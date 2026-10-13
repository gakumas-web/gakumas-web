"""从已验证制品创建当前部署的 Release；重复执行只补齐同一发布的附件。"""
import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from verify_portable_artifacts import verify_portable


def publish(directory,repository,commit,run_id):
    if not run_id.isascii() or not run_id.isdigit():raise ValueError('运行编号无效')
    directory=Path(directory);report=verify_portable(directory,expected_commit=commit)
    tag=f"portable-{report['version']}-{run_id}"
    command=['gh','release'];common=['--repo',repository]
    existing=subprocess.run(command+['view',tag,*common,'--json','targetCommitish,isDraft,assets'],capture_output=True,text=True)
    if existing.returncode==0:
        previous=json.loads(existing.stdout)
        if previous['targetCommitish']!=commit:raise ValueError('已有 Release 的源码提交不同，停止覆盖')
        if not previous['isDraft']:
            assets={entry['name']:entry for entry in previous['assets']}
            if not {report['archive']['name'],'SHA256SUMS','portable-release.json'}<=assets.keys() or assets[report['archive']['name']]['size']!=report['archive']['bytes']:
                raise ValueError('已有正式发布的附件不完整或大小不符，停止覆盖')
            with tempfile.TemporaryDirectory(prefix='portable-existing-') as temporary:
                subprocess.run(command+['download',tag,*common,'--pattern','SHA256SUMS','--pattern','portable-release.json','--dir',temporary],check=True)
                if (Path(temporary)/'SHA256SUMS').read_bytes()!=(directory/'SHA256SUMS').read_bytes() or json.loads((Path(temporary)/'portable-release.json').read_text())!=report:
                    raise ValueError('已有正式发布的制品身份不同，停止覆盖')
            print('便携包已发布且身份一致：'+tag)
            return
    else:subprocess.run(command+['create',tag,*common,'--target',commit,'--title',f"回忆整理室 {report['version']} · Windows 便携版",'--draft','--latest=false'],check=True)
    subprocess.run(command+['upload',tag,*common,str(directory/report['archive']['name']),str(directory/'SHA256SUMS'),str(directory/'portable-release.json'),'--clobber'],check=True)
    with tempfile.TemporaryDirectory(prefix='portable-notes-') as temporary:
        notes=Path(temporary)/'notes.md';notes.write_text(f"解压 Windows x64 便携包后，双击 `gakumas-web.exe`，访问 `http://127.0.0.1:18765/`。无需额外运行环境。\n\n此包复用本次部署的站点制品，包含网页、公开资料和图片。预览账号：{'开启' if report['preview_account'] else '关闭'}。账号数据保存在浏览器中。\n\n下载后可使用 `SHA256SUMS` 核对文件。源码提交：`{commit}`。\n",encoding='utf-8')
        subprocess.run(command+['edit',tag,*common,'--notes-file',str(notes),'--draft=false','--latest=false','--prerelease='+str('-' in report['version']).lower()],check=True)
    print('已发布便携包：'+tag)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path,required=True);args=parser.parse_args()
    publish(args.directory,os.environ['GITHUB_REPOSITORY'],os.environ['GITHUB_SHA'],os.environ['GITHUB_RUN_ID'])
