"""检查静态产物范围与资源路径，不读取用户数据或调用图片源。"""
import importlib.util
import json
import os
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
spec=importlib.util.spec_from_file_location('static_builder',ROOT/'tools/build.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class StaticBuildTest(unittest.TestCase):
    def test_allowlisted_output_and_common_revision(self):
        local=ROOT/'local'
        local.mkdir(exist_ok=True)
        with TemporaryDirectory(dir=local) as folder:
            output=Path(folder)/'dist'
            builder.build(output)
            files=[p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()]
            self.assertFalse(any(name.startswith(('tests/','tools/','local/','backend/','data/source/')) for name in files))
            self.assertFalse(any('snapshot.json' in name for name in files))
            self.assertIn('LICENSE.txt',files)
            self.assertIn('ATTRIBUTION.txt',files)
            self.assertFalse((output/'data').exists())
            self.assertFalse((output/'content').exists())
            self.assertIn('content-config.mjs',files)
            html=(output/'index.html').read_text()
            self.assertIn('src="./app.mjs"',html)
            self.assertIn('Content-Security-Policy',html)
            self.assertNotIn('src="/',html)
            self.assertNotIn('href="/',html)
            self.assertNotIn('/api/',(output/'application/master-prefetch.mjs').read_text())

    def test_build_identity_is_explicit_and_does_not_infer_local_git_head(self):
        with TemporaryDirectory() as folder:
            output=Path(folder)/'dist'
            with patch.dict(os.environ,{'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'123456'}):builder.build(output)
            release=json.loads((output/'release.json').read_text())
            self.assertEqual(release['source_commit'],'a'*40);self.assertEqual(release['build_run_id'],'123456')
            self.assertIn('commit/'+'a'*40,(output/'index.html').read_text())
            for commit in ['', 'unknown']:
                with patch.dict(os.environ,{'GITHUB_SHA':commit,'GITHUB_RUN_ID':'123456'}):builder.build(output)
                release=json.loads((output/'release.json').read_text())
                self.assertNotIn('source_commit',release);self.assertNotIn('build_run_id',release)

    def test_output_guard(self):
        with self.assertRaises(ValueError):
            builder.build(ROOT)
        local=ROOT/'local'
        local.mkdir(exist_ok=True)
        with TemporaryDirectory(dir=local) as folder:
            output=Path(folder)/'dist'
            output.mkdir()
            marker=output/'unrelated.txt'
            marker.write_text('保留')
            with self.assertRaises(ValueError):
                builder.build(output)
            self.assertEqual(marker.read_text(),'保留')


class ResourceReleaseTest(unittest.TestCase):
    def setUp(self):
        (ROOT/'local').mkdir(exist_ok=True)



    def test_default_is_network_free(self):
        from resource_release import prepare
        with TemporaryDirectory(dir=ROOT/'local') as temp:
            output=Path(temp)
            config,report,hosts=prepare(ROOT/'resources/asset-lock.json',output,{'images':[],'ui_icons':[]})
            self.assertEqual(config['mode'],'none');self.assertEqual(config['images'],[]);self.assertEqual(config['icons'],[])
            self.assertEqual(report,{'mode':'none'});self.assertEqual(hosts,[])





    def test_retired_locks_do_not_reactivate_old_image_modes(self):
        from resource_release import prepare
        with TemporaryDirectory(dir=ROOT/'local') as temp:
            root=Path(temp);lock=root/'lock.json'
            for mode in ('bundle','cdn'):
                lock.write_text(json.dumps({'format':'gakumas-web-assets-lock','schema_version':1,'mode':mode}))
                with self.assertRaises(ValueError):prepare(lock,root,{'images':[],'ui_icons':[]})


if __name__=='__main__':
    unittest.main()
