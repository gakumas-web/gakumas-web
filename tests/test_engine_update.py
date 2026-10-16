"""验证上游记录和引擎代码进入隔离候选，完整验证失败时不得应用。"""
import copy
from contextlib import ExitStack
import json
from pathlib import Path
import subprocess
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from update_contest_engine import assess,sha,verify_evidence
import update_contest_engine as engine


class EngineUpdateTest(unittest.TestCase):
    def setUp(self):
        self.name='packages/gakumas-data/json/skill_cards.json'
        self.code='packages/gakumas-engine/engine/CardManager/index.js'
        self.before={self.name:json.dumps([{'id':1,'score':10}]).encode(),self.code:b'export const engine=1;'}
        self.lock={'repository':'gakumas-tools/gakumas-tools','commit':'1'*40,'files':{name:sha(raw) for name,raw in self.before.items()}}

    def test_record_additions_and_corrections_are_unvalidated_candidates(self):
        for rows in [[{'id':1,'score':10},{'id':2,'score':20}],[{'id':1,'score':11}],[]]:
            after={**self.before,self.name:json.dumps(rows).encode()}
            result=assess(self.lock,self.before,after,'2'*40)
            self.assertEqual(result['status'],'candidate');self.assertEqual(result['selected_commit'],'2'*40)
            self.assertEqual(result['changes']['modified'],[self.name])
            self.assertEqual(result['lock']['files'],{name:sha(raw) for name,raw in after.items()})

    def test_engine_code_runtime_file_set_and_other_tables_are_candidates(self):
        for after in [{**self.before,self.code:b'changed'},
                      {**self.before,'packages/gakumas-engine/new.js':b'new'},
                      {self.name:self.before[self.name]},
                      {**self.before,'packages/gakumas-data/json/customizations.json':b'[{"id":1}]'}]:
            result=assess(self.lock,self.before,after,'2'*40)
            self.assertEqual(result['status'],'candidate');self.assertEqual(result['selected_commit'],'2'*40)
            self.assertTrue(any(result['changes'].values()))

    def test_license_change_addition_and_removal_require_explicit_maintenance(self):
        licensed={**self.before,'LICENSE':b'BSD-3-Clause'}
        lock={**self.lock,'files':{name:sha(raw) for name,raw in licensed.items()}}
        for before,base,after in [(licensed,lock,{**licensed,'LICENSE':b'other license'}),
                                  (licensed,lock,self.before),
                                  (self.before,self.lock,licensed)]:
            with self.subTest(files=list(after)),self.assertRaisesRegex(ValueError,'引擎许可证发生变化'):
                assess(base,before,after,'2'*40)
        self.assertEqual(assess(lock,licensed,{**licensed,self.code:b'fixed code'},'2'*40)['status'],'candidate')

    def test_id_tables_reject_invalid_structure_and_duplicate_ids(self):
        for name in engine.RECORD_TABLES:
            for rows in [{},[1],[{}],[{'id':True}],[{'id':'1'}],[{'id':1.0}],[{'id':1},{'id':1,'score':20}]]:
                with self.subTest(table=name,rows=rows),self.assertRaises(ValueError):
                    assess(self.lock,self.before,{**self.before,name:json.dumps(rows).encode()},'2'*40)
            before={**self.before,name:json.dumps([{'id':1,'score':10},{'id':2,'score':20}]).encode()}
            lock={**self.lock,'files':{key:sha(raw) for key,raw in before.items()}}
            rows=[{'id':2,'score':21},{'id':1,'score':11},{'id':3,'score':30}]
            result=assess(lock,before,{**before,name:json.dumps(rows).encode()},'2'*40)
            self.assertEqual(result['status'],'candidate')

    def test_unchanged_runtime_keeps_current_identity(self):
        result=assess(self.lock,self.before,self.before,'2'*40)
        self.assertEqual(result['status'],'unchanged');self.assertEqual(result['selected_commit'],self.lock['commit'])
        self.assertEqual(result['lock'],self.lock)

    def test_changed_baseline_is_rejected_before_classification(self):
        with self.assertRaises(ValueError):assess(self.lock,{**self.before,self.name:b'[]'},self.before,'2'*40)

    def test_verified_online_record_and_code_changes_become_next_baseline(self):
        previous_files={**self.before,self.name:b'[{"id":1,"score":11},{"id":2,"score":20}]',self.code:b'fixed code'}
        previous={**self.lock,'commit':'2'*40,'files':{name:sha(raw) for name,raw in previous_files.items()}}
        latest={**previous_files,self.code:b'later code'}
        with TemporaryDirectory() as temporary:
            root=Path(temporary);lock=root/'lock.json';lock.write_text(json.dumps(self.lock))
            with patch.object(engine,'ROOT',root),patch.object(engine,'LOCK',lock),patch.object(engine,'snapshot',side_effect=[self.before,previous_files,latest]):
                result=engine.inspect('3'*40,previous)
            self.assertEqual(result['status'],'candidate');self.assertEqual(result['selected_commit'],'3'*40)
            self.assertEqual(result['base_commit'],previous['commit']);self.assertEqual(result['previous_lock'],previous)
            self.assertEqual(result['repository_base_commit'],self.lock['commit'])

    def test_online_source_hash_is_verified_even_at_repository_commit(self):
        for commit in [self.lock['commit'],'2'*40]:
            previous={**self.lock,'commit':commit,'files':{self.name:'0'*64}}
            with TemporaryDirectory() as temporary:
                root=Path(temporary);lock=root/'lock.json';lock.write_text(json.dumps(self.lock))
                with patch.object(engine,'ROOT',root),patch.object(engine,'LOCK',lock),patch.object(engine,'snapshot',return_value=self.before),self.assertRaisesRegex(ValueError,'线上引擎来源哈希不一致'):
                    engine.inspect('3'*40,previous)

    def test_source_baseline_is_verified_before_accepting_online_version(self):
        previous={**self.lock,'commit':'2'*40}
        with TemporaryDirectory() as temporary:
            root=Path(temporary);lock=root/'lock.json';lock.write_text(json.dumps(self.lock))
            with patch.object(engine,'ROOT',root),patch.object(engine,'LOCK',lock),patch.object(engine,'snapshot',return_value={**self.before,self.name:b'[]'}),self.assertRaisesRegex(ValueError,'已固定引擎与来源锁不一致'):
                engine.inspect('3'*40,previous)

    def update_fixture(self,root,*,engine_changed=True,content_changed=True):
        for directory in ['domain','application','locales','tests','tools','resources']:(root/directory).mkdir()
        for name in engine.OUTPUTS:
            (root/name).write_text('{}' if name.endswith('.json') else 'original')
        for name in ['resources.mjs','image-config.mjs','i18n.mjs','tools/build_contest_engine.py','tools/contest_status_effects.py']:(root/name).write_text('')
        effects=root/'effects.json';effects.write_text('{"revision":"new-content"}')
        source={'commit':self.lock['commit'],'effectsSha256':'old-content' if content_changed else sha(effects.read_bytes())}
        (root/'domain/contest-engine-map.mjs').write_text('export const contestEngineMap='+json.dumps({'source':source})+';')
        after={**self.before,self.code:b'fixed code'} if engine_changed else self.before
        plan={**assess(self.lock,self.before,after,'2'*40),'repository_base_commit':self.lock['commit'],'previous_lock':None}
        return effects,after,plan

    def update_patches(self,stack,root,effects,after,plan):
        stack.enter_context(patch.object(engine,'ROOT',root))
        stack.enter_context(patch.object(engine,'site_content',return_value=({'upstream_commit':'4'*40},effects)))
        stack.enter_context(patch.object(engine,'inspect',return_value=plan))
        stack.enter_context(patch.object(engine,'snapshot',return_value=after))
        stack.enter_context(patch.object(engine,'prepare_evidence',side_effect=lambda evidence,*args:evidence))

    def test_any_validation_failure_prevents_applying_all_outputs(self):
        # 外部构建、Node 回归和审计各自失败时，生产更新入口均不得写回产物。
        for failure in range(3):
            with self.subTest(failure=failure),TemporaryDirectory() as temporary,ExitStack() as stack:
                root=Path(temporary);effects,after,plan=self.update_fixture(root)
                original={name:(root/name).read_bytes() for name in engine.OUTPUTS}
                self.update_patches(stack,root,effects,after,plan);calls=[]
                def run(command,**kwargs):
                    calls.append(command)
                    if len(calls)==1:
                        for name in engine.OUTPUTS:(root/'output/candidate'/name).write_text('candidate')
                    if len(calls)==failure+1:raise subprocess.CalledProcessError(1,command)
                stack.enter_context(patch.object(engine.subprocess,'run',side_effect=run))
                with self.assertRaises(subprocess.CalledProcessError):engine.update(root/'site',root/'output',root/'esbuild',plan,apply=True)
                self.assertEqual(len(calls),failure+1)
                self.assertEqual({name:(root/name).read_bytes() for name in engine.OUTPUTS},original)
                self.assertFalse((root/'output/report.json').exists())

    def test_code_only_and_content_only_updates_run_every_validation_before_apply(self):
        for engine_changed,content_changed in [(True,False),(False,True)]:
            with self.subTest(engine_changed=engine_changed),TemporaryDirectory() as temporary,ExitStack() as stack:
                root=Path(temporary);effects,after,plan=self.update_fixture(root,engine_changed=engine_changed,content_changed=content_changed)
                original={name:(root/name).read_bytes() for name in engine.OUTPUTS}
                self.update_patches(stack,root,effects,after,plan);calls=[]
                def run(command,**kwargs):
                    self.assertEqual({name:(root/name).read_bytes() for name in engine.OUTPUTS},original)
                    calls.append(command)
                    if len(calls)==1:(root/'output/candidate/domain/upstream-contest-engine.mjs').write_text('built engine')
                stack.enter_context(patch.object(engine.subprocess,'run',side_effect=run))
                report=engine.update(root/'site',root/'output',root/'esbuild',plan,apply=True)
                self.assertEqual(len(calls),3);self.assertIn('--source',calls[0]);self.assertIn('--test',calls[1]);self.assertIn('--baseline',calls[2])
                self.assertEqual(calls[2][calls[2].index('--baseline')+1],str(root/'tools/contest-engine-compatibility-baseline.json'))
                self.assertTrue(report['updated']);self.assertTrue(report['applied'])
                self.assertEqual((root/'domain/upstream-contest-engine.mjs').read_text(),'built engine')

    def test_no_change_skips_build_and_apply(self):
        with TemporaryDirectory() as temporary,ExitStack() as stack:
            root=Path(temporary);effects,after,plan=self.update_fixture(root,engine_changed=False,content_changed=False)
            original={name:(root/name).read_bytes() for name in engine.OUTPUTS}
            self.update_patches(stack,root,effects,after,plan)
            run=stack.enter_context(patch.object(engine.subprocess,'run'))
            report=engine.update(root/'site',root/'output',root/'esbuild',plan,apply=True)
            self.assertFalse(report['updated']);run.assert_not_called()
            self.assertEqual({name:(root/name).read_bytes() for name in engine.OUTPUTS},original)

    def test_changed_detection_plan_is_rejected_before_build_or_apply(self):
        with TemporaryDirectory() as temporary,ExitStack() as stack:
            root=Path(temporary);effects,after,plan=self.update_fixture(root)
            original={name:(root/name).read_bytes() for name in engine.OUTPUTS}
            self.update_patches(stack,root,effects,after,plan)
            changed=copy.deepcopy(plan);changed['lock']['files'][self.code]='0'*64
            run=stack.enter_context(patch.object(engine.subprocess,'run'))
            with self.assertRaisesRegex(ValueError,'自动引擎更新输入已变化'):engine.update(root/'site',root/'output',root/'esbuild',changed,apply=True)
            run.assert_not_called()
            self.assertEqual({name:(root/name).read_bytes() for name in engine.OUTPUTS},original)

    def test_candidate_snapshot_hash_change_is_rejected_before_build(self):
        with TemporaryDirectory() as temporary,ExitStack() as stack:
            root=Path(temporary);effects,after,plan=self.update_fixture(root)
            original={name:(root/name).read_bytes() for name in engine.OUTPUTS}
            self.update_patches(stack,root,effects,{**after,self.code:b'drift'},plan)
            run=stack.enter_context(patch.object(engine.subprocess,'run'))
            with self.assertRaisesRegex(ValueError,'候选引擎文件身份变化'):engine.update(root/'site',root/'output',root/'esbuild',plan,apply=True)
            run.assert_not_called()
            self.assertEqual({name:(root/name).read_bytes() for name in engine.OUTPUTS},original)

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
