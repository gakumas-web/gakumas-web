"""用独立合成仓库验证实际跟踪文件与本地忽略材料的扫描边界。"""

import importlib.util
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/check_public.py'
SPEC = importlib.util.spec_from_file_location('public_check_under_test', SCRIPT)
public = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(public)


class PublicCheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'source'
        self.root.mkdir()
        self.env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        self.root_patch = patch.object(public, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        (self.root / '.gitignore').write_text('*.exe\nlocal/\nAGENTS.md\n')
        (self.root / 'README.md').write_text('合成公开说明。\n')
        (self.root / 'local').mkdir()
        (self.root / 'local/private.exe').write_bytes(b'synthetic-local')
        (self.root / 'AGENTS.md').write_text('合成本地约定。\n')

    def git(self, *arguments):
        return subprocess.run(['git', '-C', str(self.root), *arguments],
                              check=True, capture_output=True, env=self.env)

    def test_tracked_ignored_file_is_rejected_without_reading_local_materials(self):
        self.git('init', '--quiet')
        (self.root / 'tracked.exe').write_bytes(b'synthetic-binary')
        self.git('add', '-f', 'tracked.exe')
        names = public.candidates()
        self.assertEqual(names, ['.gitignore', 'README.md', 'tracked.exe'])
        self.assertIn(('tracked.exe', '本地数据或二进制进入候选集'), public.inspect(names))

    def test_exported_tree_without_git_still_respects_ignore(self):
        names = public.candidates()
        self.assertEqual(names, ['.gitignore', 'README.md'])
        self.assertEqual(public.inspect(names), [])
        destination = self.root.parent / 'export'
        public.export(names, destination)
        self.assertEqual(sorted(path.name for path in destination.iterdir()), names)

    def test_tracked_private_text_is_rejected_without_reading_or_exporting(self):
        self.git('init', '--quiet')
        private = ['AGENTS.md', 'local/notes.md', 'dist/notes.md', '.env.example-private']
        for name in private:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('合成保留说明。\n')
            self.git('add', '-f', name)
        names = public.candidates()
        self.assertTrue(set(private).issubset(names))
        original = Path.read_bytes
        reads = []

        def read_bytes(path):
            reads.append(path.relative_to(self.root).as_posix())
            return original(path)

        with patch.object(Path, 'read_bytes', read_bytes):
            failures = public.inspect(names)
        self.assertEqual({name for name, _ in failures}, set(private))
        self.assertFalse(set(private).intersection(reads))
        destination = self.root.parent / 'export'
        # 子进程的 ROOT 由脚本位置决定，改用同目录副本验证真实 CLI 的失败边界。
        tool = self.root / 'tools/check_public.py'
        tool.parent.mkdir()
        tool.write_text(SCRIPT.read_text())
        result = subprocess.run(
            [os.sys.executable, '-B', str(tool), '--export', str(destination)],
            text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(destination.exists())

    def test_worktree_git_file_uses_its_own_index(self):
        self.git('init', '--quiet')
        self.git('add', 'README.md', '.gitignore')
        self.git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
                 'commit', '--quiet', '-m', 'synthetic')
        worktree = self.root.parent / 'worktree'
        self.git('worktree', 'add', '--quiet', '--detach', str(worktree))
        (worktree / 'tracked.exe').write_bytes(b'synthetic-binary')
        subprocess.run(['git', '-C', str(worktree), 'add', '-f', 'tracked.exe'],
                       check=True, capture_output=True, env=self.env)
        with patch.object(public, 'ROOT', worktree):
            self.assertIn('tracked.exe', public.candidates())

    def test_missing_tracked_file_is_not_silently_omitted(self):
        self.git('init', '--quiet')
        self.git('add', 'README.md')
        (self.root / 'README.md').unlink()
        names = public.candidates()
        self.assertIn('README.md', names)
        self.assertIn(('README.md', '候选文件不是普通文件'), public.inspect(names))


if __name__ == '__main__':
    unittest.main()
