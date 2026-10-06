"""验证显式交接的版本化合同样例，不跨项目导入实现。"""
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from image_delivery import read_resource_set
from content_contract import validate_manifest

class ContractVectorsTest(unittest.TestCase):

    def test_image_delivery(self):
        import copy
        samples=json.loads((ROOT/'tests/contracts/image-delivery-v1.json').read_text())
        for value in samples['versions'].values():read_resource_set(json.dumps(value).encode())
        invalid=copy.deepcopy(samples['versions']['two']);invalid['cdn_objects']=[]
        with self.assertRaises(ValueError):read_resource_set(json.dumps(invalid).encode())
        invalid=copy.deepcopy(samples['versions']['one']);invalid['baseline']['packages'][0]['bytes']=True
        with self.assertRaises(ValueError):read_resource_set(json.dumps(invalid).encode())
        invalid=copy.deepcopy(samples['versions']['one']);invalid['cdn_base_url']='https://example.invalid/?token=bad'
        with self.assertRaises(ValueError):read_resource_set(json.dumps(invalid).encode())

    def test_content(self):
        from content_contract import validate_part
        import copy
        sample=json.loads((ROOT/'tests/contracts/content-v1.json').read_text())
        for row in sample['cases']:
            with self.subTest(row['name']):
                if row['valid']:validate_manifest(json.dumps(row['value']).encode())
                else:
                    with self.assertRaises(ValueError):validate_manifest(json.dumps(row['value']).encode())
        for name,text in sample['files'].items():validate_part(name,text.encode(),sample['manifest'])
        altered=copy.deepcopy(sample['manifest']);altered['files']['catalog.json']['revision']='f'*64
        with self.assertRaises(ValueError):validate_part('catalog.json',sample['files']['catalog.json'].encode(),altered)

    def test_old_index_structures_are_rejected(self):
        for version in (1,2,3):
            with self.assertRaises(ValueError):read_resource_set(json.dumps({'format':'gakumas-assets-set','schema_version':version,'version':'old','packages':[]}).encode())

    def test_old_number_with_current_structure_is_rejected(self):
        sample=json.loads((ROOT/'tests/contracts/content-v1.json').read_text())['manifest']
        for version in (2,3):
            sample['schema_version']=version
            with self.assertRaises(ValueError):validate_manifest(json.dumps(sample).encode())
        sample=json.loads((ROOT/'tests/contracts/image-delivery-v1.json').read_text())['versions']['one']
        for version in (2,3,True):
            sample['schema_version']=version
            with self.assertRaises(ValueError):read_resource_set(json.dumps(sample).encode())
