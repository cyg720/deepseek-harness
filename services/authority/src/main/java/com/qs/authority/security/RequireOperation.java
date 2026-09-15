package com.qs.authority.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 管理接口所需的操作权限。
 *
 * <p>操作码为授权中心自身应用下已登记的操作，取值来自 {@link CenterOperations}。超级管理员
 * 不依赖权限组即通过；普通账号需要在其取得的权限组内拥有该操作。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireOperation {

    /**
     * 完整操作码，形如 {@code auth-center.AccountController.create}。
     *
     * @return 操作码
     */
    String value();
}
