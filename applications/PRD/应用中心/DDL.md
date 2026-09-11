
## 应用中心
-- ============================================================
--  应用中心 - 应用管理表（跨库/跨服务引用）
-- ============================================================


1、应用中心（基础能力）
      应用管理：
            字段：应用名称、应用编码、logo、应用作用域（个人/团队/企业）、状态、版本、应用描述、dependencies（json数组）
            操作：新增、编辑、删除、详情、列表、发布审批、冻结应用
            备注：【dependencies：如果应用依赖的插件、工具、skill等被卸载或升级，该应用可能崩溃；发布审批时，系统自动校验依赖是否存在，防止上线即报错】





```sql

CREATE TABLE application (
    id                  BIGSERIAL PRIMARY KEY,              -- 主键，自增
    app_code            VARCHAR(64) NOT NULL UNIQUE,          -- 应用编码，唯一标识应用
    app_name            VARCHAR(128) NOT NULL,                -- 应用名称
    logo                VARCHAR(512),                           -- 应用logo
    scope               VARCHAR(16) NOT NULL DEFAULT 'team',  -- personal:个人, team:团队, enterprise:企业
    status              VARCHAR(16) NOT NULL DEFAULT 'draft',  -- draft:草稿, pending:待审批, published:已发布, frozen:已冻结
    version             VARCHAR(32) NOT NULL DEFAULT '1.0.0',  -- 应用版本
    description         TEXT,                               -- 应用描述
    dependencies        JSONB DEFAULT '[]',                   -- JSON数组，如 [{"plugin":"sop", "version":"2.0"}]
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    created_by          BIGINT,                             -- 创建人ID
    updated_by          BIGINT                             -- 更新人ID
);

CREATE INDEX idx_application_app_code ON application(app_code); -- 应用编码索引，用于快速查询
CREATE INDEX idx_application_status ON application(status); -- 状态索引，用于快速查询

COMMENT ON TABLE application IS '应用中心-应用管理表';
COMMENT ON COLUMN application.scope IS 'personal:个人, team:团队, enterprise:企业';
COMMENT ON COLUMN application.status IS 'draft:草稿, pending:待审批, published:已发布, frozen:已冻结';
COMMENT ON COLUMN application.dependencies IS '依赖清单JSON数组，如 [{"plugin":"sop", "version":"2.0"}]';

-- 注册系统内置应用的授权（示例）
INSERT INTO app_authorization (app_code, permission_group_id, app_key, app_secret, data_scope_type)
VALUES ('system_admin_console', 1, 'app_admin_key', '$2a$10$encrypted_secret_here', 'SELF');

COMMENT ON TABLE app_authorization IS '应用授权表 - 内置应用已初始注册';

```
