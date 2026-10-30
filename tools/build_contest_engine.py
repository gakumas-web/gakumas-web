"""从固定 GakumasTools 源码构建浏览器引擎及经过核对的公开资料映射。"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unicodedata
from contest_status_effects import effect_change,EVIDENCE_PATH,EVIDENCE
from contest_engine_tables import parse_csv,read_table

ROOT=Path(__file__).resolve().parents[1]
COMMIT=json.loads((ROOT/'tools/contest-engine-source.json').read_text())['commit']
PLANS={'ProducePlanType_Common':'free','ProducePlanType_Plan1':'sense','ProducePlanType_Plan2':'logic','ProducePlanType_Plan3':'anomaly'}

def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
REVIEWED_PATH=ROOT/'tools/contest-engine-reviewed-mappings.json'

def reviewed_target(reviewed,kind,key,source,targets):
    entry=reviewed.get(kind,{}).get(key)
    if not entry:return None
    target=next((row for row in targets if row['id']==entry['engineId']),None)
    if target is None or digest(source)!=entry['sourceSha256'] or digest(target)!=entry['engineSha256']:
        raise ValueError('已核对的引擎身份映射发生变化，需重新确认：'+key)
    return target

def customization_material(level,grows,effects,triggers):
    level_grows=[grows[id] for id in level['produceCardGrowEffectIds']]
    material={'record':level,'grows':level_grows,'effects':[effects[grow['playProduceExamEffectId']] for grow in level_grows if grow['playProduceExamEffectId']]}
    trigger_ids=sorted({id for grow in level_grows if grow['effectType'] in ('ProduceCardGrowEffectType_PlayTriggerChange','ProduceCardGrowEffectType_PlayEffectTriggerChange') for id in [grow.get('playProduceExamTriggerId'),grow.get('playEffectProduceExamTriggerId'),*grow.get('targetPlayEffectProduceExamTriggerIds',[])] if id})
    if trigger_ids:material['triggers']=[triggers.get(id) for id in trigger_ids]
    return material

def normalized(value):return unicodedata.normalize('NFKC',re.sub('<[^>]+>','',value)).strip()
def item_name(value):
    # 道具名称的外层日文引号属于展示标点，强化后缀仍参与身份匹配。
    return re.sub(r'\s+(?=\()', '', re.sub(r'^「(.*)」(\+?)$',r'\1\2',normalized(value)))

def matching_name(value,upgraded):
    # 强化由独立字段区分；仅在强化版本上忽略展示用的末尾加号。
    value=normalized(value)
    value=''.join(char for char in value if not char.isspace())
    if upgraded:value=value.rstrip('+')
    # 保留文字、数字、长音与算术符号；统一标点和常用装饰符号。
    return ''.join(char for char in value if not unicodedata.category(char).startswith('P') and char not in '♪♫♬☆★♡♥')

def match_item(row,items,item_lookup):
    plan=PLANS.get(row['definition'].get('planType'));upgraded=row['isUpgraded']
    key=(item_name(row['name']),upgraded,plan)
    if key in item_lookup:return item_lookup[key]
    name=matching_name(row['name'],upgraded)
    matches=[target for target in items if target['upgraded']==upgraded and target['plan']==plan and matching_name(target['name'],upgraded)==name]
    if len(matches)!=1:return None
    target=matches[0];definition=row['definition']
    source='pIdol' if definition.get('originIdolCardId') else 'support' if definition.get('originSupportCardId') else 'produce'
    rarity={'ProduceItemRarity_R':'R','ProduceItemRarity_Sr':'SR','ProduceItemRarity_Ssr':'SSR'}.get(definition['rarity'])
    return target if target['mode']=='stage' and target['sourceType']==source and target['rarity']==rarity else None

def compact(value):return re.sub(r'\s+','',str(value))

def plain_effect(definition,fields):
    return all(key in fields or key in ('id','effectType','effectGroupIds') or value in ('',0,False,None,[]) or isinstance(value,str) and value.endswith('_Unknown') for key,value in definition.items())

def added_effect_patch(effect,effects):
    definition=effect.get('definition',{});kind=definition.get('effectType','').removeprefix('ProduceExamEffectType_')
    if kind=='ExamReview' and plain_effect(definition,{'effectValue1'}):return 'actions',f"goodImpressionTurns+={definition['effectValue1']}"
    if kind=='ExamPreservation' and definition.get('effectValue1')==1 and plain_effect(definition,{'effectValue1'}):return 'actions','setStance(preservation)'
    if kind=='ExamEffectTimer' and definition.get('effectValue1')==1 and definition.get('effectCount')==1 and plain_effect(definition,{'effectValue1','effectCount','chainProduceExamEffectId'}):
        child=effects.get(definition.get('chainProduceExamEffectId'),{})
        if added_effect_patch(child,{})==('actions','setStance(preservation)'):return 'actions','at:turn{setStance(preservation);limit:1}'
    if kind in ('ExamLessonDependBlock','ExamLessonDependExamReview','ExamLessonDependExamCardPlayAggressive') and definition.get('effectCount')==1 and plain_effect(definition,{'effectValue1','effectCount'}):
        field={'ExamLessonDependBlock':'genki','ExamLessonDependExamReview':'goodImpressionTurns','ExamLessonDependExamCardPlayAggressive':'motivation'}[kind]
        return 'actions',f"score+={field}*{definition['effectValue1']/1000:g}"
    if kind=='ExamBlockAddMultipleAggressive' and definition.get('effectCount')==1 and plain_effect(definition,{'effectValue1','effectValue2','effectCount'}):
        return 'actions',f"motivationMultiplier={1+definition['effectValue2']/1000:g};genki+={definition['effectValue1']}"
    if kind=='ExamReviewMultiple' and definition.get('effectTurn',0)>0 and plain_effect(definition,{'effectValue1','effectTurn'}):
        return 'actions',f"setGoodImpressionTurnsEffectBuff({definition['effectValue1']/1000:g},{definition['effectTurn']})"
    if kind=='ExamExtraTurn' and plain_effect(definition,set()):return 'actions','turnsRemaining+=1'
    return None

def trigger_condition(trigger):
    text=normalized(''.join(part.get('text','') for part in (trigger or {}).get('playProduceDescriptions',[])))
    match=re.fullmatch(r'(\d+)ターン目以降の場合、使用可',text)
    if match and int(match[1])>0:return f'turnsElapsed>={int(match[1])-1}'
    match=re.fullmatch(r'好調が(\d+)ターン以上の場合、使用可',text)
    if match:return f'goodConditionTurns>={int(match[1])}'
    for label,field in [('元気','genki'),('好印象','goodImpressionTurns'),('集中','concentration')]:
        match=re.fullmatch(label+r'が(\d+)以上の場合、使用可',text)
        if match:return f'{field}>={int(match[1])}'
    match=re.fullmatch(r'温存になった回数が(\d+)回以上の場合、使用可',text)
    if match:return f'preservationTimes>={int(match[1])}'
    return None

def stance_patch(grow,effects,base_card):
    if not base_card or not plain_effect(grow,{'playProduceExamEffectId','targetPlayProduceExamEffectIds'}):return None
    previous=grow.get('targetPlayProduceExamEffectIds',[])
    if len(previous)!=1:return None
    before=effects.get(previous[0],{}).get('definition',{});after=effects.get(grow.get('playProduceExamEffectId'),{}).get('definition',{})
    stance={'ProduceExamEffectType_ExamConcentration':'strength','ProduceExamEffectType_ExamPreservation':'preservation'}.get(before.get('effectType'))
    if not stance or before.get('effectType')!=after.get('effectType') or before.get('effectValue1')!=1 or after.get('effectValue1')!=2:return None
    if not all(plain_effect(value,{'effectValue1'}) for value in [before,after]):return None
    # 引擎成长会影响整张卡的姿态动作，拒绝同时含另一种姿态的卡。
    stances=re.findall(r'setStance\((strength2?|preservation2?)\)',compact(base_card['actions']+';'+base_card['effects']))
    if not stances or any(value!=stance for value in stances):return None
    return 'effects','at:prestage{target:this{g.stanceLevel+=1}}'

def grow_patch(grow,effects,grows,base_card=None,triggers=None):
    kind=grow['effectType'].removeprefix('ProduceCardGrowEffectType_')
    stats={'LessonAdd':'score','LessonCountAdd':'scoreTimes','BlockAdd':'genki','LessonBuffAdd':'concentration','AggressiveAdd':'motivation','ReviewAdd':'goodImpressionTurns','ParameterBuffTurnAdd':'goodConditionTurns','ParameterBuffMultiplePerTurnAdd':'perfectConditionTurns','StaminaConsumptionDownTurnAdd':'halfCostTurns','FullPowerPointAdd':'fullPowerCharge','CostReduce':'cost','CostPenetrateReduce':'typedCost','CostAggressiveReduce':'typedCost','CostParameterBuffReduce':'typedCost','CostParameterBuffMultiplePerTurnReduce':'typedCost','CostLessonBuffReduce':'typedCost','CostReviewReduce':'typedCost','CostFullPowerPointReduce':'typedCost','LessonDependBlockAdd':'scoreByGenki','LessonDependExamReviewAdd':'scoreByGoodImpressionTurns','LessonDependExamCardPlayAggressiveAdd':'scoreByMotivation'}
    if kind in stats:
        amount=grow['value']/1000 if kind.startswith('LessonDepend') else grow['value']
        return 'effects',f'at:prestage{{target:this{{g.{stats[kind]}+={amount:g}}}}}'
    if kind=='PlayTriggerChange':
        if not triggers or not base_card or not plain_effect(grow,{'playProduceExamTriggerId','targetPlayEffectProduceExamTriggerIds'}):return None
        previous=grow.get('targetPlayEffectProduceExamTriggerIds',[])
        if len(previous)!=1:return None
        before=trigger_condition(triggers.get(previous[0]));after=trigger_condition(triggers.get(grow.get('playProduceExamTriggerId')))
        condition=compact(base_card.get('conditions',''));prefix='@usable' if condition.startswith('@usable') else ''
        if before and after and condition==prefix+'if:'+before:return 'conditions',prefix+' if:'+after
        return None
    if kind=='PlayEffectTriggerChange':
        if not triggers or not base_card or not plain_effect(grow,{'playEffectProduceExamTriggerId','targetPlayEffectProduceExamTriggerIds'}):return None
        previous=grow.get('targetPlayEffectProduceExamTriggerIds',[])
        if len(previous)!=1:return None
        before=trigger_condition(triggers.get(previous[0]));after=trigger_condition(triggers.get(grow.get('playEffectProduceExamTriggerId')))
        if not before or not after:return None
        labels=re.findall(r'(@[A-Za-z][A-Za-z0-9]*)if:'+re.escape(before)+r'\{',compact(base_card['actions']))
        if len(labels)==1:return 'actions',labels[0]+' if:'+after
        return None
    if kind=='InitialAdd':return 'forceInitialHand',True
    if kind=='PlayMovePositionTypeChange' and grow['playMovePositionType']=='ProduceCardMovePositionType_Grave':return 'limit',0
    if kind=='EffectChange':return stance_patch(grow,effects,base_card) or effect_change(grow,effects,base_card)
    if kind=='EffectAdd':
        effect=effects.get(grow['playProduceExamEffectId'],{});kind=effect.get('effectType','').removeprefix('ProduceExamEffectType_')
        if kind in ('ExamReview','ExamPreservation','ExamEffectTimer','ExamLessonDependBlock','ExamLessonDependExamReview','ExamBlockAddMultipleAggressive','ExamReviewMultiple','ExamLessonDependExamCardPlayAggressive','ExamExtraTurn'):
            if not plain_effect(grow,{'playProduceExamEffectId'}):return None
            return added_effect_patch(effect,effects)
        stats={'ExamLesson':'score','ExamBlock':'genki','ExamParameterBuff':'goodConditionTurns','ExamParameterBuffMultiplePerTurn':'perfectConditionTurns','ExamLessonBuff':'concentration','ExamReview':'goodImpressionTurns','ExamCardPlayAggressive':'motivation','ExamFullPowerPoint':'fullPowerCharge','ExamStaminaConsumptionDown':'halfCostTurns'}
        if kind in stats and (kind!='ExamLesson' or effect.get('effectCount',1)==1):
            value=effect.get('effectTurn') if kind in ('ExamParameterBuff','ExamParameterBuffMultiplePerTurn','ExamReview','ExamStaminaConsumptionDown') else effect.get('effectValue1')
            if value is not None:return 'actions',f'{stats[kind]}+={value}'
        definition=effect.get('definition',{})
        if kind=='ExamCardMove':
            # 仅覆盖从山札必选一张移到保留；可选、随机、多张及附带条件不混用。
            required={'produceCardSearchId':'p_card_search-deck','movePositionType':'ProduceCardMovePositionType_Hold','pickRangeType':'ProducePickRangeType_Select','pickCountMin':1,'pickCountMax':1}
            if all(definition.get(key)==value for key,value in required.items()):
                effect_ok=all(key in required or key in ('id','effectType','effectGroupIds') or value in ('',0,False,None,[]) or isinstance(value,str) and value.endswith('_Unknown') for key,value in definition.items())
                grow_ok=all(key in ('id','effectType','effectGroupIds','playProduceExamEffectId') or value in ('',0,False,None,[]) or isinstance(value,str) and value.endswith('_Unknown') for key,value in grow.items())
                if effect_ok and grow_ok:return 'actions','holdSelected[deck]'
        if kind=='ExamPlayableValueAdd' and effect.get('effectCount')==1:return 'actions','cardUsesRemaining+=1'
        if kind=='ExamCardUpgrade' and definition.get('produceCardSearchId')=='p_card_search-hand' and definition.get('pickRangeType')=='ProducePickRangeType_All':return 'actions','upgradeHand'
        if kind=='ExamConcentration' and effect.get('effectValue1')==1:return 'actions','setStance(strength)'
        if kind=='ExamAddGrowEffect':
            target={'p_card_search-deck_all':'all','p_card_search-hand':'hand','p_card_search-hold':'held'}.get(definition.get('produceCardSearchId'))
            related=[grows.get(id) for id in definition.get('produceCardGrowEffectIds',[])]
            if target and len(related)==1 and related[0] and related[0]['effectType']=='ProduceCardGrowEffectType_LessonAdd':return 'actions',f'target:{target}{{g.score+={related[0]["value"]}}}'
    return None

def custom_matches(levels,grows,effects,target,base_card=None,triggers=None):
    expected=dict.fromkeys(['forceInitialHand','conditions','cost','actions','limit','effects'],'')
    for row in levels:
        patches=[grow_patch(grows[id],effects,grows,base_card,triggers) for id in row['produceCardGrowEffectIds']]
        if not patches or any(patch is None for patch in patches):return False
        grouped={}
        for field,value in patches:
            if field in ('forceInitialHand','limit'):
                if len(levels)!=1 or field in grouped:return False
                grouped[field]=value
            else:grouped[field]=grouped.get(field,'')+(';' if field in grouped else '')+value
        for field,value in grouped.items():
            if len(levels)>1:
                if field not in ('effects','actions'):return False
                value=f'level:{row["customizeCount"]}{{{value}}}'
            expected[field]=expected[field]+value if isinstance(value,str) else value
    return all(compact(expected[key])==compact(target[key]) for key in expected)

# 只对能完整解释的效果生成签名；扩展兜底核对回合条件和次回合全手牌强化，未知字段仍拒绝。
def direct_card_actions(row,effects,triggers=None,extended=False):
    definition=row['definition']
    if any(definition.get(key) for key in ('produceCardStatusEnchantId','moveProduceExamEffectIds','moveProduceExamTriggerIds','isEndTurnLost','isConversion','isRestrict','isLimited','forceStamina')):return None
    if definition.get('playProduceExamTriggerId') and (not extended or not trigger_condition((triggers or {}).get(definition['playProduceExamTriggerId']))):return None
    if definition.get('moveEffectTriggerType')!='ProduceCardMoveEffectTriggerType_Unknown':return None
    actions=[]
    for entry in definition['playEffects']:
        if entry.get('produceExamTriggerId') or entry.get('isOncePlayEffect'):return None
        effect=effects.get(entry['produceExamEffectId'],{}).get('definition')
        if not effect:return None
        kind=effect['effectType'];used={'id','effectType','effectGroupIds'}
        if kind=='ProduceExamEffectType_ExamStaminaConsumptionDownFix' and effect['effectTurn']==-1:
            action=f"costReduction+={effect['effectValue1']}";used.update(('effectTurn','effectValue1'))
        elif kind=='ProduceExamEffectType_ExamPlayableValueAdd':
            action=f"cardUsesRemaining+={effect['effectCount']}";used.add('effectCount')
        elif kind=='ProduceExamEffectType_ExamBlock':
            action=f"genki+={effect['effectValue1']}";used.add('effectValue1')
        elif extended and kind in ('ProduceExamEffectType_ExamParameterBuff','ProduceExamEffectType_ExamParameterBuffMultiplePerTurn','ProduceExamEffectType_ExamReview'):
            field={'ProduceExamEffectType_ExamParameterBuff':'goodConditionTurns','ProduceExamEffectType_ExamParameterBuffMultiplePerTurn':'perfectConditionTurns','ProduceExamEffectType_ExamReview':'goodImpressionTurns'}[kind]
            value='effectValue1' if kind.endswith('ExamReview') else 'effectTurn'
            action=f'{field}+={effect[value]}';used.add(value)
        elif extended and kind=='ProduceExamEffectType_ExamLesson' and effect.get('effectCount')==1:
            action=f"score+={effect['effectValue1']}";used.update(('effectCount','effectValue1'))
        elif extended and kind=='ProduceExamEffectType_ExamStaminaConsumptionDown' and effect.get('effectTurn',0)>0:
            action=f"halfCostTurns+={effect['effectTurn']}";used.add('effectTurn')
        elif extended and kind=='ProduceExamEffectType_ExamEffectTimer' and effect.get('effectValue1')==1 and effect.get('effectCount')==1:
            child=effects.get(effect.get('chainProduceExamEffectId'),{}).get('definition',{})
            if child.get('effectType')!='ProduceExamEffectType_ExamCardUpgrade' or child.get('produceCardSearchId')!='p_card_search-hand' or child.get('pickRangeType')!='ProducePickRangeType_All' or not plain_effect(child,{'produceCardSearchId','pickRangeType'}):return None
            action='at:turn{upgradeHand;limit:1}';used.update(('effectValue1','effectCount','chainProduceExamEffectId'))
        else:return None
        for key,value in effect.items():
            if key in used:continue
            if value not in ('',0,False,None,[]) and not (isinstance(value,str) and value.endswith('_Unknown')):return None
        actions.append(action)
    return ';'.join(actions)

def card_structure_matches(row,target):
    definition=row['definition']
    source='support' if definition.get('originSupportCardId') else 'pIdol' if definition.get('originIdolCardId') else None
    return (target['upgraded']==bool(row['upgradeCount']) and target['plan']==PLANS.get(definition['planType'])
        and target['rarity']=={'ProduceCardRarity_N':'N','ProduceCardRarity_R':'R','ProduceCardRarity_Sr':'SR','ProduceCardRarity_Ssr':'SSR'}.get(row['rarity'])
        and target['type']=={'ProduceCardCategory_ActiveSkill':'active','ProduceCardCategory_MentalSkill':'mental'}.get(row['category'])
        and (source is None or source==target['sourceType'])
        and target['forceInitialHand']==definition['isInitial'] and target['unique']==definition['noDeckDuplication'])

def card_effects_match(row,target,effects,triggers=None,extended=False):
    actions=direct_card_actions(row,effects,triggers,extended);definition=row['definition']
    if actions is None or definition['costType']!='ExamCostType_Unknown' or definition['costValue']!=0:return None
    limit={'ProduceCardMovePositionType_Lost':1,'ProduceCardMovePositionType_Grave':0}.get(definition['playMovePositionType'])
    if limit is None:return None
    condition=trigger_condition((triggers or {}).get(definition.get('playProduceExamTriggerId')))
    expected_condition='if:'+condition if condition else ''
    cost=f"cost-={definition['stamina']}"
    return (compact(target['actions']).rstrip(';')==compact(actions) and compact(target['cost']).rstrip(';')==cost
        and compact(target['conditions'])==expected_condition and not target['effects'] and target['limit']==limit)

def card_customizations_match(row,target,custom_rows,grows,effects,customs,triggers=None):
    available={str(value['id']):value for value in customs}
    target_ids=[id for id in str(target['availableCustomizations']).split(',') if id]
    source_ids=row['definition'].get('produceCardCustomizeIds',[])
    if len(source_ids)!=len(target_ids):return False
    matched=set()
    for id in source_ids:
        levels=sorted(custom_rows.get(id,[]),key=lambda value:value['customizeCount'])
        if not levels:return False
        candidates=[key for key in target_ids if key in available and available[key]['max']==len(levels)
            and [int(value) for value in str(available[key]['price']).split(',')]==[value['producePoint'] for value in levels]
            and custom_matches(levels,grows,effects,available[key],target,triggers)]
        if len(candidates)!=1 or candidates[0] in matched:return False
        matched.add(candidates[0])
    return len(matched)==len(target_ids)

def match_skill_card(row,skills,skill_lookup,effects,custom_rows,grows,customs,triggers=None):
    key=(normalized(row['name']),bool(row['upgradeCount']),PLANS.get(row['definition'].get('planType')))
    if key in skill_lookup:
        target=skill_lookup[key]
        if target is None:return None,'ambiguous_name'
        # 已有名称路径保留复杂效果覆盖；可解释的效果发现冲突时必须拒绝。
        check=card_effects_match(row,target,effects,triggers)
        if check is False:return None,'effect_mismatch'
        if check is True and not card_structure_matches(row,target):return None,'structure_mismatch'
        return target,'name_verified' if check is True else 'name'
    name=matching_name(row['name'],bool(row['upgradeCount']))
    named=[target for target in skills if target['upgraded']==bool(row['upgradeCount']) and target['plan']==key[2] and matching_name(target['name'],target['upgraded'])==name]
    if len(named)>1:return None,'ambiguous_normalized_name'
    if named:
        target=named[0]
        if not card_structure_matches(row,target):return None,'structure_mismatch'
        if card_effects_match(row,target,effects,triggers,extended=True) is False:return None,'effect_mismatch'
        return target,'normalized_name'
    matches=[target for target in skills if card_structure_matches(row,target)
        and card_effects_match(row,target,effects,triggers,extended=True) is True
        and card_customizations_match(row,target,custom_rows,grows,effects,customs,triggers)]
    if len(matches)!=1:return None,'ambiguous_effects' if matches else 'unmatched'
    return matches[0],'effects'

def build(source,effects_file,esbuild=None,*,mapping_only=False):
    lock=json.loads((ROOT/'tools/contest-engine-source.json').read_text())
    if lock['commit']!=COMMIT:raise ValueError('模拟引擎来源锁与构建版本不一致')
    for name,expected in lock['files'].items():
        if hashlib.sha256((source/name).read_bytes()).hexdigest()!=expected:raise ValueError('模拟引擎源码校验失败：'+name)
    data=source/'packages/gakumas-data'
    read=lambda name:read_table(data,name)
    master=json.loads(effects_file.read_text());tables=master['tables'];semantics=master['semantics']['tables']
    if master['revision']!=EVIDENCE['contentRevision']:raise ValueError('持续效果补充证据与内容版本不一致，请核对同版本公开原始表后更新证据')
    reviewed=json.loads(REVIEWED_PATH.read_text())
    if reviewed['engineCommit']!=COMMIT or reviewed['effectsRevision']!=master['revision']:raise ValueError('已核对身份映射的来源版本不一致')
    skills=read('skill_cards');items=read('p_items');customs=read('customizations');stages=read('stages');skills_by_id={row['id']:row for row in skills}
    def lookup(values,normalize=normalized):
        indexed={}
        for row in values:
            name=normalize(row['name'])
            if normalize is item_name and row['upgraded'] and not name.endswith('+'):name+='+'
            key=(name,row['upgraded'],row['plan'])
            indexed[key]=None if key in indexed else row
        return indexed
    skill_lookup=lookup(skills);item_lookup=lookup(items,item_name);cards_map={};items_map={};custom_map={};source_sets={};target_sets={};unmapped={'cards':[],'items':[],'customizations':[]}
    triggers={row['id']:row for row in semantics.get('ProduceExamTrigger',[])};grows={row['id']:row for row in semantics['ProduceCardGrowEffect']};effects={row['id']:row for row in tables['ProduceExamEffect']};custom_rows={}
    for row in semantics['ProduceCardCustomize']:custom_rows.setdefault(row['id'],[]).append(row)
    reviewed_matches=[]
    card_matching={'effects':[],'rejected':[],'nameVerified':0,'nameOnly':0};custom_price_differences=[]
    for row in tables['ProduceCard']:
        if row['upgradeCount']>1 or row['definition'].get('libraryHidden') or row['rarity']=='ProduceCardRarity_Legend' or row['category']=='ProduceCardCategory_Trouble':continue
        target,method=match_skill_card(row,skills,skill_lookup,effects,custom_rows,grows,customs,triggers)
        reviewed_key=json.dumps([row['id'],row['upgradeCount']],ensure_ascii=False,separators=(',',':'))
        fallback=reviewed_target(reviewed,'cards',reviewed_key,row,skills)
        if fallback:
            if not card_structure_matches(row,fallback):raise ValueError('已核对卡片的结构不一致：'+reviewed_key)
            target,method=fallback,'reviewed_identity';reviewed_matches.append({'kind':'card','key':reviewed_key,'engineId':target['id']})
        if not target:
            unmapped['cards'].append([row['id'],row['upgradeCount']])
            card_matching['rejected'].append({'id':row['id'],'upgradeCount':row['upgradeCount'],'reason':method});continue
        if method=='effects':card_matching['effects'].append({'id':row['id'],'upgradeCount':row['upgradeCount'],'name':row['name'],'engineId':target['id'],'engineName':target['name']})
        else:card_matching['nameVerified' if method=='name_verified' else 'nameOnly']+=1
        key=json.dumps([row['id'],row['upgradeCount']],ensure_ascii=False,separators=(',',':'));cards_map[key]=[target['id'],digest(row)]
        for id in row['definition'].get('produceCardCustomizeIds',[]):source_sets.setdefault(id,set()).add(target['id'])
        for id in str(target['availableCustomizations']).split(','):
            if id:target_sets.setdefault(int(id),set()).add(target['id'])
    for row in tables['ProduceItem']:
        if row['definition'].get('libraryHidden') or not row['definition']['isExamEffect']:continue
        target=match_item(row,items,item_lookup)
        fallback=reviewed_target(reviewed,'items',row['id'],row,items)
        if fallback:
            if fallback['upgraded']!=row['isUpgraded'] or fallback['plan']!=PLANS.get(row['definition']['planType']):raise ValueError('已核对道具的结构不一致：'+row['id'])
            target=fallback;reviewed_matches.append({'kind':'item','key':row['id'],'engineId':target['id']})
        if not target:unmapped['items'].append(row['id']);continue
        items_map[row['id']]=[target['id'],digest(row)]
    for id,card_ids in source_sets.items():
        levels=sorted(custom_rows.get(id,[]),key=lambda row:row['customizeCount']);prices=[row['producePoint'] for row in levels]
        # 共用附魔只需找到语义一致的参考定义；每张卡能否使用该附魔由运行时单独核验。
        semantic_candidates=[row for row in customs if card_ids&target_sets.get(row['id'],set()) and row['max']==len(levels) and any(custom_matches(levels,grows,effects,row,skills_by_id[id],triggers) for id in card_ids&target_sets.get(row['id'],set()))]
        candidates=[row for row in semantic_candidates if [int(x) for x in str(row['price']).split(',')]==prices] or semantic_candidates
        materials=[customization_material(level,grows,effects,triggers) for level in levels]
        fallback=reviewed_target(reviewed,'customizations',id,materials,customs)
        if fallback:
            if fallback['max']!=len(levels) or not card_ids<=target_sets.get(fallback['id'],set()):raise ValueError('已核对附魔的适用卡片或等级不一致：'+id)
            candidates=[fallback];reviewed_matches.append({'kind':'customization','key':id,'engineId':fallback['id']})
        if len(candidates)!=1:unmapped['customizations'].append(id);continue
        target_prices=[int(x) for x in str(candidates[0]['price']).split(',')]
        if prices!=target_prices:custom_price_differences.append({'id':id,'engineId':candidates[0]['id'],'gamePrices':prices,'enginePrices':target_prices})
        for level,material in zip(levels,materials):
            key=json.dumps([id,level['customizeCount']],separators=(',',':'))
            custom_map[key]=[candidates[0]['id'],digest(material)]
    # 游戏目录新增可用附魔时，逐卡再次验证完整效果，再允许引擎应用现成的等价附魔。
    card_customs={};customs_by_id={row['id']:row for row in customs}
    for row in tables['ProduceCard']:
        mapped=cards_map.get(json.dumps([row['id'],row['upgradeCount']],ensure_ascii=False,separators=(',',':')))
        if not mapped:continue
        target=skills_by_id[mapped[0]]
        for id in row['definition'].get('produceCardCustomizeIds',[]):
            custom=custom_map.get(json.dumps([id,1],separators=(',',':')))
            if not custom or str(custom[0]) in str(target['availableCustomizations']).split(','):continue
            levels=sorted(custom_rows[id],key=lambda value:value['customizeCount'])
            if custom_matches(levels,grows,effects,customs_by_id[custom[0]],target,triggers):card_customs[json.dumps([row['id'],row['upgradeCount'],id],separators=(',',':'))]=custom[0]
    if not mapping_only:
        entry="export {IdolConfig,StageConfig,IdolStageConfig,StageEngine,StagePlayer,STRATEGIES,resetRand,S} from './packages/gakumas-engine/index.js';\nexport {SkillCards,PItems,Customizations,Stages} from './packages/gakumas-data/index.js';\n"
        with tempfile.TemporaryDirectory(prefix='engine-build-',dir=ROOT/'local') as temporary:
            # 入口使用显式源路径；打包器不向产物写入开发机路径。
            temp=Path(temporary);entry_file=temp/'entry.mjs'
            bundle_source=source
            if (data/'csv').exists():
                # 只转换临时打包副本，已校验的原始 CSV 及其来源哈希保持不变。
                bundle_source=temp/'source';shutil.copytree(source,bundle_source)
                for file in (bundle_source/'packages/gakumas-data/csv').glob('*.csv'):
                    file.write_text(json.dumps(parse_csv(file.read_bytes()),ensure_ascii=False))
            entry_file.write_text(entry.replace('./packages/',str(bundle_source.resolve())+'/packages/'))
            subprocess.run([str(esbuild),str(entry_file),'--bundle','--format=esm','--platform=browser','--target=es2022','--minify','--legal-comments=none','--loader:.csv=json','--alias:gakumas-data='+str((bundle_source/'packages/gakumas-data/index.js').resolve()),'--banner:js=// GakumasTools 模拟引擎；固定来源 '+COMMIT+'；BSD-3-Clause 许可见 THIRD_PARTY.md。','--outfile='+str(ROOT/'domain/upstream-contest-engine.mjs')],check=True)
    def stage_record(row):
        triplet=lambda value:dict(zip(('vocal','dance','visual'),[float(x) for x in value.split(',')]))
        # 固定参考投影沿用整数与小数类型，保持与浏览器 JSON 的数值序列化一致。
        normalize=lambda value:int(value) if isinstance(value,float) and value.is_integer() else value
        record={key:row[key] for key in ('id','type','plan','season','stage','round')}
        record.update({key:{k:normalize(v) for k,v in triplet(row[key]).items()} for key in ('criteria','turnCounts','firstTurns')})
        record['effectReference']=row['effects'];record['linkTurnCounts']=[int(x) for x in row['linkTurnCounts'].split(',')] if row['linkTurnCounts'] else [];return record
    stages_map={str(row['id']):digest(stage_record(row)) for row in stages}
    stage_index={'format':1,'source':{'repository':'gakumas-tools/gakumas-tools','commit':COMMIT},'stages':{str(row['id']):{**{key:row[key] for key in ('id','type','plan','season','stage')},'turn':sum(stage_record(row)['turnCounts'].values()),'fingerprint':stages_map[str(row['id'])]} for row in stages}}
    (ROOT/'domain/contest-stage-index.mjs').write_text('// 由 tools/build_contest_engine.py 生成的轻量能力索引；不包含引擎算法。\nexport const contestStageIndex='+json.dumps(stage_index,ensure_ascii=False,separators=(',',':'))+';\n')
    mapping={'source':{'repository':'gakumas-tools/gakumas-tools','commit':COMMIT,'statusEffectEvidenceSha256':hashlib.sha256(EVIDENCE_PATH.read_bytes()).hexdigest(),'reviewedMappingsSha256':hashlib.sha256(REVIEWED_PATH.read_bytes()).hexdigest(),'effectsRevision':master['revision'],'effectsSha256':hashlib.sha256(effects_file.read_bytes()).hexdigest()},'cards':cards_map,'cardCustomizations':card_customs,'items':items_map,'customizations':custom_map,'stages':stages_map}
    (ROOT/'domain/contest-engine-map.mjs').write_text('// 由 tools/build_contest_engine.py 生成；只包含公开目录身份与已核对映射。\nexport const contestEngineMap='+json.dumps(mapping,ensure_ascii=False,separators=(',',':'))+';\n')
    report={'mappedCards':len(cards_map),'mappedItems':len(items_map),'mappedCustomizationLevels':len(custom_map),'unmapped':unmapped,'cardMatching':card_matching,'customPriceDifferences':custom_price_differences,'reviewedMappings':reviewed_matches}
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--effects',type=Path,required=True);mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--esbuild',type=Path);mode.add_argument('--mapping-only',action='store_true',help='仅重建公开资料映射，保留已固定的引擎模块');parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
    report=build(args.source,args.effects,args.esbuild,mapping_only=args.mapping_only);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({key:value for key,value in report.items() if key not in ('unmapped','cardMatching','customPriceDifferences','reviewedMappings')}))
