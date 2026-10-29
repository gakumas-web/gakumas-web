"""验证固定分包身份、显式舞台覆盖和只写新目录的审计边界。"""

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import audit_contest_candidate as audit

ROOT = Path(__file__).resolve().parents[1]


def content(directory):
    directory.mkdir()
    parts = {
        'catalog': {'characters': {}, 'idols': {'cards': [], 'skins': []}, 'supports': {'cards': []}},
        'effects': {'tables': {name: [] for name in ('ProduceCard', 'ProduceItem', 'ProduceExamEffect')}, 'semantics': {'tables': {}}},
        'abilities': {'tables': {name: [] for name in ('MemoryAbility', 'ProduceSkill', 'ProduceEffect')}},
        'progression': {'progression': {'tables': {'IdolCard': [], 'SupportCard': []}}},
        'achievements': {'achievements': {name: [] for name in ('Achievement', 'AchievementProgress', 'Mission', 'Item')}},
    }
    manifest = {'format': 'gakumas-contest-audit-content', 'schema_version': 1,
                'upstream_commit': 'a' * 40, 'files': {}}
    for scope, value in parts.items():
        revision = audit.sha(audit.canonical(value))
        value = {'scope': scope, 'revision': revision, **value}
        raw = audit.canonical(value) + b'\n'
        (directory / (scope + '.json')).write_bytes(raw)
        manifest['files'][scope + '.json'] = {'sha256': audit.sha(raw), 'bytes': len(raw), 'revision': revision}
    audit.write_json(directory / audit.MANIFEST, manifest)
    return manifest


def projected(season, index=0, marker=1):
    return {'id': f'contest:pvp_rate_config-{season}:{index}', 'season': season,
            'definition': {'stage': {'turn': marker}, 'dependencies': []}}


def audit_result(ids, *, failures=None, unsupported=0):
    failures = failures or {}
    checks = [{'id': id, 'supported': id not in failures,
               **({'reason': failures[id]} if id in failures else {})} for id in ids]
    return {'format': 1, 'stageChecks': checks,
            'summary': {'total': 3, 'supported': 3 - unsupported, 'unsupported': unsupported,
                        'newUnsupported': unsupported, 'resolved': 0, 'stageFailures': len(failures)},
            'newUnsupported': [{} for _ in range(unsupported)]}


class ContentIdentityTest(unittest.TestCase):
    def test_hash_size_revision_and_exact_public_file_set(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary) / 'content'
            manifest = content(root)
            loaded = audit.load_content(root)
            self.assertEqual(loaded['manifest_sha256'], audit.sha((root / audit.MANIFEST).read_bytes()))
            (root / 'effects.json').write_bytes((root / 'effects.json').read_bytes().replace(b'tables', b'tabLes'))
            with self.assertRaisesRegex(audit.AuditError, 'content_hash_mismatch'):
                audit.load_content(root)
            manifest['files']['../outside.json'] = manifest['files'].pop('effects.json')
            audit.write_json(root / audit.MANIFEST, manifest)
            with self.assertRaisesRegex(audit.AuditError, 'content_manifest_invalid'):
                audit.load_content(root)

    def test_manifest_format_and_symlink_escape_are_rejected(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / 'content'
            manifest = content(root)
            outside = base / 'outside.json'
            outside.write_bytes((root / 'effects.json').read_bytes())
            (root / 'effects.json').unlink()
            (root / 'effects.json').symlink_to(outside)
            with self.assertRaisesRegex(audit.AuditError, 'content_file_invalid'):
                audit.load_content(root)
            del manifest['format']
            audit.write_json(root / audit.MANIFEST, manifest)
            with self.assertRaisesRegex(audit.AuditError, 'content_manifest_invalid'):
                audit.load_content(root)

    def test_existing_output_never_overwrites_evidence(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            candidate, baseline, output = base / 'candidate', base / 'baseline', base / 'evidence'
            content(candidate); content(baseline); output.mkdir()
            previous = output / audit.REPORT
            previous.write_text('existing-evidence')
            with self.assertRaisesRegex(audit.AuditError, 'output_exists'):
                audit.audit_candidate(candidate, baseline, 'a' * 40, 'b' * 40, Path('/missing/esbuild'), output)
            self.assertEqual(previous.read_text(), 'existing-evidence')

    def test_real_cli_invalid_input_creates_fingerprinted_block_and_changes_no_inputs(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            candidate, baseline, output = base / 'candidate', base / 'baseline', base / 'evidence'
            manifest = content(candidate); content(baseline)
            manifest['schema_version'] = 2
            audit.write_json(candidate / audit.MANIFEST, manifest)
            before = {str(file): file.read_bytes() for directory in (candidate, baseline)
                      for file in directory.iterdir()}
            fixed_baseline = (ROOT / 'tools/contest-engine-compatibility-baseline.json').read_bytes()
            result = subprocess.run([sys.executable, '-B', str(ROOT / 'tools/audit_contest_candidate.py'),
                '--candidate-content', str(candidate), '--baseline-content', str(baseline),
                '--engine-commit', 'a' * 40, '--auditor-commit', 'b' * 40,
                '--esbuild', '/missing/esbuild', '--output', str(output)], capture_output=True)
            self.assertEqual(result.returncode, 1)
            report = json.loads((output / audit.REPORT).read_bytes())
            fingerprint = report.pop('fingerprint')
            self.assertEqual(report['state'], 'blocked')
            self.assertEqual(fingerprint, audit.sha(audit.canonical(report)))
            self.assertEqual(before, {name: Path(name).read_bytes() for name in before})
            self.assertEqual(fixed_baseline, (ROOT / 'tools/contest-engine-compatibility-baseline.json').read_bytes())


class StageScopeTest(unittest.TestCase):
    def test_new_changed_and_latest_union_excludes_unchanged_history(self):
        baseline = [projected(1), projected(2), projected(3, 0), projected(3, 1)]
        candidate = copy.deepcopy(baseline) + [projected(4, 0), projected(4, 1)]
        candidate[0]['definition']['stage']['turn'] = 5
        self.assertEqual(audit.expected_stage_ids(candidate, baseline), [
            'contest:pvp_rate_config-1:0', 'contest:pvp_rate_config-4:0', 'contest:pvp_rate_config-4:1'])
        self.assertEqual(audit.expected_stage_ids(baseline, baseline), [
            'contest:pvp_rate_config-3:0', 'contest:pvp_rate_config-3:1'])
        with self.assertRaisesRegex(audit.AuditError, 'stage_deleted'):
            audit.expected_stage_ids(baseline[1:], baseline)
        with self.assertRaisesRegex(audit.AuditError, 'stage_catalog_invalid'):
            audit.expected_stage_ids([projected(3), projected(3)], baseline)

    def test_missing_source_is_proved_by_real_csv_and_does_not_mask_audit_failures(self):
        expected = ['contest:pvp_rate_config-54:0', 'contest:pvp_rate_config-55:0']
        with TemporaryDirectory() as temporary:
            source = Path(temporary)
            directory = source / 'packages/gakumas-data/csv'
            directory.mkdir(parents=True)
            header = 'id,type,plan,season,stage,round,criteria,turnCounts,firstTurns,effects,linkTurnCounts\n'
            (directory / 'stages.csv').write_text(header + '1,contest,sense,54,1,,"0.3,0.3,0.4","3,3,4","0,0,1",,\n')
            missing = audit.missing_engine_stages(source, expected)
            self.assertEqual(missing, [expected[1]])
            waiting = audit_result(expected, failures={expected[1]: 'stage_reference_mismatch'})
            self.assertEqual(audit.check_audit_result(waiting, expected, missing, 1), 'waiting')
            with self.assertRaisesRegex(audit.AuditError, 'stage_audit_failed'):
                audit.check_audit_result(waiting, expected, [], 1)
            waiting['summary']['newUnsupported'] = 1; waiting['summary']['unsupported'] = 1
            waiting['summary']['supported'] = 2; waiting['newUnsupported'] = [{}]
            with self.assertRaisesRegex(audit.AuditError, 'new_unsupported_candidates'):
                audit.check_audit_result(waiting, expected, missing, 1)
            (directory / 'stages.csv').write_text('id,type,season,stage\n1,contest,no-number,1\n')
            with self.assertRaisesRegex(audit.AuditError, 'engine_stages_invalid'):
                audit.missing_engine_stages(source, expected)

    def test_exact_stage_results_and_real_failure_are_required(self):
        ids = ['contest:pvp_rate_config-55:0', 'contest:pvp_rate_config-55:1']
        passed = audit_result(ids)
        self.assertEqual(audit.check_audit_result(passed, ids, [], 0), 'passed')
        for checks in [passed['stageChecks'][:1], [passed['stageChecks'][0]] * 2, []]:
            with self.subTest(checks=checks), self.assertRaisesRegex(audit.AuditError, 'stage_coverage_mismatch'):
                audit.check_audit_result({**passed, 'stageChecks': checks}, ids, [], 0)
        failed = audit_result(ids, failures={ids[0]: 'invalid_stage_parameters'})
        with self.assertRaisesRegex(audit.AuditError, 'stage_audit_failed'):
            audit.check_audit_result(failed, ids, [ids[0]], 1)
        with self.assertRaisesRegex(audit.AuditError, 'audit_failed'):
            audit.check_audit_result(passed, ids, [], 1)

    def test_real_node_projection_ignores_sibling_and_display_changes(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            candidate, baseline = base / 'candidate', base / 'baseline'
            for directory in (candidate, baseline):
                content(directory)
                progression = json.loads((directory / 'progression.json').read_bytes())
                progression['contests'] = {'tables': {'PvpRateConfig': [
                    {'id': 'pvp_rate_config-1', 'stages': [{'turn': 10}, {'turn': 12}]}]}, 'stagePresets': []}
                audit.write_json(directory / 'progression.json', progression)
            changed = json.loads((candidate / 'progression.json').read_bytes())
            changed['contests']['tables']['PvpRateConfig'][0]['stages'][0]['turn'] = 11
            audit.write_json(candidate / 'progression.json', changed)
            script, output = base / 'project.mjs', base / 'stages.json'
            script.write_text(audit.STAGE_SCRIPT)
            result = subprocess.run(['node', str(script), str(ROOT), str(candidate), str(baseline), str(output)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            rows = json.loads(output.read_bytes())
            self.assertNotEqual(rows['candidate'][0]['definition'], rows['baseline'][0]['definition'])
            self.assertEqual(rows['candidate'][1]['definition'], rows['baseline'][1]['definition'])


    def test_stage_projection_includes_referenced_hidden_effect_definitions(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            candidate, baseline = base / 'candidate', base / 'baseline'
            for directory in (candidate, baseline):
                content(directory)
                progression = json.loads((directory / 'progression.json').read_bytes())
                progression['contests'] = {'tables': {'PvpRateConfig': [
                    {'id': 'pvp_rate_config-1', 'stages': [
                        {'turn': 10, 'produceItemIds': ['fixture-item']}, {'turn': 12}]}]}, 'stagePresets': []}
                effects = json.loads((directory / 'effects.json').read_bytes())
                effects['tables']['ProduceItem'] = [{'id': 'fixture-item', 'definition': {'effect': 'fixture-effect'}}]
                effects['tables']['ProduceExamEffect'] = [{'id': 'fixture-effect', 'definition': {'effectValue1': 1}}]
                audit.write_json(directory / 'effects.json', effects)
                audit.write_json(directory / 'progression.json', progression)
            effects = json.loads((candidate / 'effects.json').read_bytes())
            effects['tables']['ProduceExamEffect'][0]['definition']['effectValue1'] = 2
            audit.write_json(candidate / 'effects.json', effects)
            script, output = base / 'project.mjs', base / 'stages.json'
            script.write_text(audit.STAGE_SCRIPT)
            result = subprocess.run(['node', str(script), str(ROOT), str(candidate), str(baseline), str(output)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            rows = json.loads(output.read_bytes())
            self.assertNotEqual(rows['candidate'][0]['definition'], rows['baseline'][0]['definition'])
            self.assertEqual(rows['candidate'][1]['definition'], rows['baseline'][1]['definition'])


class AuditorIdentityTest(unittest.TestCase):
    def test_only_exact_source_commit_receives_verified_identity(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(['git', 'init', '--quiet', str(root)], check=True, capture_output=True)
            file = root / 'auditor.py'; file.write_text('fixed source\n')
            env = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1',
                   'GIT_AUTHOR_NAME': 'fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
                   'GIT_COMMITTER_NAME': 'fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid'}
            def git(*args):
                return subprocess.run(['git', '-C', str(root), *args], env=env, check=True, capture_output=True).stdout
            git('add', 'auditor.py'); git('commit', '--quiet', '-m', 'fixture')
            commit = git('rev-parse', 'HEAD').decode().strip()
            self.assertEqual(audit.auditor_identity(root, commit, [Path('auditor.py')])['identity_state'], 'verified_commit')
            file.write_text('local change\n')
            self.assertEqual(audit.auditor_identity(root, commit, [Path('auditor.py')])['identity_state'], 'local_validation')
            nested = root / 'nested'; nested.mkdir(); (nested / 'auditor.py').write_text('fixed source\n')
            self.assertEqual(audit.auditor_identity(nested, commit, [Path('auditor.py')])['identity_state'], 'local_validation')


class ProductionStageRangeTest(unittest.TestCase):
    def test_actual_auditor_checks_only_explicit_existing_ids_and_rejects_missing(self):
        fixture = json.loads((ROOT / 'tests/fixtures/public-data/contest-engine.json').read_bytes())
        presets = [row['stage']['preset'] for row in fixture['requests']]
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            inputs = base / 'inputs'; content(inputs)
            parts = {name: json.loads((inputs / (name + '.json')).read_bytes()) for name in audit.SCOPES}
            parts['progression']['contests'] = {'tables': {
                'PvpRateConfig': [{'id': 'pvp_rate_config-53', 'examSettingId': 'fixture',
                                  'stages': [{'turn': sum(row['turnCounts'].values()), 'produceItemIds': []} for row in presets]},
                                 {'id': 'pvp_rate_config-999', 'stages': [{'turn': 10}]}],
                'ExamSetting': [{'id': 'fixture', 'turnStartDistribute': 3, 'examTurnEndRecoveryStamina': 2,
                                 'handLimit': 5, 'holdLimit': 2}]}, 'stagePresets': presets}
            files = {name + '.json': audit.canonical(value) for name, value in parts.items()}
            site = audit._site({'files': files, 'manifest': {'files': {
                name: {'sha256': audit.sha(raw)} for name, raw in files.items()}}}, base)
            scope, report = base / 'stage-ids.json', base / 'audit.json'
            ids = [f'contest:pvp_rate_config-53:{index}' for index in range(3)]
            audit.write_json(scope, ids)
            command = ['node', str(ROOT / 'tools/audit_contest_engine.mjs'), '--site', str(site),
                       '--program', str(ROOT), '--stage-ids', str(scope), '--report', str(report)]
            result = subprocess.run(command, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            actual = json.loads(report.read_bytes())
            self.assertEqual([row['id'] for row in actual['stageChecks']], ids)
            self.assertEqual(actual['summary']['stageFailures'], 0)
            for selected in [[], ids + [ids[0]], ['contest:pvp_rate_config-1000:0']]:
                audit.write_json(scope, selected)
                failed = subprocess.run(command, capture_output=True)
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn('显式舞台范围无效', failed.stderr.decode())


if __name__ == '__main__':
    unittest.main()
