"""生成原模型的完整建表草案及同快照需求文件，不运行数据库。"""
from pathlib import Path
import re,json,hashlib,sys
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
SKILL=ROOT.parent/'skills/prd-writer-v3.1/prd-writer'
sys.path.insert(0,str(SKILL/'scripts'))
from render_prd import read_markdown,encode_markdown,render_html,extract_html_state
baseline=ROOT/'history/v0.2.0-before-ddl-v3.1.1'
state=read_markdown((baseline/'授权中心.prd.md').read_text(encoding='utf-8'))
body=state['markdown']
manifest=json.loads((baseline/'授权中心.manifest.json').read_text(encoding='utf-8'))
assert all(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h for n,h in manifest['sources'].items())
source=(ROOT/'DDL.md').read_text(encoding='utf-8')
sql=re.search(r'```sql\n(.*?)```',source,re.S).group(1)
sql=sql[:sql.index('-- 初始化数据')]
sql=re.sub(r'-- =+\n\s*$', '',sql).rstrip()
sql,n=re.subn(r'(created_by\s+BIGINT)(\s+--[^\n]*\n\s+updated_by)',r'\1,\2',sql)
assert n==10
sql=sql.replace('CREATE TABLE audit_log (\n    id                  BIGSERIAL PRIMARY KEY,','CREATE TABLE audit_log (\n    id                  BIGSERIAL NOT NULL,')
sql=sql.replace('created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP\n) PARTITION BY RANGE', 'created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT pk_audit_log PRIMARY KEY (id, created_at)\n) PARTITION BY RANGE')
implicit={'idx_account_username','idx_account_phone','idx_account_email','idx_token_token','idx_operation_code','idx_app_auth_app_code','idx_app_auth_app_key'}
seen=set();indexes=[];lines=[]
for line in sql.splitlines():
 m=re.match(r'CREATE (UNIQUE )?INDEX (\w+) ON (\w+)\(([^)]+)\);',line)
 if m:
  unique,name,table,cols=m.groups()
  if name in implicit or name in seen:continue
  seen.add(name);indexes.append((name,table,cols,'UNIQUE' if unique else 'BTREE'))
 lines.append(line)
sql='\n'.join(lines)+'\n'
sql=re.sub(r'REFERENCES (\w+)\(id\)( ON DELETE CASCADE)?',lambda m:m.group(0)+('' if m.group(2) else ' ON DELETE NO ACTION')+' ON UPDATE NO ACTION',sql)
existing={(t,c) for t,c in re.findall(r'COMMENT ON COLUMN (\w+)\.(\w+) IS',sql)}
columns={};comments=[]
for table,chunk in re.findall(r'CREATE TABLE (\w+) \((.*?)\n\)',sql,re.S):
 cols=[]
 for line in chunk.splitlines():
  m=re.match(r'\s+(\w+)\s+(BIGSERIAL|BIGINT|INT|VARCHAR|TEXT|UUID|JSONB|TIMESTAMP|BOOLEAN)\b',line)
  if not m:continue
  col=m.group(1);cols.append(col)
  if (table,col) in existing:continue
  note=line.split('--',1)[1].strip() if '--' in line else {'created_at':'创建时间；TIMESTAMP不含时区，解释规则待Q-11','permission_group_id':'权限组标识，引用permission_group.id'}.get(col,col+'，语义见第三章字段表')
  if col=='updated_at':note='更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12'
  if col in ('created_by','updated_by'):note+='；原模型未设外键，审计与保留策略待Q-09/Q-10'
  if table=='audit_log' and col=='id':note='序列生成标识；与created_at共同组成分区主键，单列无唯一约束，待Q-09/Q-16'
  comments.append("COMMENT ON COLUMN "+table+'.'+col+" IS '"+note.replace("'","''")+"';")
 columns[table]=cols
sql=sql.replace('DEPT:本部门及以下','DEPT:部门范围；是否含下级待Q-02')
sql+='\n-- 补全数据库可存储注释。\n'+'\n'.join(comments)+'\n'
sql+="COMMENT ON TABLE audit_log_default IS '审计默认分区；月分区建立与默认分区数据迁移待Q-09/Q-16';\n"
for col in columns['audit_log']:
 sql+="COMMENT ON COLUMN audit_log_default."+col+" IS '审计默认分区字段；业务含义同audit_log."+col+"';\n"
header='''-- 授权中心完整建表草案 0.3.0；来源DDL.md，原文件不修改。
-- PostgreSQL 12+为输入声明，实际部署版本/schema/search_path/扩展权限待Q-16。
-- 仅供批准隔离空库验证；本轮未执行SQL，不是存量库迁移脚本。
-- 保留原14张业务表、TIMESTAMP、JSONB、0根节点及原外键删除行为。
-- 修复10处缺逗号、重复索引；移除7个被UNIQUE覆盖的重复索引。
-- 候选：audit_log使用(id,created_at)主键，须Q-09/Q-16批准。
-- 不包含默认账号、密码、个人信息或假定ID的初始化INSERT。
-- 组织归属/会话/版本/委托应用关系及业务CHECK仍待决策，未虚构为现有列。
-- 在独立专用schema执行；部署方批准并设置search_path，本脚本不替调用方选择schema。

'''
sql=header+sql
(ROOT/'授权中心.schema.sql').write_text(sql,encoding='utf-8',newline='\n')
index_api={'account':'API-01','organization':'API-02','user_group_account':'API-03 / Q-01','token':'API-15—API-17','operation':'API-06','permission_group_account':'API-08','permission_group_org':'API-09','app_authorization':'API-10 / 鉴权','delegation':'API-11 / 鉴权','audit_log':'API-12—API-13'}
appendix='''### 4.5 完整建表 SQL、表列注释与索引

以下脚本与《授权中心.schema.sql》逐字一致，覆盖14张原业务表及1张默认分区。它是**原模型的空库建表修订草案**，并非已批准目标模型或存量迁移。PostgreSQL 12+来自输入声明，实际版本、专用schema及扩展权限待Q-16；脚本不设置共享schema，也不执行初始化账号写入。

| 修改 | 来源/影响与批准状态 |
|---|---|
| 修复10处created_by后缺逗号、删除1条同名重复索引语句 | DB-01/DB-02，确定语法修复 |
| 去掉7个被列UNIQUE覆盖的普通索引 | 唯一性仍由原UNIQUE提供，实际查询计划待核对 |
| audit_log主键改为(id,created_at) | DB-03，候选方案；满足分区键要求，但id单列无唯一约束。Q-09/Q-16未批准，依赖id唯一性的调用方必须复核 |
| 补齐表/列数据库注释，外键显式ON UPDATE/DELETE | 保留原CASCADE与默认NO ACTION；不以语法修复批准级联删除业务 |
| 移除原初始化INSERT | 使用第九章合成夹具及批准装载适配，不沿用固定密码、手机号和主键假设 |
| 暂不添加业务CHECK、组织归属、服务凭据、令牌族、审批、版本列 | 原DB/Q仍有效；本脚本不支持这些目标能力的完整实现。第三章候选字段与TD-02/07仍是设计/测试上下文 |

原模型允许的枚举、JSON成员合法性、时间区间与组织树一致性尚未全部由数据库约束实现；应用层与数据库的负责范围须按4.3批准后追加目标迁移。不能将建表完成视为这些约束已落实。若分区复合主键方案不获批准，需在Q-09/Q-16评审非分区或另设全局唯一登记方案，不能自行切换。

```sql
'''+sql+'''```

### 4.6 索引清单、查询依据与验证

保留原输入索引作为候选基线；下表关联逻辑查询，不能据此宣称性能有保障。所有索引都有写入/更新维护与存储成本，须使用批准规模TD-10和真实谓词在隔离环境执行EXPLAIN (ANALYZE, BUFFERS)后决定保留、合并或替换。

| 索引名 | 表 / 列顺序 | 类型 | 查询/约束依据 | 验证与代价 |
|---|---|---|---|---|
'''
for name,table,cols,kind in indexes:
 appendix+='| '+name+' | '+table+' / '+cols+' | '+kind+' | '+index_api.get(table,'见数据关联')+'；按上述字段过滤/关联'+('；组合去重' if kind=='UNIQUE' else '')+' | 写入维护与空间成本；核对真实计划和选择率 |\n'
appendix+='''
主键及account.uuid/username/phone/email、user_group.group_code、token.token、sys_param.param_code、sys_dict.dict_code、operation.operation_code、app_authorization.app_code/app_key的UNIQUE隐式建立索引，不额外重复建索引。permission_group无额外索引，现阶段按主键关联；新增名称筛选须补查询证据。

`organization.org_path`的普通BTREE不保证所有排序规则下前缀LIKE走索引；`delegation(valid_from,valid_until)`不保证双范围谓词同时高效；status/result低选择率索引须按分布评估。原DDL没有delegation.grantor_id索引，也没有JSONB成员索引；相关查询和删除外键检查需求待Q-07/Q-10批准后选择，不能宣称所有外键均已有索引。

### 4.7 DDL验证、测试数据与验收对应

本轮只做静态检查：正文/SQL文件一致、14表与默认分区齐全、表/列注释覆盖、缺逗号修复、显式索引无重名、索引列存在和FK引用先建表。数据库初始化、约束拒绝、分区路由、执行计划、序列/迁移恢复均未执行。

| TC / AC | 数据与明确验收点 | 实际状态 |
|---|---|---|
| TC-29-001 / AC-29 | TD-01/TD-10；批准专用空库装载schema.sql，核对14表+默认分区、主键/唯一/FK、注释和索引；重复初始化应报对象存在且不重置数据 | 阻断Q-16，未执行 |
| TC-29-002 / AC-29 | TD-05/TD-10；检查重复用户名/组合、悬空FK、超长值拒绝；原模型缺少CHECK的枚举/JSON/时间断言不得伪记通过，批准补充后重验。显式ID装载后校正序列并验证下次ID不冲突 | 阻断Q-10/Q-11/Q-16，未执行 |
| TC-23组 / AC-23、AC-29 | TD-09/TD-10；默认/月分区路由、跨分区复合主键、归档恢复、数量/摘要核对；先提供真实旧库结构/快照再产生增量迁移SQL | 阻断Q-09/Q-16，未执行 |
| TC-30-001 / AC-30 | TD-10；逐项索引以真实API过滤和排序验证计划与批准性能目标；未知规模/阈值不能判通过 | 阻断Q-13/Q-15/Q-16，未执行 |

现有33条表字段样例不改名或添加未批准列，仍需映射实际ID，认证材料通过批准设施生成，UTC按Q-11转换后写入TIMESTAMP。没有提供真实旧库快照，4.4保留迁移步骤而不捏造可执行存量迁移脚本；完整建表SQL仅用于批准空库验证。

'''
body=body.replace('本章是对输入 SQL 的静态评审，不提供可直接投产的修订 DDL。','本章先保留对原输入SQL的静态评审，4.5起提供完整建表修订草案、注释、索引与验证对应；尚未执行数据库验证。')
body=body.replace('## 五、接口操作定义',appendix+'## 五、接口操作定义',1)
body=body.replace('| 业务版本 | 0.2.0 |','| 业务版本 | 0.3.0 |')
body=body.replace('| 0.2.0 | 2026-09-12','| 0.3.0 | 2026-09-12 | Codex；prd-writer 3.1.1 | 补全14表和默认分区DDL、表列注释、索引依据与验证对应；多级目录折叠和子标题定位；保留141用例/10数据集/30验收点与未决Q | 无真人签署，待决策 |\n| 0.2.0 | 2026-09-12',1)
body=body.replace('prd-writer v3.1（本次实际读取的调整版）','prd-writer v3.1（技能元信息3.1.1）')
body=body.replace('配套《授权中心.prd.html》已内嵌','左侧目录显示二至六级标题；父级定位并折叠/展开，箭头只折叠，子级直达内容。配套《授权中心.prd.html》已内嵌',1)
body=body.replace('附带 validation/v3.1/check_delivery.py','附带 validation/v3.1.1/check_delivery.py')
state.update(version='0.3.0',revision=3,updatedAt=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),markdown=body)
html=render_html(state,(SKILL/'assets/offline-shell.html').read_text(encoding='utf-8'))
assert extract_html_state(html)==read_markdown(encode_markdown(state))==state
(ROOT/'授权中心.prd.md').write_text(encode_markdown(state),encoding='utf-8',newline='\n')
(ROOT/'授权中心.prd.html').write_text(html,encoding='utf-8',newline='\n')
manifest.update(version='0.3.0',revision=3,generatedAt=state['updatedAt'],baseline=str(baseline.relative_to(ROOT)),skillVersion='3.1.1',skillSha256=hashlib.sha256((SKILL/'SKILL.md').read_bytes()).hexdigest(),tables=14,partitions=1,indexes=len(indexes),columnComments=sum(map(len,columns.values()))+len(columns['audit_log']))
manifest['files']={n:{'bytes':(ROOT/n).stat().st_size,'sha256':hashlib.sha256((ROOT/n).read_bytes()).hexdigest()} for n in ['授权中心.prd.md','授权中心.prd.html','授权中心.schema.sql']}
(ROOT/'授权中心.manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:manifest[k] for k in ['tables','partitions','indexes','columnComments']},ensure_ascii=False))
