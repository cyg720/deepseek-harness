package com.qs.authority.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 授权中心部署配置。
 *
 * <p>部署相关的可变量全部来自配置（环境变量或 application.yml），代码内没有默认常量分支：
 * token 期限与换发阈值、审计保留期、内置身份编码与初始化口令。
 *
 * @param selfAppCode 授权中心自身在授权模型中的应用编码
 * @param selfAppKey 授权中心自身应用的 AppKey；首次初始化时必填，已存在时忽略
 * @param appCenterAppCode 应用中心在本中心的受控身份应用编码
 * @param appCenterAppKey 应用中心调用受控接口时提交的 AppKey
 * @param token 令牌期限配置
 * @param password 口令策略配置
 * @param bootstrap 初始化引导配置
 * @param audit 审计与清理配置
 */
@ConfigurationProperties(prefix = "authority")
public record AuthorityProperties(
        @DefaultValue("auth-center") String selfAppCode,
        @DefaultValue("") String selfAppKey,
        @DefaultValue("app-center") String appCenterAppCode,
        @DefaultValue("") String appCenterAppKey,
        @DefaultValue Token token,
        @DefaultValue Password password,
        @DefaultValue Bootstrap bootstrap,
        @DefaultValue Audit audit) {

    /**
     * 令牌期限配置。
     *
     * @param ttlDays 签发有效期天数，默认 30
     * @param renewThresholdDays 剩余不足该天数时允许换发，默认 15
     */
    public record Token(@DefaultValue("30") int ttlDays, @DefaultValue("15") int renewThresholdDays) {
    }

    /**
     * 口令策略配置。
     *
     * @param minLength 口令最小长度，默认 8
     */
    public record Password(@DefaultValue("8") int minLength) {
    }

    /**
     * 初始化引导配置。
     *
     * @param enabled 是否执行初始化
     * @param superUsername 内置超级管理员用户名
     * @param superPassword 内置超级管理员初始口令；仅在该账号尚不存在时使用
     * @param superPhone 内置超级管理员手机号，可为空
     */
    public record Bootstrap(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("admin") String superUsername,
            @DefaultValue("") String superPassword,
            @DefaultValue("") String superPhone) {
    }

    /**
     * 审计配置。
     *
     * @param retentionDays 日志保留天数，超过才删除，默认 90
     * @param cleanupCron 清理任务 cron
     */
    public record Audit(
            @DefaultValue("90") int retentionDays,
            @DefaultValue("0 30 3 * * *") String cleanupCron) {
    }
}
