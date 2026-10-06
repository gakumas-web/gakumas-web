"""当前图片交付锁的构建配置；只有 none 与 managed 两种模式。"""
import hashlib
import json
from pathlib import Path
import tempfile
from urllib.parse import urlsplit
from urllib.request import urlopen
from image_delivery import read_resource_set, source_origin
ROOT=Path(__file__).resolve().parents[1]
MAX_MANIFEST=8*1024*1024

def public_url(value):
    if not isinstance(value, str):
        raise ValueError('资源 URL 无效')
    url = urlsplit(value)
    local = url.hostname in ('127.0.0.1', 'localhost', '::1')
    if (url.scheme != 'https' and not (local and url.scheme == 'http')) or not url.netloc or url.username or url.password or url.query or url.fragment:
        raise ValueError('资源地址必须为无凭据的 HTTPS URL；仅回环测试允许 HTTP')
    if 'latest' in url.path.lower().split('/'):
        raise ValueError('资源地址必须固定版本，不能使用 latest')
    return url

def download(url, output, limit):
    public_url(url)
    size = 0
    try:
        with urlopen(url, timeout=60) as response, output.open('wb') as stream:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise ValueError('资源下载超过大小限制')
                stream.write(chunk)
    except (OSError, ValueError):
        raise ValueError('资源下载失败或超过限制') from None

def source_file(lock, key, parent, temporary, limit):
    local, remote = lock.get(key), lock.get(key + '_url')
    if bool(local) == bool(remote):
        raise ValueError(f'必须且只能指定 {key} 或 {key}_url')
    if local:
        if not isinstance(local, str):
            raise ValueError('资源文件路径无效')
        file = (parent / local).resolve()
        if not file.is_file() or file.stat().st_size > limit:
            raise ValueError('资源文件不存在或超过限制')
        return file
    file = temporary / key
    download(remote, file, limit)
    return file

def write_config(path, config):
    path.write_text('// 构建生成的资源定位；未配置的游戏图片只使用本站占位图。\nexport const imageConfig='+json.dumps(config, ensure_ascii=False, separators=(',', ':'))+';\n', encoding='utf-8')

def prepare(lock_path, staging, requirements, mirror_images=False):
    lock_path=Path(lock_path);lock=json.loads(lock_path.read_text())
    if not isinstance(lock,dict) or lock.get('format')!='gakumas-web-assets-lock' or type(lock.get('schema_version')) is not int or lock['schema_version']!=1:
        raise ValueError('资源锁格式无效')
    empty={'mode':'none','version':None,'images':[],'icons':[],'imageURLs':{},'iconURLs':{}}
    if lock.get('mode')=='none':return empty,{'mode':'none'},[]
    if lock.get('mode')!='managed':raise ValueError('图片模式只支持 none 或 managed')
    (ROOT/'local').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='image-index-',dir=ROOT/'local') as temp:
        path=source_file(lock,'index',lock_path.parent,Path(temp),MAX_MANIFEST);raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=lock.get('sha256'):raise ValueError('图片索引 SHA-256 不匹配')
        index=read_resource_set(raw,lock.get('version'))
    needed={'images/'+name for name in requirements['images']}|{'ui-icons/'+name for name in requirements['ui_icons']}
    if not needed<=index['files'].keys():raise ValueError('图片索引未覆盖内容需求')
    if mirror_images:
        # 只生成传输地址映射，不改写已被内容清单固定哈希的图片索引。
        transfers=[(pack['url'],pack,pack['sha256']+'.tar.gz') for pack in index['baseline']['packages']]
        rows={row['sha256']+Path(name).suffix:row for name,row in index['files'].items()}
        transfers.extend((index['cdn_base_url']+'objects/'+key,rows[key],key) for key in index['cdn_objects'])
        folder=staging/'image-files';folder.mkdir()
        mapping={}
        for url,row,name in transfers:
            target=folder/name
            if not target.exists():download(url,target,row['bytes'])
            if target.stat().st_size!=row['bytes'] or hashlib.sha256(target.read_bytes()).hexdigest()!=row['sha256']:
                raise ValueError('同源图片副本大小或 SHA-256 不匹配')
            mapping[url]='./image-files/'+name
        return {**empty,'mode':'managed','version':index['version'],'allowedOrigins':[],'downloadURLs':mapping}, {'mode':'managed','version':index['version'],'baseline_version':index['baseline']['version'],'files':len(index['files']),'mirrored_downloads':len(mapping)}, []
    origins={source_origin(url) for url in [index['cdn_base_url'],*[pack['url'] for pack in index['baseline']['packages']]]}
    for origin in lock.get('download_origins',[]):
        url=public_url(origin)
        if url.path not in ('','/'):raise ValueError('额外下载来源须为源站地址')
        origins.add(source_origin(origin))
    return {**empty,'mode':'managed','version':index['version'],'allowedOrigins':sorted(origins)}, {'mode':'managed','version':index['version'],'baseline_version':index['baseline']['version'],'files':len(index['files'])}, sorted(origins)
