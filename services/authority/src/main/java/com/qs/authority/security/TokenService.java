package com.qs.authority.security;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.config.AuthorityProperties;
import com.qs.authority.modules.token.TokenMapper;
import com.qs.authority.modules.token.TokenRecord;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.qs.authority.common.support.BeijingTime;

/**
 * 令牌签发、核验与撤销。
 *
 * <p>令牌为 256 位随机值，数据库只保存 SHA-256 摘要。每次登录签发新令牌且不影响其他设备；
 * 剩余不足换发阈值时允许换发：同一事务内撤销旧记录并新建 30 天记录，登录实例保持不变。
 */
@Service
public class TokenService {

    private static final String TOKEN_TYPE_MASTER = "Master-Token";
    private static final String TOKEN_TYPE_SCENE = "Scene-Token";
    private static final String REFRESH_TYPE_ACCESS = "access_token";

    private final TokenMapper tokenMapper;
    private final AuthorityProperties properties;
    private final SecureRandom random = new SecureRandom();

    /**
     * 构造令牌服务。
     *
     * @param tokenMapper 令牌持久层
     * @param properties 部署配置
     */
    public TokenService(TokenMapper tokenMapper, AuthorityProperties properties) {
        this.tokenMapper = tokenMapper;
        this.properties = properties;
    }

    /**
     * 登录签发主令牌。
     *
     * @param accountId 账号标识
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     * @return 新令牌，明文只在本次响应返回
     */
    public IssuedToken issueMaster(long accountId, String clientIp, String userAgent) {
        return issue(accountId, TOKEN_TYPE_MASTER, UUID.randomUUID().toString(), null, clientIp, userAgent);
    }

    /**
     * 签发场景令牌。
     *
     * @param accountId 账号标识
     * @param sessionId 登录实例标识
     * @param sceneId 场景标识
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     * @return 新令牌，明文只在本次响应返回
     */
    public IssuedToken issueScene(long accountId, String sessionId, String sceneId, String clientIp, String userAgent) {
        return issue(accountId, TOKEN_TYPE_SCENE, sessionId, sceneId, clientIp, userAgent);
    }

    /**
     * 核验令牌并返回记录。
     *
     * @param raw 令牌明文
     * @return 令牌记录
     * @throws BusinessException 缺失或无效返回 40101，已撤销返回 40103，已到期返回 40102
     */
    public TokenRecord requireValid(String raw) {
        if (raw == null || raw.isBlank()) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        TokenRecord record = tokenMapper.findByDigest(digest(raw));
        if (record == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        if (record.revoked()) {
            throw BusinessException.of(ErrorCode.TOKEN_REVOKED);
        }
        if (!BeijingTime.now().isBefore(record.getExpiresAt())) {
            throw BusinessException.of(ErrorCode.TOKEN_EXPIRED);
        }
        return record;
    }

    /**
     * 判断令牌是否已进入可换发窗口。
     *
     * @param record 当前令牌
     * @return 剩余有效期严格不足换发阈值时为 true；剩余正好等于阈值不换发
     */
    public boolean renewable(TokenRecord record) {
        LocalDateTime now = BeijingTime.now();
        Duration remaining = Duration.between(now, record.getExpiresAt());
        return remaining.compareTo(Duration.ofDays(properties.token().renewThresholdDays())) < 0;
    }

    /**
     * 换发令牌：撤销旧记录并新建同实例的 30 天记录。
     *
     * @param current 当前令牌记录
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     * @return 新令牌
     * @throws BusinessException 旧令牌已被撤销或被并发换发替换时返回 40103
     */
    @Transactional
    public IssuedToken renew(TokenRecord current, String clientIp, String userAgent) {
        int revoked = tokenMapper.revokeById(current.getId());
        if (revoked == 0) {
            throw BusinessException.of(ErrorCode.TOKEN_REVOKED);
        }
        return issue(current.getAccountId(), current.getTokenType(), current.getSessionId(), current.getSceneId(),
                clientIp, userAgent);
    }

    /**
     * 撤销某个登录实例的全部有效令牌（退出当前设备）。
     *
     * @param sessionId 登录实例标识
     * @return 撤销数量
     */
    public int revokeSession(String sessionId) {
        return tokenMapper.revokeBySession(sessionId);
    }

    /**
     * 撤销账号的全部有效令牌（改密或重置）。
     *
     * @param accountId 账号标识
     * @return 撤销数量
     */
    public int revokeAccount(long accountId) {
        return tokenMapper.revokeByAccount(accountId);
    }

    /**
     * 计算令牌摘要。
     *
     * @param raw 令牌明文
     * @return SHA-256 十六进制摘要
     */
    public String digest(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行环境缺少 SHA-256", exception);
        }
    }

    private IssuedToken issue(long accountId, String tokenType, String sessionId, String sceneId, String clientIp,
            String userAgent) {
        LocalDateTime now = BeijingTime.now();
        LocalDateTime expiresAt = now.plusDays(properties.token().ttlDays());
        String raw = generateRawToken();
        TokenRecord record = new TokenRecord();
        record.setTokenDigest(digest(raw));
        record.setAccountId(accountId);
        record.setTokenType(tokenType);
        record.setRefreshType(REFRESH_TYPE_ACCESS);
        record.setExpiresAt(expiresAt);
        record.setSceneId(sceneId);
        record.setClientIp(clientIp);
        record.setUserAgent(truncate(userAgent, 256));
        record.setRevoked(false);
        record.setSessionId(sessionId);
        tokenMapper.insert(record);
        return new IssuedToken(raw, record.getId(), sessionId, expiresAt);
    }

    private String generateRawToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return "qs_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    /**
     * 签发结果。
     *
     * @param token 令牌明文，只返回一次
     * @param tokenId 令牌记录标识
     * @param sessionId 登录实例标识
     * @param expiresAt 到期时间，北京时间秒精度
     */
    public record IssuedToken(String token, Long tokenId, String sessionId, LocalDateTime expiresAt) {
    }
}
