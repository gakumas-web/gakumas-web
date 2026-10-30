"""冻结当前部署的程序与公开舞台资料，生成发布审计共用的能力基线。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

from content_contract import MAX_MANIFEST, MAX_PART, VERSION, validate_manifest, validate_part
from contest_baseline_contract import HASH_FIELDS, baseline_fingerprint, validate_baseline_snapshot

ROOT = Path(__file__).resolve().parents[1]
HASH = re.compile(r'[a-f0-9]{64}\Z')
MAX_PROGRAM = 16 * 1024 * 1024
PROGRAM_FILES = ('domain/upstream-contest-engine.mjs', 'domain/contest-engine-map.mjs',
                 'domain/contest-simulation.mjs')
HELPERS = ('contest-stage-preset.mjs', 'contest-stage-capability.mjs',
           'contest-stage-engine-capability.mjs')


class BaselineError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    try:
        return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, UnicodeError):
        raise BaselineError('baseline_json_invalid') from None


def address(base, relative):
    value = urljoin(base, relative)
    parts = urlsplit(value)
    if (parts.scheme != 'https' or not parts.netloc or parts.username or parts.password
            or parts.query or parts.fragment or any(character.isspace() for character in value)):
        raise BaselineError('baseline_url_invalid')
    return value


def download(url, limit):
    """下载公开字节；错误只返回分类，不把 URL 或认证信息写进日志。"""
    request = Request(url, headers={'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'})
    try:
        with urlopen(request, timeout=45) as response:
            final = address(url, response.geturl())
            if urlsplit(final).netloc != urlsplit(url).netloc:
                raise BaselineError('baseline_redirect_invalid')
            raw = response.read(limit + 1)
    except HTTPError as error:
        raise BaselineError('baseline_http_' + str(error.code)) from None
    except (URLError, OSError):
        raise BaselineError('baseline_download_failed') from None
    if not raw or len(raw) > limit:
        raise BaselineError('baseline_size_invalid')
    return raw


PROJECTION_SCRIPT = r'''
// 用已冻结的旧目录投影与真实旧引擎生成临时索引，再复用当前正式能力校验器。
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [program,progressionFile,output]=process.argv.slice(2);
const module=name=>import(pathToFileURL(program+'/domain/'+name+'.mjs'));
const {Stages}=await module('upstream-contest-engine'),{contestEngineMap}=await module('contest-engine-map');
const stages=Object.fromEntries(Stages.getAll().map(row=>[row.id,{id:row.id,type:row.type,plan:row.plan,season:row.season,stage:row.stage,turn:Object.values(row.turnCounts).reduce((sum,value)=>sum+value,0),fingerprint:contestEngineMap.stages[row.id]}]));
const indexFile=program+'/domain/contest-stage-index.mjs';
try{await fs.access(indexFile);}catch{await fs.writeFile(indexFile,'export const contestStageIndex='+JSON.stringify({format:1,source:contestEngineMap.source,stages})+';\n');}
const {createContestCatalog}=await module('contest-simulation');
const {verifyEngineStageCapability}=await module('contest-stage-engine-capability');
const progression=JSON.parse(await fs.readFile(progressionFile,'utf8'));
if(!progression.contests||!progression.contests.tables||!Array.isArray(progression.contests.stagePresets))throw new Error('baseline_contests_invalid');
const choices=createContestCatalog(progression.contests.tables,progression.contests.stagePresets).choices.filter(stage=>stage.kind==='contest');
if(!choices.length)throw new Error('baseline_contests_empty');
const ready=[];
for(const stage of choices){const capability=await verifyEngineStageCapability(stage);if(capability.state==='ready')ready.push(stage.id);else if(capability.state!=='pending')throw new Error('baseline_stage_invalid');}
await fs.writeFile(output,JSON.stringify({baselineReadyStageIds:ready.sort(),engine:contestEngineMap.source}));
'''


def project_ready(files, progression_path, *, root=ROOT, runner=subprocess.run):
    """执行隔离程序；候选目录和候选内容不进入旧能力计算。"""
    with tempfile.TemporaryDirectory(prefix='contest-baseline-') as temporary:
        program = Path(temporary)
        for name, raw in files.items():
            target = program / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        for name in HELPERS:
            shutil.copyfile(root / 'domain' / name, program / 'domain' / name)
        script, result = program / 'project.mjs', program / 'projection.json'
        script.write_text(PROJECTION_SCRIPT, encoding='utf-8')
        try:
            completed = runner(['node', str(script), str(program), str(program / progression_path), str(result)],
                               stdin=subprocess.DEVNULL, capture_output=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            raise BaselineError('baseline_projection_unavailable') from None
        if completed.returncode:
            raise BaselineError('baseline_projection_failed')
        value = parse(result.read_bytes())
        if not isinstance(value, dict) or not isinstance(value.get('baselineReadyStageIds'), list):
            raise BaselineError('baseline_projection_invalid')
        return value


def freeze_baseline(output, *, source=ROOT / 'resources/content-publication.json',
                    allow_bootstrap=False, fetch=download, projector=project_ready):
    output = Path(output)
    if output.exists() or output.is_symlink() or (output.parent / 'inputs').exists():
        raise BaselineError('baseline_output_exists')
    configuration = parse(Path(source).read_bytes())
    if not isinstance(configuration, dict) or not isinstance(configuration.get('site_url'), str):
        raise BaselineError('baseline_source_invalid')
    site = address(configuration['site_url'].rstrip('/') + '/', '')
    release_url, bootstrap_channel_url = address(site, 'release.json'), address(site, 'content/channel.json')
    snapshot = {'format': 'gakumas-contest-deployed-baseline', 'schema_version': 1,
                'state': 'ready', 'site_url': site, 'engine_commit': None, 'readyStageIds': [],
                **dict.fromkeys(HASH_FIELDS)}
    files = {}
    try:
        release_raw = fetch(release_url, 2 * 1024 * 1024)
    except BaselineError as error:
        if str(error) != 'baseline_http_404' or not allow_bootstrap:
            raise
        try:
            fetch(bootstrap_channel_url, MAX_MANIFEST)
        except BaselineError as channel_error:
            if str(channel_error) != 'baseline_http_404':
                raise
        else:
            raise BaselineError('baseline_bootstrap_channel_exists')
        snapshot['state'] = 'bootstrap'
    else:
        release = parse(release_raw)
        if (not isinstance(release, dict) or type(release.get('format')) is not int or release['format'] != 1
                or release.get('project') != 'gakumas-web' or not isinstance(release.get('files'), dict)
                or not isinstance(release.get('content_channel'), str)):
            raise BaselineError('baseline_release_invalid')
        channel_url = address(site, release['content_channel'])
        channel_raw = fetch(channel_url, MAX_MANIFEST)
        channel = parse(channel_raw)
        if (not isinstance(channel, dict) or channel.get('format') != 'gakumas-content-channel'
                or type(channel.get('schema_version')) is not int or channel['schema_version'] != 1
                or not isinstance(channel.get('version'), str)
                or not VERSION.fullmatch(channel['version']) or channel['version'] in ('.', '..')
                or channel.get('manifest') != 'releases/' + channel['version'] + '/manifest.json'
                or not isinstance(channel.get('sha256'), str) or not HASH.fullmatch(channel['sha256'])):
            raise BaselineError('baseline_channel_invalid')
        manifest_url = address(channel_url, channel['manifest'])
        manifest_raw = fetch(manifest_url, MAX_MANIFEST)
        if sha(manifest_raw) != channel['sha256']:
            raise BaselineError('baseline_manifest_hash_mismatch')
        manifest = validate_manifest(manifest_raw, channel['version'])
        files.update({'release.json': release_raw, 'content/channel.json': channel_raw,
                      'content/manifest.json': manifest_raw})
        for name in ('progression.json', 'effects.json'):
            raw = fetch(address(manifest_url, name), MAX_PART)
            validate_part(name, raw, manifest)
            files['content/' + name] = raw
        program_names = list(PROGRAM_FILES)
        if 'domain/contest-stage-index.mjs' in release['files']:
            program_names.append('domain/contest-stage-index.mjs')
        for name in program_names:
            expected = release['files'].get(name)
            if not isinstance(expected, str) or not HASH.fullmatch(expected):
                raise BaselineError('baseline_program_identity_missing')
            raw = fetch(address(site, name), MAX_PROGRAM)
            if sha(raw) != expected:
                raise BaselineError('baseline_program_hash_mismatch')
            files[name] = raw
        projection = projector(files, 'content/progression.json')
        engine = projection.get('engine')
        if not isinstance(engine, dict):
            raise BaselineError('baseline_engine_invalid')
        # 捕获期间若发布或频道切换，整批失败，避免冻结来自两个时刻的身份。
        if fetch(release_url, 2 * 1024 * 1024) != release_raw or fetch(channel_url, MAX_MANIFEST) != channel_raw:
            raise BaselineError('baseline_changed_during_freeze')
        snapshot.update(release_sha256=sha(release_raw), channel_sha256=sha(channel_raw),
                        content_manifest_sha256=sha(manifest_raw), progression_sha256=sha(files['content/progression.json']),
                        effects_sha256=sha(files['content/effects.json']), engine_sha256=sha(files[PROGRAM_FILES[0]]),
                        mapping_sha256=sha(files[PROGRAM_FILES[1]]), catalog_sha256=sha(files[PROGRAM_FILES[2]]),
                        engine_commit=engine.get('commit'), readyStageIds=projection['baselineReadyStageIds'])
    snapshot['fingerprint'] = baseline_fingerprint(snapshot)
    validate_baseline_snapshot(snapshot)
    output.parent.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        target = output.parent / 'inputs' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    output.write_bytes(canonical(snapshot) + b'\n')
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'resources/content-publication.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--allow-bootstrap', action='store_true', help='仅在程序清单和公共频道均为 HTTP 404 时允许首次部署')
    args = parser.parse_args()
    try:
        result = freeze_baseline(args.output, source=args.source, allow_bootstrap=args.allow_bootstrap)
    except BaselineError as error:
        print(json.dumps({'state': 'blocked', 'issue': str(error)}))
        return 1
    except (ValueError, OSError, KeyError, TypeError):
        print(json.dumps({'state': 'blocked', 'issue': 'baseline_freeze_failed'}))
        return 1
    print(json.dumps({'state': result['state'], 'fingerprint': result['fingerprint'],
                      'readyStages': len(result['readyStageIds'])}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
