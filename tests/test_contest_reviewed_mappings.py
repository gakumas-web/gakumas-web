"""已核对身份可跟随固定来源修正，身份锚点变化及歧义仍须阻断。"""
import copy
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import build_contest_engine as builder
from build_contest_engine import reviewed_target,match_skill_card,match_item,normalized,digest,ReviewedMappingError

class ReviewedMappingTests(unittest.TestCase):
    def test_item_name_paths_share_category_checks_and_reject_ambiguity(self):
        source={'id':'public-item','name':'道具','isUpgraded':False,
                'definition':{'planType':'ProducePlanType_Plan2','rarity':'ProduceItemRarity_Ssr','originIdolCardId':'idol'}}
        for suffix in ('','♪'):
            target={'id':17,'name':'道具'+suffix,'upgraded':False,'plan':'logic',
                    'mode':'stage','sourceType':'pIdol','rarity':'SSR'}
            lookup={(builder.item_name(target['name']),False,'logic'):target}
            self.assertIs(match_item(source,[target],lookup),target)
            for field,value in (('mode','produce'),('sourceType','support'),('rarity','R')):
                with self.subTest(suffix=suffix,field=field):
                    changed={**target,field:value}
                    lookup={(builder.item_name(changed['name']),False,'logic'):changed}
                    self.assertIsNone(match_item(source,[changed],lookup))
            duplicate={**target,'id':18}
            lookup={(builder.item_name(target['name']),False,'logic'):None}
            self.assertIsNone(match_item(source,[target,duplicate],lookup))

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
            changed=copy.deepcopy(reviewed);resolutions=[]
            self.assertEqual(reviewed_target(changed,kind,key,{**source,'name':'changed'},targets,resolutions=resolutions)['id'],option['expectedId'])
            self.assertEqual(resolutions[0]['resolution'],'reviewed_identity_preserved')
            self.assertEqual(changed[kind][key]['sourceSha256'],digest({**source,'name':'changed'}))
        for key,materials in groups.items():
            materials.sort(key=lambda value:value['record']['customizeCount']);sources['customizations',key]=materials;target=reviewed_target(reviewed,'customizations',key,materials,data['engineCustomizations'])
            self.assertEqual(target['id'],reviewed['customizations'][key]['engineId'])
            changed=copy.deepcopy(materials);changed[0]['grows'][0]['value']+=1
            updated=copy.deepcopy(reviewed);resolutions=[]
            self.assertEqual(reviewed_target(updated,'customizations',key,changed,data['engineCustomizations'],resolutions=resolutions)['id'],target['id'])
            self.assertEqual(updated['customizations'][key]['sourceSha256'],digest(changed))
        for kind,target_name in [('cards','engineCards'),('items','engineItems'),('customizations','engineCustomizations')]:
            for key in reviewed[kind]:
                # 错误目标与缺失目标不能靠已登记的 ID 绕过校验。
                with self.assertRaises(ValueError):reviewed_target(reviewed,kind,key,{},[])
                changed=copy.deepcopy(data[target_name]);target=next(row for row in changed if row['id']==reviewed[kind][key]['engineId']);target['name']+='changed'
                updated=copy.deepcopy(reviewed)
                self.assertEqual(reviewed_target(updated,kind,key,sources[kind,key],changed)['id'],target['id'])
                self.assertEqual(updated[kind][key]['engineSha256'],digest(target))
                self.assertEqual(reviewed[kind][key]['identity'],builder.reviewed_identity(kind,sources[kind,key],target))
                self.assertEqual(reviewed[kind][key]['identityEvidence']['sourceSha256'],reviewed[kind][key]['sourceSha256'])
                self.assertEqual(reviewed[kind][key]['identityEvidence']['engineSha256'],reviewed[kind][key]['engineSha256'])
                # 没有固定锚点的旧记录不能自动接受定义修正。
                legacy=copy.deepcopy(reviewed);legacy[kind][key].pop('identity')
                with self.assertRaises(ReviewedMappingError):reviewed_target(legacy,kind,key,sources[kind,key],changed)
        self.assertIsNone(reviewed_target(reviewed,'cards','unknown',{},[]))

    def name_alignment(self,upgrade=0):
        reviewed=json.loads((ROOT/'tools/contest-engine-reviewed-mappings.json').read_text())
        data=json.loads((ROOT/'tests/fixtures/public-data/contest-reviewed-mappings.json').read_text())
        source=next(option['entry']['record'] for option in data['entries'] if option['entry']['record']['id']=='p_card-02-ido-3_086' and option['entry']['record']['upgradeCount']==upgrade)
        target=next(row for row in data['engineCards'] if row['id']==464+upgrade)
        return reviewed,json.dumps([source['id'],upgrade],separators=(',',':')),source,{**target,'name':source['name']}

    def match_name(self,source,targets):
        lookup={}
        for target in targets:
            key=(normalized(target['name']),target['upgraded'],target['plan'])
            lookup[key]=None if key in lookup else target
        return match_skill_card(source,targets,lookup,{}, {}, {}, [])[0]

    def test_only_engine_name_alignment_reuses_unchanged_reviewed_behavior(self):
        for upgrade in (0,1):
            reviewed,key,source,target=self.name_alignment(upgrade);before=copy.deepcopy(reviewed);resolutions=[]
            matched=self.match_name(source,[target])
            self.assertEqual(matched['id'],464+upgrade)
            result=reviewed_target(reviewed,'cards',key,source,[target],matched=matched,resolutions=resolutions)
            self.assertEqual(result,target);self.assertEqual(reviewed,before)
            self.assertEqual(resolutions[0]['resolution'],'engine_name_aligned')
            self.assertEqual(resolutions[0]['engineSha256'],digest(target))
            self.assertEqual(resolutions[0]['reviewedEngineSha256'],reviewed['cards'][key]['engineSha256'])

    def test_identity_preserving_definition_updates_advance_fingerprints_with_evidence(self):
        reviewed,key,source,target=self.name_alignment();before=copy.deepcopy(reviewed)
        changed_source=copy.deepcopy(source);changed_source['definition']['stamina']+=1;changed_source['text']='updated description'
        changed={**target,'cost':'cost-=7','actions':target['actions']+';genki+=1','conditions':'if:turnsElapsed>=2','effects':'at:turn{genki+=1}','limit':0}
        resolutions=[]
        self.assertEqual(reviewed_target(reviewed,'cards',key,changed_source,[changed],matched=changed,resolutions=resolutions),changed)
        entry=reviewed['cards'][key]
        self.assertEqual(entry['sourceSha256'],digest(changed_source));self.assertEqual(entry['engineSha256'],digest(changed))
        self.assertEqual(entry['identity'],before['cards'][key]['identity'])
        self.assertEqual(entry['identityEvidence'],before['cards'][key]['identityEvidence'])
        self.assertEqual(resolutions[0]['reviewedSourceSha256'],before['cards'][key]['sourceSha256'])
        self.assertEqual(resolutions[0]['reviewedEngineSha256'],before['cards'][key]['engineSha256'])

    def test_identity_changes_and_ambiguous_or_conflicting_matches_remain_blocked(self):
        reviewed,key,source,target=self.name_alignment()
        changes=[{'upgraded':True},{'plan':'sense'},{'pIdolId':65},{'sourceType':'support'},{'type':'mental'},{'rarity':'SR'},{'id':999}]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(ReviewedMappingError):
                changed={**target,**change}
                reviewed_target(reviewed,'cards',key,source,[changed],matched=changed)
        changed_sources=[{**source,'id':'different'},{**source,'upgradeCount':1},{**source,'category':'ProduceCardCategory_MentalSkill'},
                         {**source,'definition':{**source['definition'],'originIdolCardId':'different'}}]
        for changed_source in changed_sources:
            with self.assertRaises(ReviewedMappingError):reviewed_target(reviewed,'cards',key,changed_source,[target],matched=target)
        with self.assertRaises(ReviewedMappingError):reviewed_target(reviewed,'cards',key,source,[target],matched={**target,'id':999})
        with self.assertRaises(ReviewedMappingError):reviewed_target(reviewed,'cards',key,source,[target,target],matched=target)
        targets=[target,{**target,'id':999}]
        self.assertIsNone(self.match_name(source,targets))
        with self.assertRaises(ReviewedMappingError):reviewed_target(reviewed,'cards',key,source,targets,matched=self.match_name(source,targets),match_method='ambiguous_name')
        changed_reviewed=copy.deepcopy(reviewed);changed_reviewed['cards'][key].pop('identity');changed_reviewed['cards'][key]['engineName']='incorrect evidence'
        with self.assertRaises(ReviewedMappingError):reviewed_target(changed_reviewed,'cards',key,source,[target],matched=target)

    def test_customization_level_and_type_anchors_cannot_advance(self):
        reviewed=json.loads((ROOT/'tools/contest-engine-reviewed-mappings.json').read_text())
        data=json.loads((ROOT/'tests/fixtures/public-data/contest-reviewed-mappings.json').read_text())
        material=next(option['entry']['customizations'][0] for option in data['entries'] if option['entry'].get('customizations'))
        key=material['record']['id'];target=next(row for row in data['engineCustomizations'] if row['id']==reviewed['customizations'][key]['engineId'])
        for field,value in [('customizeCount',2),('id','different')]:
            changed=copy.deepcopy(material);changed['record'][field]=value
            with self.assertRaises(ReviewedMappingError):reviewed_target(reviewed,'customizations',key,[changed],[target])
        for change in [{'type':'different'},{'max':2},{'alias':'different'}]:
            with self.assertRaises(ReviewedMappingError):reviewed_target(reviewed,'customizations',key,[material],[{**target,**change}])

    def test_rejected_named_other_id_cannot_fall_back_to_reviewed_identity(self):
        reviewed,key,source,target=self.name_alignment();source=copy.deepcopy(source);source['name']='Unique collision♡'
        collision={**target,'id':999,'name':'Unique collision','type':'mental'};targets=[target,collision]
        matched,method=match_skill_card(source,targets,{}, {}, {}, {}, [])
        self.assertIsNone(matched);self.assertEqual(method,'structure_mismatch')
        with self.assertRaises(ReviewedMappingError) as raised:reviewed_target(reviewed,'cards',key,source,targets,matched=matched,match_method=method)
        self.assertEqual(raised.exception.issue['namedEngineIds'],[999])
        data=json.loads((ROOT/'tests/fixtures/public-data/contest-reviewed-mappings.json').read_text())
        source=copy.deepcopy(next(option['entry']['record'] for option in data['entries'] if option.get('kind')=='item'))
        key=source['id'];target=next(row for row in data['engineItems'] if row['id']==reviewed['items'][key]['engineId'])
        source['name']='Unique collision♡';targets=[target,{**target,'id':999,'name':'Unique collision','mode':'produce'}]
        matched=match_item(source,targets,{})
        self.assertIsNone(matched)
        with self.assertRaises(ReviewedMappingError) as raised:reviewed_target(reviewed,'items',key,source,targets,matched=matched)
        self.assertEqual(raised.exception.issue['namedEngineIds'],[999])

    def test_build_failure_writes_structured_fingerprints_before_raising(self):
        reviewed,key,source,target=self.name_alignment()
        target={**target,'pIdolId':65}
        try:reviewed_target(reviewed,'cards',key,source,[target])
        except ReviewedMappingError as error:failure=error
        with TemporaryDirectory() as temporary:
            report=Path(temporary)/'nested/build.json'
            args=['build_contest_engine.py','--source',temporary,'--effects',temporary,'--mapping-only','--report',str(report)]
            with patch.object(sys,'argv',args),patch.object(builder,'build',side_effect=failure),self.assertRaises(ReviewedMappingError):builder.main()
            result=json.loads(report.read_text())
            self.assertEqual(result['state'],'blocked')
            self.assertEqual(result['issues'][0]['kind'],'reviewed_mapping_changed')
            self.assertEqual(result['issues'][0]['sourceSha256'],reviewed['cards'][key]['sourceSha256'])
            self.assertEqual(result['issues'][0]['engineSha256'],digest(target))

if __name__=='__main__':unittest.main()
