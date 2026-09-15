package com.qs.authority.security;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;

/**
 * 当前请求的认证上下文。
 *
 * <p>由认证拦截器在进入控制器前写入：应用身份来自 {@code X-App-Key}，账号身份来自
 * {@code Authorization: Bearer <token>}。业务代码只读取该上下文，不重复解析请求头。
 */
public final class AuthContext {

    private static final ThreadLocal<Authentication> CURRENT = new ThreadLocal<>();

    private AuthContext() {
    }

    /**
     * 写入当前请求认证信息。
     *
     * @param authentication 认证信息
     */
    public static void set(Authentication authentication) {
        CURRENT.set(authentication);
    }

    /**
     * 读取当前请求认证信息。
     *
     * @return 认证信息，未认证时为 null
     */
    public static Authentication get() {
        return CURRENT.get();
    }

    /**
     * 读取当前登录账号，未认证时拒绝。
     *
     * @return 登录账号
     * @throws BusinessException 未认证时抛出 40101
     */
    public static AccountIdentity requireAccount() {
        Authentication authentication = CURRENT.get();
        if (authentication == null || authentication.account() == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        return authentication.account();
    }

    /**
     * 读取当前调用应用，未认证时拒绝。
     *
     * @return 调用应用
     * @throws BusinessException 未认证时抛出 40104
     */
    public static AppIdentity requireApp() {
        Authentication authentication = CURRENT.get();
        if (authentication == null || authentication.app() == null) {
            throw BusinessException.of(ErrorCode.INVALID_APP_KEY);
        }
        return authentication.app();
    }

    /**
     * 当前请求已核验的令牌记录，供换发与退出使用。
     *
     * @return 令牌记录
     * @throws BusinessException 未携带用户令牌时抛出 40101
     */
    public static com.qs.authority.modules.token.TokenRecord requireToken() {
        Authentication authentication = CURRENT.get();
        if (authentication == null || authentication.token() == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        return authentication.token();
    }

    /**
     * 当前操作账号标识，供 created_by/updated_by 使用。
     *
     * @return 账号标识，未登录时为 null
     */
    public static Long operatorId() {
        Authentication authentication = CURRENT.get();
        return authentication == null || authentication.account() == null ? null
                : authentication.account().id();
    }

    /**
     * 当前调用应用编码，供审计日志使用。
     *
     * @return 应用编码，未认证时为 null
     */
    public static String appCode() {
        Authentication authentication = CURRENT.get();
        return authentication == null || authentication.app() == null ? null : authentication.app().appCode();
    }

    /**
     * 清除当前线程上下文。
     */
    public static void clear() {
        CURRENT.remove();
    }

    /**
     * 当前请求的认证信息。
     *
     * @param app 调用应用身份
     * @param account 登录账号身份，登录与受控接口可为 null
     * @param token 已核验的令牌记录，未携带用户令牌时为 null
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     */
    public record Authentication(AppIdentity app, AccountIdentity account,
            com.qs.authority.modules.token.TokenRecord token, String clientIp, String userAgent) {
    }

    /**
     * 登录账号身份。
     *
     * @param id 账号标识
     * @param username 用户名
     * @param superAdmin 是否内置超级管理员
     * @param mustChangePassword 是否处于强制改密状态
     * @param status 账号状态
     */
    public record AccountIdentity(long id, String username, boolean superAdmin, boolean mustChangePassword,
            String status) {
    }
}
