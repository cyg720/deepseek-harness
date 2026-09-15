package com.qs.authority.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 授权中心自身管理接口：调用方 AppKey 必须是授权中心自己的应用身份。
 *
 * <p>其他应用即使持有合法登录 token 也不能管理本中心；权限仍由 {@link RequireOperation}
 * 按账号取得的操作另行判断。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface SelfAppOnly {
}
