"""验证生成锁可由实际安装器消费，损坏和不兼容输入不产生可用锁。"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from test_content_install import fixture, build, install, ROOT
from prepare_locks import prepare

class PrepareLocksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT/'local').mkdir(exist_ok=True)

    def test_generated_locks_install_and_preflight(self):
        with TemporaryDirectory(dir=ROOT/'local') as temp:
            root=Path(temp);fixture(root,'one');site=root/'dist';build(site)
            result=prepare(root/'one',root/'locks',mode='none',site=site)
            self.assertEqual(result['state'],'ready')
            install(site,root/'locks/content-lock.json')
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'one')
            with self.assertRaises(ValueError):prepare(root/'one',root/'bad-mode',mode='bundle',assets_index=root/'one/assets-index.json',site=site)
            self.assertFalse((root/'bad-mode').exists())
            with self.assertRaises(FileExistsError):prepare(root/'one',root/'locks')
            (root/'one/catalog.json').write_text('broken')
            with self.assertRaises(ValueError):prepare(root/'one',root/'bad')
            self.assertFalse((root/'bad').exists())

    def test_delivery_locks_and_origin_change(self):
        with TemporaryDirectory(dir=ROOT/'local') as temp:
            root=Path(temp)
            sample=json.loads((ROOT/'tests/contracts/image-delivery-v1.json').read_text())['versions']['one']
            fixture(root,'one',sample)
            prepare(root/'one',root/'locks')
            lock=json.loads((root/'locks/asset-lock.json').read_text())
            self.assertEqual((lock['schema_version'],lock['mode']),(1,'managed'))
            site=root/'dist';build(site,root/'locks/asset-lock.json',root/'locks/content-lock.json')
            self.assertIn('blob:',(site/'index.html').read_text())
            self.assertIn('https://release.example.invalid',json.loads((site/'release.json').read_text())['image_policy']['download_origins'])
            install(site,root/'locks/content-lock.json',asset_lock=root/'locks/asset-lock.json')
            sample['cdn_base_url']='https://new.example.invalid/'
            fixture(root,'two',sample)
            with self.assertRaises(ValueError):prepare(root/'two',root/'bad',site=site)
            with self.assertRaises(ValueError):install(site,root/'two-lock.json')
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'one')

if __name__=='__main__':unittest.main()
