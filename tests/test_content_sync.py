"""验证公开资料引用边界、同版本不同身份和发布前的新旧引用核对。"""
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import sync_content as sync
import update_contest_engine as engine


def source():
    version='data-one'
    return {'format':'gakumas-content-publication','schema_version':1,'version':version,
            'bundle_url':'https://cnb.cool/birdnest_333/gakumas-data/-/releases/download/content-'+version+'/gakumas-content-'+version+'.json.gz',
            'bytes':100,'sha256':'1'*64,'manifest_sha256':'2'*64,'data_commit':'3'*40,
            'asset_commit':'4'*40,'assets_version':'images-one','assets_sha256':'5'*64,'master_revision':'6'*64}


class ContentSyncTest(unittest.TestCase):
    def test_version_url_size_and_all_fixed_identities_are_required(self):
        self.assertEqual(sync.validate_source(source()),source())
        for field,value in [('bundle_url','https://other.example.invalid/payload'),('bytes',True),('bytes',0),('sha256','1'),('data_commit','main'),('version','../other'),('assets_version',''),('manifest_sha256',''),('schema_version',True)]:
            with self.subTest(field=field),self.assertRaises(ValueError):sync.validate_source({**source(),field:value})

    def test_same_version_with_different_manifest_requires_update(self):
        candidate=source()
        self.assertTrue(sync.same_release(candidate,{'version':candidate['version'],'sha256':candidate['manifest_sha256']}))
        self.assertFalse(sync.same_release(candidate,{'version':candidate['version'],'sha256':'7'*64}))
        self.assertFalse(sync.same_release(candidate,None))

    def test_missing_publication_does_not_invent_a_new_version(self):
        with patch.object(sync,'git',side_effect=[b'',b'']) as git:
            self.assertIsNone(sync.resolve_source())
            self.assertEqual(git.call_count,2)

    def test_resolution_uses_one_frozen_json_snapshot(self):
        with patch.object(sync,'git',side_effect=[b'',b'1'*40+b' refs/heads/content-channel',b'',json.dumps(source()).encode()]) as git:
            self.assertEqual(sync.resolve_source(),source())
            self.assertEqual(git.call_args.args[-1],'FETCH_HEAD:pages-source.json')

    def test_new_reference_rejects_a_stale_deployment(self):
        with TemporaryDirectory() as temporary:
            path=Path(temporary)/'source.json';path.write_text(json.dumps(source()))
            for current,valid in [(source(),True),({**source(),'manifest_sha256':'7'*64},False),(None,False)]:
                with patch.object(sys,'argv',['sync_content.py','--verify-current',str(path)]),patch.object(sync,'resolve_source',return_value=current):
                    if valid:sync.main()
                    else:
                        with self.assertRaises(ValueError):sync.main()

    def test_unchanged_deployed_content_does_not_trigger_build(self):
        with TemporaryDirectory() as temporary:
            path=Path(temporary)/'source.json';outputs=Path(temporary)/'outputs'
            candidate=source();channel={'version':candidate['version'],'sha256':candidate['manifest_sha256']}
            with patch.object(sys,'argv',['sync_content.py','--output',str(path),'--check-site']),patch.object(sync,'resolve_source',return_value=candidate),patch.object(sync,'online_channel',return_value=channel),patch.object(engine,'inspect',return_value={'selected_commit':'1'*40}),patch.object(engine,'deployed_lock',return_value={'commit':'1'*40}),patch.dict(os.environ,{'GITHUB_OUTPUT':str(outputs)}):
                sync.main()
            self.assertIn('changed=false',outputs.read_text());self.assertEqual(json.loads(path.read_text()),candidate)

    def test_engine_only_update_also_triggers_build_with_frozen_plan(self):
        with TemporaryDirectory() as temporary:
            path=Path(temporary)/'source.json';outputs=Path(temporary)/'outputs';candidate=source()
            channel={'version':candidate['version'],'sha256':candidate['manifest_sha256']};plan={'selected_commit':'2'*40,'candidate_commit':'2'*40}
            with patch.object(sys,'argv',['sync_content.py','--output',str(path),'--check-site']),patch.object(sync,'resolve_source',return_value=candidate),patch.object(sync,'online_channel',return_value=channel),patch.object(engine,'inspect',return_value=plan),patch.object(engine,'deployed_lock',return_value={'commit':'1'*40}),patch.dict(os.environ,{'GITHUB_OUTPUT':str(outputs)}):sync.main()
            self.assertIn('changed=true',outputs.read_text());self.assertEqual(json.loads((path.parent/'engine-update.json').read_text()),plan)


if __name__=='__main__':unittest.main()
