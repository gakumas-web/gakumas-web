"""读取公开发布引用，固定本次 Pages 构建输入；不读取 CNB 凭据或其它项目源码。"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT/'resources/content-publication.json'
MAX_SOURCE = 64 * 1024
HASH = re.compile(r'[a-f0-9]{64}\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
VERSION = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z')
REPOSITORY = 'https://cnb.cool/birdnest_333/gakumas-data.git'


def validate_source(source):
    if not isinstance(source, dict) or source.get('format') != 'gakumas-content-publication' or type(source.get('schema_version')) is not int or source['schema_version'] != 1:
        raise ValueError('公共资料发布引用格式无效')
    version = source.get('version')
    if not isinstance(version, str) or not VERSION.fullmatch(version):raise ValueError('公共资料版本无效')
    expected = 'https://cnb.cool/birdnest_333/gakumas-data/-/releases/download/content-'+version+'/gakumas-content-'+version+'.json.gz'
    if source.get('bundle_url') != expected:raise ValueError('公共资料包地址不属于固定发布仓库和版本')
    if type(source.get('bytes')) is not int or not 0 < source['bytes'] <= 128*1024*1024:raise ValueError('公共资料包大小无效')
    for key in ['sha256', 'manifest_sha256', 'assets_sha256', 'master_revision']:
        if not isinstance(source.get(key), str) or not HASH.fullmatch(source[key]):raise ValueError('公共资料哈希无效：'+key)
    for key in ['data_commit', 'asset_commit']:
        if not isinstance(source.get(key), str) or not COMMIT.fullmatch(source[key]):raise ValueError('公共资料固定提交无效：'+key)
    if not isinstance(source.get('assets_version'), str) or not VERSION.fullmatch(source['assets_version']):raise ValueError('图片交付版本无效')
    return source


def git(root, *args):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_ASKPASS': '/bin/false'}
    result = subprocess.run(['git', '-c', 'credential.helper=', *args], cwd=root, env=env, capture_output=True)
    if result.returncode:raise RuntimeError('公开资料引用读取失败：'+args[0])
    return result.stdout


def resolve_source(config=CONFIG):
    config = json.loads(Path(config).read_text())
    if config.get('format') != 'gakumas-content-publication-source' or config.get('schema_version') != 1 or config.get('repository') != REPOSITORY or config.get('ref') != 'refs/heads/content-channel' or config.get('path') != 'pages-source.json':
        raise ValueError('公共资料引用源配置无效')
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='content-source-', dir=ROOT/'local') as temporary:
        root = Path(temporary);git(root, 'init', '--quiet')
        found = git(root, 'ls-remote', REPOSITORY, config['ref']).decode().strip()
        if not found:return None
        # 每次构建只解析一次；后续缓存键与实际构建使用同一份固定引用。
        git(root, 'fetch', '--quiet', '--depth=1', REPOSITORY, config['ref'])
        raw = git(root, 'show', 'FETCH_HEAD:'+config['path'])
        if len(raw) > MAX_SOURCE:raise ValueError('公共资料引用超过大小限制')
        return validate_source(json.loads(raw))


def online_channel(site_url):
    try:
        with urlopen(Request(urljoin(site_url, 'content/channel.json'), headers={'Cache-Control': 'no-cache', 'User-Agent': 'gakumas-content-sync'}), timeout=30) as response:
            raw = response.read(MAX_SOURCE+1)
    except HTTPError as error:
        if error.code == 404:return None
        raise RuntimeError('线上公共资料频道读取失败，HTTP '+str(error.code)) from None
    if len(raw) > MAX_SOURCE:raise ValueError('线上公共资料频道超过大小限制')
    channel = json.loads(raw)
    if channel.get('format') != 'gakumas-content-channel' or channel.get('schema_version') != 1:raise ValueError('线上公共资料频道格式无效')
    return channel


def same_release(source, channel):
    return bool(channel and channel.get('version') == source['version'] and channel.get('sha256') == source['manifest_sha256'])


def write_outputs(values):
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, value in values.items():output.write(key+'='+str(value).lower()+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'local/content-source/pages-source.json')
    parser.add_argument('--check-site', action='store_true')
    parser.add_argument('--verify-current', type=Path)
    parser.add_argument('--allow-bootstrap', action='store_true')
    args = parser.parse_args()
    source = resolve_source()
    if args.verify_current:
        candidate = json.loads(args.verify_current.read_text())
        if source is None or validate_source(candidate) != source:raise ValueError('发布引用已变化，停止旧构建部署；下一轮使用最新输入')
        print('公共资料发布引用仍匹配当前候选。');return
    if source is None:
        write_outputs({'ready': False, 'changed': False})
        if not args.allow_bootstrap:
            print('公共资料发布引用尚未建立，本次不触发 Pages。');return
        source = json.loads((ROOT/'resources/pages-source.json').read_text())
        state = 'bootstrap'
    else:
        config = json.loads(CONFIG.read_text())
        changed = not same_release(source, online_channel(config['site_url'])) if args.check_site else True
        if args.check_site:
            from update_contest_engine import inspect,deployed_lock,write
            previous=deployed_lock(config['site_url']);plan=inspect(previous=previous);write(args.output.parent/'engine-update.json',plan)
            changed=(previous or {}).get('commit')!=plan['selected_commit'] or changed
        write_outputs({'ready': True, 'changed': changed})
        state = 'changed' if changed else 'unchanged'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(source, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'state': state, 'version': source['version']}, ensure_ascii=False))


if __name__ == '__main__':main()
