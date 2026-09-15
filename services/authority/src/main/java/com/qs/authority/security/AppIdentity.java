package com.qs.authority.security;

import java.time.LocalDateTime;

/**
 * 当前请求的应用身份，由 {@code X-App-Key} 解析得到。
 *
 * @param id 应用授权记录标识
 * @param appCode 应用编码
 * @param appKey 应用密钥
 * @param status 授权状态：active、frozen、offline
 */
public record AppIdentity(long id, String appCode, String appKey, String status) {

    /**
     * 应用是否可用于鉴权。
     *
     * @return 仅 active 状态可继续
     */
    public boolean active() {
        return "active".equals(status);
    }
}
