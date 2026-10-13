"""校验可选的公开补充元数据与玩家推导规则，不包含计算默认值。"""
import math
import re


def _object(value):
    return isinstance(value, dict)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _text(value):
    return isinstance(value, str) and bool(value)


def validate_catalog_metadata(value):
    if not _object(value) or type(value.get('schema_version')) is not int or value.get('schema_version') != 1:
        raise ValueError('目录补充元数据格式无效')
    colors, times = value.get('characterColors'), value.get('skinReleaseTimes')
    if not _object(colors) or any(not _text(key) or not isinstance(color, str) or not re.fullmatch(r'#[0-9A-Fa-f]{6}', color) for key, color in colors.items()):
        raise ValueError('角色印象色无效')
    if not _object(times):
        raise ValueError('装扮发行时间补充无效')
    for key, row in times.items():
        if not _text(key) or not _object(row) or not _number(row.get('time')) or row['time'] == 0 or row.get('source') not in ('reported-batch', 'same-batch'):
            raise ValueError('装扮发行时间补充无效')
        if row['source'] == 'reported-batch' and (row.get('precision') != 'day' or not _text(row.get('url'))):
            raise ValueError('报道日期缺少精度或来源')
        if row['source'] == 'same-batch' and (not isinstance(row.get('referenceIds'), list) or not row['referenceIds'] or not all(_text(item) for item in row['referenceIds'])):
            raise ValueError('同批次日期缺少参考记录')
    return value


def validate_community_rules(value):
    if not _object(value) or type(value.get('schema_version')) is not int or value.get('schema_version') != 1:
        raise ValueError('玩家推导规则格式无效')
    hif, costs = value.get('hifStar'), value.get('contestCosts')
    for rule in (hif, costs):
        if not _object(rule) or rule.get('classification') != 'player-inferred' or rule.get('verification') != 'maintainer-confirmed-game-consistent':
            raise ValueError('玩家推导规则缺少性质和核对状态')
    if type(hif.get('enabled')) is not bool or not _number(hif.get('finalCap')) or not hif['finalCap'] or not _number(hif.get('bonusMultiplier')) or not hif['bonusMultiplier'] or hif.get('rounding') not in ('floor', 'round', 'ceil', 'none'):
        raise ValueError('HIF 奖励参数无效')
    item, battle = hif.get('item'), hif.get('battle')
    if not _object(item) or not all(_text(item.get(key)) for key in ('id', 'name')) or type(item.get('limit')) is not int or item['limit'] < 0 or not _number(item.get('baseReward')) or item.get('countField') not in ('triggerCount', 'reactionCount') or item.get('matchingCountField') not in (None, 'triggerCount', 'reactionCount'):
        raise ValueError('HIF 道具规则无效')
    if not _object(battle) or any(not isinstance(battle.get(key), list) or not all(_number(number) for number in battle[key]) for key in ('spLessons', 'rounds')):
        raise ValueError('HIF 本战奖励无效')
    def pair(row):
        return _object(row) and all(_number(row.get(key)) for key in ('base', 'upgraded'))
    rarities = costs.get('rarities')
    if not _number(costs.get('exclusiveCost')) or not _number(costs.get('initialProducerLevelMax')) or not pair(costs.get('supportCard')) or not _object(rarities) or not rarities or any(not _text(key) or not pair(row) or 'initial' in row and not pair(row['initial']) for key, row in rarities.items()):
        raise ValueError('卡片容量费用无效')
    ranges, aliases = costs.get('ranges'), costs.get('rankAliases')
    if not isinstance(ranges, list) or not ranges or any(not _object(row) or not _text(row.get('rank')) or not _number(row.get('min')) or not _number(row.get('max')) or row['min'] > row['max'] for row in ranges):
        raise ValueError('卡组容量区间无效')
    ranks = {row['rank'] for row in ranges}
    if len(ranks) != len(ranges) or not _object(aliases) or any(not _text(key) or key in ranks or target not in ranks for key, target in aliases.items()):
        raise ValueError('卡组评级别名无效')
    return value


def validate_memory_power_tables(tables):
    """两张综合值原表可同时缺失；提供时必须完整，未知稀有度不得代用。"""
    names = ('Setting', 'ProduceCardCustomizeRarityEvaluation')
    if not any(name in tables for name in names):
        return tables
    def integer(value):
        return type(value) is int and 0 <= value <= 9007199254740991
    settings, customizations = (tables.get(name) for name in names)
    coefficients = ('memoryPowerParameterCoefficientPermil', 'memoryPowerStaminaCoefficientPermil', 'memoryPowerProduceResourceEvaluationCoefficientPermil')
    if not isinstance(settings, list) or len(settings) != 1 or not isinstance(settings[0], dict) or settings[0].get('id') != '1' or any(not integer(settings[0].get(key)) for key in coefficients):
        raise ValueError('回忆综合值系数表无效')
    if not isinstance(customizations, list) or not customizations:
        raise ValueError('回忆附魔评价表缺失或为空')
    rarities = set()
    for row in customizations:
        if not isinstance(row, dict) or not isinstance(row.get('rarity'), str) or not row['rarity'].startswith('ProduceCardRarity_') or row['rarity'] in rarities or not integer(row.get('evaluation')):
            raise ValueError('回忆附魔评价无效或重复')
        rarities.add(row['rarity'])
    if not {'ProduceCardRarity_N', 'ProduceCardRarity_R', 'ProduceCardRarity_Sr', 'ProduceCardRarity_Ssr'} <= rarities:
        raise ValueError('回忆附魔评价缺少基础稀有度')
    return tables
