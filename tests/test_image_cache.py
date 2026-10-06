"""通过实际下载、图片生成和静态构建验证缓存复用与损坏恢复。"""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import build as builder
from build_pages import build_pages
from image_cache import cache_identity,cache_key
from prepare_locks import prepare
from test_image_plan import source_fixture
from test_content_install import fixture


def inventory(folder):
    return {str(path.relative_to(folder)):hashlib.sha256(path.read_bytes()).hexdigest() for path in folder.rglob('*') if path.is_file()}


class ImageCacheTest(unittest.TestCase):
    def setUp(self):
        environment=patch.dict(os.environ,{'GITHUB_OUTPUT':'','GITHUB_STEP_SUMMARY':''});environment.start();self.addCleanup(environment.stop)
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.requests=[];self.blocked=False;owner=self
        class Handler(SimpleHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                owner.requests.append(self.path)
                if owner.blocked:self.send_error(503);return
                super().do_GET()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(self.root)))
        self.thread=Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close_server)
        self.origin=f'http://127.0.0.1:{self.server.server_port}'
        folder=self.root/'source';folder.mkdir();self.index=source_fixture(folder)
        self.index['baseline']['packages'][0]['url']=self.origin+'/source/'+self.index['baseline']['packages'][0]['sha256']+'.tar.gz'
        self.index['cdn_base_url']=self.origin+'/objects/'
        _,self.bundle=fixture(self.root,'one',self.index);self.locks=self.root/'locks';prepare(self.root/'one',self.locks)
        self.cache=self.root/'cache'

    def close_server(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def build(self,name,locks=None):
        report={};site=self.root/name/'dist';locks=locks or self.locks
        builder.build(site,locks/'asset-lock.json',locks/'content-lock.json',mirror_images=True,image_cache=self.cache,cache_report=report)
        return site,report

    def test_hit_is_byte_identical_and_still_builds_current_program(self):
        cold,first=self.build('cold');self.assertEqual(first['status'],'miss');self.assertTrue(first['saved'])
        requests=len(self.requests);self.blocked=True
        warm,second=self.build('warm');self.assertEqual(second['status'],'hit');self.assertEqual(len(self.requests),requests)
        self.assertEqual(inventory(cold),inventory(warm))
        checkout=self.root/'checkout';checkout.mkdir()
        for name in ['index.html','style.css','startup.js','app.mjs','i18n.mjs','resources.mjs','image-config.mjs','content-config.mjs','LICENSE','THIRD_PARTY.md','package.json']:
            shutil.copyfile(ROOT/name,checkout/name)
        for name in builder.MODULE_DIRS:shutil.copytree(ROOT/name,checkout/name)
        (checkout/'resources').mkdir();shutil.copyfile(ROOT/'resources/content-source.json',checkout/'resources/content-source.json')
        with (checkout/'app.mjs').open('a') as stream:stream.write('\n// 前端更新仍须进入新产物。\n')
        with patch.object(builder,'ROOT',checkout):updated,third=self.build('updated')
        self.assertEqual(third['status'],'hit');self.assertEqual(first['key'],third['key']);self.assertEqual(len(self.requests),requests)
        self.assertNotEqual((cold/'app.mjs').read_bytes(),(updated/'app.mjs').read_bytes())
        self.assertEqual(inventory(cold/'image-files'),inventory(updated/'image-files'))

    def test_index_and_generator_changes_invalidate_the_key(self):
        _,first=self.build('cold');requests=len(self.requests)
        self.index['version']='next-assets';fixture(self.root,'two',self.index);locks=self.root/'locks-two';prepare(self.root/'two',locks)
        _,second=self.build('changed',locks);self.assertEqual(second['status'],'miss');self.assertNotEqual(first['key'],second['key']);self.assertGreater(len(self.requests),requests)
        identity=cache_identity('0'*64);changed=json.loads(json.dumps(identity));changed['generator']['tools/image_plan.py']='1'*64
        self.assertNotEqual(cache_key(identity),cache_key(changed))

    def test_corrupt_cached_package_is_rebuilt_and_source_failure_keeps_site(self):
        site,first=self.build('cold');before=inventory(site);entry=self.cache/first['key']
        target=next((entry/'image-files').iterdir());target.write_bytes(b'corrupt')
        requests=len(self.requests);rebuilt,second=self.build('rebuilt')
        self.assertEqual(second['status'],'invalid');self.assertTrue(second['saved']);self.assertGreater(len(self.requests),requests)
        self.assertEqual(before,inventory(rebuilt));self.assertTrue(list(self.cache.glob('*.invalid-*')))
        next((entry/'image-files').iterdir()).write_bytes(b'corrupt-again');self.blocked=True;release=(site/'release.json').read_bytes()
        with self.assertRaises(ValueError):self.build('cold')
        self.assertEqual((site/'release.json').read_bytes(),release)

    def test_cache_rejects_paths_and_symlinks_without_copying_them(self):
        cold,first=self.build('cold');entry=self.cache/first['key'];manifest=entry/'manifest.json';original=manifest.read_bytes()
        document=json.loads(original);document['plan']['packages'][0]['url']='../../outside';manifest.write_text(json.dumps(document))
        _,rebuilt=self.build('bad-path');self.assertEqual(rebuilt['status'],'invalid')
        target=next((entry/'image-files').iterdir());outside=self.root/'outside';shutil.copyfile(target,outside);target.unlink();target.symlink_to(outside)
        good,rebuilt=self.build('bad-link');self.assertEqual(rebuilt['status'],'invalid');self.assertEqual(inventory(cold),inventory(good))

    def test_pages_entry_reports_matching_key_and_cache_hit(self):
        raw=self.bundle.read_bytes();source=self.root/'pages-source.json'
        source.write_text(json.dumps({'version':'one','bundle_url':self.origin+'/one.json.gz','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}))
        key=build_pages(source,None,key_only=True)
        cold=build_pages(source,self.root/'pages-cold/dist',self.cache);warm=build_pages(source,self.root/'pages-warm/dist',self.cache)
        self.assertEqual(cold['image_cache']['key'],key);self.assertEqual(warm['image_cache']['status'],'hit');self.assertGreaterEqual(warm['build_seconds'],0)
        first=inventory(self.root/'pages-cold/dist');second=inventory(self.root/'pages-warm/dist')
        first.pop('build-report.json');second.pop('build-report.json');self.assertEqual(first,second)
