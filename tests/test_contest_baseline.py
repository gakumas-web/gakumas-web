"""验证部署基线冻结只使用旧程序和旧资料，并在传输或身份失败时阻断。"""

import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import freeze_contest_baseline as freeze
from contest_baseline_contract import read_baseline_snapshot

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://example.invalid/current/'


def deployed():
    preset = {'id': 1, 'type': 'contest', 'plan': 'sense', 'season': 1, 'stage': 1, 'round': 1,
              'criteria': {'vocal': 1, 'dance': 0, 'visual': 0},
              'turnCounts': {'vocal': 10, 'dance': 0, 'visual': 0},
              'firstTurns': {'vocal': 1, 'dance': 0, 'visual': 0},
              'effectReference': {}, 'linkTurnCounts': {}}
    stage = {**preset, 'turnCounts': preset['turnCounts']}
    mapping = {'source': {'repository': 'gakumas-tools/gakumas-tools', 'commit': 'a' * 40},
               'stages': {'1': freeze.sha(freeze.canonical(preset))}}
    program = {
        'domain/upstream-contest-engine.mjs': ('export const Stages={getAll:()=>'
                                             + json.dumps([stage]) + '};').encode(),
        'domain/contest-engine-map.mjs': ('export const contestEngineMap=' + json.dumps(mapping) + ';').encode(),
        'domain/contest-simulation.mjs': (ROOT / 'domain/contest-simulation.mjs').read_bytes(),
    }
    progression = {'scope': 'progression', 'revision': 'b' * 64,
                   'progression': {'tables': {'IdolCard': [], 'SupportCard': []}},
                   'contests': {'tables': {'PvpRateConfig': [{'id': 'pvp_rate_config-1',
                       'stages': [{'turn': 10, 'planType': 'ProducePlanType_Plan1'}]}]},
                       'stagePresets': [preset]}}
    effects = {'scope': 'effects', 'revision': 'c' * 64,
               'tables': {'ProduceCard': [], 'ProduceItem': [], 'ProduceExamEffect': []}}
    parts = {'progression.json': freeze.canonical(progression), 'effects.json': freeze.canonical(effects)}
    manifest = {'format': 'gakumas-content', 'schema_version': 1, 'version': 'old',
                'master_revision': 'old', 'min_web_version': '0.5.0', 'files': {}}
    for name in ('catalog.json', 'effects.json', 'abilities.json', 'progression.json', 'achievements.json', 'assets-index.json'):
        raw = parts.get(name, b'{}')
        manifest['files'][name] = {'sha256': freeze.sha(raw), 'bytes': len(raw),
                                  'revision': progression['revision'] if name == 'progression.json' else effects['revision']}
    manifest_raw = freeze.canonical(manifest)
    channel_raw = freeze.canonical({'format': 'gakumas-content-channel', 'schema_version': 1,
                                   'version': 'old', 'manifest': 'releases/old/manifest.json',
                                   'sha256': freeze.sha(manifest_raw)})
    release_raw = freeze.canonical({'format': 1, 'project': 'gakumas-web',
                                   'content_channel': './content/channel.json',
                                   'files': {name: freeze.sha(raw) for name, raw in program.items()}})
    entries = {'release.json': release_raw, 'content/channel.json': channel_raw,
               'content/releases/old/manifest.json': manifest_raw,
               **{'content/releases/old/' + name: raw for name, raw in parts.items()}, **program}
    return {SITE + name: raw for name, raw in entries.items()}


class FreezeBaselineTest(unittest.TestCase):
    def run_freeze(self, base, entries, **kwargs):
        source = base / 'source.json'
        source.write_bytes(freeze.canonical({'site_url': SITE}))
        calls = []
        def fetch(url, limit):
            calls.append(url)
            value = entries.get(url, freeze.BaselineError('baseline_http_404'))
            if isinstance(value, Exception):
                raise value
            self.assertLessEqual(len(value), limit)
            return value
        snapshot = freeze.freeze_baseline(base / 'frozen/baseline.json', source=source, fetch=fetch, **kwargs)
        return snapshot, calls

    def test_old_program_and_old_content_are_frozen_without_candidate_or_images(self):
        with TemporaryDirectory() as temporary:
            base, entries = Path(temporary), deployed()
            candidate = base / 'dist/content/progression.json'
            candidate.parent.mkdir(parents=True)
            candidate.write_text('{"contests":{"stagePresets":[]}}')
            snapshot, calls = self.run_freeze(base, entries)
            self.assertEqual(snapshot['readyStageIds'], ['contest:pvp_rate_config-1:0'])
            self.assertEqual(snapshot['engine_commit'], 'a' * 40)
            self.assertEqual(snapshot['progression_sha256'], freeze.sha(entries[SITE + 'content/releases/old/progression.json']))
            self.assertEqual(read_baseline_snapshot(base / 'frozen/baseline.json'), snapshot)
            self.assertFalse(any('image' in url or 'assets-index' in url for url in calls))
            self.assertEqual(set(calls), set(entries))
            self.assertEqual(calls.count(SITE + 'release.json'), 2)
            self.assertEqual(calls.count(SITE + 'content/channel.json'), 2)
            self.assertFalse((base / 'frozen/inputs/domain/contest-stage-index.mjs').exists())
            candidate.write_text('{}')
            self.assertEqual(read_baseline_snapshot(base / 'frozen/baseline.json')['readyStageIds'], snapshot['readyStageIds'])

    def test_every_downloaded_payload_hash_is_checked(self):
        for name in ('content/releases/old/manifest.json', 'content/releases/old/progression.json',
                     'content/releases/old/effects.json', *freeze.PROGRAM_FILES):
            with self.subTest(name=name), TemporaryDirectory() as temporary:
                entries = deployed()
                entries[SITE + name] += b' '
                with self.assertRaises(ValueError):
                    self.run_freeze(Path(temporary), entries)
                self.assertFalse((Path(temporary) / 'frozen/baseline.json').exists())

    def test_missing_release_or_transport_failure_cannot_create_an_empty_baseline(self):
        for error in ('baseline_http_404', 'baseline_http_403', 'baseline_http_500', 'baseline_download_failed'):
            with self.subTest(error=error), TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(freeze.BaselineError, error):
                    self.run_freeze(Path(temporary), {SITE + 'release.json': freeze.BaselineError(error)})

    def test_bootstrap_requires_explicit_flag_and_two_404_responses(self):
        with TemporaryDirectory() as temporary:
            snapshot, calls = self.run_freeze(Path(temporary), {}, allow_bootstrap=True)
            self.assertEqual(snapshot['state'], 'bootstrap')
            self.assertEqual(snapshot['readyStageIds'], [])
            self.assertTrue(all(snapshot[name] is None for name in freeze.HASH_FIELDS))
            self.assertEqual(calls, [SITE + 'release.json', SITE + 'content/channel.json'])
        for channel in (b'{}', freeze.BaselineError('baseline_http_403'), freeze.BaselineError('baseline_download_failed')):
            with self.subTest(channel=type(channel).__name__), TemporaryDirectory() as temporary:
                with self.assertRaises(freeze.BaselineError):
                    self.run_freeze(Path(temporary), {SITE + 'content/channel.json': channel}, allow_bootstrap=True)
        with TemporaryDirectory() as temporary:
            entries = deployed()
            del entries[SITE + 'content/channel.json']
            with self.assertRaisesRegex(freeze.BaselineError, 'baseline_http_404'):
                self.run_freeze(Path(temporary), entries, allow_bootstrap=True)

    def test_capture_race_and_projection_failure_preserve_no_success_snapshot(self):
        with TemporaryDirectory() as temporary:
            base, entries = Path(temporary), deployed()
            def changed(files, progression_path):
                entries[SITE + 'release.json'] += b' '
                return {'engine': {'commit': 'a' * 40}, 'baselineReadyStageIds': []}
            with self.assertRaisesRegex(freeze.BaselineError, 'baseline_changed_during_freeze'):
                self.run_freeze(base, entries, projector=changed)
            self.assertFalse((base / 'frozen/baseline.json').exists())
        with TemporaryDirectory() as temporary:
            def fail(files, progression_path):
                raise freeze.BaselineError('baseline_projection_failed')
            with self.assertRaisesRegex(freeze.BaselineError, 'baseline_projection_failed'):
                self.run_freeze(Path(temporary), deployed(), projector=fail)

    def test_existing_index_must_match_the_real_old_registry_and_mapping(self):
        with TemporaryDirectory() as temporary:
            entries = deployed()
            name = 'domain/contest-stage-index.mjs'
            raw = b'export const contestStageIndex={format:1,source:{},stages:{}};'
            entries[SITE + name] = raw
            release = json.loads(entries[SITE + 'release.json'])
            release['files'][name] = freeze.sha(raw)
            entries[SITE + 'release.json'] = freeze.canonical(release)
            with self.assertRaisesRegex(freeze.BaselineError, 'baseline_projection_failed'):
                self.run_freeze(Path(temporary), entries)

    def test_snapshot_tamper_and_overwrite_are_rejected(self):
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            snapshot, _ = self.run_freeze(base, deployed())
            snapshot['readyStageIds'] = []
            output = base / 'frozen/baseline.json'
            output.write_bytes(freeze.canonical(snapshot))
            with self.assertRaisesRegex(ValueError, '指纹'):
                read_baseline_snapshot(output)
            with self.assertRaisesRegex(freeze.BaselineError, 'baseline_output_exists'):
                self.run_freeze(base, deployed())

    def test_pages_freezes_before_reuse_or_build_and_reuses_one_snapshot(self):
        workflow = (ROOT / '.github/workflows/pages.yml').read_text()
        step = workflow.split('      - name: 冻结当前部署的旧程序与旧资料能力\n', 1)[1].split('      - name:', 1)[0]
        self.assertNotIn('        if:', step)
        self.assertIn('workflow_dispatch', step)
        self.assertLess(workflow.index('冻结当前部署'), workflow.index('读取已有站点制品'))
        self.assertLess(workflow.index('冻结当前部署'), workflow.index('构建当前程序并复用图片'))
        commands = [line for line in workflow.splitlines() if '--site dist' in line and ('update_contest_engine.py' in line or 'audit_contest_engine.mjs' in line)]
        self.assertEqual(len(commands), 3)
        self.assertTrue(all('--baseline-snapshot local/contest-baseline/baseline.json' in command for command in commands))


if __name__ == '__main__':
    unittest.main()
