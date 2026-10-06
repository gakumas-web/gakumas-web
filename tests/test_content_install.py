"""证明内容可独立更新且失败不会切换频道，不依赖数据项目源码。"""
import gzip
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build import build
from install_content import install


def fixture(root,version,asset_index=None,*,changed=None,characters=None):
    folder=root/version;folder.mkdir()
    bodies={'catalog':{'characters':characters or {'test':'合成角色'},'idols':{'cards':[],'skins':[]},'supports':{'cards':[]}},
            'effects':{'tables':{'ProduceCard':[],'ProduceItem':[],'ProduceExamEffect':[]}},
            'abilities':{'tables':{'MemoryAbility':[],'ProduceSkill':[],'ProduceEffect':[]}},
            'progression':{'progression':{'tables':{'IdolCard':[],'SupportCard':[]}}},
            'achievements':{'achievements':{'Achievement':[],'AchievementProgress':[],'Mission':[],'Item':[]}}}
    if changed=='catalog':bodies['catalog']['characters']['test']=version
    if changed=='effects':bodies['effects']['tables']['ProduceExamEffect']=[{'id':version,'effectType':'Synthetic'}]
    revisions={name:hashlib.sha256(json.dumps({'scope':name,**body},sort_keys=True).encode()).hexdigest() for name,body in bodies.items()}
    files={name+'.json':json.dumps({'scope':name,'revision':revisions[name],**body}) for name,body in bodies.items()}
    index=asset_index if asset_index is not None else json.loads((ROOT/'tests/contracts/image-delivery-v1.json').read_text())['versions']['one']
    files['assets-index.json']=json.dumps(index)
    manifest={'format':'gakumas-content','schema_version':1,'version':version,'min_web_version':'0.5.0','master_revision':version,
              'files':{name:{'bytes':len(text.encode()),'sha256':hashlib.sha256(text.encode()).hexdigest()} for name,text in files.items()}}
    for name,revision in revisions.items():manifest['files'][name+'.json']['revision']=revision
    raw=json.dumps(manifest);digest=hashlib.sha256(raw.encode()).hexdigest()
    for name,text in {**files,'manifest.json':raw}.items():(folder/name).write_text(text)
    lock=root/(version+'-lock.json');lock.write_text(json.dumps({'format':'gakumas-content-lock','schema_version':1,'version':version,'manifest':version+'/manifest.json','sha256':digest}))
    bundle=root/(version+'.json.gz')
    bundle.write_bytes(gzip.compress(json.dumps({'format':'gakumas-content-bundle','schema_version':1,'manifest':raw,'manifest_sha256':digest,'files':files}).encode()))
    return lock,bundle


class ContentInstallTest(unittest.TestCase):
    def setUp(self):
        (ROOT/'local').mkdir(exist_ok=True)

    def test_old_program_and_old_channel_are_not_reused(self):
        with TemporaryDirectory(dir=ROOT/'local') as temp:
            root=Path(temp);site=root/'dist';build(site);lock,_=fixture(root,'one')
            program=site/'release.json';original=program.read_bytes();value=json.loads(original);value['format']=2;program.write_text(json.dumps(value))
            with self.assertRaises(ValueError):install(site,lock)
            with self.assertRaises(ValueError):build(site)
            self.assertEqual(json.loads(program.read_text())['format'],2)
            program.write_bytes(original);install(site,lock)
            manifest=site/'content/releases/one/manifest.json';value=json.loads(manifest.read_text());value['schema_version']=2;manifest.write_text(json.dumps(value))
            channel=site/'content/channel.json';value=json.loads(channel.read_text());value['sha256']=hashlib.sha256(manifest.read_bytes()).hexdigest();channel.write_text(json.dumps(value))
            with self.assertRaises(ValueError):build(site)

    def test_update_offline_import_failure_and_core_independence(self):
        (ROOT/'local').mkdir(exist_ok=True)
        with TemporaryDirectory(dir=ROOT/'local') as temp:
            root=Path(temp);site=root/'dist';build(site)
            core={name:hashlib.sha256((site/name).read_bytes()).hexdigest() for name in ['app.mjs','index.html','release.json','image-config.mjs']}
            one,bundle=fixture(root,'one');install(site,one)
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'one')
            two,_=fixture(root,'two');install(site,two)
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'two')
            self.assertTrue((site/'content/releases/one/catalog.json').is_file())
            for name,digest in core.items():self.assertEqual(hashlib.sha256((site/name).read_bytes()).hexdigest(),digest)
            third,_=fixture(root,'three');(root/'three/effects.json').write_text('corrupted')
            with self.assertRaises(ValueError):install(site,third)
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'two')
            install(site,bundle_path=bundle)
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'one')
            build(site)
            self.assertEqual(json.loads((site/'content/channel.json').read_text())['version'],'one')
            self.assertTrue((site/'content/releases/two/manifest.json').is_file())


if __name__=='__main__':unittest.main()
