"""从本地发布物生成配套锁及预检报告；不下载、不安装、不修改既有锁。"""
import argparse
import json
import os
from pathlib import Path
from content_contract import validate_manifest, validate_part, require_web_version, sha256
from image_delivery import read_resource_set
from resource_release import public_url, ROOT
from image_delivery import source_origin


def prepare(release_dir, output, mode=None, assets_index=None, site=None, download_origins=None):
    release_dir, output = Path(release_dir).resolve(), Path(output).resolve()
    raw = (release_dir/'manifest.json').read_bytes()
    manifest = validate_manifest(raw)
    for name in manifest['files']:validate_part(name, (release_dir/name).read_bytes(), manifest)
    content_index=read_resource_set((release_dir/'assets-index.json').read_bytes())
    mode=mode or 'managed'
    deployed = json.loads((Path(site)/'release.json').read_text()) if site else None
    if deployed and (deployed.get('project') != 'gakumas-web' or deployed.get('format') != 1):raise ValueError('目标不是 Web 构建目录')
    current = deployed['version'] if deployed else json.loads((ROOT/'package.json').read_text())['version']
    require_web_version(manifest['min_web_version'], current)
    if deployed and deployed.get('image_policy', {}).get('mode', 'none') != mode:
        raise ValueError('图片模式与已部署程序不一致，需要重新构建程序')
    if mode not in ('none', 'managed'):raise ValueError('图片模式无效')
    index_path = Path(assets_index).resolve() if assets_index else release_dir/'assets-index.json'
    index_raw = index_path.read_bytes()
    if sha256(index_raw) != manifest['files']['assets-index.json']['sha256']:raise ValueError('资源索引与内容发布物不匹配')
    index = read_resource_set(index_raw)
    asset = {'format': 'gakumas-web-assets-lock', 'schema_version': 1, 'mode': mode,
             'version': index['version'], 'sha256': sha256(index_raw), 'index': os.path.relpath(index_path, output)}
    if mode == 'managed':
        asset['download_origins']=download_origins or []
        urls=[index['cdn_base_url'],*[pack['url'] for pack in index['baseline']['packages']]]
        origins={source_origin(url) for url in urls}
        for origin in asset['download_origins']:
            parsed=public_url(origin)
            if parsed.path not in ('','/'):raise ValueError('额外下载来源须为源站地址')
            origins.add(source_origin(origin))
        if deployed and not origins <= set(deployed['image_policy'].get('download_origins',[])):
            raise ValueError('图片来源未被当前部署允许，需要重新构建程序')
    content = {'format': 'gakumas-content-lock', 'schema_version': 1, 'version': manifest['version'],
               'sha256': sha256(raw), 'manifest': os.path.relpath(release_dir/'manifest.json', output)}
    report = {'state': 'ready', 'content_version': manifest['version'], 'assets_version': index['version'],
              'image_mode': mode, 'web_version': current, 'cdn_access_verified': False}
    output.mkdir(parents=True, exist_ok=False)
    for name, value in [('content-lock.json', content), ('asset-lock.json', asset), ('report.json', report)]:
        (output/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['none', 'managed'])
    parser.add_argument('--assets-index', type=Path)
    parser.add_argument('--site', type=Path, help='可选：预检已有部署的程序版本和图片模式')
    parser.add_argument('--download-origin', action='append', help='显式允许 Release 重定向的下载源站')
    args = parser.parse_args()
    print(json.dumps(prepare(args.release, args.output, args.mode, args.assets_index, args.site, args.download_origin), ensure_ascii=False))
