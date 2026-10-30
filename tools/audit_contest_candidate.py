"""固定公开分包和引擎来源，在独立目录执行合并前模拟兼容性审计。"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from content_contract import MAX_PART, MAX_TOTAL, SCOPES, validate_part
from contest_engine_tables import read_table
import update_contest_engine as production

ROOT = Path(__file__).resolve().parents[1]
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
STAGE_ID = re.compile(r'contest:pvp_rate_config-([1-9][0-9]*):([0-9]+)\Z')
MANIFEST = 'review-manifest.json'
REPORT = 'contest-engine-audit-report.json'
TOOLS = ('audit_contest_candidate.py', 'audit_contest_engine.mjs', 'build_contest_engine.py',
         'update_contest_engine.py', 'contest_engine_tables.py', 'contest_status_effects.py',
         'contest-engine-source.json', 'contest-engine-reviewed-mappings.json',
         'contest-status-effects.json', 'contest-engine-compatibility-baseline.json',
         'content_contract.py', 'image_delivery.py', 'reference_contract.py', 'contest_baseline_contract.py')
PROGRAM_FILES = ('resources.mjs', 'image-config.mjs', 'i18n.mjs', 'THIRD_PARTY.md')
REGRESSIONS = ('contest-engine.test.mjs', 'contest-reviewed-mappings.test.mjs')


class AuditError(Exception):
    def __init__(self, kind, message=None):
        self.kind = kind
        self.message = message
        super().__init__(kind)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    Path(path).write_bytes(canonical(value) + b'\n')


def read_json(raw, kind):
    try:
        return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (UnicodeError, ValueError):
        raise AuditError(kind) from None


def load_content(directory):
    """先验证完整文件身份，再把已验证字节交给后续工具，避免混用变化中的输入。"""
    root = Path(directory).resolve(strict=True)
    path = root / MANIFEST
    if path.is_symlink() or path.stat().st_size > 64 * 1024:
        raise AuditError('content_manifest_invalid')
    raw = path.read_bytes()
    manifest = read_json(raw, 'content_manifest_invalid')
    allowed = {'format', 'schema_version', 'upstream_commit', 'source_commit', 'files'}
    if (not isinstance(manifest, dict) or set(manifest) - allowed
            or manifest.get('format') != 'gakumas-contest-audit-content'
            or type(manifest.get('schema_version')) is not int or manifest['schema_version'] != 1
            or not isinstance(manifest.get('upstream_commit'), str)
            or not COMMIT.fullmatch(manifest['upstream_commit'])
            or not isinstance(manifest.get('files'), dict)
            or set(manifest['files']) != {scope + '.json' for scope in SCOPES}):
        raise AuditError('content_manifest_invalid')
    if 'source_commit' in manifest and (not isinstance(manifest['source_commit'], str)
                                       or not COMMIT.fullmatch(manifest['source_commit'])):
        raise AuditError('content_manifest_invalid')
    files, parts, total = {}, {}, 0
    for name, identity in manifest['files'].items():
        file = root / name
        if (not isinstance(identity, dict) or set(identity) != {'sha256', 'bytes', 'revision'}
                or not isinstance(identity.get('sha256'), str) or not HASH.fullmatch(identity['sha256'])
                or not isinstance(identity.get('revision'), str) or not HASH.fullmatch(identity['revision'])
                or type(identity.get('bytes')) is not int or not 0 < identity['bytes'] <= MAX_PART
                or file.is_symlink() or file.resolve(strict=True).parent != root
                or file.stat().st_size != identity['bytes']):
            raise AuditError('content_file_invalid')
        content = file.read_bytes()
        if sha(content) != identity['sha256']:
            raise AuditError('content_hash_mismatch')
        total += len(content)
        if total > MAX_TOTAL:
            raise AuditError('content_too_large')
        try:
            value = validate_part(name, content, manifest)
        except (ValueError, TypeError, KeyError):
            raise AuditError('content_contract_invalid') from None
        files[name], parts[name.removesuffix('.json')] = content, value
    return {'manifest': manifest, 'manifest_bytes': raw, 'manifest_sha256': sha(raw),
            'files': files, 'parts': parts}


def _program_inputs(root):
    names = [Path('tools') / name for name in TOOLS]
    names += [Path(name) for name in PROGRAM_FILES]
    for directory in ('domain', 'application', 'locales'):
        names += sorted(file.relative_to(root) for file in (root / directory).glob('*.mjs'))
    for name in REGRESSIONS:
        relative = Path('tests') / name
        names.append(relative)
        text = (root / relative).read_text()
        for fixture in re.findall(r"\./fixtures/public-data/([A-Za-z0-9._-]+\.json)", text):
            names.append(Path('tests/fixtures/public-data') / fixture)
    return sorted(set(names))


def auditor_identity(root, commit, names):
    files = {str(name): sha((root / name).read_bytes()) for name in names}
    identity = {'repository': 'gakumas-web/gakumas-web', 'commit': commit,
                'identity_state': 'local_validation', 'code_sha256': sha(canonical(files)), 'code_files': files}
    env = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_ASKPASS': '/bin/false'}
    try:
        command = ['git', '--no-lazy-fetch', '-C', str(root)]
        top = subprocess.run(command + ['rev-parse', '--show-toplevel'], capture_output=True,
                             stdin=subprocess.DEVNULL, timeout=20, env=env)
        if top.returncode or Path(top.stdout.decode().strip()).resolve() != root.resolve():
            return identity
        for name, expected in files.items():
            found = subprocess.run(command + ['show', commit + ':' + name], capture_output=True,
                                   stdin=subprocess.DEVNULL, timeout=20, env=env)
            if found.returncode or sha(found.stdout) != expected:
                return identity
    except (OSError, UnicodeError, subprocess.TimeoutExpired):
        return identity
    identity['identity_state'] = 'verified_commit'
    return identity


def copy_program(root, output, names):
    program = output / 'program'
    for name in names:
        target = program / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, target)
    (program / 'local').mkdir()
    return program


STAGE_SCRIPT = r'''
// 按正式目录投影比较舞台，排除整季兄弟记录与纯展示名称。
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [program,candidate,baseline,output]=process.argv.slice(2);
const {createContestCatalog}=await import(pathToFileURL(program+'/domain/contest-simulation.mjs'));
const {verifyEngineStageCapability:verifyContestStageCapability}=await import(pathToFileURL(program+'/domain/contest-stage-engine-capability.mjs'));
const read=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
const project=async directory=>{
 const progression=await read(directory+'/progression.json'),effects=await read(directory+'/effects.json');
 if(!progression.contests||!progression.contests.tables||!Array.isArray(progression.contests.stagePresets))throw new Error('invalid_contest_content');
 const choices=createContestCatalog(progression.contests.tables,progression.contests.stagePresets).choices.filter(stage=>stage.kind==='contest');
 const index=new Map();
 for(const [table,rows] of Object.entries({...effects.tables,...effects.semantics?.tables})){
  if(!Array.isArray(rows))throw new Error('invalid_effect_table');
  for(const row of rows){
   const definition=row.definition??Object.fromEntries(Object.entries(row).filter(([key])=>!['name','text','descriptions','produceDescriptions','playProduceDescriptions','playEffectProduceDescriptions'].includes(key)));
   const item={table,definition},group=index.get(row.id)??[];group.push(item);index.set(row.id,group);
  }
 }
 return Promise.all(choices.map(async stage=>{
  const {season,...value}=stage;
  if(value.preset){const {name,...preset}=value.preset;value.preset=preset;}
  const queue=strings(value),seen=new Set(),dependencies=[];
  while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);for(const row of index.get(id)??[]){dependencies.push(row);queue.push(...strings(row.definition));}}
  dependencies.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {id:stage.id,season:stage.seasonNumber,preset:stage.preset??null,capability:await verifyContestStageCapability(stage),definition:{stage:value,dependencies}};
 }));
};
await fs.writeFile(output,JSON.stringify({candidate:await project(candidate),baseline:await project(baseline)}));
'''


def run_command(command, *, cwd, output, label, timeout=240):
    try:
        result = subprocess.run(command, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=timeout, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    except subprocess.TimeoutExpired:
        raise AuditError(label + '_timeout') from None
    except OSError:
        raise AuditError(label + '_unavailable') from None
    (output / (label + '.stdout.log')).write_bytes(result.stdout)
    (output / (label + '.stderr.log')).write_bytes(result.stderr)
    return result.returncode


def expected_stage_ids(candidate, baseline):
    def indexed(rows):
        if not isinstance(rows, list) or not rows:
            raise AuditError('stage_catalog_invalid')
        result = {}
        for row in rows:
            if (not isinstance(row, dict) or not isinstance(row.get('id'), str)
                    or not STAGE_ID.fullmatch(row['id']) or row['id'] in result
                    or type(row.get('season')) is not int or row['season'] < 1
                    or int(STAGE_ID.fullmatch(row['id']).group(1)) != row['season']
                    or not isinstance(row.get('definition'), dict)):
                raise AuditError('stage_catalog_invalid')
            result[row['id']] = row
        return result
    current, previous = indexed(candidate), indexed(baseline)
    if set(previous) - set(current):
        raise AuditError('stage_deleted')
    latest = max(row['season'] for row in current.values())
    expected = {id for id, row in current.items()
                if row['season'] == latest or id not in previous
                or canonical(row['definition']) != canonical(previous[id]['definition'])}
    ready = [row for row in previous.values() if row.get('capability', {}).get('state') == 'ready']
    if ready:
        latest_ready = max(row['season'] for row in ready)
        expected.update(row['id'] for row in ready if row['season'] == latest_ready)
    return sorted(expected)


def updated_stage_ids(expected, capabilities, baseline_ready_ids):
    ready = {row['id'] for row in capabilities if row['capability']['state'] == 'ready'}
    previous = set(baseline_ready_ids)
    newly_ready, lost_ready = ready - previous, previous - ready
    return sorted(set(expected) | newly_ready | lost_ready), sorted(newly_ready)


def missing_engine_stages(source, expected):
    try:
        rows = read_table(source / 'packages/gakumas-data', 'stages')
        if not isinstance(rows, list) or not rows:
            raise ValueError
        known = set()
        for row in rows:
            required = {'id', 'type', 'plan', 'season', 'stage', 'round', 'criteria',
                        'turnCounts', 'firstTurns', 'effects', 'linkTurnCounts'}
            if (not isinstance(row, dict) or not required <= set(row)
                    or row['type'] not in ('contest', 'event', 'linkContest')
                    or row['plan'] not in ('free', 'sense', 'logic', 'anomaly')):
                raise ValueError
            if row['type'] != 'contest':
                continue
            if (type(row.get('season')) is not int or row['season'] < 1
                    or type(row.get('stage')) is not int or row['stage'] < 1):
                raise ValueError
            key = f"contest:pvp_rate_config-{row['season']}:{row['stage'] - 1}"
            if key in known:
                raise ValueError
            known.add(key)
    except (OSError, KeyError, TypeError, ValueError):
        raise AuditError('engine_stages_invalid') from None
    return sorted(set(expected) - known)


def check_audit_result(audit, expected, missing, returncode, *, baseline_ready_ids=()):
    if (not isinstance(audit, dict) or audit.get('format') != 1
            or audit.get('candidatePoolChecked') is not True
            or not isinstance(audit.get('stageChecks'), list)
            or not isinstance(audit.get('pendingStages'), list)):
        raise AuditError('audit_report_invalid')
    checks, pending = audit['stageChecks'], audit['pendingStages']
    ids = [row.get('id') if isinstance(row, dict) else None for row in checks]
    pending_ids = [row.get('id') if isinstance(row, dict) else None for row in pending]
    if (len(ids) != len(set(ids)) or len(pending_ids) != len(set(pending_ids))
            or set(ids) & set(pending_ids) or set(ids) | set(pending_ids) != set(expected)):
        raise AuditError('stage_coverage_mismatch')
    if set(pending_ids) & set(baseline_ready_ids):
        raise AuditError('ready_stage_regressed')
    for row in pending:
        reasons = row.get('reasons')
        if (not isinstance(reasons, list) or not reasons or len(set(reasons)) != len(reasons)
                or set(reasons) - {'missing_stage_reference', 'missing_engine_stage'}):
            raise AuditError('pending_stage_invalid')
    actual_missing = {row['id'] for row in pending if 'missing_engine_stage' in row['reasons']}
    if actual_missing != set(missing):
        raise AuditError('engine_stage_proof_mismatch')
    if any(type(row.get('supported')) is not bool for row in checks):
        raise AuditError('audit_report_invalid')
    summary = audit.get('summary')
    if not isinstance(summary, dict) or any(type(summary.get(key)) is not int or summary[key] < 0
            for key in ('total', 'supported', 'unsupported', 'newUnsupported', 'resolved', 'stageFailures')):
        raise AuditError('audit_report_invalid')
    failures = [row for row in checks if not row['supported']]
    if (summary['stageFailures'] != len(failures)
            or summary['supported'] + summary['unsupported'] != summary['total']
            or summary['newUnsupported'] != len(audit.get('newUnsupported', []))):
        raise AuditError('audit_report_invalid')
    if summary['newUnsupported']:
        raise AuditError('new_unsupported_candidates')
    if failures:
        raise AuditError('stage_audit_failed')
    if returncode != 0:
        raise AuditError('audit_failed')
    return 'partial' if pending else 'passed'


def _freeze_content(content, output, name):
    directory = output / 'inputs' / name
    directory.mkdir(parents=True)
    (directory / MANIFEST).write_bytes(content['manifest_bytes'])
    for file, raw in content['files'].items():
        (directory / file).write_bytes(raw)
    return directory


def _site(content, output):
    site = output / 'site'
    release = site / 'content/releases/candidate-audit'
    release.mkdir(parents=True)
    for file, raw in content['files'].items():
        (release / file).write_bytes(raw)
    manifest = {'version': 'candidate-audit', 'files': content['manifest']['files']}
    raw = canonical(manifest) + b'\n'
    (release / 'manifest.json').write_bytes(raw)
    write_json(site / 'content/channel.json', {'manifest': 'releases/candidate-audit/manifest.json', 'sha256': sha(raw)})
    (site / 'content-config.mjs').write_text('export const contentConfig={channelURL:"./content/channel.json"};\n')
    return site


def audit_candidate(candidate_content, baseline_content, engine_commit, auditor_commit, esbuild, output, *, root=ROOT):
    output = Path(output)
    if output.exists() or output.is_symlink():
        raise AuditError('output_exists')
    if any(output.resolve().is_relative_to(Path(directory).resolve()) for directory in (candidate_content, baseline_content)):
        raise AuditError('output_overlaps_input')
    output.mkdir(parents=True)
    report = {'format': 'gakumas-contest-engine-audit', 'schema_version': 1, 'state': 'blocked',
              'candidate_manifest_sha256': None, 'baseline_manifest_sha256': None, 'upstream_commit': None,
              'auditor': None, 'engine': {'repository': 'gakumas-tools/gakumas-tools', 'commit': engine_commit, 'lock_sha256': None},
              'compatibility_baseline_sha256': None, 'expectedStageIds': [], 'stageChecks': [],
              'summary': {}, 'candidatePoolChecked': False, 'pendingStages': [],
              'baselineReadyStageIds': [], 'baselineGuardStageIds': [], 'newlyReadyStageIds': [],
              'baselineEngine': None, 'missing_stage_ids': [], 'issues': []}
    try:
        if not COMMIT.fullmatch(engine_commit) or not COMMIT.fullmatch(auditor_commit):
            raise AuditError('commit_invalid')
        candidate, baseline = load_content(candidate_content), load_content(baseline_content)
        report.update(candidate_manifest_sha256=candidate['manifest_sha256'], baseline_manifest_sha256=baseline['manifest_sha256'],
                      upstream_commit=candidate['manifest']['upstream_commit'])
        names = _program_inputs(root)
        report['auditor'] = auditor_identity(root, auditor_commit, names)
        report['compatibility_baseline_sha256'] = sha((root / 'tools/contest-engine-compatibility-baseline.json').read_bytes())
        baseline_lock = production.read(root / 'tools/contest-engine-source.json')
        baseline_files = report['auditor']['code_files']
        report['baselineEngine'] = {'repository': 'gakumas-tools/gakumas-tools', 'commit': baseline_lock['commit'],
            'source_lock_sha256': baseline_files['tools/contest-engine-source.json'],
            'lock_sha256': baseline_files['tools/contest-engine-source.json'],
            'registry_sha256': baseline_files['domain/upstream-contest-engine.mjs'],
            'mapping_sha256': baseline_files['domain/contest-engine-map.mjs']}
        program = copy_program(root, output, names)
        if any(sha((program / name).read_bytes()) != expected
               for name, expected in report['auditor']['code_files'].items()):
            raise AuditError('auditor_source_changed')
        current, prior = _freeze_content(candidate, output, 'candidate'), _freeze_content(baseline, output, 'baseline')
        script = output / 'stage-input.mjs'
        script.write_text(STAGE_SCRIPT)
        projected = output / 'stage-input.json'
        if run_command(['node', str(script), str(program), str(current), str(prior), str(projected)],
                       cwd=root, output=output, label='stage_projection'):
            raise AuditError('stage_projection_failed')
        stages = read_json(projected.read_bytes(), 'stage_projection_invalid')
        ready = [row for row in stages['baseline'] if row['capability']['state'] == 'ready']
        report['baselineReadyStageIds'] = sorted(row['id'] for row in ready)
        latest_ready = max((row['season'] for row in ready), default=None)
        report['baselineGuardStageIds'] = sorted(row['id'] for row in ready if row['season'] == latest_ready)
        if ready and not report['baselineGuardStageIds']:
            raise AuditError('baseline_guard_missing')
        expected = expected_stage_ids(stages['candidate'], stages['baseline'])
        report['expectedStageIds'] = expected
        write_json(output / 'expected-stage-ids.json', expected)
        lock = production.read(root / 'tools/contest-engine-source.json')
        cache = root / 'local/engine-source-cache'
        before = production.snapshot(cache, lock['commit'])
        after = before if engine_commit == lock['commit'] else production.snapshot(cache, engine_commit)
        production.assess(lock, before, after, engine_commit)
        engine_lock = {'repository': 'gakumas-tools/gakumas-tools', 'commit': engine_commit,
                       'files': {name: sha(raw) for name, raw in sorted(after.items())}}
        source = output / 'engine-source'
        source.mkdir()
        for name, raw in after.items():
            file = source / name
            if not file.resolve().is_relative_to(source.resolve()):
                raise AuditError('engine_source_path_invalid')
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(raw)
        write_json(program / 'tools/contest-engine-source.json', engine_lock)
        report['engine']['lock_sha256'] = sha((program / 'tools/contest-engine-source.json').read_bytes())
        reviewed = production.read(program / 'tools/contest-engine-reviewed-mappings.json')
        reviewed.update(engineCommit=engine_commit, effectsRevision=candidate['parts']['effects']['revision'])
        write_json(program / 'tools/contest-engine-reviewed-mappings.json', reviewed)
        evidence = production.prepare_evidence(production.read(program / 'tools/contest-status-effects.json'),
                                               candidate['parts']['effects'], candidate['manifest']['upstream_commit'])
        write_json(program / 'tools/contest-status-effects.json', evidence)
        if run_command([sys.executable, '-B', str(program / 'tools/build_contest_engine.py'), '--source', str(source),
                        '--effects', str(current / 'effects.json'), '--esbuild', str(Path(esbuild).resolve()),
                        '--report', str(output / 'engine-build.json')], cwd=root, output=output, label='engine_build'):
            raise AuditError('engine_build_failed')
        if run_command(['node', '--test', *(str(Path('tests') / name) for name in REGRESSIONS)],
                       cwd=program, output=output, label='engine_regressions'):
            raise AuditError('engine_regressions_failed')
        capability_script = output / 'candidate-capabilities.mjs'
        capability_script.write_text("import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';"
            "const [program,input,output]=process.argv.slice(2);"
            "const {verifyEngineStageCapability:verifyContestStageCapability}=await import(pathToFileURL(program+'/domain/contest-stage-engine-capability.mjs'));"
            "const rows=JSON.parse(await fs.readFile(input,'utf8')).candidate;"
            "const result=await Promise.all(rows.map(async row=>({id:row.id,capability:await verifyContestStageCapability(row.definition.stage)})));"
            "await fs.writeFile(output,JSON.stringify(result));")
        capability_file = output / 'candidate-capabilities.json'
        if run_command(['node', str(capability_script), str(program), str(projected), str(capability_file)],
                       cwd=root, output=output, label='candidate_capabilities'):
            raise AuditError('candidate_capabilities_failed')
        capabilities = read_json(capability_file.read_bytes(), 'candidate_capabilities_invalid')
        expected, report['newlyReadyStageIds'] = updated_stage_ids(expected, capabilities, report['baselineReadyStageIds'])
        report['expectedStageIds'] = expected
        write_json(output / 'expected-stage-ids.json', expected)
        write_json(output / 'baseline-ready-stage-ids.json', report['baselineReadyStageIds'])
        report['missing_stage_ids'] = missing_engine_stages(source, expected)
        site = _site(candidate, output)
        raw_report = output / 'candidate-audit.json'
        returncode = run_command(['node', str(program / 'tools/audit_contest_engine.mjs'), '--site', str(site),
                                  '--program', str(program), '--stage-ids', str(output / 'expected-stage-ids.json'),
                                  '--baseline-ready-ids', str(output / 'baseline-ready-stage-ids.json'),
                                  '--baseline', str(program / 'tools/contest-engine-compatibility-baseline.json'),
                                  '--report', str(raw_report)], cwd=root, output=output, label='candidate_audit')
        audit = read_json(raw_report.read_bytes(), 'audit_report_invalid')
        report['stageChecks'], report['summary'] = audit.get('stageChecks', []), audit.get('summary', {})
        report['candidatePoolChecked'] = audit.get('candidatePoolChecked') is True
        report['pendingStages'] = audit.get('pendingStages', [])
        report['state'] = check_audit_result(audit, expected, report['missing_stage_ids'], returncode,
                                             baseline_ready_ids=report['baselineReadyStageIds'])
    except AuditError as error:
        report['issues'].append({'kind': error.kind, **({'message': error.message} if error.message else {})})
    except (ValueError, RuntimeError, KeyError, TypeError, OSError) as error:
        report['issues'].append({'kind': 'candidate_audit_error', 'message': str(error)[:500]})
    report['fingerprint'] = sha(canonical(report))
    write_json(output / REPORT, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate-content', 'baseline-content', 'engine-commit', 'auditor-commit', 'esbuild', 'output'):
        parser.add_argument('--' + name, required=True, type=Path if name in ('candidate-content', 'baseline-content', 'esbuild', 'output') else str)
    args = parser.parse_args()
    try:
        report = audit_candidate(args.candidate_content.resolve(), args.baseline_content.resolve(), args.engine_commit,
                                 args.auditor_commit, args.esbuild, args.output.resolve())
    except (AuditError, OSError) as error:
        print(json.dumps({'state': 'blocked', 'issues': [{'kind': error.kind if isinstance(error, AuditError) else 'output_unavailable'}]}))
        return 1
    print(json.dumps({'state': report['state'], 'fingerprint': report['fingerprint'], 'issues': report['issues']}, ensure_ascii=False))
    return {'passed': 0, 'partial': 0, 'waiting': 2, 'blocked': 1}[report['state']]


if __name__ == '__main__':
    raise SystemExit(main())
