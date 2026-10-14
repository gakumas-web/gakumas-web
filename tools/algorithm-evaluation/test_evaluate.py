"""验证评测工具不会把损坏证据、失败门槛或缺失轨迹误报为通过。"""
import io
import json
from pathlib import Path
import tempfile
import unittest

import evaluate as e

BASELINE = e.versions.DEFAULT_BASELINE.parent


class EvaluationTests(unittest.TestCase):
    def test_historical_failure_is_preserved(self):
        result = e.compare(BASELINE / 'example-r01.json')
        original = e.read(BASELINE / 'comparison-expected.json')
        self.assertEqual(result['medianGain'], original['medianGain'])
        self.assertEqual(result['worstGain'], original['worstGain'])
        self.assertFalse(result['passed'])

    def temporary_plan(self, tmp):
        plan = e.read(BASELINE / 'example-r01.json')
        plan['pairs'] = plan['pairs'][:1]
        for name in ['baseline', 'candidate', 'reference']:
            plan['pairs'][0][name] = str((BASELINE / plan['pairs'][0][name]).resolve())
        source = BASELINE / plan['evidence'][0]
        registry = e.read(source)
        registry['baseline']['path'] = str((source.parent / registry['baseline']['path']).resolve())
        for item in registry['records']:
            item['path'] = str((source.parent / item['path']).resolve())
        plan['evidence'] = [str(Path(tmp) / 'evidence.json')]
        return plan, registry

    def write_plan(self, tmp, plan, registry):
        path = Path(tmp) / 'plan.json'
        e.save(path, plan)
        e.save(plan['evidence'][0], registry)
        return path

    def test_truncated_reference_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan, registry = self.temporary_plan(tmp)
            pair = plan['pairs'][0]
            old = pair['reference']
            reference = e.read(old)
            reference['rows'][0]['scores'].pop()
            pair['reference'] = str(Path(tmp) / 'reference.json')
            e.save(pair['reference'], reference)
            item = next(item for item in registry['records'] if item['path'] == old)
            item.update(path=pair['reference'], sha256=e.digest(pair['reference']))
            with self.assertRaisesRegex(ValueError, 'truncated reference'):
                e.compare(self.write_plan(tmp, plan, registry))

    def test_changed_evidence_bytes_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan, registry = self.temporary_plan(tmp)
            pair = plan['pairs'][0]
            old = pair['candidate']
            changed = e.read(old)
            changed['rows'][0]['score'] += 1
            pair['candidate'] = str(Path(tmp) / 'changed.json')
            e.save(pair['candidate'], changed)
            next(item for item in registry['records'] if item['path'] == old)['path'] = pair['candidate']
            with self.assertRaisesRegex(ValueError, 'artifact identity mismatch'):
                e.compare(self.write_plan(tmp, plan, registry))

    def test_mixed_engine_versions_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan, registry = self.temporary_plan(tmp)
            item = next(item for item in registry['records'] if item['path'] == plan['pairs'][0]['candidate'])
            item['context']['evaluation']['runtime']['domain/upstream-contest-engine.mjs'] = '0' * 64
            item['context']['evaluationId'] = e.versions.identity(item['context']['evaluation'])
            with self.assertRaisesRegex(ValueError, 'incompatible evaluation versions'):
                e.compare(self.write_plan(tmp, plan, registry))

    def test_mixed_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan, registry = self.temporary_plan(tmp)
            item = next(item for item in registry['records'] if item['path'] == plan['pairs'][0]['candidate'])
            item['inputSha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'input binding mismatch'):
                e.compare(self.write_plan(tmp, plan, registry))

    def test_missing_version_evidence_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = e.read(BASELINE / 'example-r01.json')
            plan.pop('evidence')
            path = Path(tmp) / 'plan.json'
            e.save(path, plan)
            with self.assertRaisesRegex(ValueError, 'version evidence required'):
                e.compare(path)

    def test_algorithm_identity_is_separate_from_evaluation(self):
        baseline = e.versions.load_baseline()
        original = e.versions.context(baseline)
        hashes = {name: info['sha256'] for name, info in baseline['modules'].items()}
        hashes['application/contest-optimization-client.mjs'] = '0' * 64
        changed = e.versions.context(baseline, hashes)
        self.assertEqual(changed['evaluationId'], original['evaluationId'])
        self.assertNotEqual(changed['algorithmId'], original['algorithmId'])

    def test_changed_engine_requires_observation_or_new_baseline(self):
        expected, actual = {'evaluationId': 'old'}, {'evaluationId': 'new'}
        with self.assertRaisesRegex(ValueError, 'same evaluation version'):
            e.versions.replay_compatibility(expected, actual, 'exact')
        self.assertFalse(e.versions.replay_compatibility(expected, actual, 'observe'))

    def test_missing_trace_is_not_reported_as_not_generated(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'no-trace.json'
            e.save(path, {'rows': [{'key': 'example'}]})
            with self.assertRaisesRegex(ValueError, 'research.events required'):
                e.diagnose(path)

    def test_archive_detects_modified_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bad.tar.gz'
            with e.tarfile.open(path, 'w:gz') as archive:
                contents = {'MANIFEST.json': json.dumps({'files': {'sample.txt': {'bytes': 3, 'sha256': '0' * 64}}}).encode(),
                            'sample.txt': b'bad'}
                for name, data in contents.items():
                    member = e.tarfile.TarInfo(name)
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
            with self.assertRaisesRegex(ValueError, 'archive hash mismatch'):
                e.verify_archive(path)

    def test_evidence_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'record.json'
            e.save(path, {'kept': True})
            with self.assertRaises(FileExistsError):
                e.save(path, {'kept': False})
            self.assertTrue(e.read(path)['kept'])


if __name__ == '__main__':
    unittest.main()
