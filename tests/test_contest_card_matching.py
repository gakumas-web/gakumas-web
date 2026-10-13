"""验证名称优先及完整直接效果兜底，不把名称相似或部分效果一致当成身份。"""
import copy
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_contest_engine import match_skill_card,normalized,custom_matches

class CardMatchingTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads((ROOT/'tests/fixtures/public-data/contest-card-name-matching.json').read_text())
        self.effects={row['id']:row for row in self.data['effects']}
        self.grows={row['id']:row for row in self.data['grows']}
        self.customs={row['id']:[row] for row in self.data['customizations']}

    def match(self,row,targets=None):
        targets=self.data['engineCards'] if targets is None else targets
        lookup={}
        for target in targets:
            key=(normalized(target['name']),target['upgraded'],target['plan'])
            lookup[key]=None if key in lookup else target
        return match_skill_card(row,targets,lookup,self.effects,self.customs,self.grows,self.data['engineCustomizations'])

    def test_spelling_difference_resolves_both_upgrades(self):
        for row,id in zip(self.data['cards'],[586,587]):
            target,method=self.match(row)
            self.assertEqual(target['id'],id);self.assertEqual(method,'effects')

    def test_name_takes_priority_over_equivalent_other_card(self):
        row=self.data['cards'][1];target=copy.deepcopy(self.data['engineCards'][1]);target['name']=row['name']
        duplicate={**target,'id':999,'name':'別名'}
        result,method=self.match(row,[duplicate,target])
        self.assertEqual(result['id'],587);self.assertEqual(method,'name_verified')

    def test_same_name_different_effect_is_rejected(self):
        row=self.data['cards'][1];target={**self.data['engineCards'][1],'name':row['name'],'actions':'costReduction+=2;cardUsesRemaining+=1'}
        self.assertEqual(self.match(row,[target]),(None,'effect_mismatch'))

    def test_ambiguous_fallback_is_rejected(self):
        target=self.data['engineCards'][1]
        self.assertEqual(self.match(self.data['cards'][1],[target,{**target,'id':999}]),(None,'ambiguous_effects'))

    def test_fallback_checks_flags_order_conditions_and_customizations(self):
        row=self.data['cards'][1];target=self.data['engineCards'][1]
        for change in [{'forceInitialHand':False},{'limit':0},{'cost':'cost-=1'},{'plan':'logic'},{'type':'active'},{'availableCustomizations':'29'},{'actions':'cardUsesRemaining+=1;costReduction+=1'}]:
            with self.subTest(change=change):self.assertIsNone(self.match(row,[{**target,**change}])[0])
        conditional=copy.deepcopy(row);conditional['definition']['playEffects'][0]['produceExamTriggerId']='condition'
        self.assertIsNone(self.match(conditional)[0])
        effect=self.effects[row['playEffects'][0]['produceExamEffectId']]['definition']
        effect['chainProduceExamEffectId']='additional-effect'
        self.assertIsNone(self.match(row)[0])

    def test_unknown_complex_effect_stays_on_existing_name_path(self):
        row=self.data['cards'][1];target={**self.data['engineCards'][1],'name':row['name']}
        self.effects[row['playEffects'][0]['produceExamEffectId']]['definition']['effectType']='ProduceExamEffectType_Unhandled'
        self.assertEqual(self.match(row,[target])[1],'name')
        self.assertIsNone(self.match(row)[0])

    def test_selected_deck_hold_customization_is_exact(self):
        data=json.loads((ROOT/'tests/fixtures/public-data/contest-hold-customization.json').read_text())
        material=data['card']['customizations'][0];grow=material['grows'][0];effect=material['effects'][0]
        def matches():return custom_matches([material['record']],{grow['id']:grow},{effect['id']:effect},data['engineCustomization'])
        self.assertTrue(matches())
        for key,value in [('pickCountMin',0),('pickCountMax',2),('pickRangeType','ProducePickRangeType_Random'),('produceCardSearchId','p_card_search-hand'),('movePositionType','ProduceCardMovePositionType_Grave'),('chainProduceExamEffectId','extra')]:
            with self.subTest(key=key):
                before=effect['definition'][key];effect['definition'][key]=value
                self.assertFalse(matches());effect['definition'][key]=before
        grow['playEffectProduceExamTriggerId']='condition'
        self.assertFalse(matches())

    def test_preview_customizations_match_full_public_effects(self):
        data=json.loads((ROOT/'tests/fixtures/public-data/contest-preview-customizations.json').read_text())
        grows={r['id']:r for r in data['grows']};effects={r['id']:r for r in data['effects']};targets={r['id']:r for r in data['engineCustomizations']}
        for entry in data['entries']:
            for custom,target in zip(entry['card']['reference']['customizes'],entry['engineCustomizations']):
                levels=[r for r in data['customizations'] if r['id']==custom['id']]
                with self.subTest(card=entry['card']['record']['name'],custom=custom['id']):self.assertTrue(custom_matches(levels,grows,effects,targets[target]))
        for effect in effects.values():
            if effect['definition']['effectType']=='ProduceExamEffectType_ExamReview':
                self.assertEqual(effect['definition']['effectTurn'],0)
                self.assertEqual(effect['definition']['effectValue1'],2)

    def test_status_replacements_require_complete_dependencies_and_original_anchor(self):
        data=json.loads((ROOT/'tests/fixtures/public-data/contest-status-customizations.json').read_text())
        grows={r['id']:r for r in data['grows']};effects={r['id']:r for r in data['effects']}
        for base in data['engineCards']:
            for target in data['engineCustomizations']:
                if str(target['id']) not in str(base['availableCustomizations']).split(','):continue
                entries=[e for e in data['entries'] if e['record']['name']==base['name']]
                levels=[r for r in data['customizations'] if r['id']==entries[0]['reference']['customizes'][0]['id']]
                self.assertTrue(custom_matches(levels,grows,effects,target,base),base['name'])
                self.assertFalse(custom_matches(levels,grows,effects,target,{**base,'actions':''}))
                broken=copy.deepcopy(effects);id=grows[levels[0]['produceCardGrowEffectIds'][0]]['playProduceExamEffectId']
                broken[id]['definition']['effectTurn']+=1
                self.assertFalse(custom_matches(levels,grows,broken,target,base))
                # 即使外层引用不变，内层倍率变动也必须使固定证据失效。
                broken=copy.deepcopy(effects)
                for effect in broken.values():
                    if effect['definition']['effectType'] in ('ProduceExamEffectType_ExamLessonDependBlock','ProduceExamEffectType_ExamLessonDependExamReview','ProduceExamEffectType_ExamBlockPerUseCardCount'):
                        effect['definition']['effectValue1']+=1
                self.assertFalse(custom_matches(levels,grows,broken,target,base))

class ConditionalMatchingTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads((ROOT/'tests/fixtures/public-data/contest-conditional-customizations.json').read_text())
        self.effects={r['id']:r for r in self.data['effects']};self.grows={r['id']:r for r in self.data['grows']};self.triggers={r['id']:r for r in self.data['triggers']};self.customs={}
        for r in self.data['customizations']:self.customs.setdefault(r['id'],[]).append(r)

    def match(self,row):
        targets=self.data['engineCards'];lookup={(normalized(r['name']),r['upgraded'],r['plan']):r for r in targets}
        return match_skill_card(row,targets,lookup,self.effects,self.customs,self.grows,self.data['engineCustomizations'],self.triggers)

    def test_delayed_hand_upgrade_and_turn_condition_match_without_name_alias(self):
        for row in self.data['cards']:
            if row['id']!='p_card-00-sup-2_028':continue
            target,method=self.match(row);self.assertEqual(target['id'],242+row['upgradeCount']);self.assertEqual(method,'effects')
        timer=next(r for r in self.effects.values() if r['definition']['effectType']=='ProduceExamEffectType_ExamEffectTimer');timer['definition']['effectValue1']=2
        self.assertIsNone(self.match(self.data['cards'][0])[0])

    def test_condition_change_checks_original_condition_and_target(self):
        id='p_card_custom-wrapper-p_card-01-act-2_061-a-01';base=next(r for r in self.data['engineCards'] if r['id']==597);target=next(r for r in self.data['engineCustomizations'] if r['id']==97)
        self.assertTrue(custom_matches(self.customs[id],self.grows,self.effects,target,base,self.triggers))
        self.assertFalse(custom_matches(self.customs[id],self.grows,self.effects,target,{**base,'conditions':'@usable if:goodConditionTurns>=6'},self.triggers))
        self.assertFalse(custom_matches(self.customs[id],self.grows,self.effects,{**target,'conditions':'@usable if:goodConditionTurns>=3'},base,self.triggers))

    def test_genki_nine_does_not_match_old_four(self):
        levels=self.customs['p_card_custom-070-g_effect-effect_add-e_effect-exam_block-0009'];base=next(r for r in self.data['engineCards'] if r['id']==35)
        for id,expected in [(27,False),(28,True)]:self.assertEqual(custom_matches(levels,self.grows,self.effects,next(r for r in self.data['engineCustomizations'] if r['id']==id),base,self.triggers),expected)

if __name__=='__main__':unittest.main()
