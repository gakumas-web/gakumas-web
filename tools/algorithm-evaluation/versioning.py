"""将通用证据规则与具体引擎基准分开；身份用于阻止误混，不充当签名认证。"""
import hashlib
import json
from pathlib import Path

KIT = Path(__file__).resolve().parent
DEFAULT_BASELINE = KIT / 'baselines/r00-r08-20261013/profile.json'
SUPPORTED_ADAPTER = 'contest-worker-v1'


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def resolve(base, relative):
    return (Path(base).parent / relative).resolve()


def file_entry(base, entry):
    path = resolve(base, entry['path'])
    require(digest(path) == entry['sha256'], f'baseline artifact changed: {path}')
    return path


def load_baseline(path=DEFAULT_BASELINE):
    path = Path(path).resolve()
    profile = read(path)
    require(profile['format'] == 1, 'unsupported baseline format')
    require(profile['adapter'] == SUPPORTED_ADAPTER, 'unsupported execution adapter')
    runtime = resolve(path, profile['runtime']['directory'])
    content = resolve(path, profile['content']['directory'])
    modules = read(file_entry(path, profile['runtime']['manifest']))
    contents = read(file_entry(path, profile['content']['manifest']))
    require(set(profile['runtime']['algorithmModules']) <= set(modules), 'algorithm modules missing')
    for name, info in modules.items():
        require(digest(runtime / name) == info['sha256'], f'frozen runtime changed: {name}')
    for name, info in contents.items():
        require(digest(content / name) == info['sha256'], f'frozen content changed: {name}')
    cases = {}
    for row in profile['cases']:
        require(row['id'] not in cases, 'duplicate baseline case')
        expected = {}
        for result in row['expected']:
            require(result['seed'] not in expected, 'duplicate baseline seed')
            expected[result['seed']] = file_entry(path, result)
        cases[row['id']] = {'input': file_entry(path, row['input']),
                            'inputSha256': row['input']['sha256'], 'expected': expected}
    for selection in profile['profiles'].values():
        require(selection['cases'] and selection['seeds'], 'empty regression selection')
        for case in selection['cases']:
            require(case in cases and set(selection['seeds']) <= set(cases[case]['expected']), 'missing expected regression record')
    return {'path': path, 'profile': profile, 'sha256': digest(path), 'runtime': runtime,
            'content': content, 'modules': modules, 'contents': contents, 'cases': cases}


def context(baseline, module_hashes=None):
    """评分环境排除显式列出的搜索模块；其余依赖保守地全部绑定版本。"""
    profile = baseline['profile']
    hashes = module_hashes or {name: info['sha256'] for name, info in baseline['modules'].items()}
    require(set(hashes) == set(baseline['modules']), 'runtime inventory mismatch')
    algorithm = set(profile['runtime']['algorithmModules'])
    evaluation = {'runtime': {name: sha for name, sha in hashes.items() if name not in algorithm},
                  'content': {name: info['sha256'] for name, info in baseline['contents'].items()},
                  'adapter': profile['adapter'], 'sampling': profile['sampling'],
                  'candidateKeyContract': profile['candidateKeyContract'],
                  'scoreContract': profile['scoreContract']}
    return {'evaluationId': identity(evaluation), 'algorithmId': identity({name: hashes[name] for name in sorted(algorithm)}),
            'evaluation': evaluation}


def audit(baseline_path=DEFAULT_BASELINE):
    baseline = load_baseline(baseline_path)
    bound = context(baseline)
    return {'passed': True, 'baselineId': baseline['profile']['id'], 'baselineSha256': baseline['sha256'],
            'evaluationId': bound['evaluationId'], 'algorithmId': bound['algorithmId'],
            'runtimeFiles': len(baseline['modules']), 'contentFiles': len(baseline['contents']),
            'cases': list(baseline['cases']), 'newSimulationRuns': 0,
            'boundary': '只核对所选冻结基准；不要求当前生产源码等于旧版本，不解释历史质量结论。'}


def replay_compatibility(expected, actual, check):
    require(check in ['exact', 'observe'], 'unknown replay check')
    compatible = expected['evaluationId'] == actual['evaluationId']
    if check == 'exact':
        require(compatible, 'exact replay requires the same evaluation version; use observe or a new baseline')
    return compatible


def evidence_record(path, case, kind, baseline, module_hashes=None):
    bound = context(baseline, module_hashes)
    return {'path': str(Path(path).resolve()), 'sha256': digest(path), 'case': case, 'kind': kind,
            'inputSha256': baseline['cases'][case]['inputSha256'], 'context': bound}


def load_evidence(plan_path, registries):
    """每个结果必须由回执绑定字节、输入和评分环境，缺失时拒绝比较。"""
    require(registries, 'version evidence required')
    records = {}
    baseline_cache = {}
    for name in registries:
        path = resolve(plan_path, name)
        registry = read(path)
        require(registry['format'] == 1, 'unsupported evidence format')
        require(registry['origin'] in ['historical-binding', 'execution'], 'unknown evidence origin')
        profile_path = resolve(path, registry['baseline']['path'])
        if profile_path not in baseline_cache:
            baseline_cache[profile_path] = load_baseline(profile_path)
        baseline = baseline_cache[profile_path]
        require(baseline['sha256'] == registry['baseline']['sha256'], 'evidence baseline identity mismatch')
        frozen = context(baseline)
        for item in registry['records']:
            record_path = resolve(path, item['path'])
            require(record_path not in records, 'duplicate artifact binding')
            require(item['kind'] in ['search', 'reference'], 'invalid artifact kind')
            require(item['case'] in baseline['cases'], 'unregistered input case')
            require(item['inputSha256'] == baseline['cases'][item['case']]['inputSha256'], 'input binding mismatch')
            bound = item['context']
            require(bound['evaluationId'] == identity(bound['evaluation']), 'evaluation identity mismatch')
            # 执行回执可记录新源码，但必须保留该基准的内容、键与抽样合同。
            for key in ['content', 'adapter', 'sampling', 'candidateKeyContract', 'scoreContract']:
                require(bound['evaluation'][key] == frozen['evaluation'][key], f'evidence contract mismatch: {key}')
            require(set(bound['evaluation']['runtime']) == set(frozen['evaluation']['runtime']), 'evaluation module inventory mismatch')
            records[record_path] = {**item, 'origin': registry['origin'], 'registry': str(path)}
    return records


def bound_artifact(records, path, case, kind):
    path = Path(path).resolve()
    require(path in records, f'unbound artifact: {path}')
    item = records[path]
    require(digest(path) == item['sha256'], f'artifact identity mismatch: {path}')
    require(item['case'] == case and item['kind'] == kind, 'artifact case or role mismatch')
    return item


def require_compatible(*items):
    keys = ['case', 'inputSha256']
    require(all(all(item[key] == items[0][key] for key in keys) for item in items), 'incompatible candidate input')
    require(all(item['context']['evaluationId'] == items[0]['context']['evaluationId'] for item in items),
            'incompatible evaluation versions; reevaluate under one version')
