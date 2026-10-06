"""从固定 Release 内容包构建同源图片站点；下载失败或身份不符时停止。"""
import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory

from build import build
from install_content import read_bundle
from prepare_locks import prepare
from resource_release import ROOT, download


def build_pages(source, output, image_cache=None, key_only=False):
    started=time.monotonic();cache_report={}
    source=json.loads(Path(source).read_text())
    size=source['bytes']
    if type(size) is not int or not 0<size<=128*1024*1024:
        raise ValueError('Pages 内容包大小无效')
    (ROOT/'local').mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='pages-',dir=ROOT/'local') as temporary:
        root=Path(temporary);bundle=root/'content.json.gz'
        download(source['bundle_url'],bundle,size)
        if bundle.stat().st_size!=size or hashlib.sha256(bundle.read_bytes()).hexdigest()!=source['sha256']:
            raise ValueError('Pages 内容包大小或 SHA-256 不匹配')
        raw,manifest,files=read_bundle(bundle)
        if manifest['version']!=source['version']:raise ValueError('Pages 内容版本不匹配')
        if key_only:
            from image_cache import cache_identity,cache_key
            return cache_key(cache_identity(hashlib.sha256(files['assets-index.json']).hexdigest()))
        content=root/'content';content.mkdir()
        for name,data in {**files,'manifest.json':raw}.items():(content/name).write_bytes(data)
        locks=root/'locks';prepare(content,locks)
        count=build(Path(output),locks/'asset-lock.json',locks/'content-lock.json',mirror_images=True,image_cache=image_cache,cache_report=cache_report)
    total=sum(path.stat().st_size for path in Path(output).rglob('*') if path.is_file())
    if total>1_000_000_000:raise ValueError('Pages 站点超过 1 GB，停止发布')
    config=json.loads((Path(output)/'image-config.mjs').read_text().split('export const imageConfig=',1)[1].strip().removesuffix(';'))
    groups=config['loadingPlan']['groups']
    program=sum(path.stat().st_size for path in Path(output).rglob('*') if path.is_file() and path.relative_to(output).parts[0] not in ('content','image-files'))
    content=sum(path.stat().st_size for path in (Path(output)/'content').rglob('*') if path.is_file())
    report={'image_cache':cache_report,'build_seconds':round(time.monotonic()-started,3),'version':source['version'],'program_files':count,'program_bytes':program,'content_bytes':content,'site_bytes':total,
            'image_delivery':'same-origin-on-demand','groups':groups,'initial_image_bytes':sum(row['bytes'] for row in groups if row['group']=='core'),
            'complete_image_bytes':sum(row['bytes'] for row in groups),'compatibility_archives':'保留当前源版本的原始分段，供此前已打开的页面完成下载；新页面只请求用途包。'}
    report_path=Path(output)/'build-report.json'
    while True:
        raw=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
        size=total+len(raw.encode())
        if report['site_bytes']==size:break
        report['site_bytes']=size
    if size>1_000_000_000:raise ValueError('Pages 站点超过 1 GB，停止发布')
    report_path.write_text(raw)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:
            summary.write(f"图片构建缓存：{cache_report.get('status','disabled')}；构建耗时：{report['build_seconds']} 秒。\n\n")
            summary.write('## Pages 构建体积\n\n| 项目 | MiB |\n| --- | ---: |\n')
            for name,key in [('程序','program_bytes'),('公共资料','content_bytes'),('无账号首次图片','initial_image_bytes'),('可选完整图片','complete_image_bytes'),('发布目录','site_bytes')]:
                summary.write(f"| {name} | {report[key]/1048576:.2f} |\n")
            summary.write('\n已有账号的首屏图片取决于当前视图；用途包和原始兼容分段分别保留，不把二者总量当作首次下载量。\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as output_file:
            output_file.write(f"cache_saved={str(cache_report.get('saved',False)).lower()}\ncache_status={cache_report.get('status','disabled')}\n")
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=ROOT/'resources/pages-source.json')
    parser.add_argument('--output',type=Path,default=ROOT/'dist')
    parser.add_argument('--image-cache',type=Path,help='可选图片构建缓存目录')
    parser.add_argument('--cache-key',action='store_true',help='只校验内容包并输出图片构建缓存键')
    args=parser.parse_args()
    result=build_pages(args.source,args.output,args.image_cache,args.cache_key)
    print(result if args.cache_key else json.dumps(result,ensure_ascii=False))
