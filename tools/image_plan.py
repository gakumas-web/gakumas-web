"""把已核验的发行附件重组为用途小包；来源索引与原图字节保持不变。"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory


def digest(raw):return hashlib.sha256(raw).hexdigest()


def category(name):
    if name.startswith('ui-icons/'):
        return 'artwork-decoration' if 'full.' in name else 'core'
    if re.search(r'[-_]full\.webp$',name):return 'artwork-idol' if 'cidol-' in name else 'artwork-other'
    if 'achievement_' in name:
        match=re.search(r'achievement_(?:char_)?([a-z]{4})-',name)
        return 'achievements-'+(match[1] if match else 'common')
    if 'skillcard_' in name:return 'memories-skills'
    if re.search(r'produceitem|memoryability|ability|item_',name):return 'memories-items'
    if 'img_general_icon_' in name:return 'core'
    return 'catalog'


def build_plan(index,folder):
    from PIL import Image
    folder=Path(folder)
    files=dict(index['files']);thumbnails={};sources={};groups={};artworks=[]
    with TemporaryDirectory(prefix='image-plan-') as temporary:
        objects=Path(temporary)
        # 不使用 extractall；所有路径来自已验证索引，只读取普通图片文件。
        for pack in index['baseline']['packages']:
            archive=folder/(pack['sha256']+'.tar.gz');seen=set();total=0
            with tarfile.open(archive,'r:gz') as tar:
                for member in tar:
                    if not member.isfile():raise ValueError('图片基础包包含非普通文件')
                    if member.name=='manifest.json':continue
                    key=member.name.removeprefix('objects/');row=pack['objects'].get(key)
                    if not member.name.startswith('objects/') or not row or key in seen or member.size!=row['bytes']:
                        raise ValueError('图片基础包成员身份无效')
                    total+=member.size
                    if total>32*1024*1024:raise ValueError('图片基础包解包超限')
                    raw=tar.extractfile(member).read()
                    if digest(raw)!=row['sha256']:raise ValueError('图片基础包成员哈希不符')
                    (objects/key).write_bytes(raw);seen.add(key)
            if seen!=set(pack['objects']):raise ValueError('图片基础包缺少对象')
        for name,row in index['files'].items():
            key=row['sha256']+Path(name).suffix
            source=objects/key if (objects/key).exists() else folder/key
            if not source.is_file() or source.stat().st_size!=row['bytes'] or digest(source.read_bytes())!=row['sha256']:
                raise ValueError('用途包缺少已核验图片')
            sources[key]=source;group=category(name)
            # 跨用途复用的同一对象只放进一个包；基础界面的优先级最高。
            if key not in groups or group=='core':groups[key]=group
            if group.startswith('artwork') and name.startswith('images/'):
                artworks.append((name,source))
        def thumbnail(item):
            name,source=item
            with Image.open(source) as picture:
                picture.thumbnail((384,384),Image.Resampling.LANCZOS)
                out=io.BytesIO();picture.save(out,format='WEBP',quality=78,method=6)
            return name,out.getvalue()
        # 构建端有界并行生成缩略图；浏览器仍只处理已生成的小文件。
        with ThreadPoolExecutor(max_workers=4) as executor:
            for name,raw in executor.map(thumbnail,artworks):
                sha=digest(raw);thumb=name.removesuffix('.webp')+'_thumb.webp'
                files[thumb]={'sha256':sha,'bytes':len(raw)};thumbnails[name]=thumb
                key=sha+'.webp';target=objects/key;target.write_bytes(raw);sources[key]=target;groups[key]='catalog-thumbnails'
        rows={row['sha256']+Path(name).suffix:row for name,row in files.items()}
        buckets={}
        for key in rows:buckets.setdefault(groups[key],[]).append(key)
        packages=[];report=[]
        for group,keys in sorted(buckets.items()):
            limit=(2 if group=='core' else 4)*1024*1024;chunks=[];chunk={};size=0
            for key in sorted(keys):
                row=rows[key]
                if chunk and (size+row['bytes']>limit or len(chunk)>=4096):chunks.append(chunk);chunk={};size=0
                chunk[key]=row;size+=row['bytes']
            if chunk:chunks.append(chunk)
            group_bytes=0
            for chunk in chunks:
                buffer=io.BytesIO()
                with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0) as zipped:
                    with tarfile.open(fileobj=zipped,mode='w',format=tarfile.USTAR_FORMAT) as tar:
                        manifest=json.dumps({'format':'gakumas-image-base','schema_version':1,'objects':chunk},sort_keys=True,separators=(',',':')).encode()
                        for name,raw in [('manifest.json',manifest),*((('objects/'+key),sources[key].read_bytes()) for key in chunk)]:
                            entry=tarfile.TarInfo(name);entry.size=len(raw);entry.mtime=0;entry.mode=0o644;tar.addfile(entry,io.BytesIO(raw))
                raw=buffer.getvalue();sha=digest(raw);name=sha+'.tar.gz';(folder/name).write_bytes(raw)
                packages.append({'url':'./image-files/'+name,'sha256':sha,'bytes':len(raw),'objects':chunk,'group':group})
                group_bytes+=len(raw)
            report.append({'group':group,'objects':len(keys),'packages':len(chunks),'bytes':group_bytes})
    return {'version':index['version'],'files':files,'thumbnails':thumbnails,'packages':packages,'groups':report}
