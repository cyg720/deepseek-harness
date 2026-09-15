package com.qs.authority.support;

import org.junit.jupiter.api.extension.ConditionEvaluationResult;
import org.junit.jupiter.api.extension.ExecutionCondition;
import org.junit.jupiter.api.extension.ExtensionContext;

/**
 * 本地 PostgreSQL 不可用时禁用接口用例。
 *
 * <p>作为 {@link ExecutionCondition} 注册在测试基类上，在容器启动前生效，因此不会因为拿不到
 * 数据源而让整轮构建失败；有数据库时条件为真，用例照常执行。
 */
public class DatabaseRequiredCondition implements ExecutionCondition {

    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        if (TestDatabase.available()) {
            return ConditionEvaluationResult.enabled("本地 PostgreSQL 可用");
        }
        return ConditionEvaluationResult.disabled("需要本地 Docker PostgreSQL：设置 AUTH_DB_PASSWORD 后重跑");
    }
}
