"""构建纯静态站点；只读取发布白名单，不接触账号目录或任何凭据。"""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
SCOPES = ('catalog', 'effects', 'abilities', 'progression', 'achievements')
MODULE_DIRS = ('application', 'domain', 'ui', 'locales')
from resource_release import prepare, write_config, public_url
from install_content import read_release, requirements_for, install_release
from content_contract import require_web_version, validate_manifest, validate_part, sha256

def build(output, asset_lock=None, content_lock=None, mirror_images=False):
    if output.is_symlink():
        raise ValueError('输出目录不能是符号链接')
    output = output.resolve()
    # 只替换专门的构建输出，不允许覆盖源码或任意父目录。
    if output == ROOT or output in ROOT.parents or output.name != 'dist':
        raise ValueError('输出必须是名为 dist 的独立目录')
    if output.exists() and any(path.name != '.building' for path in output.iterdir()):
        try:
            previous = json.loads((output/'release.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise ValueError('输出目录含未知文件，拒绝清空') from None
        if previous.get('project') != 'gakumas-web' or previous.get('format') != 1:
            raise ValueError('输出目录不属于本构建器，拒绝覆盖')
    channel_path=output/'content/channel.json'
    if channel_path.exists():
        channel=json.loads(channel_path.read_text())
        release_dir=output/'content/releases'/channel['version']
        raw=(release_dir/'manifest.json').read_bytes()
        if sha256(raw)!=channel['sha256']:raise ValueError('已有内容频道身份不一致')
        manifest=validate_manifest(raw,channel['version'])
        for name in manifest['files']:validate_part(name,(release_dir/name).read_bytes(),manifest)
    output.mkdir(parents=True, exist_ok=True)
    staging = output / '.building'
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    for name in ('index.html', 'style.css', 'startup.js', 'app.mjs', 'i18n.mjs', 'resources.mjs', 'image-config.mjs', 'content-config.mjs'):
        shutil.copyfile(ROOT / name, staging / name)
    shutil.copyfile(ROOT/'LICENSE', staging/'LICENSE.txt')
    shutil.copyfile(ROOT/'THIRD_PARTY.md', staging/'ATTRIBUTION.txt')
    for directory in MODULE_DIRS:
        (staging / directory).mkdir()
        for source in (ROOT / directory).glob('*.mjs'):
            shutil.copyfile(source, staging / directory / source.name)
    content_data = None
    if content_lock:
        (ROOT/'local').mkdir(exist_ok=True)
        with TemporaryDirectory(prefix='content-build-', dir=ROOT/'local') as temp:
            content_data = read_release(content_lock, Path(temp))
    requirements = requirements_for(content_data[2]) if content_data else {'images': [], 'ui_icons': []}
    if content_data:
        require_web_version(content_data[1]['min_web_version'], json.loads((ROOT/'package.json').read_text())['version'])
        resource_lock = json.loads(Path(asset_lock or ROOT/'resources/asset-lock.json').read_text())
        if resource_lock.get('mode') != 'none' and (resource_lock.get('schema_version') != 1 or resource_lock.get('sha256') != content_data[1]['files']['assets-index.json']['sha256']):
            raise ValueError('初始内容与资源锁不匹配')
    if mirror_images and not content_data:raise ValueError('同源图片部署必须固定初始内容')
    config, resources, image_hosts = prepare(asset_lock or ROOT/'resources/asset-lock.json', staging, requirements, mirror_images)
    write_config(staging/'image-config.mjs', config)
    (staging / 'ui-icons').mkdir(exist_ok=True)
    (staging / 'ui-icons/unavailable.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
        '<rect width="48" height="48" rx="8" fill="#eee"/>'
        '<path d="m10 34 10-12 7 8 5-5 6 9" fill="none" stroke="#aaa" stroke-width="2"/></svg>', encoding='utf-8')
    # 程序重建保留已部署的不可变内容版本；已有文件不覆盖新构建生成的文件。
    if (output/'content').is_dir():
        for source in (output/'content').rglob('*'):
            if not source.is_file():continue
            target = staging/'content'/source.relative_to(output/'content')
            if target.exists():continue
            target.parent.mkdir(parents=True, exist_ok=True)
            os.link(source, target)
    if content_data:
        install_release(staging, *content_data)
    source = json.loads((ROOT/'resources/content-source.json').read_text())
    channel = source.get('channel_url')
    data_hosts = []
    if not isinstance(channel, str):raise ValueError('内容频道地址无效')
    if channel.startswith(('https://', 'http://')):
        url = public_url(channel);data_hosts = [url.scheme+'://'+url.netloc]
    elif channel != './content/channel.json':
        raise ValueError('本地内容频道必须为 ./content/channel.json')
    (staging/'content-config.mjs').write_text('// 构建时确定内容频道，更新资料无需重新构建程序。\nexport const contentConfig='+json.dumps({'channelURL': channel})+';\n')
    html = (staging / 'index.html').read_text(encoding='utf-8')
    policy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' "+' '.join(sorted(set(data_hosts+(image_hosts if config['mode']=='managed' else []))))+"; img-src 'self' "+("blob: " if config['mode']=='managed' else '')+' '.join(image_hosts)+"; base-uri 'none'; form-action 'none'"
    html = html.replace('<head>', '<head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+policy+'">', 1)
    (staging / 'index.html').write_text(html, encoding='utf-8')
    (staging / '.nojekyll').touch()
    records = {}
    for path in sorted(staging.rglob('*')):
        if not path.is_file() or path.relative_to(staging).parts[0]=='content':
            continue
        content = path.read_bytes()
        records[str(path.relative_to(staging))] = hashlib.sha256(content).hexdigest()
        if path.suffix in ('.mjs', '.json', '.html', '.css'):
            path.with_name(path.name+'.gz').write_bytes(gzip.compress(content, mtime=0))
    (staging / 'release.json').write_text(json.dumps({'project': 'gakumas-web', 'format': 1, 'version': json.loads((ROOT/'package.json').read_text())['version'],
        'image_policy': {'mode': config['mode'], 'hosts': image_hosts, 'download_origins': config.get('allowedOrigins', [])},
        'content_channel': channel, 'files': records}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    for path in output.iterdir():
        if path != staging:
            shutil.rmtree(path) if path.is_dir() else path.unlink()
    for path in staging.iterdir():
        path.rename(output / path.name)
    staging.rmdir()
    return len(records)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--asset-lock', type=Path, help='显式资源锁文件；默认 resources/asset-lock.json 禁用游戏图片')
    parser.add_argument('--content-lock', type=Path, help='可选初始内容版本；后续更新使用 install_content.py，无需重建程序')
    parser.add_argument('--mirror-images', action='store_true', help='下载并校验图片分段和增量，随站点同源发布；资源更新须重新构建')
    args = parser.parse_args()
    print(f'静态程序构建完成：{build(args.output, args.asset_lock, args.content_lock, args.mirror_images)} 个程序文件；内容独立发布。')
