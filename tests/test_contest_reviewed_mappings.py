"""显式身份对应沿用固定上游实现，来源和目标发生变化时禁止静默放行。"""
import copy
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_contest_engine import reviewed_target

class ReviewedMappingTests(unittest.TestCase):
    def test_reviewed_identities_and_both_fingerprints(self):
        reviewed=json.loads((ROOT/'tools/contest-engine-reviewed-mappings.json').read_text());data=json.loads((ROOT/'tests/fixtures/public-data/contest-reviewed-mappings.json').read_text())
        groups={};sources={}
        for option in data['entries']:
            entry=option['entry']
            if option.get('kind')=='item':kind,key,source,targets='items',entry['id'],entry['record'],data['engineItems']
            elif not entry['customizations']:kind,key,source,targets='cards',json.dumps([entry['reference']['id'],entry['reference']['upgradeCount']],separators=(',',':')),entry['record'],data['engineCards']
            else:
                material=entry['customizations'][0];key=material['record']['id'];groups.setdefault(key,[]).append(material);continue
            sources[kind,key]=source
            self.assertEqual(reviewed_target(reviewed,kind,key,source,targets)['id'],option['expectedId'])
            with self.assertRaises(ValueError):reviewed_target(reviewed,kind,key,{**source,'name':'changed'},targets)
        for key,materials in groups.items():
            materials.sort(key=lambda value:value['record']['customizeCount']);sources['customizations',key]=materials;target=reviewed_target(reviewed,'customizations',key,materials,data['engineCustomizations'])
            self.assertEqual(target['id'],reviewed['customizations'][key]['engineId'])
            changed=copy.deepcopy(materials);changed[0]['grows'][0]['value']+=1
            with self.assertRaises(ValueError):reviewed_target(reviewed,'customizations',key,changed,data['engineCustomizations'])
        for kind,target_name in [('cards','engineCards'),('items','engineItems'),('customizations','engineCustomizations')]:
            for key in reviewed[kind]:
                # 错误目标与缺失目标不能靠已登记的 ID 绕过校验。
                with self.assertRaises(ValueError):reviewed_target(reviewed,kind,key,{},[])
                changed=copy.deepcopy(data[target_name]);next(row for row in changed if row['id']==reviewed[kind][key]['engineId'])['name']+='changed'
                with self.assertRaises(ValueError):reviewed_target(reviewed,kind,key,sources[kind,key],changed)
        self.assertIsNone(reviewed_target(reviewed,'cards','unknown',{},[]))

if __name__=='__main__':unittest.main()
