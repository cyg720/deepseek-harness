"""核对文档、合成夹具和实际浏览器导出；不执行业务验收。"""
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).parent
sys.path.insert(0,str(ROOT.parent/'skills/prd-writer-v3.1/prd-writer/scripts'))
from render_prd import read_markdown,extract_html_state
checks=[]
def check(name,condition):
    assert condition,name
    checks.append(name)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
state=read_markdown((ROOT/'授权中心.prd.md').read_text(encoding='utf-8'))
body=state['markdown']
plain_body=re.sub(r'\\([\[\]*_])',r'\1',body)
check('MD/HTML 完整同快照',state==extract_html_state((ROOT/'授权中心.prd.html').read_text(encoding='utf-8')))
manifest=json.loads((ROOT/'授权中心.manifest.json').read_text(encoding='utf-8'))
check('原始资料未变',all(sha(ROOT/name)==value for name,value in manifest['sources'].items()))
check('交付哈希一致',all(sha(ROOT/name)==value['sha256'] for name,value in manifest['files'].items()))
check('版本 0.3.1',state['version']=='0.3.1')
cases=json.loads((OUT/'test-cases.json').read_text(encoding='utf-8'))
check('141 独立用例编号唯一',len(cases)==len({c['id'] for c in cases})==141)
check('30 原测试组全部保留',{c['group'] for c in cases}==set(range(1,31)))
check('每条用例完整正文',all('#### '+c['id']+'：'+c['title'] in plain_body and all(c[k] for k in ['inputs','action','expected','data','role','q']) for c in cases))
check('角色均可解析',all(c['role'] in ['administrator','staticUser','delegatedUser','service'] for c in cases))
for prefix,count in [('US',14),('BR',30),('AC',30),('API',17),('DB',18),('Q',16),('TD',10)]:
    actual={int(x) for x in re.findall(r'\b'+prefix+r'-(\d{2})(?!\d)',body)}
    check(prefix+' 引用无越界且覆盖全部编号',actual==set(range(1,count+1)))
acbody=body.split('### 10.2')[0].split('### 10.1')[1]
check('30 验收标准逐项列出',len(re.findall(r'^\| AC-\d{2} /',acbody,re.M))==30)
records=body.split('### 10.2')[1].split('### 10.3')[0]
check('30 验收记录真实标阻断',len(re.findall(r'^\|\s+AC-\d{2}\s+\|\s+阻断\s+\|',records,re.M))==30)
diagrams=re.findall(r'```mermaid\n(.*?)```',body,re.S)
check('六张 Mermaid 源码完整',len(diagrams)==6)
generator=ROOT/'测试数据/生成测试数据.py'
embedded=re.findall(r'```python\n(.*?)```',body,re.S)
check('正文生成器与交付脚本逐字一致',len(embedded)==1 and embedded[0].rstrip()==generator.read_text(encoding='utf-8').rstrip())
data=json.loads((ROOT/'测试数据/baseline/authorization-fixtures.json').read_text(encoding='utf-8'))
dm=json.loads((ROOT/'测试数据/baseline/manifest.json').read_text(encoding='utf-8'))
check('夹具哈希一致',dm['sha256']==sha(ROOT/'测试数据/baseline/authorization-fixtures.json'))
check('10 组夹具完整',len([k for k in data if k.startswith('TD-')])==10)
tables=data['TD-01']['tables'];sql=(ROOT/'授权中心.schema.sql').read_text(encoding='utf-8')
check('14 表共 33 条字段样例',len(tables)==14 and sum(map(len,tables.values()))==33)
for name,rows in tables.items():
    chunk=re.search(r'CREATE TABLE '+name+r'\s*\((.*?)\n\)',sql,re.S).group(1)
    cols=set(re.findall(r'^\s+(\w+)\s+(?:BIGSERIAL|BIGINT|VARCHAR|TEXT|UUID|JSONB|TIMESTAMP|BOOLEAN)',chunk,re.M))
    check(name+' 无虚构列且主键唯一',all(set(row)<=cols for row in rows) and len({row['id'] for row in rows})==len(rows))
    for column,target,targetcol in re.findall(r'FOREIGN KEY\s*\((\w+)\)\s+REFERENCES\s+(\w+)\s*\((\w+)\)',chunk,re.I):
        check(name+'.'+column+' 外键可解析',all(row.get(column) is None or row[column] in {x[targetcol] for x in tables[target]} for row in rows))
    for column in re.findall(r'^\s+(\w+)\s+[^\n]*?\bUNIQUE\b',chunk,re.M):
        values=[row[column] for row in rows if row.get(column) is not None]
        check(name+'.'+column+' 唯一',len(values)==len(set(values)))
    for columns in re.findall(r'UNIQUE\s*\(([^)]+)\)',chunk):
        cols=[x.strip() for x in columns.split(',')]
        values=[tuple(row[x] for x in cols) for row in rows]
        check(name+' 组合唯一',len(values)==len(set(values)))
check('JSONB 操作引用可解析',all(set(g['operation_ids'])<={o['id'] for o in tables['operation']} for g in tables['permission_group']))
check('指定组织引用可解析',all(set(a['specified_org_ids'])<={o['id'] for o in tables['organization']} for a in tables['app_authorization']))
orgs={o['id']:o for o in tables['organization']}
check('组织父路径一致',all(o['org_path']==((orgs[o['parent_id']]['org_path'] if o['parent_id'] else '')+'/'+str(o['id'])) for o in orgs.values()))
check('资源矩阵匹配范围用例',[(r['creator_id'],r['dept_id']) for r in data['TD-03']['resources']]==[(102,11),(103,11),(103,12),(103,21)])
check('认证标记不可用声明',data['meta']['credentialsUsable'] is False and all(a['password']=='SYNTHETIC-NOT-A-LOGIN-HASH' for a in tables['account']))
bad=data['TD-05']
check('边界长度明确',all(len(bad[k])==n for k,n in [('username64',64),('username65',65),('name128',128),('name129',129),('text512',512),('text513',513)]))
check('缺失/null/空串互相独立',bad['missing']=={} and bad['null']=={'remark':None} and bad['empty']=={'remark':''})
times=data['TD-06'];dt=lambda s:datetime.fromisoformat(s.replace('Z','+00:00'))
check('毫秒边界与等价时区', (dt(times['atFrom'])-dt(times['beforeFrom'])).total_seconds()==0.001 and (dt(times['afterUntil'])-dt(times['atUntil'])).total_seconds()==0.001 and dt(times['sameInstantOffset'])==dt(data['meta']['referenceTime']))
transitions=data['TD-08'];check('29 条状态迁移',sum(map(len,transitions.values()))==29)
for entity,rows in transitions.items():
    for i,r in enumerate(rows):
        check(entity+' 状态源码/表/用例 '+str(i),any(r['current']+' --> '+r['next']+': '+r['event'] in diagram for diagram in diagrams) and any('TD-08.'+entity+'['+str(i)+']' in c['inputs'] for c in cases) and any(r['current'] in line and r['next'] in line and r['event'] in line for line in plain_body.splitlines() if line.startswith('|')))
with tempfile.TemporaryDirectory(prefix='auth-prd-data-') as temp:
    base=Path(temp);script=base/'embedded.py';script.write_text(embedded[0],encoding='utf-8')
    def run(out,*extra,ok=True):
        result=subprocess.run([sys.executable,'-X','utf8',str(script),'--out-dir',str(out),*extra],capture_output=True,text=True,encoding='utf-8')
        check('生成器 '+out.name+(' 成功' if ok else ' 拒绝非法参数/覆盖'),(result.returncode==0)==ok)
    run(base/'a');run(base/'b');run(base/'a')
    check('同参数重复及正文脚本输出可复现',(base/'a/authorization-fixtures.json').read_bytes()==(base/'b/authorization-fixtures.json').read_bytes()==(ROOT/'测试数据/baseline/authorization-fixtures.json').read_bytes())
    run(base/'a','--seed','1',ok=False)
    check('拒绝覆盖保留旧文件',(base/'a/authorization-fixtures.json').read_bytes()==(base/'b/authorization-fixtures.json').read_bytes())
    run(base/'changed','--seed','1','--namespace','auth-other')
    check('种子/命名空间改变数据',(base/'changed/authorization-fixtures.json').read_bytes()!=(base/'a/authorization-fixtures.json').read_bytes())
    run(base/'scale','--resource-count','10000')
    check('10000 条规模生成',len(json.loads((base/'scale/authorization-fixtures.json').read_text(encoding='utf-8'))['TD-03']['resources'])==10000)
    run(base/'invalid','--resource-count','3',ok=False);run(base/'badname','--namespace','../outside',ok=False)
    check('非法参数不创建输出目录',not (base/'invalid').exists() and not (base/'badname').exists())
for name in ['roundtrip.zip','keyboard.zip']:
    if (OUT/name).exists():
        with zipfile.ZipFile(OUT/name) as z:
            check(name+' CRC 正确',z.testzip() is None)
            md=next(n for n in z.namelist() if n.endswith('.md'));html=next(n for n in z.namelist() if n.endswith('.html'))
            check(name+' 双格式同快照',read_markdown(z.read(md).decode('utf-8'))==extract_html_state(z.read(html).decode('utf-8')))
sql=(ROOT/'授权中心.schema.sql').read_text(encoding='utf-8')
check('正文包含完整SQL且逐字一致',sql in re.findall(r'```sql\n(.*?)```',body,re.S))
check('SQL无初始化DML',not re.search(r'^\s*(INSERT|UPDATE|DELETE|DROP)\s',sql,re.M))
check('修复缺逗号',not re.search(r'created_by\s+BIGINT\s+--[^\n]*\n\s+updated_by',sql))
check('分区主键含created_at','PRIMARY KEY (id, created_at)' in sql)
tables_sql=re.findall(r'CREATE TABLE (\w+) \((.*?)\n\)',sql,re.S)
check('14业务表+1默认分区',len(tables_sql)==14 and 'CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;' in sql)
cols_by_table={}
for table,chunk in tables_sql:
    cols=re.findall(r'^\s+(\w+)\s+(?:BIGSERIAL|BIGINT|INT|VARCHAR|TEXT|UUID|JSONB|TIMESTAMP|BOOLEAN)\b',chunk,re.M)
    cols_by_table[table]=set(cols)
    check(table+' 表注释完整',bool(re.search(r'COMMENT ON TABLE '+table+r" IS '[^']+';",sql)))
    check(table+' 全部列有数据库注释',all('COMMENT ON COLUMN '+table+'.'+c+' IS ' in sql for c in cols))
    for target in re.findall(r'REFERENCES (\w+)\(id\)',chunk):
        check(table+' FK先建表 '+target,sql.index('CREATE TABLE '+target+' (')<sql.index('CREATE TABLE '+table+' ('))
indexes=re.findall(r'^CREATE (?:UNIQUE )?INDEX (\w+) ON (\w+)\(([^)]+)\);',sql,re.M)
check('27显式索引无重名',len(indexes)==len({x[0] for x in indexes})==27)
check('所有索引表列存在',all(table in cols_by_table and all(c.strip() in cols_by_table[table] for c in cols.split(',')) for _,table,cols in indexes))
check('159字段注释且无重复定义',len(re.findall(r'COMMENT ON COLUMN (\w+\.\w+) IS',sql))==len(set(re.findall(r'COMMENT ON COLUMN (\w+\.\w+) IS',sql)))==159)
check('操作app_code必填且非唯一',bool(re.search(r'app_code\s+VARCHAR\(64\) NOT NULL,',sql)))
check('操作应用外键存在','FOREIGN KEY (app_code) REFERENCES app_authorization(app_code)' in sql)
apps={a['app_code'] for a in data['TD-01']['tables']['app_authorization']}
check('所有合成操作归属现有应用',all(o['app_code'] in apps for o in data['TD-01']['tables']['operation']))
check('一应用多操作样例',sum(o['app_code']=='auth-prd-app-a' for o in data['TD-01']['tables']['operation'])==3)
report={'passed':len(checks),'checks':checks,'businessExecution':'未执行；本报告只验证文档与合成数据'}
(OUT/'delivery-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':len(checks)},ensure_ascii=False))
