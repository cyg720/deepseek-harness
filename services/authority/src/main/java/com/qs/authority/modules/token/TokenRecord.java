package com.qs.authority.modules.token;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 登录令牌记录，对应表 {@code qs__auth__token}。
 *
 * <p>只保存令牌核验摘要；明文 token 仅在签发或换发成功响应中返回一次。
 */
@Getter
@Setter
public class TokenRecord {

    private Long id;
    private String tokenDigest;
    private Long accountId;
    private String tokenType;
    private String refreshType;
    private LocalDateTime expiresAt;
    private String sceneId;
    private String clientIp;
    private String userAgent;
    private Boolean revoked;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
    /** 登录实例标识；UUID 列以文本形式读写，避免依赖驱动的 UUID 映射。 */
    private String sessionId;

    /**
     * 是否已撤销。
     *
     * @return revoked 为真时为 true
     */
    public boolean revoked() {
        return Boolean.TRUE.equals(revoked);
    }
}
