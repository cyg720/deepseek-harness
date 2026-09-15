package com.qs.authority.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 强制改密状态下仍可调用的接口：修改初始密码、本人改密、退出登录与读取本人信息。
 *
 * <p>其余接口在账号 {@code must_change_password} 为真时一律返回 40303，完成改密前不开放普通业务。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface AllowPasswordChange {
}
