#!/usr/bin/env python3
"""Check the delivered fixture recipe and references, not business acceptance."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT/'examples/device-demo-source.md').read_text(encoding='utf-8')
GENERATOR = ROOT/'examples/generate_device_test_data.py'


class TestDataTests(unittest.TestCase):
    def run_generator(self, out_dir, *args, script=GENERATOR):
        return subprocess.run([sys.executable, '-X', 'utf8', str(script), '--out-dir', str(out_dir), *args],
                              capture_output=True, text=True, encoding='utf-8')

    def test_reproducible_recipe_and_constraint_categories(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp)/'a', Path(temp)/'b'
            for out_dir in (first, second, first):
                result = self.run_generator(out_dir)
                self.assertEqual(result.returncode, 0, result.stderr)
            for name in ('device-fixtures.json', 'manifest.json'):
                self.assertEqual((first/name).read_bytes(), (second/name).read_bytes())
            data = (first/'device-fixtures.json').read_bytes()
            fixture = json.loads(data)
            manifest = json.loads((first/'manifest.json').read_bytes())
            self.assertEqual(manifest['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(manifest['datasetCount'], 5)
            baseline = fixture['TD-01']['devices']
            self.assertEqual(len(baseline), 3)
            for key in ('id', 'code'):
                self.assertEqual(len({item[key] for item in baseline}), 3)
            for item in baseline:
                self.assertIsInstance(item['id'], int)
                self.assertTrue(item['name'].strip())
                self.assertLessEqual(len(item['code']), 64)
                self.assertLessEqual(len(item['name']), 128)
                self.assertEqual(item['version'], 1)
            self.assertEqual(baseline[0]['code'], 'prd-demo-165167')
            self.assertEqual(set(fixture['TD-01']['scopeById']), {str(item['id']) for item in baseline})
            self.assertEqual(len(fixture['TD-01']['actors']), 2)
            requests = fixture['TD-02']
            self.assertEqual(len(requests), 10)
            self.assertEqual(requests['duplicateCreate']['code'], baseline[0]['code'])
            self.assertFalse(requests['blankName']['name'].strip())
            self.assertEqual(len(requests['nameAtLimit']['name']), 128)
            self.assertEqual(len(requests['nameOverLimit']['name']), 129)
            self.assertNotIn('remark', requests['remarkMissing'])
            self.assertIsNone(requests['remarkNull']['remark'])
            self.assertEqual(requests['remarkEmpty']['remark'], '')
            self.assertLess(requests['staleUpdate']['version'], baseline[0]['version'])
            a, b = fixture['TD-04'].values()
            self.assertEqual((a['id'], a['version']), (b['id'], b['version']))
            self.assertNotEqual(a['name'], b['name'])
            for transition in fixture['TD-05']['transitions']:
                line = f"{transition['from']} --> {transition['to']}: {transition['event']}"
                self.assertIn(line, SOURCE)
            self.assertNotIn('草稿 --> 停用', SOURCE)

    def test_document_embeds_complete_executable_recipe(self):
        blocks = re.findall(r'```python\n([\s\S]*?)\n```', SOURCE)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]+'\n', GENERATOR.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp)/'copied-from-prd.py'
            script.write_text(blocks[0], encoding='utf-8')
            result = self.run_generator(Path(temp)/'output', script=script)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['baselineRecords'], 3)

    def test_changed_parameters_require_isolation_and_invalid_namespace_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp)/'a', Path(temp)/'b'
            self.assertEqual(self.run_generator(first).returncode, 0)
            saved = (first/'device-fixtures.json').read_bytes()
            self.assertNotEqual(self.run_generator(first, '--seed', '7').returncode, 0)
            self.assertEqual((first/'device-fixtures.json').read_bytes(), saved)
            self.assertEqual(self.run_generator(second, '--seed', '7', '--namespace', 'other-run').returncode, 0)
            self.assertNotEqual((second/'device-fixtures.json').read_bytes(), saved)
            self.assertNotEqual(self.run_generator(Path(temp)/'invalid', '--namespace', '../escape').returncode, 0)
            self.assertFalse((Path(temp)/'invalid').exists())

    def test_acceptance_cases_and_data_references_are_complete(self):
        chapter_two = SOURCE.split('## 二、', 1)[1].split('## 三、', 1)[0]
        chapter_nine = SOURCE.split('## 九、', 1)[1].split('## 十、', 1)[0]
        chapter_ten = SOURCE.split('## 十、', 1)[1].split('## 十一、', 1)[0]
        acceptance = re.findall(r'^\| (AC-\d+-\d+) \|', chapter_two, re.M)
        self.assertEqual(len(acceptance), len(set(acceptance)))
        self.assertEqual(Counter(re.findall(r'^\| (AC-\d+-\d+) \|', chapter_ten, re.M)), Counter({ac: 2 for ac in acceptance}))
        cases = re.findall(r'^#### (TC-\d+-\d+)：', chapter_nine, re.M)
        self.assertEqual(len(cases), len(set(cases)))
        self.assertEqual(set(re.findall(r'TC-\d+-\d+', SOURCE)), set(cases))
        self.assertEqual(set(re.findall(r'AC-\d+-\d+', chapter_nine)), set(acceptance))
        self.assertEqual(set(re.findall(r'TD-\d+', SOURCE)), {f'TD-{n:02d}' for n in range(1, 6)})
        self.assertIn('## 九、测试用例、测试数据与追溯', SOURCE)
        self.assertIn('## 十、逐项验收计划与结果', SOURCE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
