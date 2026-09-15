"""从保留的评审基线生成 v3.1 交付；不执行授权中心业务。"""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
SKILL=ROOT.parent/'skills/prd-writer-v3.1/prd-writer'
BASELINE=ROOT/'history/v0.1.1-before-v3.1-20260912-120405/授权中心.prd.md'
sys.path.insert(0,str(SKILL/'scripts'))
from render_prd import read_markdown,encode_markdown,render_html,extract_html_state

old=read_markdown(BASELINE.read_text(encoding='utf-8'))
body=old['markdown']
ac_section=body.split('### 2.6 验收标准')[1].split('## 三、')[0]
criteria={}
for line in ac_section.splitlines():
    if re.match(r'^\| AC-\d{2} \|',line):
        cells=[x.strip() for x in line.strip('|').split('|')]
        criteria[int(cells[0][-2:])]=cells
trace_section=body.split('### 9.2 多对多追溯矩阵')[1].split('### 9.3')[0]
traces={}
for line in trace_section.splitlines():
    if re.match(r'^\| TC-\d{2} \|',line):
        cells=[x.strip() for x in line.strip('|').split('|')]
        traces[int(cells[0][-2:])]=cells

cases=[]
def add(group,title,data,inputs,action,expected,role='administrator',kind='接口/集成',q=None):
    number=1+sum(c['group']==group for c in cases)
    qs={1:'Q-05、Q-15',2:'Q-05、Q-06',3:'Q-03、Q-04',4:'Q-02、Q-03',5:'Q-02、Q-04',
        6:'Q-03、Q-04、Q-07、Q-11',7:'Q-07、Q-08',8:'Q-04',9:'Q-01、Q-05、Q-10、Q-12',
        10:'Q-02、Q-12',11:'Q-02、Q-10、Q-12',12:'Q-10、Q-14',13:'Q-03、Q-12',
        14:'Q-01、Q-12',15:'Q-03、Q-05',16:'Q-08、Q-13',17:'Q-05、Q-06、Q-11',
        18:'Q-06、Q-12',19:'Q-06、Q-08',20:'Q-07、Q-12',21:'Q-10、Q-12',22:'Q-09',
        23:'Q-09、Q-13',24:'Q-01、Q-15',25:'Q-12',26:'Q-06、Q-11',27:'Q-08、Q-09',
        28:'Q-01、Q-12、Q-14、Q-15',29:'Q-16',30:'Q-08、Q-09、Q-13'}
    q=q or qs[group]
    if kind!='隔离数据库' and 'Q-15' not in q:q+='、Q-15'
    cases.append(dict(id=f'TC-{group:02}-{number:03}',group=group,title=title,data=data,inputs=inputs,
        action=action,expected=expected,role=role,kind=kind,q=q,ac=f'AC-{group:02}',
        priority='P0' if group in [1,2,3,4,5,6,7,8,14,15,16,18,19,20,21,22,24,25,27,29] else 'P1',
        refs=criteria[group][1],api=traces[group][3]))

add(1,'无效应用键拒绝','TD-01、TD-04','appKey=TD-04.appInvalid；operationCode=DeviceController.control','调用 API-11[验证应用授权]；通过受控调用追踪检查后续校验是否发生','HTTP 401；不查询委托进行放行，不执行业务动作，业务码仍待 Q-15。','delegatedUser')
add(1,'冻结应用拒绝','TD-01、TD-04','app=503/frozen；grantee=103；存在 active 委托 601','以冻结应用请求 dev-001 的 control','HTTP 401；有效委托不能绕过应用冻结；资源不变。','delegatedUser')
for title,inputs,expected in [
    ('服务账号密码登录拒绝','account=104；password=TD-04.passwordAttempt','拒绝且不签发访问或刷新令牌。'),
    ('服务凭据与白名单正例','account=104；credentialRef=fixture:service-104；IP=192.0.2.10','经已批准适配注入有效测试凭据后可进入后续认证；仅凭占位标签不能签发。'),
    ('服务凭据白名单外拒绝','account=104；相同有效测试凭据；IP=198.51.100.10','拒绝且不签发令牌；不能以客户端伪造的转发头覆盖可信源 IP。'),
    ('服务证书正例与失效反例','certificateRef=fixture:certificate-104；IP=192.0.2.10；分别注入有效/过期/撤销证书','只有有效证书且绑定主体/IP 正确者进入后续认证；过期或撤销均拒绝。'),
    ('服务账号空白名单','account=104；分别 ipWhitelist=[]、null','两组均不得解释为全网；按批准规则拒绝保存或认证，不能取得令牌。')]:
    add(2,title,'TD-01、TD-04',inputs,'通过批准的 API-10[登录]分别提交；核对签发记录数及拒绝原因',expected,'service','认证端到端')
add(3,'直接静态授权正例','TD-01、TD-02','app=501；account=101；operation=202；permission_group_account=411','验证 dev-001 控制权限并追踪委托查询次数','返回 STATIC 与 SELF 范围；不查询委托；业务写入还需执行行过滤。','administrator')
add(3,'应用操作上限拒绝','TD-01、TD-02','app=502 仅含 202；account=101；请求 operation=201','在应用上限采用交集的 Q-03 批准后验证列表操作','不因为用户具有 201 而突破应用上限；拒绝且无业务效果。','administrator')
add(3,'移除静态授权后不能缓存旧许可','TD-01、TD-02','account=103 无直接/组织许可；group=402 空操作；禁用该例委托601','验证 operation=202；对照新增 group403/account103 关联后重查','无授权组拒绝；添加批准的直接关联后仅按当前应用上限得到 STATIC；无组不等于所有操作。','delegatedUser')
add(4,'所属与下级继承策略对照','TD-01、TD-02','account102→org11；授权org11；再改归属org12；account103→org21 同名不同树','分别验证 102/103；在 Q-02 精确归属/后代规则定稿后记录各组预期','org11 对应主体可继承；org21 不能因同名继承；org12 按批准的后代策略单独判定。','staticUser')
add(4,'移除归属及成员源失效','TD-01、TD-02、TD-09','删除测试上下文中的 account102/org11；另组注入 permission-source-timeout','重新请求 DEPT 范围与继承操作；检查无归属与依赖故障区别','无法确定组织集合时不返回全量范围、不使用不确定旧许可；诊断与无归属业务策略分别记录。','staticUser')
for scope,expected in [('SELF','仅 dev-001；dev-002/003/004 不属于账号102创建'),('DEPT','精确部门时 dev-001/002；若批准含后代则再含 dev-003；dev-004 始终不在该部门集合'),('SPECIFIED','指定 [21] 时仅 dev-004')]:
    add(5,scope+' 列表、计数及写入','TD-01、TD-02、TD-03',f'account=102；app501 的数据范围改为 {scope}；SPECIFIED 时组织=[21]；资源为4条基线',
        '1. 在独立快照设置范围并核对静态许可。2. 分别查询列表和计数。3. 对每条 dev-001～004 提交控制请求并核对副作用。',
        expected+'；列表/计数/单资源写入范围一致；超范围不修改；按钮操作许可不随行范围变动。','staticUser','业务端到端')
add(5,'空/未知指定组织拒绝扩权','TD-01、TD-03、TD-05','SPECIFIED；specifiedOrgIds 分别 []、null、[999999]','分别保存配置并在获准可构造存量脏数据的隔离环境验证','配置拒绝或空范围的最终行为按 Q-04；三组均不返回无限制集合、不修改资源。','staticUser')
add(6,'五条件全部匹配','TD-01、TD-02、TD-03、TD-06','app501；account103；operation202；device/dev-001；委托601 active；now=00:30Z；无静态许可','执行 API-11[验证应用授权]，随后业务服务核对许可资源并执行一次操作','命中 DELEGATION，范围只含 dev-001；授权允许不等于业务执行成功，分阶段记录。','delegatedUser')
for title,mutation in [('被授权人不匹配','grantee 从103改102；请求主体仍103'),('权限组不含操作','permission_group_id 从403改402；operation仍202'),('资源类型不匹配','请求 resourceType=alarm；委托仍device'),('资源ID不匹配','请求 resourceId=dev-002；委托只含dev-001'),('尚未开始','now=TD-06.beforeFrom'),('超过结束','now=TD-06.afterUntil')]:
    add(6,title,'TD-01、TD-02、TD-03、TD-06',mutation+'；其余条件与 TC-06-001 完全相同','每组重新装载基线，只破坏所列一个条件，再执行校验','HTTP 403；不能由其他条件抵消；不产生资源写入。','delegatedUser')
for title,mutation in [('未批准委托','601.status=pending'),('撤销委托','601.status=revoked'),('过期委托','601.status=expired；now=afterUntil'),('跨应用委托','TD-02.delegationApp[601]=502；请求app501'),('越权授予人','grantor=103 且没有可授出操作/资源'),('申请人自批','申请人与处理人均103')]:
    add(7,title,'TD-01、TD-02、TD-06',mutation,'按 Q-07 批准策略发起委托处理或资源鉴权并比对前后状态','不得通过未生效/越权来源获得许可；自批禁止方案批准后应拒绝且状态不变；不能伪造已批准。','delegatedUser')
add(8,'静态超行范围不进入委托','TD-01、TD-02、TD-03','account102 静态有202、SELF；给102另设对dev-004的有效委托','请求控制 dev-004 并检查路径追踪及资源快照','拒绝该行；委托路径未用于补救，资源未修改；错误公开口径待 Q-15。','staticUser','业务端到端')

# Five explicitly named operations are instantiated only for modules in the source PRD.
crud=[(9,'API-01','账号','TD-01.account','username=auth-prd-new；accountType=person；凭据走批准测试流程','remark=修改备注'),
      (10,'API-02','组织','TD-01.organization','parentId=11；orgName=测试岗位；orgType=post','orgName=调整后的岗位'),
      (11,'API-03','用户组','TD-01.user_group','groupCode=auth-prd-new-group；groupName=新用户组','groupName=调整后的用户组'),
      (12,'API-04','参数','TD-01.sys_param','paramCode=auth-prd-new-param；paramValue=demo','paramValue=changed'),
      (12,'API-05','字典','TD-01.sys_dict','dictCode=auth-prd-new-dict；dictItems=[启用,禁用]','dictItems=[启用,停用]'),
      (13,'API-07','权限组','TD-01.permission_group','name=新权限组；operationIds=[201]','operationIds=[201,203]'),
      (14,'API-08','用户授权关联','TD-07.uniqueAccountPair','permissionGroupId=403；accountId=103','permissionGroupId=402；accountId=103'),
      (14,'API-09','组织授权关联','TD-07.uniqueOrgPair','permissionGroupId=403；orgId=21','permissionGroupId=402；orgId=21')]
for group,api,label,selector,create,edit in crud:
    for operation in ['新增','编辑','详情','列表','删除']:
        if operation=='新增':inp=create;step=f'调用 {api}[新增]，由响应记录实际生成 ID；以该 ID 复查';expect='只新增一条正确记录；ID 由服务端生成，不改写已有对象。'
        elif operation=='编辑':inp=edit;step=f'准备本例无引用新对象并读取版本，调用 {api}[编辑]，重新读取';expect='仅允许字段变化；版本按批准机制变化；未提交字段不被意外清空。'
        elif operation=='详情':inp='按本例新对象实际 ID 定位；另以未授权管理员/对象做对照';step=f'调用 {api}[详情]，比较允许字段与持久值';expect='授权主体可读正确字段；越权拒绝且不泄露对象；读取不写数据。'
        elif operation=='列表':inp='使用本例编码/名称筛选；空匹配值=auth-prd-no-match';step=f'调用 {api}[列表]并遍历分页；再查询空匹配';expect='范围内可查询且无越权记录；空集合与分页口径一致；不写数据。'
        else:inp='本例单独创建且无引用的对象；删除语义须先批准Q-10';step=f'调用 {api}[删除]，检查实体与关联及审计；再次读取';expect='仅按批准硬删除/软删除/停用方案处理目标；不意外级联其他对象；读取结果符合删除策略。'
        add(group,label+operation,'TD-01、TD-02、TD-07',selector+'；'+inp,step,expect+' 散列、AppSecret 与令牌不进入常规输出。')
add(9,'账号重复/只读字段/长度校验','TD-01、TD-05','username=auth-prd-member 重复；新建传 id=102；编辑注入TD-05.readonly；username65','各组分别调用账号新增/编辑；检查新增数、账号102及服务端字段','重复、只读写入、65字符名称按规则拒绝；不存在编辑不转新增；原账号不变。')
add(10,'移动子树与防环','TD-01、TD-07','移动 org11 到org20；反例 parentId=12 或 parentId=11；版本初值7','核对 org11/12 路径；分别执行合法移动、自父、循环和陈旧版本更新','合法移动同时更新两条路径；自父/循环/旧版本拒绝并保留原树；目标范围未经授权不可移动。')
add(11,'跨部门成员及重复/移除','TD-01、TD-02','user_group301；成员102/103；重复添加103再移除103','API-15[成员添加/列表/移除]；同时对照103在加入前后的操作202校验，禁用委托','成员组合唯一；移除只影响用户组成员；加入跨部门用户组不会隐式授予操作权限。')
add(12,'配置结构与唯一引用校验','TD-01、TD-05','已有paramCode/dictCode；dictItems 分别错误对象/null/[]；paramValue分别缺失/null/空串；设置一个消费方引用','按 Q-14 确定每组合法性后逐组提交，另删除被引用参数/字典','重复编码拒绝；必填缺失/null拒绝；数组空与参数空串按批准规则独立判断；禁止删除引用时原值保留。')
for operation in ['新增','详情','列表']:
    add(13,'操作登记'+operation,'TD-01','operationCode=DeviceController.detail；新增对照码=DeviceController.syntheticCheck；resourceType=device',
        f'执行 API-06[{operation}]；新增使用对照码，查询使用既有203',
        '新增只登记一次，详情/列表返回授权字段；不增加未批准的操作编辑/删除入口。')
add(13,'重复操作与无效权限引用','TD-01、TD-05','重复 operationCode=DeviceController.control；permissionGroup.operationIds=[999999]','分别调用操作新增和权限组编辑；检查operation计数及组401','两组拒绝；既有操作与组操作集合不变；JSONB 语法正确不代表引用合法。')
add(14,'同组合并发建立与原子替换','TD-01、TD-07','两个请求相同 uniqueAccountPair，再两个相同 uniqueOrgPair；将关联411替换为已存在组合','屏障同时释放两次新增并等待完成；然后测试冲突替换和重复删除','每个组合最多一条；冲突替换不能先删旧关系；重复删除不额外授予或恢复权限。',kind='事务/并发')
for title,inputs,action,expect in [
    ('应用注册','appCode=auth-prd-new-app；group401；SELF','API-11[应用注册]，记录生成键，再重复编码注册','首次仅一个应用与受控凭据；重复拒绝；密钥仅按批准流程展示'),
    ('操作绑定及共享影响','app501与504共享group401；目标操作=[201]','API-11[操作授权码绑定]；核对两应用和其他用户的组','不得默改共享组造成他应用/用户权限变化；越权绑定拒绝'),
    ('授权明细','app501；同/非负责该应用的管理员','API-11[获取应用授权明细]','仅负责应用的获准主体读到操作与范围；没有AppSecret或其他应用详情')]:
    add(15,title,'TD-01、TD-02',inputs,action,expect+'；实际公开响应协议待Q-15。')
add(16,'授权刷新与撤权传播','TD-01、TD-07、TD-10','app501；至少两个隔离节点持有旧许可；撤回operation202；Q-13批准时限','API-11[应用授权刷新]；从撤权提交时刻到各节点最后一次允许逐点记录；核对密钥前后值','批准时限内全部拒绝旧许可；授权刷新不自行轮换AppSecret；未批准时限不能写通过。',kind='多节点运行验证')
add(17,'Master 与 Scene 登录签发','TD-01、TD-02、TD-04','account102；session-a；scene-a；批准寿命；有效凭据通过测试适配注入','API-10[登录]和API-17[场景签发/兑换]；读取有效期、类型及可信主体','Master/Scene类别与场景正确；客户端不能伪造accountId；1小时适用范围依Q-06定稿，刷新寿命不自动等于1小时。','staticUser','认证端到端')
add(17,'错误场景及过期拒绝','TD-01、TD-02、TD-04、TD-06','Scene实例703；scene-b；另组 now=afterUntil','分别带错误场景和已过期访问令牌请求受保护操作','均拒绝，不恢复令牌或执行业务；真实JWT由适配签发，fixture标签本身不能登录。','staticUser','认证端到端')
add(18,'并发刷新与旧令牌重放','TD-01、TD-02、TD-07','刷新实例702；session-a；两个同一刷新请求','屏障同时调用 API-10[刷新令牌]，开放API-14同样复测；随后重放旧令牌','按批准轮换方案至多一组有效换发；旧刷新令牌不能新增会话；事务失败不能只消费旧令牌却谎称签发。','staticUser','事务/并发')
add(18,'刷新响应丢失后的恢复','TD-01、TD-02、TD-09','702 已消费但响应被测试代理丢弃','按批准的结果查询/幂等恢复协议处理；不得盲目用旧令牌无限重试','最终只存在批准数量的有效会话；明确未知结果，不能默认已失败重新签发。','staticUser','故障注入')
add(19,'退出当前会话与注销范围','TD-01、TD-02','session-a含701/702/703；另建session-b对照有效会话；注销704为已撤销对照','分别API-10[退出/注销]和API-14[注销]，重复请求；管理员尝试注销未授权会话','只影响批准的会话/场景范围；范围外会话保持原状；重复不恢复；管理员越权拒绝。','staticUser')
add(20,'申请幂等与参数冲突','TD-01、TD-02、TD-06、TD-07','grantee103；group403；device/dev-001；validFrom/Until；同idempotencyKey；反例改resourceIds=[dev-002]','API-12[申请]首次及同参数重试，再同键不同参数提交','首次pending不生效；同键同参数不新增；不同参数冲突且不改原申请；不能自动批准。','delegatedUser')
add(20,'委托查询可见范围','TD-01、TD-02','委托601；申请/处理/无关三种身份','API-16[详情/列表]，切换主体并篡改委托ID','仅批准范围内可读；无关主体不获取资源清单/理由；查询不触发批准。','delegatedUser')
for entity,api in [('账号101','API-01'),('组织11','API-02'),('权限组401','API-07')]:
    add(21,entity+' 被引用删除','TD-01、TD-07',entity+' 存在当前关联；删除前检查后并发加入引用','在事务隔离测试中调用 '+api+'[删除]，对照无引用对象；核对应用、委托、令牌及审计','按批准策略拒绝或一致处理；无半删除/孤立引用；权限组删除不能意外删除应用凭据；审计按保留策略保留。',kind='事务/引用')
add(22,'四类事件与脱敏追加','TD-01、TD-02、TD-09','静态允许、委托执行、未认证拒绝、业务失败；auditTrace；TD-09.sensitiveMarkers','通过可信写入方 API-13[新增]记录各阶段，按 trace 查询详情/列表','执行人为实际grantee103，grantor101单列候选；阶段与结果可区分；未知主体不伪造0号账号；敏感标记不在日志。',kind='审计集成')
add(22,'审计读写越权','TD-01、TD-02','普通成员102及未获该应用日志权限的审计员；日志1001','尝试伪造追加、查他应用日志、篡改/删除日志','拒绝未经授权行为；不存在普通用户编辑/删除日志入口；不改变原审计。','staticUser')
add(23,'归档恢复与重复批次','TD-01、TD-09、TD-10','archiveBatch；批准保留期和隔离副本；按源记录id/时间/计数保存清单','API-13[自动归档]调度同批次两次；抽样恢复并按ID/计数/内容哈希比对','完整性与可恢复性验证后才处理原数据；重复不重复删除或重复归档；默认分区存在不等于已归档。',kind='隔离恢复演练')
add(24,'开放详情与权限限制','TD-01、TD-02','app501/app502；目标102/103；并尝试任意userId=999999','分别 API-14[获取用户详情/获取用户权限]；切换应用与目标','只返回批准目标及当前应用操作和字段；不包含密码散列/AppSecret/完整令牌；权限列表不是资源执行许可。','staticUser','安全接口')
add(24,'开放获取令牌复用签发','TD-01、TD-02、TD-04','account102；app501；批准认证上下文','API-14[获取令牌]与API-10[登录]对照，开放刷新/注销复用TC-18/TC-19','同一生命周期与主体/应用限制；不产生绕过服务账号限制或独立失效规则的令牌。','staticUser','认证端到端')
add(25,'权限/应用/委托陈旧版本编辑','TD-01、TD-07','组401、应用501、委托601 三组分别readVersion=7；requestA/B','每组两个会话读取v7；A先提交，B提交旧v7；检查页面未提交输入和当前详情','A成功后B冲突，B表单保留供比较；不静默覆盖A、不丢失其他字段；实际版本存储待Q-12。',kind='并发/界面')
for key,expect in [('beforeFrom','拒绝'),('atFrom','允许'),('atUntil','允许'),('afterUntil','拒绝')]:
    add(26,'委托时刻 '+key,'TD-01、TD-02、TD-06','委托601 active；account103；无静态权限；now=TD-06.'+key,'通过已批准测试时钟适配设置now；鉴权dev-001；暂停过期标记任务重复核对',expect+'；闭区间边界不变，不能依赖任务先把status改成expired；认证/资源等其他条件保持匹配。','delegatedUser','可控时钟')
add(26,'时区等价与逆序区间','TD-01、TD-06','00:30Z 与08:30+08:00；反例validFrom>end','以等价时刻分别验证；另提交逆序有效期申请','等价时刻结论一致；逆序区间拒绝且不创建记录；TIMESTAMP装载时区由Q-11批准。','delegatedUser','可控时钟')
for fault in ['permission-source-timeout','cache-unavailable','audit-write-failure']:
    add(27,'依赖故障 '+fault,'TD-01、TD-09','TD-09.faults 中 '+fault+'；保留已允许缓存对照','在受控测试适配注入单一故障，发起鉴权/高风险写，恢复后重试一次','权限不确定不放行；审计失败按批准阻断或可靠补记策略，不宣称已审计；恢复不能重复执行业务。',kind='故障注入')
add(28,'长度边界与字段空值','TD-01、TD-05','username64/65；name128/129；text512/513；remark缺失/null/空串；JSON[]/null/错误对象','按第三章将每组投到适用字段；每次还原初始值，分别新增和编辑并核对字段结果','恰好声明长度允许、超限拒绝；不可空字段拒绝null；缺失是否保留按Q-12；参数值与字典结构按Q-14独立判定；失败原值不变。')
add(28,'大ID与排序/文本注入','TD-01、TD-05','largeId=9007199254740993；invalidSort；htmlText；readonly','检查请求/响应ID逐字往返；将非法排序作为值提交；将HTML文本通过获准字段显示；尝试覆盖服务端字段','大ID不转为有精度损失的JS数值；非法排序不执行SQL；纯文本不产生标签或外部请求；服务端字段不可覆盖。',kind='安全/界面')
add(29,'DDL修订前置与空库初始化','TD-01、TD-10','原DDL含10处缺逗号、重复idx_token_account_id、audit_log分区主键问题','先核对DB-01～03修订证据；DBA在批准版本隔离库执行修订DDL，再核对14表与约束','原稿不能直接当建库成功；修订版实际建立后方可通过；字段/外键/JSON/时区与批准方案一致。',kind='隔离数据库')
add(29,'非法约束与序列/迁移恢复','TD-01、TD-05、TD-10','重复username；重复用户/组组合；无效外键999999；显式主键后再插入；批准旧库结构副本','隔离库逐项验证拒绝；再执行版本化迁移、中断恢复和记录/哈希对照','拒绝非法行、序列不撞键，存量/恢复计数与内容符合批准迁移；没有真实旧库快照时迁移项阻断。',kind='隔离数据库')
add(30,'性能与撤权/归档运行指标','TD-03、TD-09、TD-10','resource-count可设10000；基线4条不代表负载；Q-13批准规模/分布/并发/阈值/RTO/RPO','记录环境、预热、采样窗口；测鉴权P95/P99/错误率、撤权时延、归档延迟与恢复指标','每项与批准阈值比较；未定阈值/分布/环境时阻断；本地生成10000条数据不构成性能通过。',kind='性能/运行验证')

# State-machine rows have their own executable scenarios, including all self-loops.
spec=importlib.util.spec_from_file_location('authorization_data',ROOT/'测试数据/生成测试数据.py')
data_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(data_module)
fixture=data_module.generate()
for entity,group in [('account',9),('app',15),('token',17),('delegation',20),('archive',23)]:
    for index,row in enumerate(fixture['TD-08'][entity]):
        target_group=(18 if row['next']=='consumed' else 19 if row['next']=='revoked' else 17) if entity=='token' else group
        add(target_group,f'{entity}：{row["current"]} —{row["event"]}→ {row["next"]}',
            'TD-01、TD-02、TD-06、TD-08、TD-09',f'TD-08.{entity}[{index}]；恢复当前状态={row["current"]}；版本/时间/授权前提按第六章对应行',
            '1. 按对应状态表准备身份、初态和时间。2. 通过批准的事件入口触发 '+row['event']+'。3. 查询状态/关联对象及适用审计；失败分支另恢复初态后注入前提不满足。',
            '目标状态为 '+row['next']+'，副作用/失败处理逐项符合第六章该行；失败不能谎称转换成功，自循环不得恢复终态有效。',
            kind='状态/集成',q={'account':'Q-05、Q-08、Q-12','app':'Q-05、Q-08、Q-12','token':'Q-06、Q-11、Q-12','delegation':'Q-07、Q-11、Q-12','archive':'Q-09、Q-13'}[entity])

def cell(text):return str(text).replace('|',r'\|').replace('\n',' ')
def row(*values):return '| '+' | '.join(cell(v) for v in values)+' |'

grouped=defaultdict(list)
for item in cases:grouped[item['group']].append(item)

for item in cases:
    for table in ['account','organization','user_group','sys_param','sys_dict','permission_group']:
        item['inputs']=item['inputs'].replace('TD-01.'+table,'TD-01.tables.'+table)

lines=['## 九、测试用例、测试数据与追溯','','### 9.1 测试环境、编号与执行约定','',
    f'沿用 TC-01—TC-30 作为测试组，以下展开为 {len(cases)} 条独立用例，编号 TC-组号-三位序号。用例逐条定义输入、操作和断言；所有业务用例均未执行，状态为阻断。生成测试数据与验证文档是本轮执行内容，不计入业务结果。','',
    '共同前提：测试负责人提供隔离环境、实现/DDL版本、已批准的 Q 结论和测试适配。API-编号[动作]指第五章明确列出的逻辑操作；现有 URL、HTTP 成功协议和业务码尚未提供，Q-15 关闭前不能拼造 curl 请求。实际路由映射、业务装载、时钟/故障注入与日志读取方式必须在执行记录中登记。','',
    '身份映射：TD-02.roles.administrator=101、staticUser=102、delegatedUser=103、service=104。这些是合成测试标签；101 这个编号并不自动具有平台管理权限，须按 Q-01 在测试环境配置每例需要的动作/对象/字段范围。无权对照身份必须确认不持有其他直接/组织许可；委托否定用例也不得残留另一条有效委托。','',
    '每例通用步骤：0. 恢复本例独立快照，按 TD 选择器构造请求，将合成 ID 映射到实际 ID；记录原值、状态/版本和适用日志起点。1. 执行该例操作。2. 检查响应、页面与持久值及日志/外部副作用。3. 保存证据后按 9.5 清理。并发用例使用同步屏障并等待全部请求结束，不用任意 sleep 假装并发。','',
    'P0 是权限、安全、数据完整性及可部署性风险；P1 是其他功能/运行验证建议优先级，仍需业务负责人排期。待定指标不会因标 P1 而豁免。每例的 HTTP/业务码分别记录：原文明确应用身份拒绝 401、五条件委托不匹配 403；其余使用 Q-15 批准结果，不假设全 HTTP 200。','',
    '证据记录统一包含环境/构建版本、数据库/策略版本、实际操作者、执行时间、请求（脱敏）、响应、前后快照及适用日志。建议证据目录 validation/business/<TC编号>/ 只是待执行业务记录位置，本轮未创建通过证据。','',
    '### 9.2 用例总表','',row('TC','测试组/AC','场景','层级/优先级','TD','状态'),row(*(['---']*6))]
for c in cases:lines.append(row(c['id'],f'TC-{c["group"]:02} / {c["ac"]}',c['title'],c['kind']+' / '+c['priority'],c['data'],'阻断；'+c['q']))
lines+=['','### 9.3 逐条用例详情','']
for c in cases:
    lines += ['#### '+c['id']+'：'+c['title'],'',row('项目','执行定义'),row('---','---'),
        row('关联与角色',c['ac']+'；'+c['refs']+'；'+c['api']+'；角色 TD-02.roles.'+c['role']),
        row('前置条件','完成9.1通用前提；关闭 '+c['q']+'；每个子场景独立还原，不能沿用上一子场景的修改'),
        row('具体数据',c['data']+'；'+c['inputs']),
        row('操作步骤',c['action']),
        row('预期结果与禁止副作用',c['expected']+' HTTP/业务码依9.1分列；非本例目标对象、凭据与授权关系不得附带变化。'),
        row('清理/重跑','保存脱敏证据，按ID映射只清理本例生成对象并恢复初始字段/版本；关系先子后父；不清共享审计；步骤见9.5'),
        row('实际执行','阻断；实际结果/环境/构建版本/执行人/时间/证据均无；拟证据目录 validation/business/'+c['id']+'/'),'']

lines += ['### 9.4 测试数据集与具体样例','',
    '全部数据使用固定 seed=20260912、namespace=auth-prd、referenceTime=2026-09-12T00:30:00Z；默认业务资源4条。JSON 中 TD 键及子字段是下表选择器。表字段样例和测试上下文分开，不能把上下文属性直接 INSERT 到原 DDL。','',
    row('TD','内容/数量与分布','样例/关联','生成及校验边界'),row(*(['---']*4)),
    row('TD-01','14 个原 DDL 表的字段样例：账号4、组织5、用户组1、成员2、令牌4、参数1、字典1、操作4、权限组3、用户授权1、组织授权1、应用4、委托1、审计1','tables.account[1].id=102；org11与org21同名不同树；app501=SELF、502=DEPT、503=frozen、504=SPECIFIED[21]；delegation601=active','共33条。字段类型与引用可作本地检查，但密码/secret/token为不可用标记；不是可直接装载或登录的合法认证种子。'),
    row('TD-02','2条组织归属、4个角色标签、1个委托应用映射、4个令牌上下文','102→11，103→21；601→app501；701/702/703属于session-a','原DDL缺少这些关系；仅测试适配上下文，受Q-01/Q-02/Q-06/Q-07阻断。'),
    row('TD-03','默认4条业务资源；可参数化至100000条','dev-001=(creator102,dept11)，dev-002=(103,11)，dev-003=(103,12)，dev-004=(103,21)','不是新增授权中心业务表。SELF/DEPT/SPECIFIED采用该资源矩阵；扩展数据固定种子，分布/规模需批准后才可用于性能。'),
    row('TD-04','应用、密码、IP、证书与场景输入','无效key=fixture-unknown；允许IP=192.0.2.10，拒绝IP=198.51.100.10；scene-b','示例IP为测试值。凭据/证书仅引用标签，必须由已批准测试设施注入有效/失效材料；不生成真实凭据。'),
    row('TD-05','合法边界与故意非法请求','username64/65、中文name128/129、text512/513、缺失/null/空串、空数组/对象、未知ID999999、大ID字符串9007199254740993、非法排序、只读字段、HTML字样','故意非法输入不能作为合法基线预装；逐项检查长度/类型/缺失区别，不在生成器中修正坏数据。'),
    row('TD-06','4个边界时刻、1个等价偏移时刻及过期待审批输入','23:59:59.999Z/00:00Z/01:00Z/01:00:00.001Z；08:30+08与00:30Z相等','委托区间两端包含；token过期边界按Q-06单独确定；旧TIMESTAMP时区映射仍待Q-11。'),
    row('TD-07','两个v7请求、一个幂等键、两类相同组合','requestA.operationIds=[201]，requestB=[202]；同version=7；key=auth-prd-apply-001','version/幂等键不在原DDL；只能在批准并发方案的测试适配中使用，不能声称已有数据库列。'),
    row('TD-08','5种状态机，共29条迁移','account3、app3、token7、delegation9、archive7；含自循环','与第六章图/表逐条核对；rejected/consumed/归档任务状态为候选或逻辑状态，不作为已批准表列。'),
    row('TD-09','6种故障标签、归档批次、审计trace和3类敏感标记','权限源超时、缓存不可用、审计失败、复制失败、校验错、完成确认失败','标签不自动注入故障；适配由Q-08/Q-09批准。记录归档范围、数量和摘要，清理不能删除唯一副本。'),
    row('TD-10','迁移问题清单与性能参数占位','原DDL三类建库障碍；performanceApproval/concurrency/p95TargetMs/rto/rpo=null','null表示没有批准参数，不是零指标；不生成伪造旧库/容量基线，不执行DDL。'),'']

lines += ['### 9.5 数据如何生成、校验、装载与清理','',
    '生成工具：Python 3.10+ 标准库，本轮实际运行版本见交付验证报告。已交付同目录的 测试数据/生成测试数据.py，完整内容也在下面，可从单独的 MD/HTML 复制重建。无需联网、数据库或认证信息。','',
    '在授权中心目录执行；输出目录是本次独立夹具目录。默认只写 authorization-fixtures.json 和 manifest.json；同参数重跑字节相同，已有不同内容时拒绝覆盖，请改用新目录。','',
    '```bash','python 测试数据/生成测试数据.py --out-dir 测试数据/baseline --seed 20260912 --namespace auth-prd --resource-count 4',
    'python 测试数据/生成测试数据.py --out-dir 测试数据/repeat --seed 20260912 --namespace auth-prd --resource-count 4',
    '```','',
    '容量数据生成示例（仅演示生成能力，非批准性能规模）：','',
    '```bash','python 测试数据/生成测试数据.py --out-dir 测试数据/scale-10000 --seed 20260912 --namespace auth-prd --resource-count 10000','```','',
    '```python',(ROOT/'测试数据/生成测试数据.py').read_text(encoding='utf-8').rstrip(),'```','',
    '生成后校验：manifest中的SHA-256须与JSON原始字节一致；两次同参数输出相同；TD-01中主键、用户名/编码及组合不重复，全部已声明外键能解析；父路径与层次一致；TD-03默认资源矩阵精确匹配上表；TD-05中各长度和缺失/null/空串独立；TD-06边界前后相差1毫秒；TD-08的29条迁移逐条等于第六章图和表。附带 validation/v3.1/check_delivery.py 在本地执行这些检查，结果只能代表夹具与文档检查。','',
    '装载前提与顺序：原DDL存在DB-01—DB-03等问题，先由DBA批准并在隔离库验证修订方案；再配置测试身份/范围及凭据设施；通过已核验测试工厂依次建立 account、organization、operation、user_group、sys_param/sys_dict、permission_group，再建立各关联、app_authorization、token、delegation，最后配置审计读取/归档副本。所有生成ID由装载工具返回，保存合成ID→实际ID映射，JSONB内的操作/组织/资源引用也要映射，禁止假设生产id=101或序列从1开始。','',
    'TD-01认证字段只有不可用标记，不能直接插表后当真实认证数据；服务账号password非空冲突、令牌真实格式与存储方式由Q-05/Q-06解决。TD-02的成员/会话/应用归属、TD-07版本及TD-08逻辑状态只通过批准适配建立。TD-03资源在业务测试桩或获准业务测试服务中建立，不创建未经确认的新授权中心表。UTC字符串装载原TIMESTAMP前必须执行Q-11批准的时区转换。','',
    '清理：所有并发请求完成并保存证据后，用本例ID映射精确定位，先撤销/清理委托和令牌，再处理应用、权限与成员关联，再清理专用组、操作、账号和组织（组织自叶到根），参数/字典先检查消费引用。审计副本与归档按批准留存规则处理，不删除共享日志。若恢复旧状态/版本，必须用已批准测试重置机制，不能以普通业务编辑接口猜测回滚。原数据库/用户资料不在清理范围。','',
    '本地清理只删除本次 baseline/repeat/scale-10000 输出目录中的 authorization-fixtures.json 与 manifest.json 两个已知文件；确认目录属于本次运行后逐文件删除，不递归清空共享目录。程序不提供任何业务删除命令。','',
    '### 9.6 多对多追溯与待补范围','',row('测试组','US/BR','AC','API/数据约束','独立用例','TD'),row(*(['---']*6))]
for group in range(1,31):
    t=traces[group];items=grouped[group]
    lines.append(row(t[0],criteria[group][1],f'AC-{group:02}',t[3],', '.join(c['id'] for c in items),', '.join(sorted({td for c in items for td in re.findall(r'TD-\d{2}',c['data'])}))))
lines += ['',
    '状态覆盖：TD-08每条迁移均有对应的独立状态用例。没有状态列的组织/组/参数/字典等按第六章N/A处理。性能代表性分布、真实迁移旧库、业务适配与可执行路由尚缺资料，分别由Q-13/Q-16/Q-15阻断；本轮不将通用夹具当作这些缺失资料。成员与委托处理等候选API是否纳入本期仍须关闭原Q，不因增加用例自动扩大功能范围。','',
    '## 十、逐项验收计划与结果','','### 10.1 验收点与放行标准','',
    '逐项复用AC-01—AC-30。每项须执行下列全部独立用例，并核对第二章Given/When/Then及对应状态表；用例有多个明确参数组时，每组分别保留结果。任何必要断言尚待Q或没有证据，都不能将该AC标通过。','',
    row('AC / 验收点','关联需求 / 明确放行标准','验证步骤与TC/TD','所需证据 / 重验范围'),row(*(['---']*4))]
for group in range(1,31):
    ac=criteria[group];items=grouped[group]
    lines.append(row(ac[0]+' / '+ac[2],ac[1]+'；'+ac[5],
        '按9.3逐例准备→操作→核对前后状态及副作用：'+', '.join(c['id'] for c in items)+'；数据 '+', '.join(sorted({td for c in items for td in re.findall(r'TD-\d{2}',c['data'])})),
        '保存脱敏请求/响应、页面或持久快照、适用日志及执行信息；状态项对照第六章，运行项附原始测量/环境。失败修复后重验本AC全部受影响子例与关联BR/API。'))
lines += ['','### 10.2 逐项实际执行记录','',
    '公共执行信息：环境、代码/DDL/策略版本、执行者、时间、实际观察与证据均未提供。本表每行都是未执行业务验收的阻断状态；证据目录仅为计划。','',
    row('AC','状态','阻断Q','实际结果 / 证据','环境/版本/人员/时间'),row(*(['---']*5))]
for group in range(1,31):
    qs=sorted({q for c in grouped[group] for q in re.findall(r'Q-\d{2}',c['q'])})
    lines.append(row(f'AC-{group:02}','阻断','、'.join(qs)+'；尚无业务环境','未执行 / 无','未提供'))
lines += ['','### 10.3 发布放行与重验','',
    '- [ ] 指定Q责任人并关闭影响本次实现的阻断项，留下选择与批准依据。',
    '- [ ] 14项原文范围及新增候选动作经业务确认；静态失败才委托的分支未被暗改。',
    '- [ ] DDL初始化/迁移、非法数据约束、序列及恢复在批准隔离环境有实际证据。',
    '- [ ] 所有适用TC按版本执行；AC逐项记录真实结果及缺陷；未执行项不能勾成通过。',
    '- [ ] 接入业务完成行过滤、单资源写入拒绝、撤权传播、审计与归档恢复端到端验证。',
    '- [ ] 性能/可用性/恢复指标满足Q-13批准目标，由责任角色签署放行。','',
    'Q-02/03/04变化重验组织/静态/范围/委托；Q-05/06/08变化重验认证/令牌/撤权；Q-07变化重验委托；Q-09变化重验审计/归档/故障；Q-10/11/12/16变化重验删除/时间/并发/迁移；Q-15变化重验全部适配和兼容调用方。旧版无业务通过证据可沿用。','',
    '本轮完成的是资料梳理、双格式生成、本地合成夹具生成和文档质量验证；实际工具、时间与证据见《交付验证报告》。文档勾选不是测试执行，数据生成检查也不是授权中心业务验收。','']

body=body[:body.index('## 九、')]+'\n'.join(lines)+'\n'+body[body.index('## 十一、'):]
body=body.replace('| 业务版本 | 0.1.1 |','| 业务版本 | 0.2.0 |')
body=body.replace('prd-writer v3.0（2026-09-12 读取的调整版），标准深度；核对原始资料并重新生成需求方案','prd-writer v3.1（本次实际读取的调整版），revise / full；复核原始资料，展开测试数据、用例与逐项验收')
body=body.replace('[prd-writer v3.0](../skills/prd-writer-v3.0/prd-writer/SKILL.md)','[prd-writer v3.1](../skills/prd-writer-v3.1/prd-writer/SKILL.md)')
body=body.replace('表中八类前缀均在本文使用。','表中九类业务前缀均在本文使用。')
body=body.replace('| TC | 业务测试用例组 | TC-01，顺序两位编号 | 第九章；第十章验收计划 |',
    '| TC | 业务测试组与独立用例 | TC-01为原组；TC-01-001为组内独立用例 | 第九章；第十章逐项验收 |\n| TD | 合成测试数据集 | TD-01，顺序两位编号 | 第九、十章及本地生成器 |')
body=re.sub(r'图表显示说明：[^\n]+',
    '图表显示说明：配套《授权中心.prd.html》已内嵌 Mermaid 11.16.0，六张图在正文原位离线渲染；可展开复制源码、切换适应宽度/原始尺寸，修改或重新导出HTML后按当前源码重绘。状态表始终保留。旧版独立《授权中心.图示.html》仅为历史副本，本版以主HTML为准。',body)
body=body.replace('配套 HTML 为源码展示，未图形渲染。','配套 HTML 原位渲染图形并保留可展开源码。')
needle='|---|---|---|---|---|\n| 0.1.1 |'
replacement='|---|---|---|---|---|\n'+row('0.2.0','2026-09-12','Codex；prd-writer v3.1',f'保留原US/BR/AC/API/DB/TC/Q，新增TD-01—TD-10；将30测试组展开为{len(cases)}条独立用例，逐项列30个AC；生成可复现夹具，主HTML原位渲染6图；业务规则未获批准','无真人签署，待决策')+'\n| 0.1.1 |'
assert needle in body;body=body.replace(needle,replacement,1)
body=body.rstrip()+'\n'
now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
state={**old,'version':'0.2.0','revision':2,'updatedAt':now,'markdown':body}
expected={'PRD.md':'0afb16acf876bfdc70c9eb5927fd037ff336b007dac6b6249a122ac74e5438b3',
          'DDL.md':'63ced17ffedc46d17acb94af1ae7894502020afa5714c2661afef886e94f4e71'}
source_hashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in expected}
assert source_hashes==expected,'原始资料变化，需重新核验，不能沿用旧快照'
document=render_html(state,(SKILL/'assets/offline-shell.html').read_text(encoding='utf-8'))
markdown=encode_markdown(state)
assert read_markdown(markdown)==extract_html_state(document)==state
for name,text in [('授权中心.prd.md',markdown),('授权中心.prd.html',document)]:
    (ROOT/name).write_text(text,encoding='utf-8',newline='\n')
(Path(__file__).parent/'test-cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
manifest={'docId':state['docId'],'version':state['version'],'revision':2,'generatedAt':now,
    'sources':source_hashes,'baseline':str(BASELINE.relative_to(ROOT)),
    'skill':str(SKILL.relative_to(ROOT.parent)),'skillSha256':hashlib.sha256((SKILL/'SKILL.md').read_bytes()).hexdigest(),
    'testGroups':30,'testCases':len(cases),'acceptancePoints':30,'datasets':10,
    'files':{name:{'bytes':(ROOT/name).stat().st_size,'sha256':hashlib.sha256((ROOT/name).read_bytes()).hexdigest()} for name in ['授权中心.prd.md','授权中心.prd.html']},
    'validation':'同快照构建；具体静态/浏览器验证见交付验证报告；业务测试和验收未执行'}
(ROOT/'授权中心.manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'cases':len(cases),'groups':len(grouped),'bytes':len(body.encode('utf-8'))},ensure_ascii=False))
