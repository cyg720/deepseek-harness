-- 授权中心数据库结构验证（AC-29 / TC-31-027）
-- 用法：
--   docker exec -i -e PGPASSWORD=<POSTGRES_PASSWORD> qs-local-postgres-1 \
--     psql -U qs -d qs -v ON_ERROR_STOP=1 -f - < scripts/verify-schema.sql
-- 只读查询 + 一个在事务内回滚的约束验证块；不修改任何业务数据。

\pset footer off

\echo '== 1. 业务表数量（期望 15）与日志分区（期望 1）=='
SELECT count(*) AS business_tables FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'qs__auth__%' AND table_name <> 'qs__auth__audit_log_default';
SELECT count(*) AS audit_partitions FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'qs__auth__audit_log_default';

\echo '== 2. 显式索引（期望 14 个 CREATE INDEX + 1 个超级管理员部分唯一索引）=='
SELECT count(*) AS explicit_indexes FROM pg_indexes
WHERE schemaname = 'public' AND tablename LIKE 'qs__auth%' AND indexname NOT LIKE '%_pkey'
  AND indexname NOT LIKE '%_key' AND indexname NOT LIKE 'qs__auth__audit_log_default%';

\echo '== 3. 触发器（期望 16 行：13 张业务表更新时间触发器 + 账号业务列触发器 + 账号保护触发器两事件）=='
SELECT count(*) AS triggers FROM information_schema.triggers WHERE trigger_name LIKE 'qs__auth%';

\echo '== 4. 北京时间秒精度：写入行的默认时间与数据库当前北京时间在同一秒 =='
BEGIN;
INSERT INTO qs__auth__sys_param (param_code, param_value, description) VALUES ('tz-check', 'x', '时区校验');
SELECT (created_at BETWEEN date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai') - interval '1 second'
                      AND date_trunc('second', clock_timestamp() AT TIME ZONE 'Asia/Shanghai') + interval '1 second')
       AS beijing_second_precision
FROM qs__auth__sys_param WHERE param_code = 'tz-check';
ROLLBACK;

\echo '== 5. 列注释数量（字段说明随 SQL 交付）=='
SELECT count(*) AS column_comments FROM pg_description d
JOIN pg_class c ON c.oid = d.objoid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'qs__auth%' AND d.objsubid > 0;

\echo '== 6. 约束行为（事务内验证后回滚）=='
BEGIN;
\set ON_ERROR_STOP off
\echo '-- 6.1 非法外键（不存在的应用编码）应被拒绝'
SAVEPOINT s1;
INSERT INTO qs__auth__operation (app_code, operation_code, operation_name)
VALUES ('no-such-app', 'no-such-app.X.y', 'y');
ROLLBACK TO s1;
\echo '-- 6.2 操作码缺少应用前缀应被拒绝'
SAVEPOINT s2;
INSERT INTO qs__auth__operation (app_code, operation_code, operation_name)
SELECT app_code, 'without-prefix', 'y' FROM qs__auth__app_authorization LIMIT 1;
ROLLBACK TO s2;
\echo '-- 6.3 空参数值应被拒绝'
SAVEPOINT s3;
INSERT INTO qs__auth__sys_param (param_code, param_value) VALUES ('blank-check', '   ');
ROLLBACK TO s3;
\echo '-- 6.4 重复关联组合应被拒绝'
SAVEPOINT s4;
INSERT INTO qs__auth__account_organization (account_id, org_id)
SELECT account_id, org_id FROM qs__auth__account_organization LIMIT 1;
ROLLBACK TO s4;
\echo '-- 6.5 服务账号缺少 IP 白名单应被拒绝'
SAVEPOINT s5;
INSERT INTO qs__auth__account (username, account_type, password) VALUES ('svc-check', 'service', NULL);
ROLLBACK TO s5;
\echo '-- 6.6 第二名单个内置超级管理员应被拒绝'
SAVEPOINT s6;
INSERT INTO qs__auth__account (username, password, is_super_admin) VALUES ('super-check', 'x', TRUE);
ROLLBACK TO s6;
\echo '-- 6.7 删除内置超级管理员应被拒绝'
SAVEPOINT s7;
DELETE FROM qs__auth__account WHERE is_super_admin;
ROLLBACK TO s7;
\echo '-- 6.8 版本触发器：业务列更新后 version 自增且更新时间由数据库维护'
SAVEPOINT s8;
SELECT version AS version_before, updated_at AS updated_before FROM qs__auth__sys_param ORDER BY id LIMIT 1;
UPDATE qs__auth__sys_param SET description = 'schema-verify' WHERE id = (SELECT min(id) FROM qs__auth__sys_param);
SELECT version AS version_after, updated_at AS updated_after FROM qs__auth__sys_param ORDER BY id LIMIT 1;
ROLLBACK TO s8;
ROLLBACK;
\set ON_ERROR_STOP on

\echo '== 7. 每个业务表均有主键与列注释 =='
SELECT count(*) AS tables_without_pk FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_name LIKE 'qs__auth__%'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints c
    WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.constraint_type = 'PRIMARY KEY');
