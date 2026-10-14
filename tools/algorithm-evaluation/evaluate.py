"""推荐算法本地评测入口：基准校验、轨迹诊断、版本比较和真实 Worker 回归。"""
import argparse
import hashlib
import http.server
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import tarfile
import threading
from urllib.parse import urlparse

KIT = Path(__file__).resolve().parent
import versioning as versions

audit = versions.audit


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def save(path, value):
    """拒绝覆盖已有回执，保留原始实验。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')


def stamp(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': digest(path)}


def diagnose(path, key=None):
    run = read(path)
    events = run.get('research', {}).get('events')
    require(events is not None, 'research.events required; absence is not a negative finding')
    key = key or run['rows'][0]['key']
    proposed = [e for e in events if e['event'] == 'proposed' and key in e['keys']]
    scored = [e for e in events if e['event'] == 'scored' and e.get('key') == key]
    phases = sorted({e['phase'] for e in proposed})
    return {'record': stamp(path), 'key': key, 'champion': key == run['rows'][0]['key'],
            'searchGenerations': [e['generation'] for e in proposed if e['phase'] == 'search'],
            'proposedPhases': phases, 'scored': bool(scored),
            'polishParent': any(e['event'] == 'parents' and key in e['keys'] for e in events),
            'finalist': any(row['key'] == key for row in run['rows']),
            'phaseRuns': run.get('diagnostics', {}).get('phaseRuns'),
            'timing': run['research'].get('timing'),
            'boundary': '精确配置事件；未成为下一代或局部起点不等于永久淘汰。修复时间包含于生成，Worker 时间不可直接相加。'}


def compare(plan_path):
    """按协议读取已锁定冠军及外评，不在参考池重新挑冠军。"""
    plan_path = Path(plan_path).resolve()
    plan = read(plan_path)
    require(plan.get('format') == 2, 'comparison format 2 with version evidence required')
    require(plan['purpose'] in ['development', 'regression', 'holdout'], 'invalid purpose')
    require(plan['pairs'], 'empty comparison')
    evidence = versions.load_evidence(plan_path, plan.get('evidence'))
    rows, identities, seen, contexts = [], [], set(), []
    for pair in plan['pairs']:
        identity = (pair['case'], pair['seed'])
        require(identity not in seen, f'duplicate pair: {identity}')
        seen.add(identity)
        paths = {name: (plan_path.parent / pair[name]).resolve() for name in ['baseline', 'candidate', 'reference']}
        bound = [versions.bound_artifact(evidence, paths[name], pair['case'], 'reference' if name == 'reference' else 'search')
                 for name in ['baseline', 'candidate', 'reference']]
        versions.require_compatible(*bound)
        contexts.append({'evaluationId': bound[0]['context']['evaluationId'],
                         'algorithmA': bound[0]['context']['algorithmId'], 'algorithmB': bound[1]['context']['algorithmId']})
        a, b, ref = (read(paths[name]) for name in ['baseline', 'candidate', 'reference'])
        require(a['seed'] == b['seed'] == pair['seed'], 'search seed mismatch')
        require(ref['seeds'] == [plan['referenceSeed']], 'reference seed mismatch')
        require(ref['runs'] == plan['referenceRuns'], 'reference sample count mismatch')
        scores = {}
        for row in ref['rows']:
            require(row['seed'] == plan['referenceSeed'], 'mixed reference seeds')
            require(row['key'] not in scores, 'duplicate reference key')
            require(len(row['scores']) == ref['runs'], 'truncated reference samples')
            value = row['stats']['score']
            require(math.isfinite(value) and all(math.isfinite(v) for v in row['scores']), 'nonfinite score')
            scores[row['key']] = value
        require(ref['totalRuns'] == len(ref['rows']) * ref['runs'], 'reference cost mismatch')
        keys = [a['rows'][0]['key'], b['rows'][0]['key']]
        require(all(key in scores for key in keys), 'locked champion missing from reference')
        require(a['totalRuns'] > 0 and b['totalRuns'] > 0, 'invalid search cost')
        gain = (scores[keys[1]] - scores[keys[0]]) / max(1, abs(scores[keys[0]]))
        elapsed = [run.get('elapsedMs', run.get('elapsed')) for run in [a, b]]
        require(all(value is not None and value > 0 and math.isfinite(value) for value in elapsed), 'invalid elapsed time')
        rows.append({'case': pair['case'], 'seed': pair['seed'], 'gain': gain,
                     'runsA': a['totalRuns'], 'runsB': b['totalRuns'], 'timeRatio': elapsed[1] / elapsed[0],
                     'scoreA': scores[keys[0]], 'scoreB': scores[keys[1]], 'champions': keys})
        identities.extend(stamp(path) for path in paths.values())
    require(all(row == contexts[0] for row in contexts), 'mixed comparison environments or algorithms')
    median = statistics.median(row['gain'] for row in rows)
    worst = min(row['gain'] for row in rows)
    time_ratio = statistics.median(row['timeRatio'] for row in rows)
    checks = {'medianGain': median >= plan['gates']['medianGain'],
              'worstGain': worst >= plan['gates']['worstGain'],
              'budget': all(row['runsB'] <= row['runsA'] for row in rows),
              'medianTimeRatio': time_ratio <= plan['gates']['medianTimeRatio']}
    return {'plan': stamp(plan_path), 'purpose': plan['purpose'], 'rows': rows,
            'versionContext': contexts[0], 'versionCompatibilityChecked': True,
            'medianGain': median, 'worstGain': worst, 'medianTimeRatio': time_ratio,
            'checks': checks, 'passed': all(checks.values()), 'sources': identities,
            'newSimulationRuns': 0, 'adoptionApproved': False,
            'boundary': '核对回执绑定的字节、输入与评分环境；历史补绑定不是当时生成的证明，未见性及事先登记需另行核验。通过不自动授权上线。'}


SEARCH = '''async ({options,seed,budgetName})=>{
 const {startContestOptimization,OPTIMIZATION_BUDGETS}=await import('./application/contest-optimization-client.mjs');
 const started=performance.now();
 if(!OPTIMIZATION_BUDGETS[budgetName])throw Error('unknown evaluation budget');
 const report=await startContestOptimization(options,{seed,budget:OPTIMIZATION_BUDGETS[budgetName],multiCore:true,diagnosticDetails:true}).promise;
 return {seed,elapsedMs:performance.now()-started,totalRuns:report.totalRuns,
 rows:report.rows.map(row=>({key:row.key,genome:row.genome,score:row.stats.score,scores:row.result.scores})),
 research:report.research??null,diagnostics:report.diagnostics,unsupported:report.unsupported,skipped:report.skipped};
}'''


def regression(profile, source, output, baseline_path=versions.DEFAULT_BASELINE, check='exact'):
    """从冻结正式输入运行真实 Worker，不读取预览站点或账号。"""
    from playwright.sync_api import sync_playwright
    output = Path(output).resolve()
    require(not output.exists(), f'output already exists: {output}')
    baseline = versions.load_baseline(baseline_path)
    configuration = baseline['profile']
    require(profile in configuration['profiles'], 'unknown regression profile')
    runtime = (baseline['runtime'] if source == 'frozen' else Path(source)).resolve()
    manifest = baseline['modules']
    content_manifest = baseline['contents']
    source_hashes = {name: digest(runtime / name) for name in manifest}
    if source == 'frozen':
        require(all(source_hashes[name] == info['sha256'] for name, info in manifest.items()), 'frozen runtime changed')
    actual_context = versions.context(baseline, source_hashes)
    expected_context = versions.context(baseline)
    compatible = versions.replay_compatibility(expected_context, actual_context, check)
    output.mkdir(parents=True)
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            relative = urlparse(self.path).path.lstrip('/')
            if relative in ['', 'index.html']:
                data, content_type = b'<!doctype html><meta charset="utf-8"><title>Algorithm evaluation</title>', 'text/html'
            elif relative in manifest:
                data, content_type = (runtime / relative).read_bytes(), 'text/javascript'
            elif relative in content_manifest:
                data, content_type = (baseline['content'] / relative).read_bytes(), 'application/json'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    cases = configuration['profiles'][profile]['cases']
    seeds = configuration['profiles'][profile]['seeds']
    protocol = {'profile': profile, 'cases': cases, 'seeds': seeds, 'source': str(runtime),
                'baseline': {'path': os.path.relpath(baseline['path'], output), 'sha256': baseline['sha256']},
                'check': check, 'versionContext': actual_context,
                'moduleSha256': source_hashes, 'budget': configuration['budget'], 'hardwareConcurrency': configuration['hardwareConcurrency'],
                'contentSha256': {name: entry['sha256'] for name, entry in content_manifest.items()},
                'python': platform.python_version(), 'playwright': importlib.metadata.version('playwright'),
                'inputSha256': {case: baseline['cases'][case]['inputSha256'] for case in cases}}
    save(output / 'protocol.json', protocol)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    summaries = []
    bindings = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.add_init_script("Object.defineProperty(navigator,'hardwareConcurrency',{value:" + str(configuration['hardwareConcurrency']) + "})")
                page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='networkidle')
                page.evaluate("async()=>{const {loadMaster}=await import('./application/master-loader.mjs');await loadMaster('contests');}")
                for case in cases:
                    require(digest(baseline['cases'][case]['input']) == baseline['cases'][case]['inputSha256'], 'input changed before run')
                    options = read(baseline['cases'][case]['input'])
                    for seed in seeds:
                        expected = read(baseline['cases'][case]['expected'][seed])
                        record = page.evaluate(SEARCH, {'options': options, 'seed': seed, 'budgetName': configuration['budget']})
                        record_path = output / f'{case}-{seed}.json'
                        save(record_path, record)
                        binding = versions.evidence_record(record_path, case, 'search', baseline, source_hashes)
                        binding['path'] = record_path.name
                        bindings.append(binding)
                        exact = record['rows'] == expected['rows'] and record['totalRuns'] == expected['totalRuns'] if check == 'exact' else None
                        summaries.append({'case': case, 'seed': seed, 'exactReplay': exact,
                                          'totalRuns': record['totalRuns'], 'elapsedMs': record['elapsedMs']})
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    require(all(digest(runtime / name) == sha for name, sha in source_hashes.items()), 'runtime changed during run')
    require(all(digest(baseline['content'] / name) == info['sha256'] for name, info in content_manifest.items()), 'content changed during run')
    require(all(digest(baseline['cases'][case]['input']) == baseline['cases'][case]['inputSha256'] for case in cases), 'input changed during run')
    save(output / 'evidence.json', {'format': 1, 'origin': 'execution', 'baseline': protocol['baseline'], 'records': bindings})
    result = {'profile': profile, 'source': source, 'runs': summaries,
              'check': check, 'evaluationId': actual_context['evaluationId'], 'compatibleWithBaseline': compatible,
              'newSimulationRuns': sum(row['totalRuns'] for row in summaries),
              'passed': all(row['exactReplay'] for row in summaries) if check == 'exact' else None,
              'status': 'checked' if check == 'exact' else 'observed',
              'boundary': '历史案例确定性回归，不是新算法独立质量验收；源码变化导致不一致时须另做固定冠军外评。'}
    save(output / 'summary.json', result)
    return result


def verify_archive(path):
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        names = [entry.name for entry in members]
        require(len(names) == len(set(names)), 'duplicate archive member')
        require(all(entry.isfile() and not Path(entry.name).is_absolute() and '..' not in Path(entry.name).parts for entry in members), 'unsafe archive member')
        manifest = json.load(archive.extractfile('MANIFEST.json'))
        expected = manifest['files']
        require(set(names) == set(expected) | {'MANIFEST.json'}, 'archive inventory mismatch')
        for name, info in expected.items():
            member = archive.getmember(name)
            require(member.size == info['bytes'], f'archive size mismatch: {name}')
            with archive.extractfile(member) as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            require(actual == info['sha256'], f'archive hash mismatch: {name}')
    return {'passed': True, 'files': len(expected), 'archiveSha256': digest(path), 'bytes': Path(path).stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    aud = sub.add_parser('audit', help='校验所选版本基准，不要求当前生产版本保持不变')
    aud.add_argument('--baseline', type=Path, default=versions.DEFAULT_BASELINE)
    diag = sub.add_parser('diagnose', help='读取单次轨迹的候选生命周期')
    diag.add_argument('record', type=Path)
    diag.add_argument('--key')
    comp = sub.add_parser('compare', help='按协议比较锁定冠军及完整预算')
    comp.add_argument('plan', type=Path)
    reg = sub.add_parser('regression', help='真实浏览器 Worker 固定回归')
    reg.add_argument('--profile', choices=['smoke', 'full'], default='smoke')
    reg.add_argument('--source', default='frozen', help='frozen 或含完整模块的源码目录')
    reg.add_argument('--baseline', type=Path, default=versions.DEFAULT_BASELINE)
    reg.add_argument('--check', choices=['exact', 'observe'], default='exact', help='同评分版本精确回归，或只记录观察而不作质量判定')
    reg.add_argument('--output', required=True, type=Path)
    verify = sub.add_parser('verify-archive', help='不解包核对每个文件及归档身份')
    verify.add_argument('path', type=Path)
    args = parser.parse_args()
    if args.command == 'audit':
        result = audit(args.baseline)
    elif args.command == 'diagnose':
        result = diagnose(args.record, args.key)
    elif args.command == 'compare':
        result = compare(args.plan)
    elif args.command == 'regression':
        result = regression(args.profile, args.source, args.output, args.baseline, args.check)
    else:
        result = verify_archive(args.path)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 2 if result.get('passed') is False else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError) as error:
        print(f'evaluation failed: {error}', file=sys.stderr)
        sys.exit(1)
