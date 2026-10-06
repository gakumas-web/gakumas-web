"""独立安装已校验内容，不重建或改写 Web 程序；最后原子切换频道。"""
import argparse
import gzip
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urljoin

from content_contract import MAX_MANIFEST, MAX_BUNDLE, sha256, validate_manifest, validate_part, validate_bundle, require_web_version
from resource_release import ROOT, source_file, download
from image_delivery import source_origin


def read_release(lock_path, temporary):
    lock_path = Path(lock_path)
    lock = json.loads(lock_path.read_text())
    if not isinstance(lock, dict) or lock.get('format') != 'gakumas-content-lock' or lock.get('schema_version') != 1:
        raise ValueError('内容锁格式无效')
    file = source_file(lock, 'manifest', lock_path.parent, temporary, MAX_MANIFEST)
    raw = file.read_bytes()
    if sha256(raw) != lock.get('sha256'):
        raise ValueError('内容清单 SHA-256 不匹配')
    manifest = validate_manifest(raw, lock.get('version'))
    files = {}
    for name, row in manifest['files'].items():
        if lock.get('manifest_url'):
            target = temporary/name
            download(urljoin(lock['manifest_url'], name), target, row['bytes'])
        else:
            target = file.parent/name
        if target.stat().st_size != row['bytes']:
            raise ValueError('内容文件大小不匹配')
        content = target.read_bytes();validate_part(name, content, manifest);files[name] = content
    return raw, manifest, files


def read_bundle(path):
    path = Path(path)
    if path.stat().st_size > MAX_BUNDLE:
        raise ValueError('内容包超过限制')
    with path.open('rb') as stream:
        zipped = stream.read(2) == b'\x1f\x8b'
    if zipped:
        with gzip.open(path, 'rb') as stream:raw = stream.read(MAX_BUNDLE+1)
    else:raw = path.read_bytes()
    manifest, files = validate_bundle(raw)
    bundle = json.loads(raw)
    return bundle['manifest'].encode(), manifest, {name: value.encode() for name, value in files.items()}


def requirements_for(files):
    index = json.loads(files['assets-index.json'])
    names = list(index['files'])
    return {'images': sorted(name.removeprefix('images/') for name in names if name.startswith('images/')),
            'ui_icons': sorted(name.removeprefix('ui-icons/') for name in names if name.startswith('ui-icons/'))}


def install_release(output, raw, manifest, files):
    output = Path(output)
    content_root = output/'content'
    if content_root.is_symlink():raise ValueError('内容目录不能为符号链接')
    content_root.mkdir(parents=True, exist_ok=True)
    release_dir = content_root/'releases'/manifest['version']
    release_dir.parent.mkdir(exist_ok=True)
    if release_dir.exists():
        existing = release_dir/'manifest.json'
        if not existing.is_file() or existing.read_bytes() != raw:
            raise ValueError('同版本内容已存在且清单不同，禁止覆盖')
        for name, data in files.items():
            if (release_dir/name).read_bytes() != data:raise ValueError('已安装版本的内容文件发生改变，拒绝复用')
    else:
        with TemporaryDirectory(prefix='.content-', dir=release_dir.parent) as temp:
            stage = Path(temp)/'release';stage.mkdir()
            for name, data in {**files, 'manifest.json': raw}.items():
                (stage/name).write_bytes(data);(stage/(name+'.gz')).write_bytes(gzip.compress(data, mtime=0))
            stage.rename(release_dir)
    channel = {'format': 'gakumas-content-channel', 'schema_version': 1, 'version': manifest['version'],
               'manifest': 'releases/'+manifest['version']+'/manifest.json', 'sha256': sha256(raw)}
    temporary = content_root/'.channel.json.tmp'
    temporary.write_text(json.dumps(channel, ensure_ascii=False, indent=2)+'\n')
    os.replace(temporary, content_root/'channel.json')
    return {'version': manifest['version'], 'manifest_sha256': sha256(raw), 'files': len(files)}


def install(output, lock_path=None, bundle_path=None, asset_lock=None):
    output = Path(output)
    release = json.loads((output/'release.json').read_text())
    if release.get('project') != 'gakumas-web' or release.get('format') != 1:raise ValueError('目标不是已构建的 Web 目录')
    mode = release.get('image_policy', {}).get('mode', 'none')
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='content-install-', dir=ROOT/'local') as temp:
        temporary = Path(temp)
        raw, manifest, files = read_bundle(bundle_path) if bundle_path else read_release(lock_path, temporary)
        require_web_version(manifest['min_web_version'], release.get('version'))
        index=json.loads(files['assets-index.json'])
        if mode not in ('none','managed'):raise ValueError('旧图片模式已退役，需要重新构建程序')
        if mode=='managed':
            origins={source_origin(url) for url in [index['cdn_base_url'],*[pack['url'] for pack in index['baseline']['packages']]]}
            if not origins <= set(release['image_policy'].get('download_origins',[])):raise ValueError('图片来源未被当前程序允许，需要重新构建')
        if asset_lock:
            asset = json.loads(Path(asset_lock).read_text())
            if asset.get('mode') != mode or asset.get('schema_version') != 1 or asset.get('sha256') != manifest['files']['assets-index.json']['sha256']:
                raise ValueError('资源锁与内容版本或已部署图片模式不匹配')
        return install_release(output, raw, manifest, files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--lock', type=Path)
    source.add_argument('--bundle', type=Path)
    parser.add_argument('--asset-lock', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT/'dist')
    args = parser.parse_args()
    print(json.dumps(install(args.output, args.lock, args.bundle, args.asset_lock), ensure_ascii=False))
