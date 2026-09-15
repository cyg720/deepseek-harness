package com.qs.authority.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记不需要用户 token 的接口，例如登录。
 *
 * <p>应用身份仍然必需：所有接口都要通过 {@code X-App-Key} 说明调用方。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface Anonymous {
}
