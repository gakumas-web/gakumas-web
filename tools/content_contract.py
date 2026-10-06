"""内容格式 1 的发布端校验器；通过合同样例与消费者对齐，不跨项目导入。"""
import hashlib
import json
import re
from image_delivery import read_resource_set

SCOPES = ('catalog', 'effects', 'abilities', 'progression', 'achievements')
FORMAT = 'gakumas-content'
MAX_MANIFEST = 64 * 1024
MAX_PART = 32 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_BUNDLE = 128 * 1024 * 1024
VERSION = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def validate_manifest(raw, expected_version=None):
    if len(raw) > MAX_MANIFEST:
        raise ValueError('内容清单超过限制')
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get('format') != FORMAT or type(value.get('schema_version')) is not int or value.get('schema_version') != 1:
        raise ValueError('不支持的内容格式')
    version = value.get('version')
    if not isinstance(version, str) or not VERSION.fullmatch(version) or version in ('.', '..'):
        raise ValueError('内容版本无效')
    if expected_version is not None and version != expected_version:
        raise ValueError('内容版本与锁不匹配')
    if not isinstance(value.get('master_revision'), str) or not value['master_revision']:
        raise ValueError('内容缺少主数据版本')
    if not isinstance(value.get('min_web_version'), str) or not re.fullmatch(r'\d+\.\d+\.\d+', value['min_web_version']):
        raise ValueError('最低 Web 版本无效')
    if tuple(map(int, value['min_web_version'].split('.'))) < (0, 5, 0):
        raise ValueError('内容格式 1 至少需要 Web 0.5.0')
    files = value.get('files')
    if not isinstance(files, dict) or set(files) != {scope+'.json' for scope in SCOPES} | {'assets-index.json'}:
        raise ValueError('内容文件集合不完整或包含额外文件')
    total = 0
    for name, row in files.items():
        if not isinstance(row, dict) or type(row.get('bytes')) is not int or not 0 < row['bytes'] <= MAX_PART or not isinstance(row.get('sha256'), str) or not HASH.fullmatch(row['sha256']):
            raise ValueError('内容文件大小或哈希无效')
        if name != 'assets-index.json' and (not isinstance(row.get('revision'), str) or not HASH.fullmatch(row['revision'])):
            raise ValueError('内容分包缺少独立业务版本')
        total += row['bytes']
    if total > MAX_TOTAL:
        raise ValueError('内容总大小超过限制')
    return value


def validate_part(name, raw, manifest):
    row = manifest['files'][name]
    if len(raw) != row['bytes'] or sha256(raw) != row['sha256']:
        raise ValueError('内容文件校验失败: '+name)
    if name == 'assets-index.json':
        return read_resource_set(raw)
    value = json.loads(raw)
    scope = name.removesuffix('.json')
    revision = row['revision']
    if not isinstance(value, dict) or value.get('scope') != scope or value.get('revision') != revision:
        raise ValueError('内容分包身份不一致: '+name)
    required = {'catalog': ('characters', 'idols', 'supports'), 'effects': ('tables',),
                'abilities': ('tables',), 'progression': ('progression',), 'achievements': ('achievements',)}[scope]
    if any(not isinstance(value.get(key), dict) for key in required):
        raise ValueError('内容分包结构不完整: '+name)
    if scope == 'catalog':
        if any(not isinstance(value[group].get(key), list) for group, key in [('idols', 'cards'), ('idols', 'skins'), ('supports', 'cards')]):
            raise ValueError('卡牌目录必须为数组')
    else:
        table_names = {'effects': ('ProduceCard', 'ProduceItem', 'ProduceExamEffect'),
                       'abilities': ('MemoryAbility', 'ProduceSkill', 'ProduceEffect'),
                       'progression': ('IdolCard', 'SupportCard'),
                       'achievements': ('Achievement', 'AchievementProgress', 'Mission', 'Item')}[scope]
        tables = value.get('tables') if scope in ('effects', 'abilities') else value['progression'].get('tables') if scope == 'progression' else value['achievements']
        if not isinstance(tables, dict) or any(not isinstance(tables.get(table), list) for table in table_names):
            raise ValueError('内容数据表不完整: '+name)
    return value


def validate_bundle(raw):
    if len(raw) > MAX_BUNDLE:
        raise ValueError('本地内容包超过限制')
    bundle = json.loads(raw)
    if not isinstance(bundle, dict) or bundle.get('format') != 'gakumas-content-bundle' or bundle.get('schema_version') != 1:
        raise ValueError('本地内容包格式无效')
    manifest_text = bundle.get('manifest')
    if not isinstance(manifest_text, str) or sha256(manifest_text.encode()) != bundle.get('manifest_sha256'):
        raise ValueError('本地内容包清单校验失败')
    manifest = validate_manifest(manifest_text.encode())
    files = bundle.get('files')
    if not isinstance(files, dict) or set(files) != set(manifest['files']) or any(not isinstance(value, str) for value in files.values()):
        raise ValueError('本地内容包文件集合无效')
    for name, text in files.items():
        validate_part(name, text.encode(), manifest)
    return manifest, files


def require_web_version(minimum, current):
    if not isinstance(current, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', current):
        raise ValueError('Web 程序版本无效')
    if tuple(map(int, minimum.split('.'))) > tuple(map(int, current.split('-')[0].split('.'))):
        raise ValueError('内容需要更新的 Web 程序版本')
