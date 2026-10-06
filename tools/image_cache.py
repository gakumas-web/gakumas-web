"""复用已校验的图片构建产物；缓存不包含程序、账号或凭据。"""
import hashlib
import json
import platform
import re
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
import uuid
import zlib

from image_delivery import validate_delivery
from image_plan import category,thumbnail_group

ROOT=Path(__file__).resolve().parents[1]
CACHE_FORMAT=1


def digest_file(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def cache_identity(index_sha,image_groups=None):
    from PIL import __version__ as pillow_version, features
    sources=['tools/image_plan.py','tools/image_delivery.py','tools/image_cache.py','tools/resource_release.py','requirements-build.txt']
    return {'format':CACHE_FORMAT,'index_sha256':index_sha,
            'grouping_sha256':hashlib.sha256(json.dumps(image_groups or {},sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
            'generator':{name:digest_file(ROOT/name) for name in sources},
            'python':platform.python_version(),'pillow':pillow_version,'webp':features.version('webp'),
            'zlib':zlib.ZLIB_RUNTIME_VERSION,'system':platform.system(),'machine':platform.machine()}


def cache_key(identity):
    raw=json.dumps(identity,sort_keys=True,separators=(',',':')).encode()
    return 'pages-images-v1-'+hashlib.sha256(raw).hexdigest()


def validate_plan(plan,index,image_groups=None):
    if not isinstance(plan,dict) or plan.get('version')!=index['version']:raise ValueError('缓存图片版本不匹配')
    expected_thumbnails={name:name.removesuffix('.webp')+'_thumb.webp' for name in index['files'] if name.startswith('images/') and category(name,image_groups).startswith('artwork')}
    if plan.get('thumbnails')!=expected_thumbnails:raise ValueError('缓存缩略图映射不匹配')
    files=plan.get('files',{})
    if set(files)!=set(index['files'])|set(expected_thumbnails.values()) or any(files.get(name)!=row for name,row in index['files'].items()):
        raise ValueError('缓存改变了来源图片身份')
    packages=plan.get('packages',[])
    for pack in packages:
        if pack.get('url')!='./image-files/'+str(pack.get('sha256'))+'.tar.gz':raise ValueError('缓存用途包路径无效')
    validate_delivery({**index,'files':files,'cdn_objects':[],
        'baseline':{'version':index['baseline']['version'],'packages':[{**pack,'url':'https://cache.example.invalid/'+pack['sha256']+'.tar.gz'} for pack in packages]}})
    expected_groups={}
    for name,row in index['files'].items():
        key=row['sha256']+Path(name).suffix;group=category(name,image_groups)
        if key not in expected_groups or group=='core':expected_groups[key]=group
    for original,name in expected_thumbnails.items():
        expected_groups.setdefault(files[name]['sha256']+Path(name).suffix,thumbnail_group(expected_groups[index['files'][original]['sha256']+Path(original).suffix]))
    groups={}
    for pack in packages:
        group=pack.get('group')
        if any(expected_groups.get(key)!=group for key in pack['objects']):raise ValueError('缓存用途分组不匹配')
        row=groups.setdefault(group,{'group':group,'objects':0,'packages':0,'bytes':0})
        row['objects']+=len(pack['objects']);row['packages']+=1;row['bytes']+=pack['bytes']
    if plan.get('groups')!=[groups[key] for key in sorted(groups)]:raise ValueError('缓存用途包统计不匹配')


def expected_files(plan,transfers):
    records={name:{'sha256':row['sha256'],'bytes':row['bytes']} for _,row,name in transfers}
    for pack in plan['packages']:records[pack['sha256']+'.tar.gz']={'sha256':pack['sha256'],'bytes':pack['bytes']}
    return records


def read_cache(entry,identity,index,transfers,image_groups=None):
    manifest=entry/'manifest.json';folder=entry/'image-files'
    if entry.is_symlink() or manifest.is_symlink() or folder.is_symlink() or manifest.stat().st_size>32*1024*1024:
        raise ValueError('图片缓存目录或清单无效')
    document=json.loads(manifest.read_text())
    if document.get('identity')!=identity:raise ValueError('图片缓存输入身份不匹配')
    plan=document['plan'];validate_plan(plan,index,image_groups)
    records=expected_files(plan,transfers)
    if document.get('files')!=records or {path.name for path in folder.iterdir()}!=set(records):raise ValueError('图片缓存文件集合不匹配')
    for name,row in records.items():
        if not re.fullmatch(r'[a-f0-9]{64}\.(?:tar\.gz|webp|png)',name):raise ValueError('图片缓存文件名无效')
        path=folder/name
        if path.is_symlink() or not path.is_file() or path.stat().st_size!=row['bytes'] or digest_file(path)!=row['sha256']:
            raise ValueError('图片缓存文件大小或哈希不匹配')
    return plan,records


def restore(cache,identity,index,transfers,output,image_groups=None):
    entry=Path(cache)/cache_key(identity)
    if not entry.exists():return None,'miss'
    try:plan,records=read_cache(entry,identity,index,transfers,image_groups)
    except (OSError,ValueError,TypeError,KeyError,AttributeError):return None,'invalid'
    # 全部检查通过后才复制，避免半份缓存影响后续正常重建。
    for name in records:shutil.copyfile(entry/'image-files'/name,output/name)
    return plan,'hit'


def save(cache,identity,index,transfers,plan,folder,image_groups=None):
    cache=Path(cache);cache.mkdir(parents=True,exist_ok=True)
    entry=cache/cache_key(identity);records=expected_files(plan,transfers)
    with TemporaryDirectory(prefix='image-cache-',dir=cache) as temporary:
        staged=Path(temporary)/'entry';(staged/'image-files').mkdir(parents=True)
        for name in records:shutil.copyfile(folder/name,staged/'image-files'/name)
        (staged/'manifest.json').write_text(json.dumps({'identity':identity,'plan':plan,'files':records},separators=(',',':'))+'\n')
        read_cache(staged,identity,index,transfers,image_groups)
        if entry.exists():entry.rename(cache/(entry.name+'.invalid-'+uuid.uuid4().hex))
        staged.rename(entry)
