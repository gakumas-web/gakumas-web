"""复用制品前核对提交、部署选项与内容摘要，拒绝混用不同构建。"""
import argparse
import hashlib
import json
import os
import zipfile
from pathlib import Path
from package_portable import digest


def verify_site(site,expected_commit=None,expected_preview=None):
    site=Path(site).resolve();release_path=site/'release.json';release=json.loads(release_path.read_text())
    if release.get('project')!='gakumas-web' or release.get('format')!=1:raise ValueError('站点发布清单无效')
    if expected_commit and release.get('source_commit')!=expected_commit:raise ValueError('复用站点的源码提交与本次运行不一致')
    preview=bool(release.get('features',{}).get('preview_account'))
    if expected_preview is not None and preview!=expected_preview:raise ValueError('复用站点的预览账号开关与本次选择不一致')
    for name,value in release['files'].items():
        path=site/name
        if path.is_symlink() or not path.resolve().is_relative_to(site) or not path.is_file() or digest(path)!=value:raise ValueError('复用站点程序文件校验失败')
    if (site/'resources/preview-account.json').exists()!=preview:raise ValueError('预览数据文件与开关不一致')
    return {'site_release_sha256':digest(release_path),'version':release['version'],'preview_account':preview}


def verify_portable(directory,expected_commit=None,expected_site=None,expected_preview=None):
    directory=Path(directory).resolve();report=json.loads((directory/'portable-release.json').read_text())
    if report.get('project')!='gakumas-web-portable' or report.get('format')!=1 or report.get('platform')!='windows-x64':raise ValueError('便携制品清单无效')
    if expected_commit and report.get('source_commit')!=expected_commit:raise ValueError('复用便携包的源码提交不一致')
    if expected_site and report.get('site_release_sha256')!=expected_site:raise ValueError('便携包与本次站点不是同一构建')
    if expected_preview is not None and report.get('preview_account')!=expected_preview:raise ValueError('便携包预览开关不一致')
    name=report['archive']['name'];archive=directory/name
    if Path(name).name!=name or archive.is_symlink() or not archive.is_file() or archive.stat().st_size!=report['archive']['bytes'] or digest(archive)!=report['archive']['sha256']:raise ValueError('便携压缩包摘要校验失败')
    expected=report['archive']['sha256']+'  '+name+'\n'
    if (directory/'SHA256SUMS').read_text()!=expected:raise ValueError('SHA256SUMS 与制品清单不一致')
    with zipfile.ZipFile(archive) as source:
        prefix=name.removesuffix('.zip')+'/'
        for member in source.namelist():
            parts=Path(member).parts
            if not member.startswith(prefix) or '..' in parts or '\\' in member or ':' in member:raise ValueError('压缩包路径无效')
        raw=source.read(prefix+'www/release.json')
        if hashlib.sha256(raw).hexdigest()!=report['site_release_sha256']:raise ValueError('压缩包站点身份不一致')
        if hashlib.sha256(source.read(prefix+'gakumas-web.exe')).hexdigest()!=report['launcher_sha256']:raise ValueError('启动器摘要不一致')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--site',type=Path);parser.add_argument('--portable',type=Path);parser.add_argument('--expected-commit');parser.add_argument('--expected-site');parser.add_argument('--expected-preview',choices=['true','false']);args=parser.parse_args()
    preview=None if args.expected_preview is None else args.expected_preview=='true'
    if args.site:
        report=verify_site(args.site,args.expected_commit,preview)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as output:output.write('site_sha256='+report['site_release_sha256']+'\n')
    elif args.portable:report=verify_portable(args.portable,args.expected_commit,args.expected_site,preview)
    else:parser.error('需要 --site 或 --portable')
    print(json.dumps(report,ensure_ascii=False))
