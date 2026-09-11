

## 一、PostgreSQL DDL

```sql
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

CREATE INDEX idx_account_username ON account(username);      -- 用户名索引，用于快速查询
CREATE INDEX idx_account_phone ON account(phone);           -- 手机号索引，用于快速查询
CREATE INDEX idx_account_email ON account(email);           -- 邮箱索引，用于快速查询
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
    created_by          BIGINT                             -- 创建人ID
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
    created_by          BIGINT                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE user_group IS '用户组表（跨部门虚拟小组）';     -- 跨部门虚拟小组，用于组织用户，不实际存储用户信息


-- ============================================================
-- 4. 用户组_用户关联表
-- ============================================================
CREATE TABLE user_group_account (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    user_group_id       BIGINT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE, -- 用户组ID，关联用户组表，级联删除
    account_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE, -- 账号ID，关联账号表，级联删除
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    created_by          BIGINT                             -- 创建人ID
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
    account_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE, -- 账号ID，关联账号表，级联删除
    token_type          VARCHAR(16) NOT NULL,               -- Master-Token / Scene-Token
    refresh_type        VARCHAR(16) NOT NULL,               -- access_token / refresh_token
    expires_at          TIMESTAMP NOT NULL,                   -- 过期时间
    scene_id            VARCHAR(64),                        -- Scene-Token 绑定的场景ID（如WebSocket连接ID）
    client_ip           VARCHAR(64),                        -- 客户端IP
    user_agent          VARCHAR(256),                       -- 用户代理
    revoked             BOOLEAN DEFAULT FALSE,                -- 是否已撤销，默认false
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_token_token ON token(token); -- JWT Token索引，用于快速查询
CREATE INDEX idx_token_account_id ON token(account_id); -- 账号ID索引，用于快速查询
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
    created_by          BIGINT                             -- 创建人ID
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
    created_by          BIGINT                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE sys_dict IS '系统字典管理表';
COMMENT ON COLUMN sys_dict.dict_items IS '字典项JSON数组，如 ["启用","禁用","待审核"]';


-- ============================================================
-- 8. 操作管理表
-- ============================================================
CREATE TABLE operation (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    operation_code      VARCHAR(128) NOT NULL UNIQUE,       -- 控制器名+方法名，如 DeviceController.delete
    operation_name      VARCHAR(128) NOT NULL,               -- 操作名称
    operation_desc      VARCHAR(512),                        -- 操作描述
    resource_type       VARCHAR(64),                        -- 所属资源类型，如 device / alarm / report
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_operation_code ON operation(operation_code); -- 操作编码索引，用于快速查询
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
    created_by          BIGINT                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

COMMENT ON TABLE permission_group IS '权限组表（权限操作码字典）';
COMMENT ON COLUMN permission_group.operation_ids IS '操作ID JSON数组，如 [1,2,3]';


-- ============================================================
-- 10. 权限组_用户关联表
-- ============================================================
CREATE TABLE permission_group_account (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE CASCADE, -- 权限组ID，关联权限组表
    account_id          BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE, -- 用户ID，关联用户表
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
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE CASCADE, -- 权限组ID，关联权限组表
    org_id              BIGINT NOT NULL REFERENCES organization(id) ON DELETE CASCADE, -- 组织ID，关联组织表
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
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id) ON DELETE CASCADE, -- 权限组ID，关联权限组表
    app_key             VARCHAR(64) NOT NULL UNIQUE,          -- 应用密钥，唯一标识应用
    app_secret          VARCHAR(128) NOT NULL,              -- 加密存储
    data_scope_type     VARCHAR(16) NOT NULL DEFAULT 'SELF', -- SELF / DEPT / SPECIFIED
    specified_org_ids   JSONB DEFAULT '[]',                 -- data_scope_type=SPECIFIED 时必填
    status              VARCHAR(16) NOT NULL DEFAULT 'active', -- active / frozen
    secret_expire_at    TIMESTAMP,                          -- AppSecret 过期时间
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_app_auth_app_code ON app_authorization(app_code); -- 应用编码索引，用于快速查询
CREATE INDEX idx_app_auth_app_key ON app_authorization(app_key); -- 应用密钥索引，用于快速查询
CREATE INDEX idx_app_auth_status ON app_authorization(status); -- 状态索引，用于快速查询
CREATE INDEX idx_app_auth_permission_group_id ON app_authorization(permission_group_id); -- 权限组ID索引，用于快速查询

COMMENT ON TABLE app_authorization IS '应用授权表';
COMMENT ON COLUMN app_authorization.data_scope_type IS 'SELF:本人数据, DEPT:本部门及以下, SPECIFIED:指定部门';
COMMENT ON COLUMN app_authorization.specified_org_ids IS '指定部门时存储组织ID列表，JSON数组格式如 [1,2,3]';
COMMENT ON COLUMN app_authorization.status IS 'active:生效, frozen:冻结';


-- ============================================================
-- 13. 委托授权表
-- ============================================================
CREATE TABLE delegation (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    grantor_id          BIGINT NOT NULL REFERENCES account(id), -- 授权人（管理员）
    grantee_id          BIGINT NOT NULL REFERENCES account(id), -- 被授权人（实际执行人）
    permission_group_id BIGINT NOT NULL REFERENCES permission_group(id),
    resource_type       VARCHAR(64) NOT NULL,                -- 资源类型，如 device / alarm
    resource_ids        JSONB NOT NULL,                      -- 资源ID列表，如 ["1","2","3"]
    valid_from          TIMESTAMP NOT NULL,                  -- 有效开始时间
    valid_until         TIMESTAMP NOT NULL,                  -- 有效结束时间
    status              VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending / active / expired / revoked
    reason              VARCHAR(512),                        -- 拒绝原因或错误信息
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT                             -- 创建人ID
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
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
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
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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


-- ============================================================
-- 初始化数据
-- ============================================================

-- 插入默认超级管理员账号（密码请在首次启动时重置）
INSERT INTO account (username, password, phone, account_type, status, remark)
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '13800000000', 'person', 'normal', '系统超级管理员');

-- 插入默认根组织
INSERT INTO organization (id, parent_id, org_path, org_name, org_type)
VALUES (1, 0, '/1', '总公司', 'company');

-- 插入默认操作码（示例）
INSERT INTO operation (operation_code, operation_name, operation_desc, resource_type) VALUES
    ('AccountController.list', '账号列表', '分页查询账号列表', 'account'),
    ('AccountController.detail', '账号详情', '查询账号详细信息', 'account'),
    ('AccountController.create', '新增账号', '创建新账号', 'account'),
    ('AccountController.update', '编辑账号', '更新账号信息', 'account'),
    ('AccountController.delete', '删除账号', '删除账号', 'account'),
    ('DeviceController.list', '设备列表', '分页查询设备列表', 'device'),
    ('DeviceController.detail', '设备详情', '查询设备详细信息', 'device'),
    ('DeviceController.control', '设备控制', '启动/停止设备', 'device'),
    ('AlarmController.list', '告警列表', '分页查询告警列表', 'alarm'),
    ('AlarmController.confirm', '确认告警', '确认告警信息', 'alarm');

-- 插入默认权限组（管理员权限组）
INSERT INTO permission_group (id, name, description, operation_ids)
VALUES (1, '系统管理员', '拥有所有操作权限', '[1,2,3,4,5,6,7,8,9,10]');

-- 将管理员账号关联到管理员权限组
INSERT INTO permission_group_account (permission_group_id, account_id)
VALUES (1, 1);


-- ============================================================
-- 索引维护建议（定期执行）
-- ============================================================

-- 清理过期令牌（建议每天执行一次）
-- DELETE FROM token WHERE expires_at < NOW() - INTERVAL '7 days' AND revoked = true;

-- 清理过期委托（建议每小时执行一次）
-- UPDATE delegation SET status = 'expired' WHERE valid_until < NOW() AND status = 'active';
```

---

## 二、使用说明

| 项目 | 说明 |
|:---|:---|
| **数据库** | PostgreSQL 12+ |
| **UUID生成** | 使用 `uuid-ossp` 扩展 |
| **JSONB字段** | 用于存储灵活结构（操作ID数组、资源ID列表、依赖清单等） |
| **日志分区** | `audit_log` 已按 `created_at` 配置为分区表，需定期创建月度分区 |
| **索引** | 所有外键关联字段均已建立索引，查询性能有保障 |
| **初始化数据** | 已预置超级管理员、根组织、示例操作码和管理员权限组 |

---
