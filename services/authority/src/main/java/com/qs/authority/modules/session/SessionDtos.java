package com.qs.authority.modules.session;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 会话与令牌接口模型。
 *
 * <p>令牌明文只在签发、换发或场景签发的成功响应中返回一次；数据库只保存摘要。
 */
public final class SessionDtos {

    private SessionDtos() {
    }

    /**
     * 登录请求。
     *
     * @param username 用户名
     * @param password 密码原文，不做空白裁剪
     */
    public record LoginRequest(
            @NotBlank(message = "请输入用户名") @Size(max = 64, message = "长度不能超过 64 个字符") String username,
            @NotBlank(message = "请输入密码") @Size(max = 64, message = "长度不能超过 64 个字符") String password) {
    }

    /**
     * 登录与换发响应。
     *
     * @param token 令牌明文，只在本次响应返回
     * @param expiresAt 到期时间，北京时间秒精度
     * @param sessionId 登录实例标识；换发后保持不变
     * @param accountId 账号标识
     * @param username 用户名
     * @param mustChangePassword 是否必须先修改初始密码
     * @param isSuperAdmin 是否内置超级管理员
     */
    public record TokenResponse(String token, String expiresAt, String sessionId, String accountId, String username,
            boolean mustChangePassword, boolean isSuperAdmin) {
    }

    /**
     * 场景令牌签发请求。
     *
     * @param sceneId 场景标识，如音视频会话 ID、WebSocket 连接 ID
     */
    public record SceneTokenRequest(
            @NotBlank(message = "请输入场景标识") @Size(max = 64, message = "长度不能超过 64 个字符") String sceneId) {
    }

    /**
     * 场景令牌响应。
     *
     * @param token 令牌明文，只在本次响应返回
     * @param expiresAt 到期时间，北京时间秒精度
     * @param sceneId 场景标识
     * @param sessionId 所属登录实例标识
     */
    public record SceneTokenResponse(String token, String expiresAt, String sceneId, String sessionId) {
    }
}
