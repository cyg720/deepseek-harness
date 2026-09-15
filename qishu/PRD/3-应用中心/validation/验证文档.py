"""验证应用中心交付文件和合成夹具；不执行SQL或业务接口。"""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

BASE = Path(__file__).resolve().parents[1]
SKILL = BASE.parent / 'skills/prd-writer-v3.1/prd-writer'
spec = importlib.util.spec_from_file_location('render_prd', SKILL/'scripts/render_prd.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
md = (BASE/'应用中心.prd.md').read_text(encoding='utf-8')
state = module.read_markdown(md)
body = state['markdown']
checks = []


def check(name, condition, details=''):
    checks.append({'name': name, 'status': '通过' if condition else '失败', 'details': details})


check('MD与HTML完整快照相同', state == module.extract_html_state((BASE/'应用中心.prd.html').read_text(encoding='utf-8')))
sql = (BASE/'应用中心.schema.sql').read_text(encoding='utf-8')
check('第四章SQL与附件逐字一致', re.findall(r'```sql\n(.*?)```', body, re.S) == [sql])
json_blocks = re.findall(r'```json\n(.*?)```', body, re.S)
for block in json_blocks:
    json.loads(block)
check('所有JSON示例可解析', len(json_blocks) == 7, f'{len(json_blocks)} blocks')
for prefix, count in [('S',6),('US',7),('BR',22),('AC',28),('API',19),('DB',4),('TC',28),('TD',4),('Q',12)]:
    values = set(re.findall(r'\b'+prefix+r'-(\d{2})\b', body))
    check(prefix+'编号无越界或缺失', values == {f'{n:02}' for n in range(1,count+1)}, ','.join(sorted(values)))
check('28条TC详情完整', len(re.findall(r'^#### TC-\d{2} ', body, re.M)) == 28 and body.count('| 清理与重跑 |') == 28)
acceptance = body.split('## 十、逐项验收计划与结果',1)[1].split('## 十一、',1)[0]
check('每项AC有标准和执行结果', all(len(re.findall(r'^\| AC-'+f'{n:02}'+r' \|',acceptance,re.M)) == 2 for n in range(1,29)))
check('一图统揽为首个二级章', re.findall(r'^## (.*)',body,re.M)[0] == '一图统揽')
check('流程和状态图均存在', body.count('```mermaid\n') == 3)
check('用户决定准确保留', '单企业部署，与授权中心对齐' in body and '有没有审批权限 走授权中心来设定' in body)
check('全部表列具备数据库注释', all('COMMENT ON COLUMN '+name+'.'+column+' IS ' in sql for name,block in re.findall(r'CREATE TABLE (\w+) \(\n(.*?)\n\);',sql,re.S) for column in re.findall(r'^    (\w+) (?:BIGSERIAL|BIGINT|INTEGER|VARCHAR|TEXT|JSONB|TIMESTAMP)\b',block,re.M)))
check('无跨库授权写入和密钥列', 'INSERT INTO' not in sql and not re.search(r'^\s*app_secret\s',sql,re.M))
without_code = re.sub(r'```.*?```','',body,flags=re.S)
links = re.findall(r'\[[^\]]+\]\(([^)]+)\)',without_code)
check('本地引用存在', all((BASE/link.split('#')[0]).exists() for link in links if not re.match(r'https?:',link)), str(links))
fixture_script = BASE/'测试数据/生成测试数据.py'
check('正文含完整夹具脚本', fixture_script.read_text(encoding='utf-8').rstrip() in body)
with tempfile.TemporaryDirectory(prefix='app-prd-check-') as scratch:
    outputs=[]
    commands=[]
    for name in ('a','b'):
        directory=Path(scratch)/name
        command=[sys.executable,'-X','utf8',str(fixture_script),'--out-dir',str(directory)]
        result=subprocess.run(command,check=True,text=True,capture_output=True,encoding='utf-8')
        commands.append({'argv':command,'stdout':result.stdout.strip(),'exitCode':result.returncode})
        outputs.append((directory/'application-fixtures.json').read_bytes())
    check('两次独立生成夹具逐字一致',outputs[0]==outputs[1],hashlib.sha256(outputs[0]).hexdigest())
    target=Path(scratch)/'a/application-fixtures.json'
    target.write_text('{"preserve":true}\n',encoding='utf-8')
    retry=subprocess.run(commands[0]['argv'],capture_output=True,text=True,encoding='utf-8')
    check('不同内容覆盖被拒绝并保留原文件',retry.returncode!=0 and target.read_text(encoding='utf-8')=='{"preserve":true}\n',retry.stderr.strip())
    fixture=json.loads(outputs[0])
    check('TD数据数量与文档一致',len(fixture['TD-01']['actors'])==6 and len(fixture['TD-01']['applications'])==5 and len(fixture['TD-02']['requests'])==8 and len(fixture['TD-04']['legalTransitions'])==10)
sources={}
for path in [BASE/'DDL.md',BASE.parent/'平台公约.md',BASE.parent/'总体架构.md',BASE.parent/'2-授权中心/授权中心.prd.md',SKILL/'SKILL.md']:
    sources[str(path.relative_to(BASE.parent))]=hashlib.sha256(path.read_bytes()).hexdigest()
report={'executedAt':datetime.now(timezone.utc).isoformat(),'python':sys.version,'checks':checks,'fixtureCommands':commands,'sourceSHA256':sources,'limits':['仅静态检查SQL，未执行数据库','未执行任何业务用例、接口或正式验收']}
(BASE/'validation/静态验证.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'passed':sum(c['status']=='通过' for c in checks),'failed':[c for c in checks if c['status']=='失败']},ensure_ascii=False))
raise SystemExit(1 if any(c['status']=='失败' for c in checks) else 0)
