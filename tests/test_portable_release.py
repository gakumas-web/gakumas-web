"""验证便携制品封装及复用身份，外部发布只检查命令合同。"""
import contextlib
import io
import hashlib

import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from package_portable import package
from verify_portable_artifacts import verify_site,verify_portable
from publish_portable import publish


class PortableReleaseTest(unittest.TestCase):
    def fixture(self,root):
        site=root/'dist';site.mkdir();(site/'index.html').write_text('<!doctype html><title>fixture</title>')
        release={'project':'gakumas-web','format':1,'version':'0.0.0-test','source_commit':'a'*40,'features':{'preview_account':False},'files':{'index.html':hashlib.sha256((site/'index.html').read_bytes()).hexdigest()}}
        (site/'release.json').write_text(json.dumps(release))
        # 此最小 PE 头仅用于归档边界测试；实际启动由原生 exe 冒烟验证覆盖。
        header=bytearray(128);header[:2]=b'MZ';struct.pack_into('<I',header,60,64);header[64:70]=b'PE\0\0\x64\x86'
        launcher=root/'launcher.exe';launcher.write_bytes(header);license=root/'LICENSE';license.write_text('synthetic license')
        return site,launcher,license

    def test_package_identity_and_reuse_rejections(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site,launcher,license=self.fixture(root);output=root/'output';report=package(site,launcher,license,output)
            identity=verify_site(site,'a'*40,False);self.assertEqual(verify_portable(output,'a'*40,identity['site_release_sha256'],False),report)
            with self.assertRaises(ValueError):verify_site(site,'b'*40,False)
            with self.assertRaises(ValueError):verify_site(site,'a'*40,True)
            with self.assertRaises(ValueError):verify_portable(output,'a'*40,'0'*64,False)
            with (output/report['archive']['name']).open('ab') as stream:stream.write(b'changed')
            with self.assertRaises(ValueError):verify_portable(output)

    def test_unregistered_files_and_corrupt_site_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site,launcher,license=self.fixture(root);(site/'private.json').write_text('{}')
            with self.assertRaises(ValueError):package(site,launcher,license,root/'output')
            (site/'private.json').unlink();(site/'index.html').write_text('changed')
            with self.assertRaises(ValueError):package(site,launcher,license,root/'output')

    def test_release_is_draft_until_artifacts_uploaded(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site,launcher,license=self.fixture(root);output=root/'output';package(site,launcher,license,output);commands=[]
            def run(command,**kwargs):
                commands.append(command)
                return type('Result',(),{'returncode':1 if command[2]=='view' else 0,'stdout':''})()
            with patch('publish_portable.subprocess.run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):publish(output,'example/example','a'*40,'123')
            self.assertEqual([command[2] for command in commands],['view','create','upload','edit']);self.assertIn('--draft',commands[1]);self.assertIn('--draft=false',commands[-1]);self.assertIn('--clobber',commands[2])

    def test_published_release_is_reused_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);site,launcher,license=self.fixture(root);output=root/'output';report=package(site,launcher,license,output);commands=[]
            def run(command,**kwargs):
                commands.append(command)
                if command[2]=='download':
                    target=Path(command[command.index('--dir')+1])
                    for name in ['SHA256SUMS','portable-release.json']:(target/name).write_bytes((output/name).read_bytes())
                data={'targetCommitish':'a'*40,'isDraft':False,'assets':[{'name':report['archive']['name'],'size':report['archive']['bytes']},{'name':'SHA256SUMS'},{'name':'portable-release.json'}]}
                return type('Result',(),{'returncode':0,'stdout':json.dumps(data)})()
            with patch('publish_portable.subprocess.run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):publish(output,'example/example','a'*40,'123')
            self.assertEqual([command[2] for command in commands],['view','download'])


if __name__=='__main__':unittest.main()
