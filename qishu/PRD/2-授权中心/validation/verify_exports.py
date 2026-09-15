"""Check browser-produced ZIP and round-trip files independently of its runtime."""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent
sys.path.insert(0, str(ROOT.parent/'skills/prd-writer-v3.0/prd-writer/scripts'))
from render_prd import read_markdown, extract_html_state

expected = read_markdown((OUT/'roundtrip.prd.md').read_text(encoding='utf-8'))
assert extract_html_state((OUT/'roundtrip.prd.html').read_text(encoding='utf-8')) == expected
checks = []
for name in ['roundtrip.zip', 'keyboard.zip']:
    with zipfile.ZipFile(OUT/name) as bundle:
        assert bundle.testzip() is None
        names = bundle.namelist()
        assert len(names) == 2
        md = read_markdown(bundle.read(next(x for x in names if x.endswith('.md'))).decode('utf-8'))
        html = extract_html_state(bundle.read(next(x for x in names if x.endswith('.html'))).decode('utf-8'))
        assert md == html == expected
        checks.append({'file': name, 'status': '通过', 'revision': md['revision'], 'checks': ['ZIP CRC', 'two files', 'same revision and complete Markdown', 'same browser snapshot']})
manifest = json.loads((ROOT/'授权中心.manifest.json').read_text(encoding='utf-8'))
for name, record in manifest['files'].items():
    assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == record['sha256']
for name, digest in manifest['sources'].items():
    assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == digest
final = read_markdown((ROOT/'授权中心.prd.md').read_text(encoding='utf-8'))
assert '真实缓存合成测试' not in final['markdown']
assert '全文编辑合成标记' not in final['markdown']
assert '合成批注：' not in final['markdown']
assert '- [x]' not in final['markdown']
result = {'status': '通过', 'checks': checks,
          'originalFilesUnchanged': True, 'deliveryHashesUnchangedByBrowser': True,
          'syntheticEditsOnlyInValidationCopies': True,
          'limitations': 'ZIP 往返属于文档工具测试，不是业务验收。'}
(OUT/'export-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps(result, ensure_ascii=False))
