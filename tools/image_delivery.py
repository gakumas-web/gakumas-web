"""基础 Release 加增量图片合同；只有显式合并才生成新基础包。"""
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

NAME = re.compile(r'(?:images/img_[A-Za-z0-9_-]{1,180}\.webp|ui-icons/[A-Za-z0-9_-]{1,180}\.(?:webp|png))\Z')
OBJECT = re.compile(r'[a-f0-9]{64}\.(?:webp|png)\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
VERSION = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z')
MAX_FILE = 32*1024*1024
MAX_OBJECTS_PER_SEGMENT = 4096
MAX_ARCHIVE = 48*1024*1024
MAX_TOTAL = 1024*1024*1024






def public_url(value, base=False):
    if not isinstance(value, str):raise ValueError('图片交付地址无效')
    url = urlsplit(value)
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1'))) or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('图片地址必须为无凭据 HTTPS，回环测试可使用 HTTP')
    if 'latest' in url.path.lower().split('/') or (base and not url.path.endswith('/')):
        raise ValueError('图片地址须固定版本，基地址须以 / 结尾')
    return value



def source_origin(value):
    url = urlsplit(public_url(value))
    host = '['+url.hostname+']' if ':' in url.hostname else url.hostname
    port = url.port
    return url.scheme+'://'+host+(':'+str(port) if port and port != (443 if url.scheme=='https' else 80) else '')

def object_key(name, row):
    return row['sha256']+Path(name).suffix


def valid_rows(rows, objects=False):
    if not isinstance(rows, dict) or not 1 <= len(rows) <= 20000:raise ValueError('图片清单为空或过大')
    total = 0
    for name, row in rows.items():
        if not (OBJECT if objects else NAME).fullmatch(name) or not isinstance(row, dict):raise ValueError('图片名称无效')
        if type(row.get('bytes')) is not int or not 0 < row['bytes'] <= MAX_FILE or not isinstance(row.get('sha256'), str) or not HASH.fullmatch(row['sha256']):raise ValueError('图片身份无效')
        if objects and name.split('.')[0] != row['sha256']:raise ValueError('对象地址与图片哈希不一致')
        total += row['bytes']
    if total > MAX_TOTAL:raise ValueError('图片总大小超过限制')
    return total


def validate_delivery(value):
    if not isinstance(value, dict) or value.get('format') != 'gakumas-assets-set' or type(value.get('schema_version')) is not int or value.get('schema_version') != 1:raise ValueError('图片交付格式无效')
    if not isinstance(value.get('version'), str) or not VERSION.fullmatch(value['version']):raise ValueError('资源版本无效')
    valid_rows(value.get('files'))
    public_url(value.get('cdn_base_url'), True)
    baseline = value.get('baseline')
    if not isinstance(baseline, dict) or not isinstance(baseline.get('version'), str) or not VERSION.fullmatch(baseline['version']):raise ValueError('基础包版本无效')
    packages = baseline.get('packages')
    if not isinstance(packages, list) or not 1 <= len(packages) <= 256:raise ValueError('基础分段数量无效')
    seen, urls, total = {}, set(), 0
    for pack in packages:
        if not isinstance(pack, dict):raise ValueError('基础分段无效')
        public_url(pack.get('url'))
        if pack['url'] in urls:raise ValueError('基础包地址重复')
        urls.add(pack['url'])
        if type(pack.get('bytes')) is not int or not 0 < pack['bytes'] <= MAX_ARCHIVE or not isinstance(pack.get('sha256'), str) or not HASH.fullmatch(pack['sha256']):raise ValueError('基础包身份无效')
        size = valid_rows(pack.get('objects'), True)
        if size > MAX_FILE or len(pack['objects']) > MAX_OBJECTS_PER_SEGMENT:raise ValueError('基础分段超过解包预算')
        if seen.keys() & pack['objects'].keys():raise ValueError('基础分段重复包含对象')
        seen.update(pack['objects']);total += size
    if total > MAX_TOTAL or len(seen) > 20000:raise ValueError('基础包集合过大')
    current = {}
    for name, row in value['files'].items():
        key = object_key(name, row)
        if key in current and (current[key]['bytes'], current[key]['sha256']) != (row['bytes'], row['sha256']):raise ValueError('相同对象身份不一致')
        current[key] = row
        if key in seen and (seen[key]['bytes'], seen[key]['sha256']) != (row['bytes'], row['sha256']):raise ValueError('基础包与当前图片身份不一致')
    cdn = value.get('cdn_objects')
    if not isinstance(cdn, list) or any(not isinstance(key, str) for key in cdn) or len(cdn) != len(set(cdn)) or not set(cdn) <= current.keys():raise ValueError('增量图片集合无效')
    if not current.keys() <= seen.keys() | set(cdn):raise ValueError('当前图片既不在基础包也不在增量集合')
    return value


def read_resource_set(raw, expected_version=None):
    if len(raw)>8*1024*1024:raise ValueError('资源索引超过大小限制')
    value=validate_delivery(json.loads(raw))
    if expected_version is not None and value['version']!=expected_version:raise ValueError('资源索引版本与锁不匹配')
    return value
