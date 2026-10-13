"""同源基础包只在映射、大小和哈希一致时替代远程下载来源。"""
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from install_content import required_download_origins

class MirroredOriginsTest(unittest.TestCase):
    def test_verified_mirror_and_rejections(self):
        with TemporaryDirectory() as temporary:
            root=Path(temporary);body=b'synthetic-image-archive';digest=hashlib.sha256(body).hexdigest()
            relative='image-files/'+digest+'.tar.gz';path=root/relative;path.parent.mkdir();path.write_bytes(body)
            url='https://example.org/base.tar.gz';cdn='https://cdn.example.org'
            raw=('export const imageConfig='+json.dumps({'downloadURLs':{url:'./'+relative}})+';').encode();(root/'image-config.mjs').write_bytes(raw)
            release={'image_policy':{'download_origins':[cdn]},'files':{'image-config.mjs':hashlib.sha256(raw).hexdigest()}}
            index={'cdn_base_url':cdn+'/images/','baseline':{'packages':[{'url':url,'bytes':len(body),'sha256':digest}]}}
            self.assertEqual(required_download_origins(root,release,index),{cdn})
            changed=json.loads(json.dumps(index));changed['baseline']['packages'][0]['url']='https://other.example.org/base.tar.gz'
            self.assertEqual(required_download_origins(root,release,changed),{cdn,'https://other.example.org'})
            path.write_bytes(b'x'*len(body))
            with self.assertRaises(ValueError):required_download_origins(root,release,index)
            path.unlink()
            with self.assertRaises(ValueError):required_download_origins(root,release,index)
            (root/'image-config.mjs').write_bytes(raw+b' ')
            with self.assertRaises(ValueError):required_download_origins(root,release,index)
