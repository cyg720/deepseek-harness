#!/usr/bin/env python3
"""生成授权中心0.4.1合成样例；不连接数据库，不生成可登录凭据。"""
import argparse, hashlib, json, uuid
from pathlib import Path

def generate():
    now='2026-09-12T10:00:00+08:00'
    return {
      'meta': {'synthetic':True,'credentialsUsable':False,'version':'0.4.1','seed':20260912,'namespace':'auth-v040','referenceTime':now},
      'TD-01': {'accounts':[{'id':101,'username':'auth-v040-admin','status':'normal','mustChangePassword':False,'isSuperAdmin':True},{'id':102,'username':'auth-v040-member','status':'normal','mustChangePassword':False},{'id':103,'username':'auth-v040-new','status':'normal','mustChangePassword':True}], 'organizations':[{'id':10,'parentId':0},{'id':11,'parentId':10},{'id':12,'parentId':11},{'id':21,'parentId':10}], 'memberships':[{'accountId':102,'orgId':11},{'accountId':102,'orgId':21}], 'userGroup':{'id':301,'members':[102,103]}, 'operations':[{'id':201,'appCode':'app-a','operationCode':'app-a.DeviceController.list'},{'id':202,'appCode':'app-a','operationCode':'app-a.DeviceController.control'},{'id':203,'appCode':'app-b','operationCode':'app-b.DeviceController.list'}], 'permissionGroups':[{'id':401,'operationIds':[201]},{'id':402,'operationIds':[]},{'id':403,'operationIds':[202]},{'id':404,'operationIds':[203]}], 'accountGroups':[{'accountId':102,'groupId':403}], 'organizationGroups':[{'orgId':11,'groupId':401},{'orgId':12,'groupId':404}], 'apps':[{'appCode':'app-a','visibilityGroupId':401,'status':'active'},{'appCode':'app-b','visibilityGroupId':404,'status':'active'}]},
      'TD-02': {'roles':{'administrator':101,'member':102,'firstLogin':103},'notice':'这些是接口测试上下文，不是数据库种子；管理动作的授权集合需Q-01确认后配置。'},
      'TD-03': {'businessOwnedResources':[{'id':'dev-001','owner':102},{'id':'dev-002','owner':103}],'notice':'仅业务应用行权限对照；授权中心不生成过滤条件。'},
      'TD-04': {'validAppKey':'SYNTHETIC-APP-A-KEY','unknownAppKey':'SYNTHETIC-UNKNOWN','allowedIp':'192.0.2.10','deniedIp':'198.51.100.10','serviceCredentialRef':'fixture:service','notice':'AppKey占位值不可用，真实测试由隔离环境签发；不保存完整token。'},
      'TD-05': {'missing':{},'null':{'paramValue':None},'empty':{'paramValue':''},'spaces':{'paramValue':'   '},'text':{'paramValue':'中文配置'},'number':{'paramValue':'42'},'largeId':'9007199254740993','passwordShort':'Ab1!xyz','passwordValid':'Ab1!xyza','passwordNoDigit':'Abcd!xyz','passwordNoLetter':'1234!567','passwordNoSpecial':'Abcd1234','sqlInput':"x'; DROP TABLE example; --",'unknownGroupId':999999,'oldOperationCode':'DeviceController.list','foreignOperationCode':'app-b.DeviceController.list','readonly':{'createdBy':103},'username64':'u'*64,'username65':'u'*65},
      'TD-06': {'issuedAt':now,'expiresAt':'2026-10-12T10:00:00+08:00','beforeExpiry':'2026-10-12T09:59:59+08:00','atExpiry':'2026-10-12T10:00:00+08:00','afterExpiry':'2026-10-12T10:00:01+08:00','sameInstantUTC':'2026-09-12T02:00:00Z','retentionReference':'2026-12-12T10:00:00+08:00','retentionCutoff':'2026-09-13T10:00:00+08:00','renewAt15Days':'2026-09-27T10:00:00+08:00','renewBelow15Days':'2026-09-27T10:00:01+08:00','renewedExpiresAt':'2026-10-27T10:00:01+08:00'},
      'TD-07': {'readVersion':7,'firstEdit':{'version':7,'description':'甲修改'},'secondEdit':{'version':7,'description':'乙修改'},'duplicateAssociation':{'accountId':102,'orgId':11},'idempotencyKey':'auth-v040-register-a'},
      'TD-08': {'phone':{'sessionId':str(uuid.UUID(int=1)),'tokenDigest':hashlib.sha256(b'SYNTHETIC-PHONE-NOT-TOKEN').hexdigest(),'revoked':False},'computer':{'sessionId':str(uuid.UUID(int=2)),'tokenDigest':hashlib.sha256(b'SYNTHETIC-PC-NOT-TOKEN').hexdigest(),'revoked':False},'notice':'摘要样例仅用于字段测试，不代表批准了SHA-256算法或可签发凭证。'},
      'TD-09': {'faults':['authorization-unavailable','audit-write-failed','registration-partial-failure','cleanup-failed'],'unknownActor':{'accountId':None,'appCode':None,'result':'denied'}},
      'TD-10': {'users':None,'concurrency':None,'latencyTarget':None,'notice':'容量和性能目标未定，不用样例数量代表生产规模。'}
    }

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir',type=Path,required=True)
    args=parser.parse_args()
    data=(json.dumps(generate(),ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    target=args.out_dir/'authorization-fixtures.json'
    if target.exists() and target.read_bytes()!=data:
        parser.error('输出已有不同内容；请选择新的目录。')
    args.out_dir.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
    manifest={'version':'0.4.1','sha256':hashlib.sha256(data).hexdigest(),'synthetic':True,'credentialsUsable':False}
    (args.out_dir/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False))
