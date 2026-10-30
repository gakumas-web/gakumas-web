"""验证本地预览频道配置、产物身份及失败恢复，不读取账号缓存。"""

import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build import build
from content_source import configure_content_channel

CHANNEL = 'https://gakumas-web.github.io/gakumas-web/content/channel.json'


class PreviewChannelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryDirectory()
        cls.source = Path(cls.fixture.name) / 'dist'
        build(cls.source)
        html = (cls.source / 'index.html').read_text().replace("connect-src 'self'", "connect-src 'self' https://images.example.test https://existing.example.test")
        (cls.source / 'index.html').write_text(html)
        (cls.source / 'index.html.gz').write_bytes(gzip.compress(html.encode(), mtime=0))
        release = json.loads((cls.source / 'release.json').read_text())
        release['files']['index.html'] = hashlib.sha256(html.encode()).hexdigest()
        release['source_commit'] = 'a' * 40
        release['build_run_id'] = '12345'
        (cls.source / 'release.json').write_text(json.dumps(release))
        (cls.source / 'content').mkdir()
        (cls.source / 'content/channel.json').write_text('{"fixture":"local bootstrap"}')

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / 'dist'
        shutil.copytree(self.source, self.output)

    def snapshot(self):
        return {path.relative_to(self.output).as_posix(): path.read_bytes() for path in self.output.rglob('*') if path.is_file()}

    def test_updates_only_channel_files_and_is_idempotent(self):
        before = self.snapshot()
        configure_content_channel(self.output, CHANNEL)
        after = self.snapshot()
        config = after['content-config.mjs'].decode().split('export const contentConfig=')[1].rstrip(';\n')
        self.assertEqual(json.loads(config), {'channelURL': CHANNEL, 'bootstrapChannelURL': './content/channel.json'})
        connection = re.search(r'connect-src ([^;]*)', after['index.html'].decode()).group(1)
        self.assertEqual(connection.split(), ["'self'", 'https://images.example.test', 'https://existing.example.test', 'https://gakumas-web.github.io'])
        allowed = {'content-config.mjs', 'content-config.mjs.gz', 'index.html', 'index.html.gz', 'release.json'}
        self.assertEqual({name for name in before if before[name] != after[name]}, allowed)
        old_release = json.loads(before['release.json'])
        release = json.loads(after['release.json'])
        self.assertEqual(release['content_channel'], CHANNEL)
        for name in ('index.html', 'content-config.mjs'):
            self.assertEqual(release['files'][name], hashlib.sha256(after[name]).hexdigest())
            self.assertEqual(gzip.decompress(after[name + '.gz']), after[name])
            old_release['files'][name] = release['files'][name]
        old_release['content_channel'] = CHANNEL
        self.assertEqual(release, old_release)
        with patch('content_source.os.replace') as replace:
            configure_content_channel(self.output, CHANNEL)
        replace.assert_not_called()
        self.assertEqual(after, self.snapshot())

    def test_invalid_inputs_leave_all_files_unchanged(self):
        for channel in ('http://example.test/channel.json', 'https://user:secret@example.test/channel.json', 'https://example.test/channel.json?token=secret', 'https://example.test;other/channel.json'):
            with self.subTest(channel=channel):
                before = self.snapshot()
                with self.assertRaises(ValueError):
                    configure_content_channel(self.output, channel)
                self.assertEqual(before, self.snapshot())
        for mutation in ('format', 'project', 'hash', 'gzip', 'missing', 'csp'):
            with self.subTest(mutation=mutation):
                shutil.rmtree(self.output)
                shutil.copytree(self.source, self.output)
                release = json.loads((self.output / 'release.json').read_text())
                if mutation == 'format':
                    release['format'] = 2
                elif mutation == 'project':
                    release['project'] = 'other-project'
                elif mutation == 'hash':
                    release['files']['index.html'] = '0' * 64
                elif mutation == 'gzip':
                    (self.output / 'index.html.gz').write_bytes(gzip.compress(b'wrong'))
                elif mutation == 'missing':
                    (self.output / 'content-config.mjs.gz').unlink()
                elif mutation == 'csp':
                    data = (self.output / 'index.html').read_bytes().replace(b'connect-src', b'missing-src')
                    (self.output / 'index.html').write_bytes(data)
                    (self.output / 'index.html.gz').write_bytes(gzip.compress(data, mtime=0))
                    release['files']['index.html'] = hashlib.sha256(data).hexdigest()
                (self.output / 'release.json').write_text(json.dumps(release))
                before = self.snapshot()
                with self.assertRaises(ValueError):
                    configure_content_channel(self.output, CHANNEL)
                self.assertEqual(before, self.snapshot())

    def test_replace_failure_restores_original_bytes(self):
        before = self.snapshot()
        import os
        replace = os.replace
        calls = 0

        def fail_second(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('replace failed')
            replace(source, target)

        with patch('content_source.os.replace', side_effect=fail_second):
            with self.assertRaises(OSError):
                configure_content_channel(self.output, CHANNEL)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(list(self.output.glob('.preview-channel-*')))

    def test_cli_serves_configured_output(self):
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0))
            port = available.getsockname()[1]
        command = [sys.executable, '-B', str(ROOT / 'tools/preview.py'), str(port), '--directory', str(self.output), '--content-channel-url', CHANNEL]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertIn('Serving preview at', process.stdout.readline())
            with urlopen(f'http://127.0.0.1:{port}/content-config.mjs', timeout=5) as response:
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertIn(CHANNEL, response.read().decode())
        finally:
            process.terminate()
            process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
