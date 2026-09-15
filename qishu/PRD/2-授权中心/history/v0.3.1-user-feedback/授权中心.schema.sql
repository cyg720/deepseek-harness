-- 授权中心完整建表草案 0.3.1；来源DDL.md，原文件不修改。
-- PostgreSQL 12+为输入声明，实际部署版本/schema/search_path/扩展权限待Q-16。
-- 仅供批准隔离空库验证；本轮未执行SQL，不是存量库迁移脚本。
-- 保留原14张业务表、TIMESTAMP、JSONB、0根节点及原外键删除行为。
-- 修复10处缺逗号、重复索引；移除7个被UNIQUE覆盖的重复索引。
-- 候选：audit_log使用(id,created_at)主键，须Q-09/Q-16批准。
-- 不包含默认账号、密码、个人信息或假定ID的初始化INSERT。
-- 组织归属/会话/版本/委托应用关系及业务CHECK仍待决策，未虚构为现有列。
-- 在独立专用schema执行；部署方批准并设置search_path，本脚本不替调用方选择schema。

-- ============================================================
-- 安全生产智能体平台 - 授权中心 数据建模 DDL (PostgreSQL)
-- 版本: v1.0
-- 生成时间: 2026-09-07
-- ============================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. 账号表
-- ============================================================
CREATE TABLE account (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    uuid                UUID DEFAULT uuid_generate_v4() NOT NULL UNIQUE, -- 唯一标识符，全局唯一
    username            VARCHAR(64) NOT NULL UNIQUE,        -- 用户名，全局唯一
    password            VARCHAR(128) NOT NULL,              -- bcrypt 加密
    phone               VARCHAR(20) UNIQUE,                  -- 手机号，全局唯一
    email               VARCHAR(128) UNIQUE,                  -- 邮箱，全局唯一
    logo                VARCHAR(512),                       -- 头像URL
    remark              VARCHAR(512),                        -- 备注
    account_type        VARCHAR(16) NOT NULL DEFAULT 'person', -- person / service
    status              VARCHAR(16) NOT NULL DEFAULT 'normal',  -- normal / frozen
    ip_whitelist        JSONB DEFAULT '[]',                 -- 服务账号IP白名单，JSON数组
    last_login_at       TIMESTAMP,                           -- 最后登录时间
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_account_type ON account(account_type);     -- 账号类型索引，用于快速查询
CREATE INDEX idx_account_status ON account(status);          -- 状态索引，用于快速查询

COMMENT ON TABLE account IS '账号表';
COMMENT ON COLUMN account.account_type IS 'person:自然人, service:服务账号';
COMMENT ON COLUMN account.status IS 'normal:正常, frozen:冻结';
COMMENT ON COLUMN account.ip_whitelist IS '服务账号IP白名单，JSON数组格式: ["192.168.1.1", "10.0.0.0/24"]';


-- ============================================================
-- 2. 组织结构表（树形结构）
-- ============================================================
CREATE TABLE organization (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    parent_id           BIGINT DEFAULT 0 NOT NULL,          -- 0表示根节点
    org_path            VARCHAR(512) NOT NULL,              -- 物化路径，如 /1/23/456
    org_name            VARCHAR(128) NOT NULL,              -- 组织名称
    org_type            VARCHAR(32) NOT NULL,               -- company:单位 / department:部门 / team:班组 / post:岗位
    leader              VARCHAR(64),                        -- 负责人姓名
    sort_order          INT DEFAULT 0,                      -- 排序顺序，默认0
    remark              VARCHAR(512),                        -- 备注
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_organization_parent_id ON organization(parent_id); -- 父节点索引，用于快速查询所有子节点
CREATE INDEX idx_organization_org_path ON organization(org_path);    -- 物化路径索引，用于快速查询所有子节点
CREATE INDEX idx_organization_type ON organization(org_type);      -- 组织类型索引，用于快速查询所有子节点

COMMENT ON TABLE organization IS '组织结构表（树形）';
COMMENT ON COLUMN organization.org_path IS '物化路径，用于快速查询所有子节点，如 /1/23/456';
COMMENT ON COLUMN organization.org_type IS 'company:单位, department:部门, team:班组, post:岗位';


-- ============================================================
-- 3. 用户组表
-- ============================================================
CREATE TABLE user_group (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    group_code          VARCHAR(64) NOT NULL UNIQUE,        -- 用户组编码，全局唯一
    group_name          VARCHAR(128) NOT NULL,              -- 用户组名称
    description         VARCHAR(512),                        -- 用户组描述
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE user_group IS '用户组表（跨部门虚拟小组）';     -- 跨部门虚拟小组，用于组织用户，不实际存储用户信息


-- ============================================================
-- 4. 用户组_用户关联表
-- ============================================================
CREATE TABLE user_group_account (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    user_group_id       BIGINT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 用户组ID，关联用户组表，级联删除
    account_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 账号ID，关联账号表，级联删除
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE UNIQUE INDEX idx_user_group_account_unique ON user_group_account(user_group_id, account_id); -- 用户组-账号组合唯一索引，用于快速查询
CREATE INDEX idx_user_group_account_account_id ON user_group_account(account_id); -- 账号ID索引，用于快速查询

COMMENT ON TABLE user_group_account IS '用户组-用户关联表';


-- ============================================================
-- 5. 令牌管理表
-- ============================================================
CREATE TABLE token (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    token               VARCHAR(512) NOT NULL UNIQUE,       -- JWT Token，全局唯一
    account_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 账号ID，关联账号表，级联删除
    token_type          VARCHAR(16) NOT NULL,               -- Master-Token / Scene-Token
    refresh_type        VARCHAR(16) NOT NULL,               -- access_token / refresh_token
    expires_at          TIMESTAMP NOT NULL,                   -- 过期时间
    scene_id            VARCHAR(64),                        -- Scene-Token 绑定的场景ID（如WebSocket连接ID）
    client_ip           VARCHAR(64),                        -- 客户端IP
    user_agent          VARCHAR(256),                       -- 用户代理
    revoked             BOOLEAN DEFAULT FALSE,                -- 是否已撤销，默认false
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_token_account_id ON token(account_id); -- 账号ID索引，用于快速查询
CREATE INDEX idx_token_expires_at ON token(expires_at); -- 过期时间索引，用于快速查询

COMMENT ON TABLE token IS '令牌管理表';
COMMENT ON COLUMN token.token_type IS 'Master-Token:主令牌, Scene-Token:场景令牌';
COMMENT ON COLUMN token.refresh_type IS 'access_token:访问令牌, refresh_token:刷新令牌';
COMMENT ON COLUMN token.scene_id IS 'Scene-Token绑定的场景ID，如音视频会话ID、WebSocket连接ID';


-- ============================================================
-- 6. 参数管理表
-- ============================================================
CREATE TABLE sys_param (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    param_code          VARCHAR(64) NOT NULL UNIQUE,        -- 参数编码，全局唯一
    param_value         TEXT NOT NULL,                      -- 参数值
    description         VARCHAR(512),                        -- 参数描述
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE sys_param IS '系统参数管理表';


-- ============================================================
-- 7. 字典管理表
-- ============================================================
CREATE TABLE sys_dict (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    dict_code           VARCHAR(64) NOT NULL UNIQUE,        -- 字典编码，全局唯一
    dict_items          JSONB NOT NULL,                      -- JSON数组，如 ["item1","item2","item3"]
    description         VARCHAR(512),                        -- 字典描述
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE sys_dict IS '系统字典管理表';
COMMENT ON COLUMN sys_dict.dict_items IS '字典项JSON数组，如 ["启用","禁用","待审核"]';


-- ============================================================
-- 8. 操作管理表
-- ============================================================
CREATE TABLE operation (
    app_code            VARCHAR(64) NOT NULL,              -- 应用编码，标识该操作按钮所属应用；同应用可有多个操作
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    operation_code      VARCHAR(128) NOT NULL UNIQUE,       -- 控制器名+方法名，如 DeviceController.delete
    operation_name      VARCHAR(128) NOT NULL,               -- 操作名称
    operation_desc      VARCHAR(512),                        -- 操作描述
    resource_type       VARCHAR(64),                        -- 所属资源类型，如 device / alarm / report
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_operation_resource_type ON operation(resource_type); -- 资源类型索引，用于快速查询

COMMENT ON TABLE operation IS '操作管理表（权限操作码字典）';
COMMENT ON COLUMN operation.operation_code IS '操作编码，格式：控制器名称+方法名，如 DeviceController.delete';
COMMENT ON COLUMN operation.operation_name IS '操作名称，如 deleteDevice';
COMMENT ON COLUMN operation.operation_desc IS '操作描述，如 删除设备';
COMMENT ON COLUMN operation.resource_type IS '所属资源类型，如 device / alarm / report';


-- ============================================================
-- 9. 权限组表
-- ============================================================
CREATE TABLE permission_group (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    name                VARCHAR(128) NOT NULL,               -- 权限组名称
    description         VARCHAR(512),                        -- 权限组描述
    operation_ids       JSONB NOT NULL DEFAULT '[]',        -- 操作ID JSON数组，如 [1,2,3]
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE permission_group IS '权限组表（权限操作码字典）';
COMMENT ON COLUMN permission_group.operation_ids IS '操作ID JSON数组，如 [1,2,3]';


-- ============================================================
-- 10. 权限组_用户关联表
-- ============================================================
CREATE TABLE permission_group_account (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 权限组ID，关联权限组表
    account_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 用户ID，关联用户表
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    created_by          BIGINT                             -- 创建人ID
);

CREATE UNIQUE INDEX idx_perm_group_account_unique ON permission_group_account(permission_group_id, account_id); -- 权限组-用户关联表，唯一索引，防止重复关联
CREATE INDEX idx_perm_group_account_account_id ON permission_group_account(account_id); -- 用户ID索引，用于快速查询

COMMENT ON TABLE permission_group_account IS '权限组-用户关联表（权限操作码字典）';


-- ============================================================
-- 11. 权限组_组织关联表
-- ============================================================
CREATE TABLE permission_group_org (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 权限组ID，关联权限组表
    org_id              BIGINT NOT NULL REFERENCES organization(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 组织ID，关联组织表
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    created_by          BIGINT                             -- 创建人ID
);

CREATE UNIQUE INDEX idx_perm_group_org_unique ON permission_group_org(permission_group_id, org_id); -- 权限组-组织关联表，唯一索引，防止重复关联
CREATE INDEX idx_perm_group_org_org_id ON permission_group_org(org_id); -- 组织ID索引，用于快速查询

COMMENT ON TABLE permission_group_org IS '权限组-组织关联表（组织下所有用户自动继承权限）';


-- ============================================================
-- 12. 应用授权表
-- ============================================================
CREATE TABLE app_authorization (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    app_code            VARCHAR(64) NOT NULL UNIQUE,          -- 应用编码，唯一标识应用
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE CASCADE ON UPDATE NO ACTION, -- 权限组ID，关联权限组表
    app_key             VARCHAR(64) NOT NULL UNIQUE,          -- 应用密钥，唯一标识应用
    app_secret          VARCHAR(128) NOT NULL,              -- 加密存储
    data_scope_type     VARCHAR(16) NOT NULL DEFAULT 'SELF', -- SELF / DEPT / SPECIFIED
    specified_org_ids   JSONB DEFAULT '[]',                 -- data_scope_type=SPECIFIED 时必填
    status              VARCHAR(16) NOT NULL DEFAULT 'active', -- active / frozen
    secret_expire_at    TIMESTAMP,                          -- AppSecret 过期时间
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_app_auth_status ON app_authorization(status); -- 状态索引，用于快速查询
CREATE INDEX idx_app_auth_permission_group_id ON app_authorization(permission_group_id); -- 权限组ID索引，用于快速查询

COMMENT ON TABLE app_authorization IS '应用授权表';
COMMENT ON COLUMN app_authorization.data_scope_type IS 'SELF:本人数据, DEPT:部门范围；是否含下级待Q-02, SPECIFIED:指定部门';
COMMENT ON COLUMN app_authorization.specified_org_ids IS '指定部门时存储组织ID列表，JSON数组格式如 [1,2,3]';
COMMENT ON COLUMN app_authorization.status IS 'active:生效, frozen:冻结';


-- ============================================================
-- 13. 委托授权表
-- ============================================================
CREATE TABLE delegation (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    grantor_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE NO ACTION ON UPDATE NO ACTION, -- 授权人（管理员）
    grantee_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE NO ACTION ON UPDATE NO ACTION, -- 被授权人（实际执行人）
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    resource_type       VARCHAR(64) NOT NULL,                -- 资源类型，如 device / alarm
    resource_ids        JSONB NOT NULL,                      -- 资源ID列表，如 ["1","2","3"]
    valid_from          TIMESTAMP NOT NULL,                  -- 有效开始时间
    valid_until         TIMESTAMP NOT NULL,                  -- 有效结束时间
    status              VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending / active / expired / revoked
    reason              VARCHAR(512),                        -- 拒绝原因或错误信息
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_delegation_grantee_id ON delegation(grantee_id); -- 被授权人ID索引，用于快速查询
CREATE INDEX idx_delegation_permission_group_id ON delegation(permission_group_id); -- 权限组ID索引，用于快速查询
CREATE INDEX idx_delegation_status ON delegation(status); -- 状态索引，用于快速查询
CREATE INDEX idx_delegation_valid_range ON delegation(valid_from, valid_until); -- 有效时间范围索引，用于快速查询

COMMENT ON TABLE delegation IS '委托授权表（动态临时授权）';
COMMENT ON COLUMN delegation.status IS 'pending:待审批, active:生效中, expired:已过期, revoked:已撤销';
COMMENT ON COLUMN delegation.resource_ids IS '资源ID列表JSON数组，如 ["device_001", "device_002"]';


-- ============================================================
-- 14. 日志中心表（按月分区建议）
-- ============================================================
CREATE TABLE audit_log (
    id                  BIGSERIAL NOT NULL,              -- 主键，自增
    trace_id            UUID NOT NULL,                       -- 全链路追踪ID
    account_id          BIGINT NOT NULL,                     -- 实际操作人（非委托授权人）
    app_code            VARCHAR(64) NOT NULL,                -- 应用编码
    operation_code      VARCHAR(128) NOT NULL,               -- 操作编码
    resource_id         VARCHAR(128),                       -- 操作的目标资源ID
    resource_type       VARCHAR(64) NOT NULL,                -- 资源类型，如 device / alarm
    request_ip          VARCHAR(64),                        -- 请求IP
    user_agent          VARCHAR(512),                       -- 用户代理
    result              VARCHAR(16) NOT NULL,               -- success / failure / denied
    reason              VARCHAR(512),                       -- 拒绝原因或错误信息
    log_level           VARCHAR(16) NOT NULL DEFAULT 'info', -- info / warn / error
    request_body        TEXT,                               -- 请求体（脱敏后）
    response_body       TEXT,                               -- 响应体（脱敏后）
    cost_ms             INT,                                -- 接口耗时
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_audit_log PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 创建默认分区（请根据实际需要按月创建）
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT; -- 默认分区，所有数据都存储在默认分区中

-- 创建分区示例（以月为单位，需定期维护）
-- CREATE TABLE audit_log_2026_09 PARTITION OF audit_log
--     FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE INDEX idx_audit_log_trace_id ON audit_log(trace_id); -- 全链路追踪ID索引，用于快速查询
CREATE INDEX idx_audit_log_account_id ON audit_log(account_id); -- 实际操作人索引，用于快速查询
CREATE INDEX idx_audit_log_app_code ON audit_log(app_code); -- 应用编码索引，用于快速查询
CREATE INDEX idx_audit_log_operation_code ON audit_log(operation_code); -- 操作编码索引，用于快速查询
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at); -- 创建时间索引，用于快速查询
CREATE INDEX idx_audit_log_result ON audit_log(result); -- 结果索引，用于快速查询

COMMENT ON TABLE audit_log IS '审计日志表（按 created_at 按月分区）';
COMMENT ON COLUMN audit_log.result IS 'success:成功, failure:业务失败, denied:权限拒绝';
COMMENT ON COLUMN audit_log.account_id IS '实际执行人，委托场景下为被授权人';

-- 补全数据库可存储注释。
COMMENT ON COLUMN account.id IS '主键，自增';
COMMENT ON COLUMN account.uuid IS '唯一标识符，全局唯一';
COMMENT ON COLUMN account.username IS '用户名，全局唯一';
COMMENT ON COLUMN account.password IS 'bcrypt 加密';
COMMENT ON COLUMN account.phone IS '手机号，全局唯一';
COMMENT ON COLUMN account.email IS '邮箱，全局唯一';
COMMENT ON COLUMN account.logo IS '头像URL';
COMMENT ON COLUMN account.remark IS '备注';
COMMENT ON COLUMN account.last_login_at IS '最后登录时间';
COMMENT ON COLUMN account.created_at IS '创建时间';
COMMENT ON COLUMN account.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN account.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN account.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN organization.id IS '主键，自增';
COMMENT ON COLUMN organization.parent_id IS '0表示根节点';
COMMENT ON COLUMN organization.org_name IS '组织名称';
COMMENT ON COLUMN organization.leader IS '负责人姓名';
COMMENT ON COLUMN organization.sort_order IS '排序顺序，默认0';
COMMENT ON COLUMN organization.remark IS '备注';
COMMENT ON COLUMN organization.created_at IS '创建时间';
COMMENT ON COLUMN organization.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN organization.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN organization.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN user_group.id IS '主键，自增';
COMMENT ON COLUMN user_group.group_code IS '用户组编码，全局唯一';
COMMENT ON COLUMN user_group.group_name IS '用户组名称';
COMMENT ON COLUMN user_group.description IS '用户组描述';
COMMENT ON COLUMN user_group.created_at IS '创建时间';
COMMENT ON COLUMN user_group.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN user_group.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN user_group.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN user_group_account.id IS '主键，自增';
COMMENT ON COLUMN user_group_account.user_group_id IS '用户组ID，关联用户组表，级联删除';
COMMENT ON COLUMN user_group_account.account_id IS '账号ID，关联账号表，级联删除';
COMMENT ON COLUMN user_group_account.created_at IS '创建时间';
COMMENT ON COLUMN user_group_account.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN user_group_account.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN token.id IS '主键，自增';
COMMENT ON COLUMN token.token IS 'JWT Token，全局唯一';
COMMENT ON COLUMN token.account_id IS '账号ID，关联账号表，级联删除';
COMMENT ON COLUMN token.expires_at IS '过期时间';
COMMENT ON COLUMN token.client_ip IS '客户端IP';
COMMENT ON COLUMN token.user_agent IS '用户代理';
COMMENT ON COLUMN token.revoked IS '是否已撤销，默认false';
COMMENT ON COLUMN token.created_at IS '创建时间';
COMMENT ON COLUMN token.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN token.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN token.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN sys_param.id IS '主键，自增';
COMMENT ON COLUMN sys_param.param_code IS '参数编码，全局唯一';
COMMENT ON COLUMN sys_param.param_value IS '参数值';
COMMENT ON COLUMN sys_param.description IS '参数描述';
COMMENT ON COLUMN sys_param.created_at IS '创建时间';
COMMENT ON COLUMN sys_param.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN sys_param.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN sys_param.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN sys_dict.id IS '主键，自增';
COMMENT ON COLUMN sys_dict.dict_code IS '字典编码，全局唯一';
COMMENT ON COLUMN sys_dict.description IS '字典描述';
COMMENT ON COLUMN sys_dict.created_at IS '创建时间';
COMMENT ON COLUMN sys_dict.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN sys_dict.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN sys_dict.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN operation.id IS '主键，自增';
COMMENT ON COLUMN operation.created_at IS '创建时间';
COMMENT ON COLUMN operation.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN operation.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN operation.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN permission_group.id IS '主键，自增';
COMMENT ON COLUMN permission_group.name IS '权限组名称';
COMMENT ON COLUMN permission_group.description IS '权限组描述';
COMMENT ON COLUMN permission_group.created_at IS '创建时间';
COMMENT ON COLUMN permission_group.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN permission_group.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN permission_group.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN permission_group_account.id IS '主键，自增';
COMMENT ON COLUMN permission_group_account.permission_group_id IS '权限组ID，关联权限组表';
COMMENT ON COLUMN permission_group_account.account_id IS '用户ID，关联用户表';
COMMENT ON COLUMN permission_group_account.created_at IS '创建时间';
COMMENT ON COLUMN permission_group_account.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN permission_group_org.id IS '主键，自增';
COMMENT ON COLUMN permission_group_org.permission_group_id IS '权限组ID，关联权限组表';
COMMENT ON COLUMN permission_group_org.org_id IS '组织ID，关联组织表';
COMMENT ON COLUMN permission_group_org.created_at IS '创建时间';
COMMENT ON COLUMN permission_group_org.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN app_authorization.id IS '主键，自增';
COMMENT ON COLUMN app_authorization.app_code IS '应用编码，唯一标识应用';
COMMENT ON COLUMN app_authorization.permission_group_id IS '权限组ID，关联权限组表';
COMMENT ON COLUMN app_authorization.app_key IS '应用密钥，唯一标识应用';
COMMENT ON COLUMN app_authorization.app_secret IS '加密存储';
COMMENT ON COLUMN app_authorization.secret_expire_at IS 'AppSecret 过期时间';
COMMENT ON COLUMN app_authorization.created_at IS '创建时间';
COMMENT ON COLUMN app_authorization.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN app_authorization.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN app_authorization.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN delegation.id IS '主键，自增';
COMMENT ON COLUMN delegation.grantor_id IS '授权人（管理员）';
COMMENT ON COLUMN delegation.grantee_id IS '被授权人（实际执行人）';
COMMENT ON COLUMN delegation.permission_group_id IS '权限组标识，引用permission_group.id';
COMMENT ON COLUMN delegation.resource_type IS '资源类型，如 device / alarm';
COMMENT ON COLUMN delegation.valid_from IS '有效开始时间';
COMMENT ON COLUMN delegation.valid_until IS '有效结束时间';
COMMENT ON COLUMN delegation.reason IS '拒绝原因或错误信息';
COMMENT ON COLUMN delegation.created_at IS '创建时间';
COMMENT ON COLUMN delegation.updated_at IS '更新时间；DEFAULT仅在插入时生效，更新维护方待Q-11/Q-12';
COMMENT ON COLUMN delegation.created_by IS '创建人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN delegation.updated_by IS '更新人ID；原模型未设外键，审计与保留策略待Q-09/Q-10';
COMMENT ON COLUMN audit_log.id IS '序列生成标识；与created_at共同组成分区主键，单列无唯一约束，待Q-09/Q-16';
COMMENT ON COLUMN audit_log.trace_id IS '全链路追踪ID';
COMMENT ON COLUMN audit_log.app_code IS '应用编码';
COMMENT ON COLUMN audit_log.operation_code IS '操作编码';
COMMENT ON COLUMN audit_log.resource_id IS '操作的目标资源ID';
COMMENT ON COLUMN audit_log.resource_type IS '资源类型，如 device / alarm';
COMMENT ON COLUMN audit_log.request_ip IS '请求IP';
COMMENT ON COLUMN audit_log.user_agent IS '用户代理';
COMMENT ON COLUMN audit_log.reason IS '拒绝原因或错误信息';
COMMENT ON COLUMN audit_log.log_level IS 'info / warn / error';
COMMENT ON COLUMN audit_log.request_body IS '请求体（脱敏后）';
COMMENT ON COLUMN audit_log.response_body IS '响应体（脱敏后）';
COMMENT ON COLUMN audit_log.cost_ms IS '接口耗时';
COMMENT ON COLUMN audit_log.created_at IS '创建时间；TIMESTAMP不含时区，解释规则待Q-11';
COMMENT ON TABLE audit_log_default IS '审计默认分区；月分区建立与默认分区数据迁移待Q-09/Q-16';
COMMENT ON COLUMN audit_log_default.id IS '审计默认分区字段；业务含义同audit_log.id';
COMMENT ON COLUMN audit_log_default.trace_id IS '审计默认分区字段；业务含义同audit_log.trace_id';
COMMENT ON COLUMN audit_log_default.account_id IS '审计默认分区字段；业务含义同audit_log.account_id';
COMMENT ON COLUMN audit_log_default.app_code IS '审计默认分区字段；业务含义同audit_log.app_code';
COMMENT ON COLUMN audit_log_default.operation_code IS '审计默认分区字段；业务含义同audit_log.operation_code';
COMMENT ON COLUMN audit_log_default.resource_id IS '审计默认分区字段；业务含义同audit_log.resource_id';
COMMENT ON COLUMN audit_log_default.resource_type IS '审计默认分区字段；业务含义同audit_log.resource_type';
COMMENT ON COLUMN audit_log_default.request_ip IS '审计默认分区字段；业务含义同audit_log.request_ip';
COMMENT ON COLUMN audit_log_default.user_agent IS '审计默认分区字段；业务含义同audit_log.user_agent';
COMMENT ON COLUMN audit_log_default.result IS '审计默认分区字段；业务含义同audit_log.result';
COMMENT ON COLUMN audit_log_default.reason IS '审计默认分区字段；业务含义同audit_log.reason';
COMMENT ON COLUMN audit_log_default.log_level IS '审计默认分区字段；业务含义同audit_log.log_level';
COMMENT ON COLUMN audit_log_default.request_body IS '审计默认分区字段；业务含义同audit_log.request_body';
COMMENT ON COLUMN audit_log_default.response_body IS '审计默认分区字段；业务含义同audit_log.response_body';
COMMENT ON COLUMN audit_log_default.cost_ms IS '审计默认分区字段；业务含义同audit_log.cost_ms';
COMMENT ON COLUMN audit_log_default.created_at IS '审计默认分区字段；业务含义同audit_log.created_at';

-- 操作所属应用：目标新增字段；不改变operation_code全局唯一规则。
CREATE INDEX idx_operation_app_code ON operation(app_code);
COMMENT ON COLUMN operation.app_code IS '应用编码，唯一标识所属应用；一个应用可有多个操作按钮，本列不唯一';
-- 关系约束候选：在应用表建立后添加，删除/编码变更策略待Q-10批准。
ALTER TABLE operation ADD CONSTRAINT fk_operation_app_code
    FOREIGN KEY (app_code) REFERENCES app_authorization(app_code)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
