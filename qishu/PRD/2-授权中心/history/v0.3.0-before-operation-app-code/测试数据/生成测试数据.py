#!/usr/bin/env python3
"""生成独立的授权中心合成 JSON；不连接数据库、接口或凭据设施。"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import re
import uuid


def generate(seed=20260912, namespace='auth-prd', resource_count=4):
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,19}', namespace):
        raise ValueError('namespace 必须为 1—20 位小写字母、数字、连字符，首位为字母')
    if not 4 <= resource_count <= 100000:
        raise ValueError('resource-count 范围为 4—100000；规模不代表已批准性能目标')
    rng = random.Random(seed)
    reference = '2026-09-12T00:30:00Z'
    start, end = '2026-09-12T00:00:00Z', '2026-09-12T01:00:00Z'
    common = {'created_at': start, 'updated_at': start}
    def uid(label):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f'{namespace}/{seed}/{label}'))
    accounts = [dict(id=n, uuid=uid(f'account/{n}'), username=f'{namespace}-{label}',
                     password='SYNTHETIC-NOT-A-LOGIN-HASH', phone=None, email=None,
                     account_type=kind, status='normal', ip_whitelist=ips, **common)
                for n, label, kind, ips in [(101,'admin','person',[]),(102,'member','person',[]),
                                           (103,'delegate','person',[]),(104,'service','service',['192.0.2.10/32'])]]
    orgs = [dict(id=n,parent_id=parent,org_path=path,org_name=name,org_type=kind,**common)
            for n,parent,path,name,kind in [(10,0,'/10','测试单位A','company'),
                (11,10,'/10/11','同名部门','department'),(12,11,'/10/11/12','测试班组','team'),
                (20,0,'/20','测试单位B','company'),(21,20,'/20/21','同名部门','department')]]
    operations = [dict(id=n,operation_code=code,operation_name=name,resource_type=resource,**common)
                  for n,code,name,resource in [(201,'DeviceController.list','设备列表','device'),
                      (202,'DeviceController.control','设备控制','device'),
                      (203,'DeviceController.detail','设备详情','device'),
                      (204,'AccountController.list','账号列表','account')]]
    groups = [dict(id=401,name='测试静态权限',operation_ids=[201,202,203,204],**common),
              dict(id=402,name='测试空权限',operation_ids=[],**common),
              dict(id=403,name='测试委托权限',operation_ids=[202],**common)]
    apps = [dict(id=n,app_code=f'{namespace}-{name}',permission_group_id=group,
                 app_key=f'fixture-{namespace}-{name}',app_secret='SYNTHETIC-NOT-A-SECRET',
                 data_scope_type=scope,specified_org_ids=specified,status=status,**common)
            for n,name,group,scope,specified,status in [(501,'app-a',401,'SELF',[],'active'),
                (502,'app-b',403,'DEPT',[],'active'),(503,'frozen',401,'SELF',[],'frozen'),
                (504,'specified',401,'SPECIFIED',[21],'active')]]
    tokens = [dict(id=n,token=f'fixture-{namespace}-token-{n}',account_id=102,token_type=kind,
                   refresh_type=refresh,scene_id=scene,expires_at=end,revoked=revoked,**common)
              for n,kind,refresh,scene,revoked in [(701,'Master-Token','access_token',None,False),
                  (702,'Master-Token','refresh_token',None,False),
                  (703,'Scene-Token','access_token','scene-a',False),
                  (704,'Master-Token','access_token',None,True)]]
    delegation = dict(id=601,grantor_id=101,grantee_id=103,permission_group_id=403,
                      resource_type='device',resource_ids=['dev-001'],valid_from=start,
                      valid_until=end,status='active',reason='合成测试',**common)
    tables = {'account':accounts,'organization':orgs,
        'user_group':[dict(id=301,group_code=f'{namespace}-cross',group_name='跨部门测试组',**common)],
        'user_group_account':[dict(id=311,user_group_id=301,account_id=102,created_at=start),
                              dict(id=312,user_group_id=301,account_id=103,created_at=start)],
        'token':tokens,'sys_param':[dict(id=801,param_code=f'{namespace}-param',param_value='demo',**common)],
        'sys_dict':[dict(id=901,dict_code=f'{namespace}-dict',dict_items=['启用','禁用'],**common)],
        'operation':operations,'permission_group':groups,
        'permission_group_account':[dict(id=411,permission_group_id=401,account_id=101,created_at=start)],
        'permission_group_org':[dict(id=421,permission_group_id=401,org_id=11,created_at=start)],
        'app_authorization':apps,'delegation':[delegation],
        'audit_log':[dict(id=1001,trace_id=uid('audit/1001'),account_id=103,
                         app_code=f'{namespace}-app-a',operation_code='DeviceController.control',
                         resource_id='dev-001',resource_type='device',result='denied',
                         log_level='warn',reason='合成拒绝事件',created_at=start)]}
    resources = [dict(id='dev-001',creator_id=102,dept_id=11),
                 dict(id='dev-002',creator_id=103,dept_id=11),
                 dict(id='dev-003',creator_id=103,dept_id=12),
                 dict(id='dev-004',creator_id=103,dept_id=21)]
    for n in range(5,resource_count+1):
        resources.append(dict(id=f'dev-{n:06d}',creator_id=rng.choice([102,103]),dept_id=rng.choice([11,12,21])))
    transitions = {
        'account':[('[*]','创建账号','normal'),('normal','冻结账号','frozen'),('frozen','解冻账号','normal')],
        'app':[('[*]','注册应用','active'),('active','冻结应用','frozen'),('frozen','解冻应用','active')],
        'token':[('[*]','签发成功','valid'),('valid','刷新轮换成功','consumed'),
                 ('valid','到达过期阈值','expired'),('valid','退出或注销或冻结关联处理','revoked'),
                 ('consumed','重放已消费令牌','consumed'),('expired','重复注销或刷新过期令牌','expired'),
                 ('revoked','重复注销或刷新撤销令牌','revoked')],
        'delegation':[('[*]','提交申请','pending'),('pending','批准申请','active'),
                      ('pending','拒绝申请','rejected'),('active','撤销委托','revoked'),
                      ('active','超过有效结束时间','expired'),('pending','过期申请尝试批准','pending'),
                      ('expired','重试或重放终态申请','expired'),('revoked','重试或重放终态申请','revoked'),
                      ('rejected','重试或重放终态申请','rejected')],
        'archive':[('[*]','创建归档任务','queued'),('queued','启动归档','processing'),
                   ('processing','复制与完整性校验通过','verified'),('processing','复制或校验失败','failed'),
                   ('verified','确认可恢复并完成策略处理','completed'),('verified','完成确认失败','failed'),
                   ('failed','核对进度后重试','processing')]}
    return {'meta':{'synthetic':True,'seed':seed,'namespace':namespace,'referenceTime':reference,
                    'resourceCount':resource_count,'credentialsUsable':False,
                    'scope':'表字段样例，不是可直接装载的种子；认证/时区/主键映射需批准适配'},
        'TD-01':{'tables':tables},
        'TD-02':{'memberships':[{'accountId':102,'orgId':11},{'accountId':103,'orgId':21}],
                 'roles':{'administrator':101,'staticUser':102,'delegatedUser':103,'service':104},
                 'delegationApp':{'601':501},'tokenContexts':{'701':'session-a','702':'session-a',
                                                             '703':'session-a/scene-a','704':'session-b'},
                 'notice':'测试上下文，不是原 DDL 的表/列；组织归属、会话及委托应用绑定待 Q-02/Q-06/Q-07'},
        'TD-03':{'resources':resources,'notice':'业务资源模拟，不是授权中心新增业务表'},
        'TD-04':{'appInvalid':'fixture-unknown','appFrozenId':503,'allowedIp':'192.0.2.10',
                 'deniedIp':'198.51.100.10','untrustedForwardedIp':'192.0.2.10',
                 'passwordAttempt':'SYNTHETIC-DO-NOT-LOGIN','credentialRef':'fixture:service-104',
                 'certificateRef':'fixture:certificate-104','wrongScene':'scene-b'},
        'TD-05':{'username64':'u'*64,'username65':'u'*65,'name128':'名'*128,'name129':'名'*129,
                 'text512':'文'*512,'text513':'文'*513,'missing':{},'null':{'remark':None},
                 'empty':{'remark':''},'emptyArray':[],'wrongObject':{},'unknownId':999999,
                 'largeId':'9007199254740993','invalidSort':'id;DROP TABLE account',
                 'readonly':{'createdBy':'103','uuid':'00000000-0000-0000-0000-000000000000'},
                 'unknownOperation':[999999],'unknownScope':'ALL','htmlText':'<img src="https://invalid.example/pixel" onerror="alert(1)">'},
        'TD-06':{'validFrom':start,'validUntil':end,'beforeFrom':'2026-09-11T23:59:59.999Z',
                 'atFrom':start,'atUntil':end,'afterUntil':'2026-09-12T01:00:00.001Z',
                 'sameInstantOffset':'2026-09-12T08:30:00+08:00','pendingExpired':{'status':'pending','now':'2026-09-12T01:00:00.001Z'}},
        'TD-07':{'readVersion':7,'requestA':{'version':7,'operationIds':[201]},
                 'requestB':{'version':7,'operationIds':[202]},'idempotencyKey':f'{namespace}-apply-001',
                 'uniqueAccountPair':{'permissionGroupId':403,'accountId':103},
                 'uniqueOrgPair':{'permissionGroupId':403,'orgId':21},
                 'notice':'版本/幂等键为方案测试元数据；DDL 未定义这些字段'},
        'TD-08':{key:[dict(current=a,event=b,next=c) for a,b,c in rows] for key,rows in transitions.items()},
        'TD-09':{'faults':['permission-source-timeout','cache-unavailable','audit-write-failure',
                          'archive-copy-failure','archive-checksum-mismatch','archive-finalize-failure'],
                 'archiveBatch':f'{namespace}-archive-001','auditTrace':uid('audit/1001'),
                 'sensitiveMarkers':['SYNTHETIC-NOT-A-SECRET','SYNTHETIC-NOT-A-LOGIN-HASH',f'fixture-{namespace}-token-701']},
        'TD-10':{'baselineResourceCount':resource_count,'distribution':{'creators':[102,103],'departments':[11,12,21]},
                 'migrationInput':'DDL.md：保留原始错误，实际修订版/旧库快照另行批准',
                 'ddlFaults':['created_by 后 10 处缺逗号','idx_token_account_id 重名','分区主键不含 created_at'],
                 'performanceApproval':None,'concurrency':None,'p95TargetMs':None,'rto':None,'rpo':None,
                 'notice':'未批准 Q-13/Q-16；夹具数量不证明性能或迁移已通过'}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir',required=True,type=Path)
    parser.add_argument('--seed',type=int,default=20260912)
    parser.add_argument('--namespace',default='auth-prd')
    parser.add_argument('--resource-count',type=int,default=4)
    args=parser.parse_args()
    data=generate(args.seed,args.namespace,args.resource_count)
    raw=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    manifest={'schemaVersion':1,'seed':args.seed,'namespace':args.namespace,'datasets':10,
              'referenceTime':data['meta']['referenceTime'],'resourceCount':args.resource_count,
              'file':'authorization-fixtures.json','sha256':hashlib.sha256(raw).hexdigest(),
              'businessExecution':'未装载数据库；未调用接口；未执行业务验收'}
    outputs={'authorization-fixtures.json':raw,
             'manifest.json':(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf-8')}
    args.out_dir.mkdir(parents=True,exist_ok=True)
    for name,value in outputs.items():
        path=args.out_dir/name
        if path.exists() and path.read_bytes()!=value:
            raise SystemExit('已有内容不同，请使用新隔离目录：'+str(path))
    for name,value in outputs.items():(args.out_dir/name).write_bytes(value)
    print(json.dumps(manifest,ensure_ascii=False))


if __name__=='__main__':
    main()
