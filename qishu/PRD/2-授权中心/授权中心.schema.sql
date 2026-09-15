-- 授权中心0.4.2新库建表草案；依据用户在Q-01—Q-23及补充表的反馈。
-- 用户指定：Spring Boot 4.1.X、MyBatis、Docker单实例PostgreSQL 18.6；版本安装与SQL执行未验证。
-- 表前缀按反馈Markdown转义后的字面值qs__auth__使用。
-- 仅供独立新库验证，无存量迁移；在调用方批准的专用schema/search_path执行。
-- 所有时间存北京时间秒精度；密码与令牌只存散列/摘要。
-- 已确认应用多可见组、删除不级联、换发撤销旧token；操作码分隔和日志分区细节仍见第十二章。
-- 不含初始化账号、秘密、数据删除任务或生产执行命令。

CREATE TABLE qs__auth__account (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    password VARCHAR(128),
    phone VARCHAR(20) UNIQUE,
    email VARCHAR(128) UNIQUE,
    logo VARCHAR(512),
    remark VARCHAR(512),
    account_type VARCHAR(16) NOT NULL DEFAULT 'person',
    status VARCHAR(16) NOT NULL DEFAULT 'normal',
    ip_whitelist JSONB DEFAULT '[]',
    last_login_at TIMESTAMP(0),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (account_type IN ('person','service')),
    CHECK (status IN ('normal','frozen')),
    CHECK ((account_type = 'person' AND password IS NOT NULL) OR (account_type = 'service' AND password IS NULL)),
    CHECK (account_type <> 'service' OR (ip_whitelist IS NOT NULL AND jsonb_typeof(ip_whitelist) = 'array' AND ip_whitelist <> '[]'::jsonb)),
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__account IS '账号；目标设计草案';
COMMENT ON COLUMN qs__auth__account.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__account.uuid IS '唯一标识符，全局唯一';
COMMENT ON COLUMN qs__auth__account.username IS '用户名，全局唯一';
COMMENT ON COLUMN qs__auth__account.password IS '密码散列，仅自然人账号适用；服务账号不得密码登录';
COMMENT ON COLUMN qs__auth__account.phone IS '手机号，全局唯一';
COMMENT ON COLUMN qs__auth__account.email IS '邮箱，全局唯一';
COMMENT ON COLUMN qs__auth__account.logo IS '头像URL';
COMMENT ON COLUMN qs__auth__account.remark IS '备注';
COMMENT ON COLUMN qs__auth__account.account_type IS 'person:自然人, service:服务账号';
COMMENT ON COLUMN qs__auth__account.status IS 'normal:正常, frozen:冻结';
COMMENT ON COLUMN qs__auth__account.ip_whitelist IS '服务账号IP白名单，JSON数组格式: ["192.168.1.1", "10.0.0.0/24"]';
COMMENT ON COLUMN qs__auth__account.last_login_at IS '最后登录时间';
COMMENT ON COLUMN qs__auth__account.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__account.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__account.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__account.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__account.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';
COMMENT ON COLUMN qs__auth__account.must_change_password IS '首次登录须修改密码；修改成功前不开放普通业务权限';

CREATE TABLE qs__auth__organization (
    id BIGSERIAL PRIMARY KEY,
    parent_id BIGINT DEFAULT 0 NOT NULL,
    org_path VARCHAR(512) NOT NULL,
    org_name VARCHAR(128) NOT NULL,
    org_type VARCHAR(32) NOT NULL,
    leader VARCHAR(64),
    sort_order INT DEFAULT 0,
    remark VARCHAR(512),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (version >= 1)
 );
COMMENT ON COLUMN qs__auth__account.is_super_admin IS '内置超级管理员标识；初始化专用，不参与权限组，不可删除或改身份';

COMMENT ON TABLE qs__auth__organization IS '组织结构；目标设计草案';
COMMENT ON COLUMN qs__auth__organization.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__organization.parent_id IS '父组织标识，0为根；树关系不自动增加权限组继承';
COMMENT ON COLUMN qs__auth__organization.org_path IS '物化路径，用于快速查询所有子节点，如 /1/23/456';
COMMENT ON COLUMN qs__auth__organization.org_name IS '组织名称';
COMMENT ON COLUMN qs__auth__organization.org_type IS 'company:单位, plant:厂区, department:部门, post:岗位, team:班组；类型编码待Q-02';
COMMENT ON COLUMN qs__auth__organization.leader IS '负责人姓名';
COMMENT ON COLUMN qs__auth__organization.sort_order IS '排序顺序，默认0';
COMMENT ON COLUMN qs__auth__organization.remark IS '备注';
COMMENT ON COLUMN qs__auth__organization.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__organization.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__organization.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__organization.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__organization.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__account_organization (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL,
    org_id BIGINT NOT NULL,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (account_id, org_id),
    FOREIGN KEY (account_id) REFERENCES qs__auth__account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (org_id) REFERENCES qs__auth__organization(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__account_organization IS '账号与组织关联；目标设计草案';
COMMENT ON COLUMN qs__auth__account_organization.id IS 'id；含义见字段表';
COMMENT ON COLUMN qs__auth__account_organization.account_id IS '账号标识；审计中允许未知身份，其他关系必须引用真实账号';
COMMENT ON COLUMN qs__auth__account_organization.org_id IS '组织标识；成员可以关联多个组织，不设主部门';
COMMENT ON COLUMN qs__auth__account_organization.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__account_organization.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__account_organization.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__account_organization.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__account_organization.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__user_group (
    id BIGSERIAL PRIMARY KEY,
    group_code VARCHAR(64) NOT NULL UNIQUE,
    group_name VARCHAR(128) NOT NULL,
    description VARCHAR(512),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__user_group IS '用户组；目标设计草案';
COMMENT ON COLUMN qs__auth__user_group.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__user_group.group_code IS '用户组编码，全局唯一';
COMMENT ON COLUMN qs__auth__user_group.group_name IS '用户组名称';
COMMENT ON COLUMN qs__auth__user_group.description IS '用户组描述';
COMMENT ON COLUMN qs__auth__user_group.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__user_group.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__user_group.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__user_group.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__user_group.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__user_group_account (
    id BIGSERIAL PRIMARY KEY,
    user_group_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (user_group_id, account_id),
    FOREIGN KEY (account_id) REFERENCES qs__auth__account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (user_group_id) REFERENCES qs__auth__user_group(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__user_group_account IS '用户组成员；目标设计草案';
COMMENT ON COLUMN qs__auth__user_group_account.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__user_group_account.user_group_id IS '用户组ID，关联用户组表，级联删除';
COMMENT ON COLUMN qs__auth__user_group_account.account_id IS '账号标识；审计中允许未知身份，其他关系必须引用真实账号';
COMMENT ON COLUMN qs__auth__user_group_account.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__user_group_account.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__user_group_account.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__user_group_account.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__user_group_account.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__sys_param (
    id BIGSERIAL PRIMARY KEY,
    param_code VARCHAR(64) NOT NULL UNIQUE,
    param_value TEXT NOT NULL,
    description VARCHAR(512),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (btrim(param_value) <> ''),
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__sys_param IS '授权中心参数；目标设计草案';
COMMENT ON COLUMN qs__auth__sys_param.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__sys_param.param_code IS '参数编码，全局唯一';
COMMENT ON COLUMN qs__auth__sys_param.param_value IS '参数值';
COMMENT ON COLUMN qs__auth__sys_param.description IS '参数描述';
COMMENT ON COLUMN qs__auth__sys_param.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__sys_param.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__sys_param.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__sys_param.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__sys_param.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__sys_dict (
    id BIGSERIAL PRIMARY KEY,
    dict_code VARCHAR(64) NOT NULL UNIQUE,
    dict_items JSONB NOT NULL,
    description VARCHAR(512),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (jsonb_typeof(dict_items) = 'array'),
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__sys_dict IS '授权中心字典；目标设计草案';
COMMENT ON COLUMN qs__auth__sys_dict.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__sys_dict.dict_code IS '字典编码，全局唯一';
COMMENT ON COLUMN qs__auth__sys_dict.dict_items IS '字典项JSON数组，如 ["启用","禁用","待审核"]';
COMMENT ON COLUMN qs__auth__sys_dict.description IS '字典描述';
COMMENT ON COLUMN qs__auth__sys_dict.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__sys_dict.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__sys_dict.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__sys_dict.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__sys_dict.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__permission_group (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description VARCHAR(512),
    operation_ids JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (jsonb_typeof(operation_ids) = 'array'),
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__permission_group IS '权限组；目标设计草案';
COMMENT ON COLUMN qs__auth__permission_group.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__permission_group.name IS '权限组名称';
COMMENT ON COLUMN qs__auth__permission_group.description IS '权限组描述';
COMMENT ON COLUMN qs__auth__permission_group.operation_ids IS '操作ID JSON数组，如 [1,2,3]';
COMMENT ON COLUMN qs__auth__permission_group.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__permission_group.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__permission_group.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__permission_group.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__permission_group.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__app_authorization (
    id BIGSERIAL PRIMARY KEY,
    app_code VARCHAR(64) NOT NULL UNIQUE,
    app_key VARCHAR(64) NOT NULL UNIQUE,
    app_secret VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    secret_expire_at TIMESTAMP(0),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (status IN ('active','frozen','offline')),
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__app_authorization IS '应用可见范围授权；目标设计草案';
COMMENT ON COLUMN qs__auth__app_authorization.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__app_authorization.app_code IS '应用编码；操作表中表示操作所属应用';
COMMENT ON COLUMN qs__auth__app_authorization.app_key IS '应用密钥，唯一标识应用';
COMMENT ON COLUMN qs__auth__app_authorization.app_secret IS '加密存储';
COMMENT ON COLUMN qs__auth__app_authorization.status IS 'active:生效, frozen:冻结, offline:下线；仅接受应用中心受控同步';
COMMENT ON COLUMN qs__auth__app_authorization.secret_expire_at IS 'AppSecret 过期时间';
COMMENT ON COLUMN qs__auth__app_authorization.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__app_authorization.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__app_authorization.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__app_authorization.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__app_authorization.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__app_permission_group (
    id BIGSERIAL PRIMARY KEY,
    app_authorization_id BIGINT NOT NULL,
    permission_group_id BIGINT NOT NULL,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (app_authorization_id, permission_group_id),
    FOREIGN KEY (app_authorization_id) REFERENCES qs__auth__app_authorization(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (permission_group_id) REFERENCES qs__auth__permission_group(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__app_permission_group IS '应用与可见权限组关联；命中任一组可见，功能权限另算';
COMMENT ON COLUMN qs__auth__app_permission_group.id IS '关联主键';
COMMENT ON COLUMN qs__auth__app_permission_group.app_authorization_id IS '应用授权记录标识';
COMMENT ON COLUMN qs__auth__app_permission_group.permission_group_id IS '应用可见权限组标识';
COMMENT ON COLUMN qs__auth__app_permission_group.created_at IS '创建时间，北京时间秒精度';
COMMENT ON COLUMN qs__auth__app_permission_group.updated_at IS '更新时间，由数据库维护';
COMMENT ON COLUMN qs__auth__app_permission_group.created_by IS '创建人，由可信身份提供';
COMMENT ON COLUMN qs__auth__app_permission_group.updated_by IS '修改人，由可信身份提供';
COMMENT ON COLUMN qs__auth__app_permission_group.version IS '版本，编辑时比较并递增';

CREATE TABLE qs__auth__operation (
    app_code VARCHAR(64) NOT NULL,
    id BIGSERIAL PRIMARY KEY,
    operation_code VARCHAR(128) NOT NULL UNIQUE,
    operation_name VARCHAR(128) NOT NULL,
    operation_desc VARCHAR(512),
    resource_type VARCHAR(64),
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK (left(operation_code, length(app_code) + 1) = app_code || '.'),
    FOREIGN KEY (app_code) REFERENCES qs__auth__app_authorization(app_code) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__operation IS '应用功能操作；目标设计草案';
COMMENT ON COLUMN qs__auth__operation.app_code IS '应用编码；操作表中表示操作所属应用';
COMMENT ON COLUMN qs__auth__operation.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__operation.operation_code IS '全平台唯一操作码，必须以所属应用code开头；点号分隔为草案约定';
COMMENT ON COLUMN qs__auth__operation.operation_name IS '操作名称，如 deleteDevice';
COMMENT ON COLUMN qs__auth__operation.operation_desc IS '操作描述，如 删除设备';
COMMENT ON COLUMN qs__auth__operation.resource_type IS '可选业务事件类型；不参与授权中心行级数据权限计算';
COMMENT ON COLUMN qs__auth__operation.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__operation.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__operation.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__operation.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__operation.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__permission_group_account (
    id BIGSERIAL PRIMARY KEY,
    permission_group_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (permission_group_id, account_id),
    FOREIGN KEY (account_id) REFERENCES qs__auth__account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (permission_group_id) REFERENCES qs__auth__permission_group(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__permission_group_account IS '用户权限组关联；目标设计草案';
COMMENT ON COLUMN qs__auth__permission_group_account.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__permission_group_account.permission_group_id IS '权限组标识；应用授权用于可见范围，用户和组织关联用于取得权限组';
COMMENT ON COLUMN qs__auth__permission_group_account.account_id IS '账号标识；审计中允许未知身份，其他关系必须引用真实账号';
COMMENT ON COLUMN qs__auth__permission_group_account.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__permission_group_account.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__permission_group_account.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__permission_group_account.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__permission_group_org (
    id BIGSERIAL PRIMARY KEY,
    permission_group_id BIGINT NOT NULL,
    org_id BIGINT NOT NULL,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (permission_group_id, org_id),
    FOREIGN KEY (org_id) REFERENCES qs__auth__organization(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (permission_group_id) REFERENCES qs__auth__permission_group(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__permission_group_org IS '组织权限组关联；目标设计草案';
COMMENT ON COLUMN qs__auth__permission_group_org.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__permission_group_org.permission_group_id IS '权限组标识；应用授权用于可见范围，用户和组织关联用于取得权限组';
COMMENT ON COLUMN qs__auth__permission_group_org.org_id IS '组织标识；成员可以关联多个组织，不设主部门';
COMMENT ON COLUMN qs__auth__permission_group_org.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__permission_group_org.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__permission_group_org.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__permission_group_org.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';

CREATE TABLE qs__auth__token (
    id BIGSERIAL PRIMARY KEY,
    token_digest TEXT NOT NULL UNIQUE,
    account_id BIGINT NOT NULL,
    token_type VARCHAR(16) NOT NULL,
    refresh_type VARCHAR(16) NOT NULL,
    expires_at TIMESTAMP(0) NOT NULL,
    scene_id VARCHAR(64),
    client_ip VARCHAR(64),
    user_agent VARCHAR(256),
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    created_by BIGINT,
    updated_by BIGINT,
    version BIGINT NOT NULL DEFAULT 1,
    session_id UUID NOT NULL,
    CHECK (token_type IN ('Master-Token','Scene-Token')),
    CHECK (refresh_type IN ('access_token','refresh_token')),
    CHECK (expires_at > created_at),
    CHECK (btrim(token_digest) <> ''),
    FOREIGN KEY (account_id) REFERENCES qs__auth__account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (version >= 1)
 );
COMMENT ON TABLE qs__auth__token IS '登录令牌摘要；目标设计草案';
COMMENT ON COLUMN qs__auth__token.id IS '主键，自增';
COMMENT ON COLUMN qs__auth__token.token_digest IS '令牌核验摘要；不得持久化完整令牌；明文仅在签发或换发成功响应返回，摘要算法待Q-06';
COMMENT ON COLUMN qs__auth__token.account_id IS '账号标识；审计中允许未知身份，其他关系必须引用真实账号';
COMMENT ON COLUMN qs__auth__token.token_type IS 'Master-Token或Scene-Token；场景细则待Q-06';
COMMENT ON COLUMN qs__auth__token.refresh_type IS 'access_token或refresh_token；刷新协议待Q-06';
COMMENT ON COLUMN qs__auth__token.expires_at IS '到期时间，北京时间秒精度，签发后30天；续期新建token记录并撤销旧记录';
COMMENT ON COLUMN qs__auth__token.scene_id IS 'Scene-Token绑定的场景ID，如音视频会话ID、WebSocket连接ID';
COMMENT ON COLUMN qs__auth__token.client_ip IS '客户端IP';
COMMENT ON COLUMN qs__auth__token.user_agent IS '用户代理';
COMMENT ON COLUMN qs__auth__token.revoked IS '是否已撤销，默认false';
COMMENT ON COLUMN qs__auth__token.created_at IS '创建时间，北京时间，精确到秒';
COMMENT ON COLUMN qs__auth__token.updated_at IS '更新时间，北京时间，数据库更新触发器维护，精确到秒';
COMMENT ON COLUMN qs__auth__token.created_by IS '创建账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__token.updated_by IS '更新账号标识，由可信服务上下文提供';
COMMENT ON COLUMN qs__auth__token.version IS '编辑版本；保存时比较读取版本，成功后由数据库增加1';
COMMENT ON COLUMN qs__auth__token.session_id IS '登录实例标识；换发沿用当前实例，退出只撤销当前实例，改密撤销账号全部实例';

CREATE TABLE qs__auth__audit_log (
    id BIGSERIAL NOT NULL,
    trace_id UUID NOT NULL,
    account_id BIGINT,
    app_code VARCHAR(64),
    operation_code VARCHAR(128),
    resource_id VARCHAR(128),
    resource_type VARCHAR(64),
    request_ip VARCHAR(64),
    user_agent VARCHAR(512),
    result VARCHAR(16) NOT NULL,
    reason VARCHAR(512),
    log_level VARCHAR(16) NOT NULL DEFAULT 'info',
    request_body TEXT,
    response_body TEXT,
    cost_ms INT,
    created_at TIMESTAMP(0) NOT NULL DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    PRIMARY KEY (id, created_at),
    CHECK (result IN ('success','failure','denied')),
    CHECK (cost_ms IS NULL OR cost_ms >= 0)
 ) PARTITION BY RANGE (created_at);
COMMENT ON TABLE qs__auth__audit_log IS '授权中心审计日志；目标设计草案';
COMMENT ON COLUMN qs__auth__audit_log.id IS '序列生成标识；与created_at共同组成分区主键，单列无唯一约束，';
COMMENT ON COLUMN qs__auth__audit_log.trace_id IS '全链路追踪ID';
COMMENT ON COLUMN qs__auth__audit_log.account_id IS '账号标识；审计中允许未知身份，其他关系必须引用真实账号';
COMMENT ON COLUMN qs__auth__audit_log.app_code IS '应用编码；操作表中表示操作所属应用';
COMMENT ON COLUMN qs__auth__audit_log.operation_code IS '全平台唯一操作码，必须以所属应用code开头；点号分隔为草案约定';
COMMENT ON COLUMN qs__auth__audit_log.resource_id IS '可选事件对象标识；不作为授权中心数据范围判据';
COMMENT ON COLUMN qs__auth__audit_log.resource_type IS '可选业务事件类型；不参与授权中心行级数据权限计算';
COMMENT ON COLUMN qs__auth__audit_log.request_ip IS '请求IP';
COMMENT ON COLUMN qs__auth__audit_log.user_agent IS '用户代理';
COMMENT ON COLUMN qs__auth__audit_log.result IS 'success:成功, failure:业务失败, denied:权限拒绝';
COMMENT ON COLUMN qs__auth__audit_log.reason IS '授权中心事件原因，不含秘密或令牌';
COMMENT ON COLUMN qs__auth__audit_log.log_level IS 'info / warn / error';
COMMENT ON COLUMN qs__auth__audit_log.request_body IS '请求体（脱敏后）';
COMMENT ON COLUMN qs__auth__audit_log.response_body IS '响应体（脱敏后）';
COMMENT ON COLUMN qs__auth__audit_log.cost_ms IS '接口耗时';
COMMENT ON COLUMN qs__auth__audit_log.created_at IS '创建时间，北京时间，精确到秒';

CREATE INDEX qs__auth__account_organization_org_id_idx ON qs__auth__account_organization(org_id);
CREATE INDEX qs__auth__user_group_account_account_id_idx ON qs__auth__user_group_account(account_id);
CREATE INDEX qs__auth__app_permission_group_permission_group_id_idx ON qs__auth__app_permission_group(permission_group_id);
CREATE INDEX qs__auth__operation_app_code_idx ON qs__auth__operation(app_code);
CREATE INDEX qs__auth__permission_group_account_account_id_idx ON qs__auth__permission_group_account(account_id);
CREATE INDEX qs__auth__permission_group_org_org_id_idx ON qs__auth__permission_group_org(org_id);
CREATE INDEX qs__auth__token_account_id_idx ON qs__auth__token(account_id);
CREATE INDEX qs__auth__organization_parent_id_idx ON qs__auth__organization(parent_id);
CREATE INDEX qs__auth__audit_log_created_at_idx ON qs__auth__audit_log(created_at);
CREATE INDEX qs__auth__audit_log_trace_id_idx ON qs__auth__audit_log(trace_id);
CREATE INDEX qs__auth__audit_log_account_id_idx ON qs__auth__audit_log(account_id);
CREATE INDEX qs__auth__audit_log_app_code_idx ON qs__auth__audit_log(app_code);
CREATE INDEX qs__auth__token_expires_at_idx ON qs__auth__token(expires_at);
CREATE INDEX qs__auth__token_session_id_idx ON qs__auth__token(session_id);

CREATE TABLE qs__auth__audit_log_default PARTITION OF qs__auth__audit_log DEFAULT;
COMMENT ON TABLE qs__auth__audit_log_default IS '默认审计分区；超过90天自动物理删除；清理调度待Q-09';
COMMENT ON COLUMN qs__auth__audit_log_default.id IS '同审计主表id';
COMMENT ON COLUMN qs__auth__audit_log_default.trace_id IS '同审计主表trace_id';
COMMENT ON COLUMN qs__auth__audit_log_default.account_id IS '同审计主表account_id';
COMMENT ON COLUMN qs__auth__audit_log_default.app_code IS '同审计主表app_code';
COMMENT ON COLUMN qs__auth__audit_log_default.operation_code IS '同审计主表operation_code';
COMMENT ON COLUMN qs__auth__audit_log_default.resource_id IS '同审计主表resource_id';
COMMENT ON COLUMN qs__auth__audit_log_default.resource_type IS '同审计主表resource_type';
COMMENT ON COLUMN qs__auth__audit_log_default.request_ip IS '同审计主表request_ip';
COMMENT ON COLUMN qs__auth__audit_log_default.user_agent IS '同审计主表user_agent';
COMMENT ON COLUMN qs__auth__audit_log_default.result IS '同审计主表result';
COMMENT ON COLUMN qs__auth__audit_log_default.reason IS '同审计主表reason';
COMMENT ON COLUMN qs__auth__audit_log_default.log_level IS '同审计主表log_level';
COMMENT ON COLUMN qs__auth__audit_log_default.request_body IS '同审计主表request_body';
COMMENT ON COLUMN qs__auth__audit_log_default.response_body IS '同审计主表response_body';
COMMENT ON COLUMN qs__auth__audit_log_default.cost_ms IS '同审计主表cost_ms';
COMMENT ON COLUMN qs__auth__audit_log_default.created_at IS '同审计主表created_at';

CREATE FUNCTION qs__auth__maintain_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai');
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qs__auth__maintain_update() IS '维护北京时间秒精度更新时间并增加版本；调用方仍需在UPDATE条件中比较version';
CREATE TRIGGER qs__auth__account_update BEFORE UPDATE ON qs__auth__account FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__organization_update BEFORE UPDATE ON qs__auth__organization FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__account_organization_update BEFORE UPDATE ON qs__auth__account_organization FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__user_group_update BEFORE UPDATE ON qs__auth__user_group FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__user_group_account_update BEFORE UPDATE ON qs__auth__user_group_account FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__sys_param_update BEFORE UPDATE ON qs__auth__sys_param FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__sys_dict_update BEFORE UPDATE ON qs__auth__sys_dict FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__permission_group_update BEFORE UPDATE ON qs__auth__permission_group FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__app_authorization_update BEFORE UPDATE ON qs__auth__app_authorization FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__operation_update BEFORE UPDATE ON qs__auth__operation FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__permission_group_account_update BEFORE UPDATE ON qs__auth__permission_group_account FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__permission_group_org_update BEFORE UPDATE ON qs__auth__permission_group_org FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
CREATE TRIGGER qs__auth__token_update BEFORE UPDATE ON qs__auth__token FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();

-- 内置超级管理员最多一名；必须由受控初始化建立，不能用普通账号编辑接口设置。
CREATE UNIQUE INDEX qs__auth__account_super_admin_idx ON qs__auth__account(is_super_admin) WHERE is_super_admin;
CREATE FUNCTION qs__auth__protect_super_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_super_admin THEN
            RAISE EXCEPTION '内置超级管理员不可删除';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
        RAISE EXCEPTION '超级管理员身份不可通过编辑变更';
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qs__auth__protect_super_admin() IS '拒绝删除超级管理员和修改内置身份；不赋予未认证者权限';
CREATE TRIGGER qs__auth__account_protect BEFORE DELETE OR UPDATE ON qs__auth__account FOR EACH ROW EXECUTE FUNCTION qs__auth__protect_super_admin();

CREATE TRIGGER qs__auth__app_permission_group_update BEFORE UPDATE ON qs__auth__app_permission_group FOR EACH ROW EXECUTE FUNCTION qs__auth__maintain_update();
