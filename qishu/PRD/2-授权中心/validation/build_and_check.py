"""Build and verify this PRD delivery using the supplied v3.0 renderer."""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import hashlib
import html as html_lib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT.parent / 'skills/prd-writer-v3.0/prd-writer'
sys.path.insert(0, str(SKILL / 'scripts'))
from render_prd import read_markdown, encode_markdown, render_html, extract_html_state

EXPECTED_SOURCES = {
    'DDL.md': '63ced17ffedc46d17acb94af1ae7894502020afa5714c2661afef886e94f4e71',
    'PRD.md': '0afb16acf876bfdc70c9eb5927fd037ff336b007dac6b6249a122ac74e5438b3',
}
path = ROOT / '授权中心.prd.md'
state = read_markdown(path.read_text(encoding='utf-8'),
                      doc_id='safety-platform.authorization-center', version='0.1.1')
state['markdown'] = state['markdown'].rstrip() + '\n'
body = state['markdown']
checks = []

def require(name, ok, detail=None):
    checks.append({'name': name, 'status': '通过' if ok else '失败', 'detail': detail})
    if not ok:
        raise AssertionError(f'{name}: {detail}')

source_hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                 for name in EXPECTED_SOURCES}
require('原始 PRD/DDL 文件 SHA256 未变', source_hashes == EXPECTED_SOURCES, source_hashes)
for prefix, count in [('BR', 30), ('AC', 30), ('TC', 30), ('API', 17), ('Q', 16), ('DB', 18)]:
    definitions = re.findall(r'^\| (' + prefix + r'-\d{2}) \|', body, re.M)
    expected = [f'{prefix}-{i:02}' for i in range(1, count + 1)]
    require(prefix + ' 编号完整且定义唯一', sorted(definitions) == expected, len(definitions))
    refs = set(re.findall(r'\b' + prefix + r'-\d{2}\b', body))
    require(prefix + ' 引用均存在', refs <= set(expected), sorted(refs - set(expected)))
us = set(re.findall(r'^\| (US-\d{2}) \|', body, re.M))
require('14 项原文功能均有用户故事', us == {f'US-{i:02}' for i in range(1, 15)})
chapters = re.findall(r'^## ([一二三四五六七八九十]+)、', body, re.M)
require('十二章齐全', chapters == ['一','二','三','四','五','六','七','八','九','十','十一','十二'])
json_blocks = re.findall(r'^```json\n([\s\S]*?)^```', body, re.M)
for sample in json_blocks:
    json.loads(sample)
require('JSON 示例均可解析', len(json_blocks) == 3)
require('代码围栏配对', len(re.findall(r'^```', body, re.M)) == 18)
overview = body.split('## 一图统揽\n')[1].split('## 修订记录')[0]
require('一图统揽是文首之后第一个章节', re.findall(r'^## (.+)$', body, re.M)[0] == '一图统揽')
require('总览含一张流程图与全部功能引用',
        len(re.findall(r'^```mermaid\nflowchart', overview, re.M)) == 1
        and all(f'US-{i:02}' in overview for i in range(1, 15)))
require('总览标明边界、外部依赖和待决策', all(x in overview for x in ['本期', '外部依赖', '不自动纳入', 'Q-01—Q-16']))
require('总览保留静态失败才委托的分支',
        'Static -->|无操作权限| Fallback' in overview and 'RowScope --> Fallback' not in overview)
prefixes = body.split('### 编号说明\n')[1].split('### 来源标记')[0]
declared = set(re.findall(r'^\| ([A-Z]+) \|', prefixes, re.M))
used = set(re.findall(r'\b([A-Z]+)-\d{2}\b', body))
require('正文编号前缀全部有文首说明', used <= declared and set(['S','US','BR','AC','API','DB','TC','Q','RV']) <= declared)
state_chapter = body.split('## 六、业务状态机\n')[1].split('## 七、非功能需求')[0]

def check_state_pairs(chapter):
    pairs = re.findall(r'```mermaid\n(stateDiagram-v2[\s\S]*?)```\s*\n\s*(\| 当前状态 \|[\s\S]*?)(?=\n\n|\Z)', chapter)
    if len(pairs) != 5:
        raise ValueError('每个状态图必须紧邻一张状态转移表，共五对')
    result = []
    for diagram, table in pairs:
        edges = re.findall(r'^\s*(\[\*\]|\w+) --> (\[\*\]|\w+): (.+)$', diagram, re.M)
        rows = [[c.strip() for c in line.strip().strip('|').split('|')] for line in table.splitlines()[2:]]
        if not rows or any(len(row) != 7 for row in rows):
            raise ValueError('状态转移表必须有七列')
        expected = [(row[0], row[6], row[1]) for row in rows]
        if Counter(edges) != Counter(expected):
            raise ValueError('图与表的当前状态、事件或下一状态不一致')
        result.append({'transitions': len(edges), 'states': sorted(set(a for edge in edges for a in edge[:2]))})
    return result

state_results = check_state_pairs(state_chapter)
require('五张业务状态图与相邻表逐条一致', True, state_results)
for label, invalid in [
    ('缺少状态图', state_chapter.replace('stateDiagram-v2', 'flowchart TD', 1)),
    ('图中下一状态与表冲突', state_chapter.replace('[*] --> normal: 创建账号', '[*] --> frozen: 创建账号', 1)),
    ('图中事件与表冲突', state_chapter.replace('normal --> frozen: 冻结账号', 'normal --> frozen: 错误事件', 1)),
]:
    rejected = False
    try:
        check_state_pairs(invalid)
    except ValueError:
        rejected = True
    require('反例被拒绝：' + label, rejected)
require('未决状态没有伪装已批准', all(x in state_chapter for x in ['rejected 为候选新增状态', 'pending 超过 validUntil 后是否自动转 expired', 'Q-09 待批准', '已消费']))
require('Mermaid 显示能力如实声明', '源码展示，未图形渲染' in body)
for table in re.findall(r'(?m)(?:^\|.*\|\n)+', body):
    widths = Counter(len(re.split(r'(?<!\\)\|', line)) for line in table.strip().splitlines())
    require('表格列数一致', len(widths) == 1, dict(widths))
require('正文 UTF-8/LF/末尾单一换行', '\r' not in body and body.endswith('\n') and not body.endswith('\n\n'))
require('无尾随空白', not any(line.endswith((' ', '\t')) for line in body.splitlines()))
for target in re.findall(r'\]\(([^)]+)\)', body):
    if not re.match(r'https?://|#', target):
        require('本地资料链接存在', (ROOT / target).is_file(), target)
ddl = (ROOT / 'DDL.md').read_text(encoding='utf-8')
tables = re.findall(r'^CREATE TABLE (\w+) \(', ddl, re.M)
require('14 张 DDL 主表在需求中覆盖', len(tables) == 14 and all(t in body for t in tables), tables)
missing_commas = re.findall(r'^\s*created_by\s+BIGINT\s+--[^\n]*\n\s*updated_by', ddl, re.M)
require('DB-01 缺逗号证据为 10 处', len(missing_commas) == 10, len(missing_commas))
indexes = Counter(re.findall(r'^CREATE (?:UNIQUE )?INDEX (\w+)', ddl, re.M))
require('DB-02 重复索引证据', indexes['idx_token_account_id'] == 2)

md = encode_markdown(state)
html = render_html(state, (SKILL / 'assets/offline-shell.html').read_text(encoding='utf-8'))
require('MD/HTML 同一完整快照', read_markdown(md) == extract_html_state(html) == state)
require('HTML 无剩余模板占位符', '__CSP__' not in html and '__PRD_DATA__' not in html)
require('HTML 禁止联网依赖', "connect-src 'none'" in html_lib.unescape(html) and not re.search(r'<script[^>]+src=', html))
artifacts = {'授权中心.prd.md': md, '授权中心.prd.html': html}
for name, content in artifacts.items():
    (ROOT / name).write_text(content.rstrip() + '\n', encoding='utf-8', newline='\n')
manifest = {'docId': state['docId'], 'version': state['version'], 'revision': state['revision'],
            'generatedAt': datetime.now(timezone.utc).isoformat(), 'sources': source_hashes,
            'renderer': str(SKILL / 'scripts/render_prd.py'),
            'skillSha256': hashlib.sha256((SKILL/'SKILL.md').read_bytes()).hexdigest(),
            'files': {name: {'bytes': (ROOT/name).stat().st_size,
                             'sha256': hashlib.sha256((ROOT/name).read_bytes()).hexdigest()}
                      for name in artifacts},
            'validation': '双格式同快照及静态检查；业务实现和验收未执行；浏览器结果见 validation/browser-report.json'}
(ROOT/'授权中心.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'checks': checks,
          'summary': {'passed': len(checks), 'failed': 0}, 'sourceHashes': source_hashes,
          'bodyCharacters': len(body), 'bodyBytes': len(body.encode('utf-8')),
          'limitations': ['静态检查不证明业务语义正确或数据库可执行。', '业务批准及业务测试均未执行。']}
(ROOT/'validation/structure-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps({'summary': report['summary'], 'bodyBytes': report['bodyBytes'], 'files': manifest['files']}, ensure_ascii=False))
