"""检查 Git 候选文件，或按相同清单导出独立源码包；不读取被忽略的本地材料。"""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_SUFFIXES = {'.pem', '.p12', '.pfx', '.apk', '.exe', '.dll', '.so', '.log', '.pcap', '.pcapng'}
PATTERNS = {
    '个人绝对路径': re.compile(rb'/(?:home|Users)/[A-Za-z0-9][^\s"\x27]*/|[A-Z]:[\\/]+Users[\\/]+[^\s"\x27]+'),
    '私钥正文': re.compile(rb'-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}'),
    '固定服务密钥': re.compile(rb'AIza[A-Za-z0-9_-]{30,}'),
    '认证令牌正文': re.compile(rb'Bearer [A-Za-z0-9._=-]{40,}'),
}


def candidates():
    local = ROOT/'local'
    local.mkdir(exist_ok=True)
    # 隔离 Git 元数据，既验证 .gitignore，也不初始化用户仓库或使用个人 Git 设置。
    with TemporaryDirectory(prefix='public-check-', dir=local) as temporary:
        git_dir = Path(temporary)/'index.git'
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        subprocess.run(['git', 'init', '--bare', '--quiet', str(git_dir)], check=True, env=env)
        command = ['git', '-c', 'core.excludesFile=/dev/null', '--git-dir='+str(git_dir), '--work-tree='+str(ROOT)]
        result = subprocess.run(command+['ls-files', '--others', '--exclude-standard', '-z'], check=True, capture_output=True, env=env, cwd=ROOT)
        return sorted(name for name in result.stdout.decode().split('\0') if name)


def inspect(names):
    failures = []
    for name in names:
        path = ROOT/name
        if path.is_symlink() or not path.is_file():
            failures.append((name, '候选文件不是普通文件'))
            continue
        if path.suffix.lower() in FORBIDDEN_SUFFIXES or path.name in {'snapshot.json', 'capture-config.yaml', 'protocol-materials.json'}:
            failures.append((name, '本地数据或二进制进入候选集'))
        content = path.read_bytes()
        for label, pattern in PATTERNS.items():
            if pattern.search(content):
                failures.append((name, label))
        if path.suffix == '.json' and re.search(rb'"publicUserId"\s*:\s*"(?!synthetic[-_]|test[-_]|fixture[-_])[^"\s]+"', content):
            failures.append((name, 'JSON 包含非合成账号标识'))
    return failures


def export(names, destination):
    destination = destination.resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError('导出目录必须位于本仓库之外，避免递归或覆盖源码')
    if destination.exists():
        raise ValueError('导出目标已存在；请使用新的空路径')
    destination.mkdir(parents=True)
    for name in names:
        target = destination/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/name, target)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, help='可选：导出经检查的源码文件，不含任何本地材料或构建产物')
    args = parser.parse_args()
    names = candidates()
    failures = inspect(names)
    for name, reason in failures:
        # 只报告位置与类型，绝不回显可能的敏感匹配内容。
        print(f'{name}: {reason}')
    if failures:
        raise SystemExit(1)
    if args.export:
        export(names, args.export)
    print(f'公开候选检查通过：{len(names)} 个文件。')
