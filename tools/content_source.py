"""为当前格式的本地构建配置公共资料频道，保留本地启动资料。"""

import gzip
import hashlib
import json
import os
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit


def configure_content_channel(directory, channel_url):
    """先核验产物身份，再同步更新配置、CSP、预压缩文件及发布哈希。"""
    if not isinstance(channel_url, str) or re.search(r'''[\s<>"';`\\]''', channel_url):
        raise ValueError('内容频道必须为无凭据的 HTTPS URL')
    url = urlsplit(channel_url)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('内容频道必须为无凭据的 HTTPS URL')
    _ = url.port
    origin = url.scheme + '://' + url.netloc
    output = Path(directory)
    if output.is_symlink() or not output.is_dir():
        raise ValueError('预览目录必须是现有构建目录')
    names = ('index.html', 'index.html.gz', 'content-config.mjs', 'content-config.mjs.gz', 'release.json')
    originals = {}
    for name in names:
        path = output / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'预览构建缺少常规文件：{name}')
        originals[name] = path.read_bytes()
    release = json.loads(originals['release.json'])
    if not isinstance(release, dict) or release.get('project') != 'gakumas-web' or release.get('format') != 1 or not isinstance(release.get('files'), dict):
        raise ValueError('预览目录不是当前格式的 gakumas-web 构建')
    for name in ('index.html', 'content-config.mjs'):
        if hashlib.sha256(originals[name]).hexdigest() != release['files'].get(name):
            raise ValueError(f'预览程序文件身份不一致：{name}')
        if gzip.decompress(originals[name + '.gz']) != originals[name]:
            raise ValueError(f'预览预压缩文件不一致：{name}')
    html = originals['index.html'].decode('utf-8')
    policy_pattern = r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)'
    policies = list(re.finditer(policy_pattern, html))
    if len(policies) != 1:
        raise ValueError('预览构建必须包含唯一的 CSP')
    policy_match = policies[0]
    policy = policy_match.group(2)
    connections = list(re.finditer(r'(^|;)\s*connect-src\s+([^;]*)', policy))
    if len(connections) != 1:
        raise ValueError('预览 CSP 必须包含唯一的 connect-src')
    connection = connections[0]
    if origin not in connection.group(2).split():
        # 只追加频道来源，保留图片及其他已有连接权限。
        position = connection.start(2) + len(connection.group(2).rstrip())
        policy = policy[:position] + ' ' + origin + policy[position:]
    html = html[:policy_match.start(2)] + policy + html[policy_match.end(2):]
    config = {'channelURL': channel_url, 'bootstrapChannelURL': './content/channel.json'}
    updated = {
        'index.html': html.encode('utf-8'),
        'content-config.mjs': ('// 本地预览使用公共频道，首次启动保留随站点提供的资料。\nexport const contentConfig=' + json.dumps(config) + ';\n').encode('utf-8'),
    }
    for name, data in list(updated.items()):
        release['files'][name] = hashlib.sha256(data).hexdigest()
        updated[name + '.gz'] = gzip.compress(data, mtime=0)
    release['content_channel'] = channel_url
    updated['release.json'] = (json.dumps(release, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    changes = {name: data for name, data in updated.items() if data != originals[name]}
    if not changes:
        return
    # 启动服务前准备所有文件；替换失败时恢复原字节，避免保留混合身份。
    with TemporaryDirectory(prefix='.preview-channel-', dir=output) as temporary:
        staging = Path(temporary)
        for name, data in changes.items():
            (staging / name).write_bytes(data)
            (staging / (name + '.original')).write_bytes(originals[name])
        replaced = []
        try:
            for name in changes:
                os.replace(staging / name, output / name)
                replaced.append(name)
        except OSError:
            for name in replaced:
                os.replace(staging / (name + '.original'), output / name)
            raise
