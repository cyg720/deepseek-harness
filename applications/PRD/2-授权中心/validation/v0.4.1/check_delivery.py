"""检查0.4.1需求交付与合成数据，不运行数据库或业务接口。"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent
SKILL = ROOT.parent / 'skills/prd-writer-v3.1/prd-writer'
sys.path.insert(0, str(SKILL / 'scripts'))
from render_prd import read_markdown, extract_html_state

checks = []

def check(name, condition):
    assert condition, name
    checks.append(name)

state = read_markdown((ROOT / '授权中心.prd.md').read_text(encoding='utf-8'))
body = state['markdown']
sql = (ROOT / '授权中心.schema.sql').read_text(encoding='utf-8')
generator = (ROOT / '测试数据/生成测试数据.py').read_text(encoding='utf-8')
cases = json.loads((OUT / 'test-cases.json').read_text(encoding='utf-8'))
metadata = json.loads((OUT / 'revision-metadata.json').read_text(encoding='utf-8'))
feedback = json.loads((ROOT / 'history/v0.3.1-user-feedback/feedback.json').read_text(encoding='utf-8'))
check('MD与HTML完整同快照', state == extract_html_state((ROOT / '授权中心.prd.html').read_text(encoding='utf-8')))
check('版本0.4.1修订8', state['version'] == '0.4.1' and state['revision'] == 8)
check('30条用户反馈逐字保留', len(feedback) == 30 and all(row['feedback'] in body for row in feedback))
latest = json.loads((ROOT / 'history/v0.4.0-user-feedback/feedback.json').read_text(encoding='utf-8'))
check('13条新反馈逐字保留', len(latest) == 13 and all(row['feedback'] in body for row in latest))
check('23个Q主项连续', re.findall(r'^\|\s*(Q-\d{2})\s*\|', body.split('### 12.1')[1].split('### 12.2')[0], re.M) == [f'Q-{i:02}' for i in range(1, 24)])
check('SQL与正文逐字一致', re.findall(r'```sql\n(.*?)```', body, re.S) == [sql])
check('生成器与正文逐字一致', re.findall(r'```python\n(.*?)```', body, re.S) == [generator])
check('五张现行图', len(re.findall(r'```mermaid\n(.*?)```', body, re.S)) == 5)
check('图中无委托范围或归档节点', all(not any(word in diagram for word in ['delegation', 'DEPT', 'SPECIFIED', '归档', '委托']) for diagram in re.findall(r'```mermaid\n(.*?)```', body, re.S)))
create_tables = re.findall(r'CREATE TABLE (\w+) \((.*?)\n \)', sql, re.S)
check('14张业务表', len(create_tables) == metadata['tables'] == 14)
check('表前缀一致', all(t.startswith('qs__auth__') for t, _ in create_tables))
check('删除委托和中心范围字段', not re.search(r'\b(delegation|data_scope_type|specified_org_ids)\b', sql))
check('仅持久化token摘要', 'token_digest TEXT NOT NULL UNIQUE' in sql and not re.search(r'^\s+token\s+(VARCHAR|TEXT)', sql, re.M))
check('多组织无主部门', 'CREATE TABLE qs__auth__account_organization' in sql and 'is_primary' not in sql)
check('期限支持续期且不得早于创建', 'CHECK (expires_at > created_at)' in sql and "CHECK (expires_at = created_at + INTERVAL '30 days')" not in sql)
check('数据库维护北京时间和version', "AT TIME ZONE 'Asia/Shanghai'" in sql and 'NEW.version := OLD.version + 1;' in sql)
check('时间列秒精度', not re.search(r'\bTIMESTAMP(?!\(0\))', sql))
check('没有存量迁移或执行数据删除', not re.search(r'^\s*(INSERT|UPDATE|DELETE|DROP)\s', sql, re.M))
tables = {}
for name, chunk in create_tables:
    columns = re.findall(r'^\s+(\w+) (?:BIGSERIAL|BIGINT|INT|VARCHAR|TEXT|UUID|JSONB|TIMESTAMP|BOOLEAN)\b', chunk, re.M)
    tables[name] = set(columns)
    check(name + '字段无重名', len(columns) == len(set(columns)))
    check(name + '表注释', f'COMMENT ON TABLE {name} IS ' in sql)
    check(name + '列注释齐全', all(f'COMMENT ON COLUMN {name}.{col} IS ' in sql for col in columns))
    if not name.endswith('audit_log'):
        check(name + '版本及更新触发器', 'version' in columns and f'BEFORE UPDATE ON {name} ' in sql)
    for col, target, target_col in re.findall(r'FOREIGN KEY \((\w+)\) REFERENCES (\w+)\((\w+)\)', chunk):
        check(name + '.' + col + '外键先建目标且列存在', target in tables and target_col in tables[target] and col in columns)
indexes = re.findall(r'CREATE (?:UNIQUE )?INDEX (\w+) ON (\w+)\((\w+)\)', sql)
check('索引数量和名称唯一', len(indexes) == len({i[0] for i in indexes}) == metadata['indexes'])
check('索引列均存在', all(t in tables and c in tables[t] for _, t, c in indexes))
check('列注释计数一致', len(re.findall(r'COMMENT ON COLUMN ', sql)) == metadata['columnComments'])
check('当前测试编号唯一且完整正文', len(cases) == len({c['id'] for c in cases}) == metadata['testCases'] and all('#### ' + c['id'] + '：' + c['title'] in body for c in cases))
check('每例包含具体执行信息', all(all(c[k] for k in ['ac', 'api', 'us', 'br', 'td', 'inputs', 'steps', 'expected', 'q']) for c in cases))
check('旧TC不遗漏或复用退役编号', not (set(metadata['retiredTestCases']) & {c['id'] for c in cases}) and all(i in body for i in metadata['retiredTestCases']))
active_ac = {c['ac'] for c in cases}
check('32个现行AC均有执行记录', len(active_ac) == metadata['acceptancePoints'] == 32 and all('| ' + a + ' | 未执行；' in body for a in active_ac))
for old in [5, 6, 7, 8, 16, 20, 23, 30]:
    check(f'AC-{old:02}删除状态', f'| AC-{old:02} | N/A |' in body)
used_br = set(re.findall(r'BR-(\d{2})', ' '.join(c['br'] for c in cases)))
check('全部现行BR有具体TC', used_br == {f'{i:02}' for i in range(1, 37)} - {'06', '07', '14', '18', '23'})
active_apis = set(re.findall(r'^\|\s*(API-\d{2})\s*\|', body.split('### 5.2')[1].split('### 5.3')[0], re.M))
check('全部现行API有具体TC', active_apis <= {c['api'] for c in cases})
check('未调用已删除API', all(c['api'] not in ['API-12', 'API-16'] for c in cases))
for link in re.findall(r'\]\(([^)#]+)(?:#[^)]*)?\)', body):
    check('相对链接 ' + link, (ROOT / link).is_file())

with tempfile.TemporaryDirectory(prefix='auth-v040-check-') as temp:
    base = Path(temp)
    def run(path):
        result = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / '测试数据/生成测试数据.py'), '--out-dir', str(path)], capture_output=True, text=True, encoding='utf-8')
        check('生成器 ' + path.name, result.returncode == 0)
    run(base / 'a')
    run(base / 'b')
    run(base / 'a')
    data_bytes = (base / 'a/authorization-fixtures.json').read_bytes()
    check('固定参数可重复且与交付一致', data_bytes == (base / 'b/authorization-fixtures.json').read_bytes() == (ROOT / '测试数据/v0.4.1/authorization-fixtures.json').read_bytes())
    data = json.loads(data_bytes)
    check('10组数据', {k for k in data if k.startswith('TD-')} == {f'TD-{i:02}' for i in range(1, 11)})
    check('数据无委托或主部门', all(word not in data_bytes.decode() for word in ['delegation', 'isPrimary', 'specifiedOrgIds']))
    check('时间精确30天', datetime.fromisoformat(data['TD-06']['expiresAt']) - datetime.fromisoformat(data['TD-06']['issuedAt']) == timedelta(days=30))
    times = {k: datetime.fromisoformat(v) for k, v in data['TD-06'].items()}
    check('日志样例精确90天', times['retentionReference'] - times['retentionCutoff'] == timedelta(days=90))
    check('续期阈值样例覆盖等号及下一秒', times['expiresAt'] - times['renewAt15Days'] == timedelta(days=15) and times['renewBelow15Days'] - times['renewAt15Days'] == timedelta(seconds=1))
    check('续期后样例精确30天', times['renewedExpiresAt'] - times['renewBelow15Days'] == timedelta(days=30))
    check('超级管理员样例不配置权限组', any(a['id'] == 101 and a.get('isSuperAdmin') for a in data['TD-01']['accounts']) and not any(g['accountId'] == 101 for g in data['TD-01']['accountGroups']))
    check('两设备摘要不同', data['TD-08']['phone']['tokenDigest'] != data['TD-08']['computer']['tokenDigest'])
    check('成员多部门', {m['orgId'] for m in data['TD-01']['memberships'] if m['accountId'] == 102} == {11, 21})
    check('操作码均带应用前缀', all(o['operationCode'].startswith(o['appCode'] + '.') for o in data['TD-01']['operations']))
    groups = {g['id'] for g in data['TD-01']['permissionGroups']}
    operations = {o['id'] for o in data['TD-01']['operations']}
    check('组/应用引用存在', all(set(g['operationIds']) <= operations for g in data['TD-01']['permissionGroups']) and all(a['visibilityGroupId'] in groups for a in data['TD-01']['apps']))
    changed = base / 'changed'
    changed.mkdir()
    (changed / 'authorization-fixtures.json').write_text('user content', encoding='utf-8')
    result = subprocess.run([sys.executable, str(ROOT / '测试数据/生成测试数据.py'), '--out-dir', str(changed)], capture_output=True)
    check('不同输出拒绝覆盖', result.returncode != 0 and (changed / 'authorization-fixtures.json').read_text() == 'user content')

check('超级管理员删除保护与身份变更保护', 'IF OLD.is_super_admin THEN' in sql and 'NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin' in sql and 'CREATE UNIQUE INDEX qs__auth__account_super_admin_idx' in sql)
check('续期边界与日志保留已明确', '剩余正好15天不触发' in body and '恰好90天的日志保留' in body)
check('密码复杂度与统一响应已明确', '密码至少8位' in body and '"code":200' in body and 'MyBatis' in body)
report = {'version': state['version'], 'revision': state['revision'], 'passed': len(checks), 'checks': checks, 'businessExecution': '未执行；仅文档、SQL静态与本地数据检查', 'sha256': hashlib.sha256((ROOT / '授权中心.prd.md').read_bytes()).hexdigest()}
(OUT / 'delivery-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': len(checks)}, ensure_ascii=False))
