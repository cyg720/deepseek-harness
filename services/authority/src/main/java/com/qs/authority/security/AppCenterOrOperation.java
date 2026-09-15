package com.qs.authority.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 读接口的双主体规则：应用中心受控调用，或授权中心自身应用下的持权账号。
 *
 * <p>用于操作登记的详情与列表：应用中心上报后需要立即回查现状（此时没有用户 token），
 * 授权中心的权限管理员同样需要查看已登记操作。应用中心身份不需要用户 token，但必须是配置的
 * 应用中心 AppKey；其他调用方必须携带有效 token 且拥有 {@link #value()} 指定的操作。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface AppCenterOrOperation {

    /**
     * 管理侧需要的操作码后缀，形如 {@code OperationController.list}。
     *
     * @return 操作码后缀
     */
    String value();
}
