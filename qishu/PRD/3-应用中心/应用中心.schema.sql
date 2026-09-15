-- 应用中心 v0.1.0 新库候选设计；未经业务批准，未执行。
-- PostgreSQL；目标版本、qs__app__前缀及当前schema由Q-08确认。
-- 跨服务ID不创建跨库外键；禁止在此脚本写授权中心表或凭据。
CREATE TABLE qs__app__application (
    id BIGSERIAL PRIMARY KEY,
    app_code VARCHAR(64) NOT NULL UNIQUE,
    app_name VARCHAR(128) NOT NULL,
    logo VARCHAR(512),
    cover VARCHAR(512),
    scope VARCHAR(16) NOT NULL DEFAULT 'team',
    owner_id BIGINT NOT NULL,
    team_id BIGINT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    release_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    version BIGINT NOT NULL DEFAULT 1,
    description TEXT,
    dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    authorization_id BIGINT,
    app_key VARCHAR(64),
    credential_ref VARCHAR(256),
    desired_auth_status VARCHAR(16) NOT NULL DEFAULT 'offline',
    observed_auth_status VARCHAR(16),
    observed_auth_version BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    CONSTRAINT ck_app_code CHECK (app_code ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_app_name CHECK (length(btrim(app_name)) > 0),
    CONSTRAINT ck_app_scope CHECK (scope IN ('personal','team','enterprise')),
    CONSTRAINT ck_app_team CHECK ((scope = 'team' AND team_id IS NOT NULL) OR (scope <> 'team' AND team_id IS NULL)),
    CONSTRAINT ck_app_ids CHECK (owner_id > 0 AND (team_id IS NULL OR team_id > 0) AND created_by > 0 AND updated_by > 0 AND (authorization_id IS NULL OR authorization_id > 0)),
    CONSTRAINT ck_app_status CHECK (status IN ('draft','pending','published','frozen','offline')),
    CONSTRAINT ck_app_release CHECK (release_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    CONSTRAINT ck_app_version CHECK (version > 0),
    CONSTRAINT ck_app_dependencies CHECK (jsonb_typeof(dependencies) = 'array'),
    CONSTRAINT ck_app_description CHECK (description IS NULL OR length(description) <= 10000),
    CONSTRAINT ck_app_desired CHECK (desired_auth_status IN ('active','frozen','offline')),
    CONSTRAINT ck_app_observed CHECK (observed_auth_status IS NULL OR observed_auth_status IN ('active','frozen','offline')),
    CONSTRAINT ck_app_auth_pair CHECK ((observed_auth_status IS NULL AND observed_auth_version IS NULL) OR (observed_auth_status IS NOT NULL AND observed_auth_version IS NOT NULL AND observed_auth_version > 0)),
    CONSTRAINT ck_app_local_auth CHECK ((status IN ('draft','pending','offline') AND desired_auth_status = 'offline') OR (status = 'published' AND desired_auth_status = 'active') OR (status = 'frozen' AND desired_auth_status = 'frozen'))
);
COMMENT ON TABLE qs__app__application IS '应用中心业务登记；单企业候选，不保存app_secret明文';
COMMENT ON COLUMN qs__app__application.id IS '应用ID；API以十进制字符串返回';
COMMENT ON COLUMN qs__app__application.app_code IS '单部署全局唯一的小写应用编码；创建后不可改，注册后不复用';
COMMENT ON COLUMN qs__app__application.app_name IS '应用名称，最多128个数据库字符';
COMMENT ON COLUMN qs__app__application.logo IS '可选logo地址，最多512字符；媒体规则待确认';
COMMENT ON COLUMN qs__app__application.cover IS '可选封面地址，最多512字符；媒体规则待确认';
COMMENT ON COLUMN qs__app__application.scope IS '候选可见范围：personal个人、team团队、enterprise企业';
COMMENT ON COLUMN qs__app__application.owner_id IS '创建归属用户ID；授权中心引用，无跨库外键';
COMMENT ON COLUMN qs__app__application.team_id IS '团队引用；仅team范围非空，团队实体映射待确认';
COMMENT ON COLUMN qs__app__application.status IS '本地业务状态draft/pending/published/frozen/offline；不证明远端生效';
COMMENT ON COLUMN qs__app__application.release_version IS '业务发布版本，候选格式主版本.次版本.修订版本';
COMMENT ON COLUMN qs__app__application.version IS '并发修订号；服务层每次变更原子比较后加1';
COMMENT ON COLUMN qs__app__application.description IS '可空纯文本描述，最多10000字符';
COMMENT ON COLUMN qs__app__application.dependencies IS '依赖数组，每项kind/code/version；元素及引用由服务层校验';
COMMENT ON COLUMN qs__app__application.authorization_id IS '授权中心授权记录ID；跨服务引用';
COMMENT ON COLUMN qs__app__application.app_key IS '授权中心返回的应用身份标识；普通响应不返回';
COMMENT ON COLUMN qs__app__application.credential_ref IS '受控凭据存储引用；不是密钥密文或明文，存储设施待确认';
COMMENT ON COLUMN qs__app__application.desired_auth_status IS '本地期望授权状态；只能由受控业务动作维护';
COMMENT ON COLUMN qs__app__application.observed_auth_status IS '最近确认的远端状态；可能过期，不作为实时鉴权依据';
COMMENT ON COLUMN qs__app__application.observed_auth_version IS '最近确认的授权中心并发版本';
COMMENT ON COLUMN qs__app__application.created_at IS '创建北京时间，精确到秒；数据库连接时区Asia/Shanghai';
COMMENT ON COLUMN qs__app__application.updated_at IS '最后更新时间，北京时间；服务层每次持久更新维护';
COMMENT ON COLUMN qs__app__application.created_by IS '创建操作者ID，由认证上下文生成';
COMMENT ON COLUMN qs__app__application.updated_by IS '最后操作者ID；后台任务归属受控服务账号';
CREATE INDEX idx_app_scope_status_id ON qs__app__application(scope,status,id DESC);
CREATE INDEX idx_app_owner_status_id ON qs__app__application(owner_id,status,id DESC);
CREATE INDEX idx_app_team_status_id ON qs__app__application(team_id,status,id DESC) WHERE team_id IS NOT NULL;

CREATE TABLE qs__app__review (
    id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES qs__app__application(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    submitted_version BIGINT NOT NULL CHECK (submitted_version > 0),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    dependency_report JSONB NOT NULL CHECK (jsonb_typeof(dependency_report) = 'object'),
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
    submitted_by BIGINT NOT NULL CHECK (submitted_by > 0),
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by BIGINT,
    decided_at TIMESTAMP,
    reason VARCHAR(1000),
    CONSTRAINT ck_review_decision CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL) OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_by > 0 AND decided_at IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)),
    CONSTRAINT ck_review_separation CHECK (status NOT IN ('approved','rejected') OR decided_by <> submitted_by),
    CONSTRAINT ck_review_withdraw CHECK (status <> 'withdrawn' OR decided_by = submitted_by),
    UNIQUE(application_id,submitted_version)
);
COMMENT ON TABLE qs__app__review IS '发布申请及不可变提交快照；审批分离为待批准建议';
COMMENT ON COLUMN qs__app__review.id IS '申请ID；API字符串';
COMMENT ON COLUMN qs__app__review.application_id IS '所属应用；不允许级联删除';
COMMENT ON COLUMN qs__app__review.submitted_version IS '提交后应用并发版本，与快照绑定';
COMMENT ON COLUMN qs__app__review.snapshot IS '提交时业务字段快照；排除凭据和凭据引用';
COMMENT ON COLUMN qs__app__review.dependency_report IS '提交和最终批准校验的报告记录；不含凭据，格式由服务层验证';
COMMENT ON COLUMN qs__app__review.status IS 'pending待决、approved通过、rejected驳回、withdrawn撤回';
COMMENT ON COLUMN qs__app__review.submitted_by IS '提交者；跨服务用户引用';
COMMENT ON COLUMN qs__app__review.submitted_at IS '提交北京时间';
COMMENT ON COLUMN qs__app__review.decided_by IS '决策或撤回操作者；未决定时为空';
COMMENT ON COLUMN qs__app__review.decided_at IS '决定北京时间；未决定时为空';
COMMENT ON COLUMN qs__app__review.reason IS '批准、驳回或撤回原因，最多1000字符；未决定为空';
CREATE UNIQUE INDEX uq_review_pending ON qs__app__review(application_id) WHERE status = 'pending';
CREATE INDEX idx_review_app_id ON qs__app__review(application_id,id DESC);

CREATE TABLE qs__app__sync_job (
    id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES qs__app__application(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    target_status VARCHAR(16) NOT NULL CHECK (target_status IN ('active','frozen','offline')),
    source_version BIGINT NOT NULL CHECK (source_version > 0),
    status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','superseded')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_until TIMESTAMP,
    next_attempt_at TIMESTAMP,
    last_error_code VARCHAR(64),
    trace_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(application_id,source_version),
    CONSTRAINT ck_sync_lease CHECK ((status = 'running' AND lease_until IS NOT NULL) OR (status <> 'running' AND lease_until IS NULL))
);
COMMENT ON TABLE qs__app__sync_job IS '授权状态同步意图；与业务状态同事务写入，按应用串行发送';
COMMENT ON COLUMN qs__app__sync_job.id IS '同步操作ID，供页面查询恢复';
COMMENT ON COLUMN qs__app__sync_job.application_id IS '所属应用；本库外键，禁止级联删除';
COMMENT ON COLUMN qs__app__sync_job.target_status IS '该意图的授权目标状态';
COMMENT ON COLUMN qs__app__sync_job.source_version IS '生成意图时的本地版本；发送前核对最新期望';
COMMENT ON COLUMN qs__app__sync_job.status IS 'queued排队、running执行、succeeded已核对、failed待恢复、superseded已过时';
COMMENT ON COLUMN qs__app__sync_job.attempts IS '已尝试次数，不代表外部成功次数';
COMMENT ON COLUMN qs__app__sync_job.lease_until IS '执行租约到期北京时间；仅running非空';
COMMENT ON COLUMN qs__app__sync_job.next_attempt_at IS '下次重试北京时间；无计划时为空';
COMMENT ON COLUMN qs__app__sync_job.last_error_code IS '脱敏错误分类；不存响应原文、SQL或凭据';
COMMENT ON COLUMN qs__app__sync_job.trace_id IS '服务端生成的诊断标识';
COMMENT ON COLUMN qs__app__sync_job.created_at IS '创建北京时间';
COMMENT ON COLUMN qs__app__sync_job.updated_at IS '状态更新时间；服务层维护北京时间';
CREATE INDEX idx_sync_due ON qs__app__sync_job(status,next_attempt_at,id) WHERE status IN ('queued','failed');
CREATE INDEX idx_sync_app_id ON qs__app__sync_job(application_id,id DESC);

CREATE TABLE qs__app__audit_event (
    id BIGSERIAL PRIMARY KEY,
    application_id BIGINT,
    actor_id BIGINT,
    action VARCHAR(64) NOT NULL,
    result VARCHAR(16) NOT NULL CHECK (result IN ('success','denied','failed','accepted')),
    before_version BIGINT,
    after_version BIGINT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    trace_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE qs__app__audit_event IS '应用管理审计；保留期和失败策略待确认，无公开写删接口';
COMMENT ON COLUMN qs__app__audit_event.id IS '审计ID，API字符串';
COMMENT ON COLUMN qs__app__audit_event.application_id IS '目标ID；可为空且不设外键，保留删除与不存在目标审计';
COMMENT ON COLUMN qs__app__audit_event.actor_id IS '已认证操作者ID，认证失败时为空';
COMMENT ON COLUMN qs__app__audit_event.action IS '动作名称，不含用户输入或密钥';
COMMENT ON COLUMN qs__app__audit_event.result IS 'success完成、denied拒绝、failed失败、accepted已受理';
COMMENT ON COLUMN qs__app__audit_event.before_version IS '操作前版本，无目标时为空';
COMMENT ON COLUMN qs__app__audit_event.after_version IS '操作后版本，无变更时可同前版本';
COMMENT ON COLUMN qs__app__audit_event.details IS '白名单业务差异和原因；排除密钥及凭据引用';
COMMENT ON COLUMN qs__app__audit_event.trace_id IS '服务端诊断标识，用于关联请求与同步任务';
COMMENT ON COLUMN qs__app__audit_event.created_at IS '事件北京时间';
CREATE INDEX idx_audit_app_id ON qs__app__audit_event(application_id,id DESC);
