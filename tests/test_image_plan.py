"""验证用途包隔离完整卡图、缩略图身份与输入对象完整性。"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import random
import sys
import tarfile
from tempfile import TemporaryDirectory
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from image_plan import build_plan,catalog_groups
from image_cache import cache_identity,cache_key,validate_plan
from image_delivery import read_resource_set


def source_fixture(folder,extra_images=()):
    files={};payloads={}
    for number,(name,size) in enumerate([('ui-icons/test.png',(16,16)),('images/img_general_cidol-test_0-full.webp',(512,768)),*extra_images]):
        picture=Image.frombytes('RGB',size,random.Random(5+number).randbytes(size[0]*size[1]*3));buffer=io.BytesIO()
        picture.save(buffer,format='PNG' if name.endswith('.png') else 'WEBP')
        raw=buffer.getvalue();sha=hashlib.sha256(raw).hexdigest();row={'sha256':sha,'bytes':len(raw)}
        files[name]=row;payloads[sha+Path(name).suffix]=raw
    objects={row['sha256']+Path(name).suffix:row for name,row in files.items()}
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w',format=tarfile.USTAR_FORMAT) as tar:
        for name,raw in [('manifest.json',json.dumps({'format':'gakumas-image-base','schema_version':1,'objects':objects}).encode()),*[(f'objects/{key}',raw) for key,raw in payloads.items()]]:
            entry=tarfile.TarInfo(name);entry.size=len(raw);tar.addfile(entry,io.BytesIO(raw))
    raw=gzip.compress(buffer.getvalue(),mtime=0);sha=hashlib.sha256(raw).hexdigest();(folder/(sha+'.tar.gz')).write_bytes(raw)
    return {'format':'gakumas-assets-set','schema_version':1,'version':'test-plan','files':files,'cdn_base_url':'https://cdn.example.invalid/','cdn_objects':[],
            'baseline':{'version':'test-plan','packages':[{'url':'https://release.example.invalid/'+sha+'.tar.gz','bytes':len(raw),'sha256':sha,'objects':objects}]}}


class ImagePlanTest(unittest.TestCase):
    def test_core_artwork_and_thumbnail_are_independent(self):
        with TemporaryDirectory() as temp:
            folder=Path(temp);index=source_fixture(folder);original=json.dumps(index);plan=build_plan(index,folder)
            self.assertEqual(json.dumps(index),original)
            self.assertEqual({p['group'] for p in plan['packages']},{'core','thumbnails-idol','artwork-idol'})
            full='images/img_general_cidol-test_0-full.webp';thumb=plan['thumbnails'][full]
            self.assertNotEqual(plan['files'][thumb]['sha256'],index['files'][full]['sha256'])
            self.assertLess(plan['files'][thumb]['bytes'],index['files'][full]['bytes'])
            updated={**index,'files':plan['files'],'baseline':{'version':'test-plan','packages':[{**p,'url':'https://site.example.invalid/'+p['url'][2:]} for p in plan['packages']]}}
            read_resource_set(json.dumps(updated).encode())
            for pack in plan['packages']:
                with tarfile.open(folder/(pack['sha256']+'.tar.gz'),'r:gz') as tar:
                    for member in tar:
                        if member.name.endswith(plan['files'][thumb]['sha256']+'.webp'):
                            with Image.open(tar.extractfile(member)) as picture:self.assertEqual(max(picture.size),384)

    def test_tab_and_theme_packages_do_not_mix_and_shared_card_stays_with_idols(self):
        with TemporaryDirectory() as temp:
            folder=Path(temp)
            names=['images/img_general_csprt-test_full.webp','images/img_general_cidol-skin-a_0-full.webp','images/img_general_cidol-skin-b_0-full.webp']
            index=source_fixture(folder,[(name,(512,768)) for name in names])
            catalog={'idols':{'cards':[{'assetId':'cidol-test'}],'skins':[
                {'assetId':'cidol-test','theme':'共用卡面'},
                {'assetId':'cidol-skin-a','theme':'夏'},
                {'assetId':'cidol-skin-b','theme':'冬'}]},'supports':{'cards':[{'assetId':'csprt-test'}]}}
            mapping=catalog_groups(catalog);plan=build_plan(index,folder,mapping);validate_plan(plan,index,mapping)
            for name,group in [('images/img_general_cidol-test_0-full.webp','idol'),(names[0],'support'),(names[1],'skin-夏'),(names[2],'skin-冬')]:
                for logical,expected in [(name,'artwork-'+group),(plan['thumbnails'][name],'thumbnails-'+group)]:
                    key=plan['files'][logical]['sha256']+'.webp'
                    packs=[pack for pack in plan['packages'] if key in pack['objects']]
                    self.assertEqual(len(packs),1);self.assertEqual(packs[0]['group'],expected)
            self.assertEqual(len(plan['packages']),9)
            catalog['idols']['skins'][1]['theme']='新主题';changed=catalog_groups(catalog)
            self.assertNotEqual(cache_key(cache_identity('0'*64,mapping)),cache_key(cache_identity('0'*64,changed)))
            with self.assertRaisesRegex(ValueError,'分组'):validate_plan(plan,index,changed)

    def test_changed_object_is_rejected(self):
        with TemporaryDirectory() as temp:
            folder=Path(temp);index=source_fixture(folder)
            key=next(iter(index['baseline']['packages'][0]['objects']))
            index['baseline']['packages'][0]['objects'][key]['sha256']='0'*64
            with self.assertRaisesRegex(ValueError,'哈希'):build_plan(index,folder)
