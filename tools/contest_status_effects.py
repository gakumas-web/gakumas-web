"""依据固定公开表核对持续效果替换；只覆盖已验证的触发结构。"""
import json
from pathlib import Path

EVIDENCE_PATH=Path(__file__).with_name('contest-status-effects.json')
EVIDENCE=json.loads(EVIDENCE_PATH.read_text())
STATUSES={row['id']:row for row in EVIDENCE['statusEnchants']}
TRIGGERS={row['id']:row for row in EVIDENCE['triggers']}
SEARCHES={row['id']:row for row in EVIDENCE['searches']}

def compact(value):return ''.join(value.split())

def verified_definition(id,effects):
    definition=effects.get(id,{}).get('definition')
    return definition if definition==EVIDENCE['effectDefinitions'].get(id) else None

def action(definition):
    kind=definition['effectType']
    if kind in ('ProduceExamEffectType_ExamLessonDependBlock','ProduceExamEffectType_ExamLessonDependExamReview'):
        field='genki' if kind.endswith('Block') else 'goodImpressionTurns';ratio=definition['effectValue1']/1000
        return f'score+={field}'+(f'*{ratio:g}' if ratio!=1 else '')
    if kind=='ProduceExamEffectType_ExamReview':return f"goodImpressionTurns+={definition['effectValue1']}"
    if kind=='ProduceExamEffectType_ExamBlockPerUseCardCount':return f"genki+={definition['effectValue2']}*cardsUsed+{definition['effectValue1']}"
    return None

def translate(id,effects):
    definition=verified_definition(id,effects)
    if definition is None:return None
    if definition['effectType']=='ProduceExamEffectType_ExamBlockPerUseCardCount':
        return f"@base genki+={definition['effectValue1']}+cardsUsed*{definition['effectValue2']}"
    if definition['effectType']!='ProduceExamEffectType_ExamStatusEnchant':return None
    status=STATUSES.get(definition['produceExamStatusEnchantId'])
    if not status:return None
    trigger=TRIGGERS[status['produceExamTriggerId']];search=SEARCHES.get(trigger['produceCardSearchId'])
    actions=[]
    for id in status['produceExamEffectIds']:
        child=verified_definition(id,effects)
        if child is None:return None
        statement=action(child)
        if statement is None:return None
        actions.append(statement)
    body=';'.join(actions);turns=definition['effectTurn'];count=definition['effectCount'];phases=trigger['phaseTypes']
    if phases==['ProduceExamPhaseType_ExamStartTurn'] and not search and turns>0 and count==0:
        return f'@trigger at:startOfTurn{{{body};limit:{turns}}}'
    if phases==['ProduceExamPhaseType_ExamCardPlay'] and search and search['cardPositionType']=='ProduceCardPositionType_Playing' and trigger['lowerSearchCount']==1 and trigger['upperSearchCount']==0 and turns==-1 and count==0:
        return f'@trigger at:cardUsed{{{body}}}'
    if phases==['ProduceExamPhaseType_ExamStatusChange'] and trigger['effectTypes']==['ProduceExamEffectType_ExamReview'] and turns>0 and count==0:
        return f'@trigger at:goodImpressionTurnsIncreased{{if:isDirectEffect{{{body}}};ttl:{turns}}}'
    if phases==['ProduceExamPhaseType_ExamPlayCountInterval'] and trigger['phaseValues']==[3] and search and search['cardCategories']==['ProduceCardCategory_ActiveSkill'] and search['cardPositionType']=='ProduceCardPositionType_Target' and turns==-1 and count==2:
        # 引擎先判定触发，再更新同源计数，因此第三次使用对应旧计数余二。
        return f'@base at:cardUsed[active]{{effectCounter+=1}};+at:cardUsed[active]{{if:effectCounter%3==2{{{body}}};limit:{count}}}'
    return None

def effect_change(grow,effects,base_card):
    if base_card is None or len(grow.get('targetPlayProduceExamEffectIds',[]))!=1:return None
    ignored={'id','effectType','effectGroupIds','playProduceExamEffectId','targetPlayProduceExamEffectIds'}
    if any(key not in ignored and value not in ('',0,False,None,[]) and not (isinstance(value,str) and value.endswith('_Unknown')) for key,value in grow.items()):return None
    before=translate(grow['targetPlayProduceExamEffectIds'][0],effects);after=translate(grow['playProduceExamEffectId'],effects)
    if before is None or after is None or compact(before) not in compact(base_card['actions']):return None
    # 标签保留原动作的位置，由参考引擎执行替换，不能追加成第二份持续效果。
    return 'actions',after
