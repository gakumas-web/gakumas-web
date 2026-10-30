"""验证同一次 Pages 发布流程冻结的已部署模拟能力基线。"""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

HASH_FIELDS = ('release_sha256', 'channel_sha256', 'content_manifest_sha256', 'progression_sha256',
               'effects_sha256', 'engine_sha256', 'mapping_sha256', 'catalog_sha256')
HASH = re.compile(r'[a-f0-9]{64}\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
STAGE_ID = re.compile(r'contest:pvp_rate_config-[1-9][0-9]*:[0-9]+\Z')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def baseline_fingerprint(value):
    return hashlib.sha256(canonical({key: item for key, item in value.items() if key != 'fingerprint'})).hexdigest()


def validate_baseline_snapshot(value):
    required = {'format', 'schema_version', 'state', 'site_url', 'engine_commit', 'readyStageIds', 'fingerprint', *HASH_FIELDS}
    if (not isinstance(value, dict) or set(value) != required
            or value.get('format') != 'gakumas-contest-deployed-baseline'
            or type(value.get('schema_version')) is not int or value['schema_version'] != 1
            or value.get('state') not in ('ready', 'bootstrap')):
        raise ValueError('已部署模拟基线格式无效')
    try:
        if not isinstance(value['site_url'], str):
            raise ValueError
        url = urlsplit(value['site_url'])
        if (url.scheme != 'https' or not url.hostname or url.username is not None or url.password is not None
                or url.query or url.fragment or any(char.isspace() for char in value['site_url'])):
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError('已部署模拟基线站点无效') from None
    ids = value['readyStageIds']
    if (not isinstance(ids, list) or any(not isinstance(id, str) or not STAGE_ID.fullmatch(id) for id in ids)
            or len(ids) != len(set(ids))):
        raise ValueError('已部署模拟基线舞台范围无效')
    if value['state'] == 'bootstrap':
        if ids or value['engine_commit'] is not None or any(value[key] is not None for key in HASH_FIELDS):
            raise ValueError('首次部署基线必须为空')
    elif (not isinstance(value['engine_commit'], str) or not COMMIT.fullmatch(value['engine_commit'])
          or any(not isinstance(value[key], str) or not HASH.fullmatch(value[key]) for key in HASH_FIELDS)):
        raise ValueError('已部署模拟基线身份无效')
    if value.get('fingerprint') != baseline_fingerprint(value):
        raise ValueError('已部署模拟基线指纹不匹配')
    return value


def read_baseline_snapshot(path):
    path = Path(path)
    if path.stat().st_size > 64 * 1024:
        raise ValueError('已部署模拟基线超过大小限制')
    return validate_baseline_snapshot(json.loads(path.read_bytes()))
