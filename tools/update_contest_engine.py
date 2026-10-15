"""仅自动接收固定引擎的追加数据；在隔离候选中生成、回归和审计，通过后才应用。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
REPOSITORY='https://github.com/gakumas-tools/gakumas-tools.git'
LOCK=ROOT/'tools/contest-engine-source.json'
ADDITIVE={f'packages/gakumas-data/json/{name}.json' for name in ['skill_cards','p_items','p_idols','stages']}
OUTPUTS=['tools/contest-engine-source.json','tools/contest-engine-reviewed-mappings.json','tools/contest-status-effects.json','domain/upstream-contest-engine.mjs','domain/contest-engine-map.mjs','THIRD_PARTY.md']


def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):return json.loads(Path(path).read_text())
def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def git(root,*args):
    result=subprocess.run(['git','-c','credential.helper=',*args],cwd=root,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_ASKPASS':'/bin/false'},capture_output=True,timeout=180)
    if result.returncode:raise RuntimeError('引擎公开来源读取失败：'+args[0])
    return result.stdout


def latest_commit():
    commit=git(ROOT,'ls-remote',REPOSITORY,'HEAD').decode().split()[0]
    if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('引擎提交身份无效')
    return commit


def snapshot(root,commit):
    root=Path(root);root.mkdir(parents=True,exist_ok=True);git(root,'init','--quiet')
    present=subprocess.run(['git','cat-file','-e',commit+'^{commit}'],cwd=root,capture_output=True,timeout=30).returncode==0
    if not present:git(root,'fetch','--quiet','--depth=1',REPOSITORY,commit)
    tree=git(root,'ls-tree','-r',commit,'LICENSE','packages/gakumas-data','packages/gakumas-engine').decode().splitlines()
    files={}
    for line in tree:
        metadata,name=line.split('\t');mode,kind,_=metadata.split()
        if name!='LICENSE' and Path(name).suffix not in ('.js','.mjs','.cjs','.json'):continue
        if mode!='100644' or kind!='blob':raise ValueError('引擎运行文件类型变化：'+name)
        files[name]=git(root,'show',commit+':'+name)
    return files


def added_rows(before,after):
    if not isinstance(before,list) or not isinstance(after,list):raise ValueError('追加数据必须是记录数组')
    def indexed(rows):
        result={}
        for row in rows:
            if not isinstance(row,dict) or type(row.get('id')) is not int or row['id'] in result:raise ValueError('追加数据 ID 无效或重复')
            result[row['id']]=row
        return result
    old,new=indexed(before),indexed(after)
    if any(json.dumps(new.get(key),sort_keys=True)!=json.dumps(row,sort_keys=True) for key,row in old.items()):raise ValueError('已有引擎记录被修改或删除')
    if [key for key in new if key in old]!=list(old):raise ValueError('已有引擎记录顺序变化')
    return sorted(set(new)-set(old))


def assess(lock,before,after,commit):
    if set(before)!=set(lock['files']) or any(sha(raw)!=lock['files'][name] for name,raw in before.items()):raise ValueError('已固定引擎与来源锁不一致')
    reasons=[];additions={}
    if set(after)!=set(before):reasons.append('运行文件集合发生变化')
    for name in sorted(set(before)&set(after)):
        if before[name]==after[name]:continue
        if name not in ADDITIVE:reasons.append('代码或非追加白名单发生变化：'+name);continue
        try:
            ids=added_rows(json.loads(before[name]),json.loads(after[name]))
            if ids:additions[name]=ids
        except (ValueError,TypeError) as error:reasons.append(name+'：'+str(error))
    status='review-required' if reasons else 'approved' if additions else 'unchanged'
    selected=commit if status=='approved' else lock['commit']
    return {'format':1,'base_commit':lock['commit'],'candidate_commit':commit,'selected_commit':selected,'status':status,'additions':additions,'reasons':reasons,
            'lock':{'repository':lock['repository'],'commit':selected,'files':{name:sha(raw) for name,raw in sorted((after if status=='approved' else before).items())}}}


def inspect(commit=None,previous=None):
    lock=read(LOCK);commit=commit or latest_commit()
    if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('引擎提交身份无效')
    (ROOT/'local').mkdir(exist_ok=True)
    cache=ROOT/'local/engine-source-cache';before=snapshot(cache,lock['commit']);repository_base=lock['commit'];accepted_previous=None
    if previous and previous.get('commit')!=lock['commit']:
        prior=previous.get('commit','')
        if previous.get('repository')!=lock['repository'] or not re.fullmatch('[a-f0-9]{40}',prior):raise ValueError('线上引擎来源格式无效')
        prior_files=snapshot(cache,prior)
        if {name:sha(raw) for name,raw in prior_files.items()}!=previous.get('files'):raise ValueError('线上引擎来源哈希不一致')
        # 线上自动版本也必须能从仓库固定版证明为纯追加，才作为下一次更新基线。
        if assess(lock,before,prior_files,prior)['status']=='approved':lock=previous;before=prior_files;accepted_previous=previous
    after=before if commit==lock['commit'] else snapshot(cache,commit)
    return {**assess(lock,before,after,commit),'repository_base_commit':repository_base,'previous_lock':accepted_previous}


def download(url,limit=128*1024*1024):
    with urlopen(Request(url,headers={'User-Agent':'gakumas-engine-update','Cache-Control':'no-cache'}),timeout=90) as response:raw=response.read(limit+1)
    if len(raw)>limit:raise ValueError('引擎参考文件超过大小限制')
    return raw


def deployed_lock(site_url):
    try:return json.loads(download(site_url.rstrip('/')+'/content/engine-source.json',64*1024))
    except HTTPError as error:
        if error.code!=404:raise
        return None


def verify_evidence(evidence,master,tables):
    extra={'produceDescriptions','playProduceDescriptions','playEffectProduceDescriptions'}
    for key,name in [('statusEnchants','ProduceExamStatusEnchant'),('triggers','ProduceExamTrigger'),('searches','ProduceCardSearch')]:
        rows={row['id']:row for row in tables[name]}
        for old in evidence[key]:
            current=rows.get(old['id'])
            if current is None or any(current.get(key)!=value for key,value in old.items()) or set(current)-set(old)-extra:raise ValueError('持续效果补充证据发生变化：'+old['id'])
    effects={row['id']:row['definition'] for row in master['tables']['ProduceExamEffect']}
    for key,expected in evidence['effectDefinitions'].items():
        if effects.get(key)!=expected:raise ValueError('已核对效果定义发生变化：'+key)


def prepare_evidence(evidence,master,upstream_commit):
    if evidence['contentRevision']==master['revision']:return evidence
    if not re.fullmatch('[a-f0-9]{40}',upstream_commit):raise ValueError('内容原始表提交无效')
    import yaml
    tables={};hashes={}
    for name in ['ProduceExamStatusEnchant','ProduceExamTrigger','ProduceCardSearch']:
        raw=download('https://raw.githubusercontent.com/vertesan/gakumasu-diff/'+upstream_commit+'/'+name+'.yaml')
        hashes[name+'.yaml']=sha(raw);tables[name]=yaml.load(raw,Loader=yaml.CSafeLoader)
    verify_evidence(evidence,master,tables)
    return {**evidence,'contentRevision':master['revision'],'source':{**evidence['source'],'commit':upstream_commit,'files':hashes}}


def site_content(site):
    from content_contract import validate_manifest,validate_part
    site=Path(site).resolve();channel=read(site/'content/channel.json');release=(site/'content'/channel['manifest']).resolve()
    if not release.is_relative_to(site/'content'):raise ValueError('内容清单越出站点目录')
    raw=release.read_bytes()
    if sha(raw)!=channel['sha256']:raise ValueError('内容频道哈希不一致')
    manifest=validate_manifest(raw,channel['version'])
    for name in manifest['files']:validate_part(name,(release.parent/name).read_bytes(),manifest)
    return manifest,release.parent/'effects.json'


def update(site,output,esbuild,plan=None,apply=False):
    manifest,effects=site_content(site);master=read(effects);output=Path(output);output.mkdir(parents=True,exist_ok=True)
    # 检测阶段的固定提交在构建阶段再次核对，不在两次读取之间改用新的 HEAD。
    if plan is None:
        config=ROOT/'resources/content-publication.json'
        previous=deployed_lock(read(config)['site_url']) if config.exists() else None
        plan=inspect(previous=previous)
    elif inspect(plan['candidate_commit'],plan.get('previous_lock'))!=plan:raise ValueError('自动引擎更新输入已变化')
    write(output/'plan.json',plan)
    mapping=(ROOT/'domain/contest-engine-map.mjs').read_text().split('export const contestEngineMap=',1)[1].strip().removesuffix(';')
    current=json.loads(mapping)['source']
    if current['commit']==plan['selected_commit'] and current['effectsSha256']==sha(effects.read_bytes()):
        report={'updated':False,'plan':plan};write(output/'report.json',report);return report
    candidate=output/'candidate'
    if candidate.exists():raise ValueError('引擎候选目录已存在，请使用新的输出目录')
    candidate.mkdir();(candidate/'local').mkdir();(candidate/'tools').mkdir()
    for directory in ['domain','application','locales','tests']:shutil.copytree(ROOT/directory,candidate/directory,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    for name in ['resources.mjs','image-config.mjs','i18n.mjs','THIRD_PARTY.md']:shutil.copyfile(ROOT/name,candidate/name)
    for name in ['build_contest_engine.py','contest_status_effects.py','contest-engine-source.json','contest-engine-reviewed-mappings.json','contest-status-effects.json']:shutil.copyfile(ROOT/'tools'/name,candidate/'tools'/name)
    source=output/'source';source.mkdir();files=snapshot(ROOT/'local/engine-source-cache',plan['selected_commit'])
    if {name:sha(raw) for name,raw in files.items()}!=plan['lock']['files']:raise ValueError('候选引擎文件身份变化')
    for name,raw in files.items():path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    write(candidate/'tools/contest-engine-source.json',plan['lock'])
    reviewed=read(candidate/'tools/contest-engine-reviewed-mappings.json');reviewed.update(engineCommit=plan['selected_commit'],effectsRevision=master['revision']);write(candidate/'tools/contest-engine-reviewed-mappings.json',reviewed)
    evidence=prepare_evidence(read(candidate/'tools/contest-status-effects.json'),master,manifest['upstream_commit']);write(candidate/'tools/contest-status-effects.json',evidence)
    attribution=(candidate/'THIRD_PARTY.md').read_text().replace(plan['repository_base_commit'],plan['selected_commit']);(candidate/'THIRD_PARTY.md').write_text(attribution)
    subprocess.run([sys.executable,'-B',str(candidate/'tools/build_contest_engine.py'),'--source',str(source.resolve()),'--effects',str(effects),'--esbuild',str(Path(esbuild).resolve()),'--report',str((output/'build.json').resolve())],check=True)
    subprocess.run(['node','--test','tests/contest-engine.test.mjs','tests/contest-reviewed-mappings.test.mjs'],cwd=candidate,check=True)
    subprocess.run(['node',str(ROOT/'tools/audit_contest_engine.mjs'),'--site',str(Path(site).resolve()),'--program',str(candidate.resolve()),'--baseline',str(ROOT/'tools/contest-engine-compatibility-baseline.json'),'--report',str((output/'audit.json').resolve())],check=True)
    changed=[name for name in OUTPUTS if (ROOT/name).read_bytes()!=(candidate/name).read_bytes()]
    report={'updated':bool(changed),'applied':apply,'files':changed,'plan':plan};write(output/'report.json',report)
    if apply:
        for name in changed:shutil.copyfile(candidate/name,ROOT/name)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--site',type=Path);parser.add_argument('--output',type=Path,default=ROOT/'local/engine-update');parser.add_argument('--esbuild',type=Path);parser.add_argument('--plan',type=Path);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not args.site or not args.esbuild:parser.error('更新必须提供 --site 和 --esbuild')
    report=update(args.site,args.output,args.esbuild,read(args.plan) if args.plan else None,args.apply)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as stream:stream.write('updated='+str(report['updated']).lower()+'\n')
    print(json.dumps({'updated':report['updated'],'status':report['plan']['status'],'commit':report['plan']['selected_commit']},ensure_ascii=False))


if __name__=='__main__':main()
