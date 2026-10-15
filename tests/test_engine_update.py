"""验证引擎自动更新只接受追加记录，保留代码、已有定义与补充证据的审核边界。"""
import copy
import json
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from update_contest_engine import assess,added_rows,sha,verify_evidence
import update_contest_engine as engine


class EngineUpdateTest(unittest.TestCase):
    def setUp(self):
        self.name='packages/gakumas-data/json/skill_cards.json'
        self.before={self.name:json.dumps([{'id':1,'score':10}]).encode(),'packages/gakumas-engine/index.js':b'export const engine=1;'}
        self.lock={'repository':'gakumas-tools/gakumas-tools','commit':'1'*40,'files':{name:sha(raw) for name,raw in self.before.items()}}

    def test_only_additions_advance_the_fixed_version(self):
        after={**self.before,self.name:json.dumps([{'id':1,'score':10},{'id':2,'score':20}]).encode()}
        result=assess(self.lock,self.before,after,'2'*40)
        self.assertEqual(result['status'],'approved');self.assertEqual(result['selected_commit'],'2'*40)
        self.assertEqual(result['additions'],{self.name:[2]})
        self.assertEqual(assess(self.lock,self.before,self.before,'2'*40)['status'],'unchanged')

    def test_existing_values_deletion_order_and_boolean_changes_require_review(self):
        for rows in [[{'id':1,'score':11}],[],[{'id':1,'score':10},{'id':1,'score':10}],[{'id':True,'score':10}]]:
            result=assess(self.lock,self.before,{**self.before,self.name:json.dumps(rows).encode()},'2'*40)
            self.assertEqual(result['status'],'review-required');self.assertEqual(result['selected_commit'],'1'*40)
        with self.assertRaises(ValueError):added_rows([{'id':1,'value':1}],[{'id':1,'value':True}])
        with self.assertRaises(ValueError):added_rows([{'id':1},{'id':2}],[{'id':2},{'id':1},{'id':3}])

    def test_code_new_runtime_files_and_other_tables_are_not_auto_approved(self):
        for after in [{**self.before,'packages/gakumas-engine/index.js':b'changed'},
                      {**self.before,'packages/gakumas-engine/new.js':b'new'},
                      {self.name:self.before[self.name]}]:
            self.assertEqual(assess(self.lock,self.before,after,'2'*40)['status'],'review-required')
        before={'packages/gakumas-data/json/customizations.json':b'[]'}
        lock={**self.lock,'files':{name:sha(raw) for name,raw in before.items()}}
        self.assertEqual(assess(lock,before,{next(iter(before)):b'[{"id":1}]'},'2'*40)['status'],'review-required')

    def test_changed_baseline_is_rejected_before_classification(self):
        with self.assertRaises(ValueError):assess(self.lock,{**self.before,self.name:b'[]'},self.before,'2'*40)

    def test_later_code_change_preserves_last_approved_online_version(self):
        previous_files={**self.before,self.name:b'[{"id":1,"score":10},{"id":2,"score":20}]'}
        previous={**self.lock,'commit':'2'*40,'files':{name:sha(raw) for name,raw in previous_files.items()}}
        latest={**previous_files,'packages/gakumas-engine/index.js':b'changed code'}
        with TemporaryDirectory() as temporary:
            root=Path(temporary);lock=root/'lock.json';lock.write_text(json.dumps(self.lock))
            with patch.object(engine,'ROOT',root),patch.object(engine,'LOCK',lock),patch.object(engine,'snapshot',side_effect=[self.before,previous_files,latest]):
                result=engine.inspect('3'*40,previous)
            self.assertEqual(result['status'],'review-required');self.assertEqual(result['selected_commit'],'2'*40)
            self.assertEqual(result['lock'],previous)

    def test_online_source_hash_cannot_be_used_without_verification(self):
        previous={**self.lock,'commit':'2'*40,'files':{self.name:'0'*64}}
        with TemporaryDirectory() as temporary:
            root=Path(temporary);lock=root/'lock.json';lock.write_text(json.dumps(self.lock))
            with patch.object(engine,'ROOT',root),patch.object(engine,'LOCK',lock),patch.object(engine,'snapshot',side_effect=[self.before,self.before]),self.assertRaises(ValueError):engine.inspect('3'*40,previous)

    def test_evidence_can_only_advance_when_all_recorded_fields_still_match(self):
        evidence={'statusEnchants':[{'id':'s','value':1}],'triggers':[{'id':'t','phase':2}],'searches':[{'id':'q','position':3}],'effectDefinitions':{'e':{'id':'e','value':4}}}
        tables={'ProduceExamStatusEnchant':[{'id':'s','value':1,'produceDescriptions':[]}],'ProduceExamTrigger':[{'id':'t','phase':2}],'ProduceCardSearch':[{'id':'q','position':3}]}
        master={'tables':{'ProduceExamEffect':[{'id':'e','definition':{'id':'e','value':4}}]}}
        verify_evidence(evidence,master,tables)
        for table in tables:
            changed=copy.deepcopy(tables);changed[table][0]['unexpected']=1
            with self.assertRaises(ValueError):verify_evidence(evidence,master,changed)
        changed=copy.deepcopy(master);changed['tables']['ProduceExamEffect'][0]['definition']['value']=5
        with self.assertRaises(ValueError):verify_evidence(evidence,changed,tables)


if __name__=='__main__':unittest.main()
