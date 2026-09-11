#!/usr/bin/env python3
"""Deterministic converter tests. No browser, network or business execution."""
from __future__ import annotations
import base64
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unittest
from render_prd import (read_markdown, encode_markdown, render_html,
                        extract_html_state, build, validate_state)

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = (ROOT/'assets/offline-shell.html').read_text(encoding='utf-8')


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.text = '# 合成测试\n\n## 表格\n\n| 字段 | 值 |\n|---|---|\n| 备注 | a\\|b 😀 |\n\n```json\n{"v":null,"tag":"</script>"}\n```\n'
        self.state = read_markdown(self.text, doc_id='test.only', version='demo')

    def test_markdown_roundtrip(self):
        self.assertEqual(read_markdown(encode_markdown(self.state)), self.state)

    def test_html_roundtrip(self):
        self.assertEqual(extract_html_state(render_html(self.state, TEMPLATE)), self.state)

    def test_crlf_normalised(self):
        self.assertEqual(read_markdown('a\r\nb\rc')['markdown'], 'a\nb\nc')

    def test_embedded_json_does_not_close_script(self):
        value = {**self.state, 'markdown': '</script><script>globalThis.x=1</script>\n<!-- -->',
                 'version': '</script><script>x</script>'}
        result = render_html(value, TEMPLATE)
        self.assertEqual(len(re.findall(r'<script(?:\s|>)', result)), 2)
        self.assertEqual(extract_html_state(result), value)

    def test_csp_hash_matches_runtime(self):
        result = render_html(self.state, TEMPLATE)
        runtime = re.search(r'<script id="prd-runtime">([\s\S]*?)</script>', result).group(1)
        digest = base64.b64encode(hashlib.sha256(runtime.encode()).digest()).decode()
        self.assertIn('sha256-'+digest, result)
        self.assertNotRegex(result, r'<script[^>]+\bsrc=')
        self.assertNotRegex(result, r'<link[^>]+\bhref=')

    def test_unknown_schema_rejected(self):
        with self.assertRaises(ValueError):
            validate_state({**self.state, 'schemaVersion': 99})

    def test_unsafe_id_rejected(self):
        with self.assertRaises(ValueError):
            validate_state({**self.state, 'docId': '../escape'})

    def test_oversized_input_rejected(self):
        with self.assertRaises(ValueError):
            validate_state({**self.state, 'markdown': 'a'*(5*1024*1024+1)})

    def test_malformed_metadata_rejected(self):
        with self.assertRaises(ValueError):
            read_markdown('<!-- prd-workspace:{bad} -->\n# data')

    def test_non_iso_time_rejected(self):
        with self.assertRaises(ValueError):
            validate_state({**self.state, 'updatedAt':'September 8, 2026'})

    def test_build_pair_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'input.md'; source.write_text(self.text)
            result=build(source,root/'out',doc_id='test.only')
            paths=[Path(p) for p in result['paths']]
            self.assertEqual(len(paths),3)
            for name,record in result['files'].items():
                content=(root/'out'/name).read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(),record['sha256'])

    def test_output_conflicts_preserve_original(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'input.md'; source.write_text(self.text)
            out=root/'out'; build(source,out)
            old=(out/'input.prd.html').read_bytes()
            with self.assertRaises(FileExistsError):
                build(source,out)
            self.assertEqual((out/'input.prd.html').read_bytes(),old)

    def test_source_not_overwritten_even_with_force(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'input.prd.md'; source.write_text(self.text)
            with self.assertRaises(ValueError):
                build(source,root,stem='input',force=True)
            self.assertEqual(source.read_text(),self.text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
