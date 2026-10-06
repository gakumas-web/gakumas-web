"""从固定 Release 内容包构建同源图片站点；下载失败或身份不符时停止。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from build import build
from install_content import read_bundle
from prepare_locks import prepare
from resource_release import ROOT, download


def build_pages(source, output):
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
        content=root/'content';content.mkdir()
        for name,data in {**files,'manifest.json':raw}.items():(content/name).write_bytes(data)
        locks=root/'locks';prepare(content,locks)
        count=build(Path(output),locks/'asset-lock.json',locks/'content-lock.json',mirror_images=True)
    total=sum(path.stat().st_size for path in Path(output).rglob('*') if path.is_file())
    if total>1_000_000_000:raise ValueError('Pages 站点超过 1 GB，停止发布')
    config=json.loads((Path(output)/'image-config.mjs').read_text().split('export const imageConfig=',1)[1].strip().removesuffix(';'))
    groups=config['loadingPlan']['groups']
    program=sum(path.stat().st_size for path in Path(output).rglob('*') if path.is_file() and path.relative_to(output).parts[0] not in ('content','image-files'))
    content=sum(path.stat().st_size for path in (Path(output)/'content').rglob('*') if path.is_file())
    report={'version':source['version'],'program_files':count,'program_bytes':program,'content_bytes':content,'site_bytes':total,
            'image_delivery':'same-origin-on-demand','groups':groups,'initial_image_bytes':sum(row['bytes'] for row in groups if row['group']=='core'),
            'complete_image_bytes':sum(row['bytes'] for row in groups),'compatibility_archives':'保留当前源版本的原始分段，供此前已打开的页面完成下载；新页面只请求用途包。'}
    (Path(output)/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:
            summary.write('## Pages 构建体积\n\n| 项目 | MiB |\n| --- | ---: |\n')
            for name,key in [('程序','program_bytes'),('公共资料','content_bytes'),('无账号首次图片','initial_image_bytes'),('可选完整图片','complete_image_bytes'),('发布目录','site_bytes')]:
                summary.write(f"| {name} | {report[key]/1048576:.2f} |\n")
            summary.write('\n已有账号的首屏图片取决于当前视图；用途包和原始兼容分段分别保留，不把二者总量当作首次下载量。\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=ROOT/'resources/pages-source.json')
    parser.add_argument('--output',type=Path,default=ROOT/'dist')
    args=parser.parse_args()
    print(json.dumps(build_pages(args.source,args.output),ensure_ascii=False))
