"""将已构建站点与 Windows 启动器封装为可复用制品，不读取账号目录。"""
import argparse
import hashlib
import json
import re
import struct
import zipfile
from pathlib import Path


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def package(site,launcher,go_license,output):
    site=Path(site).resolve();launcher=Path(launcher).resolve();output=Path(output).resolve()
    if output==site or site in output.parents:raise ValueError('制品目录不能位于站点目录内')
    release_path=site/'release.json';release=json.loads(release_path.read_text())
    if release.get('project')!='gakumas-web' or release.get('format')!=1:raise ValueError('站点发布清单无效')
    version=release['version']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*',version):raise ValueError('程序版本不能用于制品文件名')
    for name,expected in release['files'].items():
        target=site/name
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(site) or digest(target)!=expected:raise ValueError('站点程序文件校验失败：'+name)
    files=sorted(path for path in site.rglob('*') if path.is_file() or path.is_symlink())
    names=set()
    for path in files:
        name=path.relative_to(site).as_posix()
        if path.is_symlink() or not path.resolve().is_relative_to(site):raise ValueError('站点包含符号链接')
        if name.casefold() in names:raise ValueError('站点文件在 Windows 下存在大小写冲突')
        names.add(name.casefold())
        if any(part.endswith(('.', ' ')) or re.search(r'[<>:"|?*]',part) for part in path.relative_to(site).parts):raise ValueError('站点文件名不兼容 Windows')
        parts=path.relative_to(site).parts
        content_file=(len(parts)==2 and parts[0]=='content' and parts[1] in {'channel.json','channel.json.gz','publication.json','engine-source.json'}) or (len(parts)==4 and parts[:2]==('content','releases') and parts[3].removesuffix('.gz') in {'manifest.json','catalog.json','effects.json','abilities.json','progression.json','achievements.json','assets-index.json'})
        if name not in release['files'] and name not in {'release.json','build-report.json'} and not (name.endswith('.gz') and name[:-3] in release['files']) and not content_file:
            raise ValueError('站点包含未登记文件：'+name)
    raw=launcher.read_bytes()
    offset=struct.unpack_from('<I',raw,60)[0] if len(raw)>=64 else len(raw)
    if raw[:2]!=b'MZ' or raw[offset:offset+4]!=b'PE\0\0' or raw[offset+4:offset+6]!=b'\x64\x86':raise ValueError('启动器不是 Windows x64 PE 程序')
    prefix=f'gakumas-web-{version}-windows-x64';output.mkdir(parents=True,exist_ok=True);archive=output/(prefix+'.zip')
    if archive.exists():raise ValueError('目标便携包已存在，请使用新的制品目录')
    instruction=f'''回忆整理室 Windows 便携版 {version}

1. 完整解压此压缩包，不要只取出 exe。
2. 双击 gakumas-web.exe，浏览器将打开 http://127.0.0.1:18765/。
3. 保持启动窗口开启；关闭窗口或按 Ctrl+C 停止服务。

无需安装 Python、Node.js、Docker 或 Go。需要本机浏览器。
网页、公共资料和图片与本次站点部署使用同一份构建。
预览账号：{'开启' if release.get('features',{}).get('preview_account') else '关闭'}。
账号数据保存在浏览器中，不写入此文件夹，也不会上传。
升级时解压到新的目录，关闭旧服务后再启动；相同浏览器和端口继续使用原有账号数据。
更换电脑或浏览器前请通过页面导出账号数据包。
端口被占用时先关闭原服务。高级用法：gakumas-web.exe --port 18766。
应用源码见此 Release 对应的 Git 标签；许可证位于 www/LICENSE.txt 和 www/ATTRIBUTION.txt。
启动器及页面遵循相同项目许可证；Go 运行库许可证另见 LICENSE-Go.txt。
'''
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as target:
        target.write(launcher,prefix+'/gakumas-web.exe')
        target.writestr(prefix+'/README.txt',instruction.encode('utf-8-sig'))
        target.write(go_license,prefix+'/LICENSE-Go.txt')
        for path in files:target.write(path,prefix+'/www/'+path.relative_to(site).as_posix())
    if archive.stat().st_size>=2*1024**3:
        archive.unlink();raise ValueError('便携包超过单个 Release 附件限制')
    report={'format':1,'project':'gakumas-web-portable','version':version,'platform':'windows-x64','source_commit':release.get('source_commit'),
            'site_release_sha256':digest(release_path),'preview_account':bool(release.get('features',{}).get('preview_account')),
            'launcher_sha256':digest(launcher),'archive':{'name':archive.name,'bytes':archive.stat().st_size,'sha256':digest(archive)}}
    (output/'portable-release.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'SHA256SUMS').write_text(report['archive']['sha256']+'  '+archive.name+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--site',type=Path,required=True);parser.add_argument('--launcher',type=Path,required=True);parser.add_argument('--go-license',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    print(json.dumps(package(args.site,args.launcher,args.go_license,args.output),ensure_ascii=False))
