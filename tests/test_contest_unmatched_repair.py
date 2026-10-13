"""保护名称归一化的身份边界与本批附魔的完整语义匹配。"""
import copy
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_contest_engine import matching_name,match_skill_card,match_item,custom_matches

class MatchingRepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads((ROOT/'tests/fixtures/public-data/contest-unmatched-repair.json').read_text())

    def test_punctuation_width_spaces_and_suffix(self):
        for name in ['「 テ ス ト！ 」＋','テスト!+','テスト☆＋','テスト']:
            self.assertEqual(matching_name(name,True),'テスト')
        self.assertNotEqual(matching_name('テスト+',False),matching_name('テスト',False))
        self.assertNotEqual(matching_name('カード',False),matching_name('カド',False))
        self.assertNotEqual(matching_name('第1話',False),matching_name('第2話',False))
        self.assertNotEqual(matching_name('夢と現の境界線',True),matching_name('夢と現境界線',True))

    def test_normalized_card_collision_and_upgrade_are_not_guessed(self):
        option=next(row for row in self.data['entries'] if row.get('kind')!='item' and not row['entry']['customizations'])
        source=copy.deepcopy(option['entry']['record']);source['name']='「試験！ 」+'
        target=copy.deepcopy(next(row for row in self.data['engineCards'] if matching_name(row['name'],True)==matching_name(option['entry']['record']['name'],True)))
        target['name']='試験';effects={r['id']:r for r in self.data['effects']}
        def match(targets):return match_skill_card(source,targets,{},effects,{}, {},[])
        self.assertEqual(match([target])[0]['id'],target['id'])
        self.assertEqual(match([target,{**target,'id':999,'name':'試験!'}])[1],'ambiguous_normalized_name')
        self.assertIsNone(match([{**target,'upgraded':False}])[0])
        self.assertIsNone(match([{**target,'actions':'score+=999'}])[0])
        self.assertIsNone(match([{**target,'plan':'anomaly'}])[0])

    def test_item_normalization_keeps_source_and_plan_and_collision_checks(self):
        option=next(row for row in self.data['entries'] if row.get('kind')=='item');source=copy.deepcopy(option['entry']['record']);source['name']='「テスト！ 」'
        target={'id':1,'name':'テスト','upgraded':source['isUpgraded'],'plan':'sense','sourceType':'produce','rarity':'SSR','mode':'stage'}
        self.assertEqual(match_item(source,[target],{})['id'],1)
        for change in [{'plan':'logic'},{'upgraded':not source['isUpgraded']},{'sourceType':'support'},{'rarity':'R'}]:self.assertIsNone(match_item(source,[{**target,**change}],{}))
        self.assertIsNone(match_item(source,[target,{**target,'id':2,'name':'テスト!'}],{}))

    def test_each_repaired_customization_has_matching_semantics(self):
        effects={r['id']:r for r in self.data['effects']};grows={r['id']:r for r in self.data['grows']};triggers={r['id']:r for r in self.data['triggers']}
        for option in self.data['entries']:
            entry=option['entry']
            for material in entry.get('customizations',[]):
                base=next(r for r in self.data['engineCards'] if matching_name(r['name'],True)==matching_name(entry['record']['name'],True))
                targets=[r for r in self.data['engineCustomizations'] if str(r['id']) in str(base['availableCustomizations']).split(',')]
                levels=[material['record']]
                self.assertEqual(sum(custom_matches(levels,grows,effects,target,base,triggers) for target in targets),1,entry['record']['name'])
                changed=copy.deepcopy(grows);changed[material['grows'][0]['id']]['playEffectProduceExamTriggerId']='unknown-condition'
                self.assertFalse(any(custom_matches(levels,changed,effects,target,base,triggers) for target in targets))
                if material['grows'][0]['effectType']=='ProduceCardGrowEffectType_EffectChange':
                    changed_base={**base,'actions':base['actions']+';setStance(strength);setStance(preservation)'}
                    self.assertFalse(any(custom_matches(levels,grows,effects,target,changed_base,triggers) for target in targets))

if __name__=='__main__':unittest.main()
