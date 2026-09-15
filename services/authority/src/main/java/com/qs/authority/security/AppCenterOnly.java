package com.qs.authority.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 应用中心受控接口：建立授权记录、上报或改名操作、同步应用状态。
 *
 * <p>不要求用户 token（服务间调用），但调用方 AppKey 必须等于配置的应用中心 AppKey，
 * 不能仅凭任意有效 AppKey 执行。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface AppCenterOnly {
}
