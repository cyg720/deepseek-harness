package com.qs.authority.modules.session;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.modules.account.Account;
import com.qs.authority.modules.account.AccountMapper;
import com.qs.authority.modules.session.SessionDtos.LoginRequest;
import com.qs.authority.modules.session.SessionDtos.SceneTokenResponse;
import com.qs.authority.modules.session.SessionDtos.TokenResponse;
import com.qs.authority.modules.token.TokenRecord;
import com.qs.authority.security.PasswordService;
import com.qs.authority.security.TokenService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 会话服务：登录、换发、退出当前设备与场景令牌签发。
 *
 * <p>每次登录签发一枚新的 30 天令牌，不撤销其他设备；剩余有效期严格不足换发阈值时换发新令牌
 * 并在同一事务内撤销旧令牌，登录实例保持不变；退出只撤销当前登录实例下的令牌。首次登录的受限
 * 身份同样可以换发与退出，但在完成改密前不能调用普通业务接口。
 *
 * <p>登录在同一事务内先锁定账号行再校验口令并签发令牌，因此与并发的改密、随机重置互斥：改密先
 * 完成时旧口令校验失败，登录先完成时其令牌会被改密的“撤销该账号全部令牌”覆盖，不会出现改密之后
 * 仍然有效的旧口令会话。
 */
@Service
public class SessionService {

    private static final Logger LOG = LoggerFactory.getLogger(SessionService.class);

    private final AccountMapper accountMapper;
    private final TokenService tokenService;
    private final PasswordService passwordService;

    /**
     * 构造会话服务。
     *
     * @param accountMapper 账号持久层
     * @param tokenService 令牌服务
     * @param passwordService 口令服务
     */
    public SessionService(AccountMapper accountMapper, TokenService tokenService, PasswordService passwordService) {
        this.accountMapper = accountMapper;
        this.tokenService = tokenService;
        this.passwordService = passwordService;
    }

    /**
     * 账号密码登录。
     *
     * @param request 登录请求
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     * @return 新令牌信息
     * @throws BusinessException 凭据无效返回 40101（不区分账号不存在、非自然人账号或密码错误），
     *     账号冻结返回 40302
     */
    @Transactional
    public TokenResponse login(LoginRequest request, String clientIp, String userAgent) {
        // 锁定账号行：与改密、重置、冻结串行化，避免旧口令在撤销完成后继续签发令牌。
        Account account = accountMapper.findByUsernameForUpdate(request.username().trim());
        // 统一按“凭据无效”拒绝：不透露账号是否存在，也不透露是否为服务账号。
        if (account == null || !passwordService.matches(request.password(), account.getPassword())) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        if (!account.normal()) {
            throw BusinessException.of(ErrorCode.SUBJECT_UNAVAILABLE, "账号已冻结");
        }
        TokenService.IssuedToken issued = tokenService.issueMaster(account.getId(), clientIp, userAgent);
        accountMapper.touchLastLogin(account.getId(), BeijingTime.now());
        return toResponse(issued, account);
    }

    /**
     * 换发令牌：仅当剩余有效期严格不足换发阈值时允许。
     *
     * @param current 当前令牌记录
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     * @return 新令牌信息，登录实例与旧令牌一致
     * @throws BusinessException 尚未进入换发窗口返回 40904，旧令牌已被换发或撤销返回 40103
     */
    @Transactional
    public TokenResponse renew(TokenRecord current, String clientIp, String userAgent) {
        if (!tokenService.renewable(current)) {
            throw BusinessException.of(ErrorCode.STATE_CONFLICT, "尚未进入换发窗口，无需换发");
        }
        TokenService.IssuedToken issued = tokenService.renew(current, clientIp, userAgent);
        Account account = accountMapper.findById(current.getAccountId());
        if (account == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        return toResponse(issued, account);
    }

    /**
     * 退出当前设备：只撤销当前登录实例下的令牌。
     *
     * @param current 当前令牌记录
     * @return 被撤销的令牌数量
     */
    @Transactional
    public int logout(TokenRecord current) {
        int revoked = tokenService.revokeSession(current.getSessionId());
        LOG.info("退出当前设备 sessionId={} 撤销令牌数={}", current.getSessionId(), revoked);
        return revoked;
    }

    /**
     * 为当前登录账号签发场景令牌。
     *
     * @param sceneId 场景标识
     * @param current 当前令牌记录
     * @param clientIp 客户端 IP
     * @param userAgent 用户代理
     * @return 场景令牌信息
     */
    @Transactional
    public SceneTokenResponse issueSceneToken(String sceneId, TokenRecord current, String clientIp, String userAgent) {
        TokenService.IssuedToken issued = tokenService.issueScene(current.getAccountId(), current.getSessionId(),
                sceneId, clientIp, userAgent);
        return new SceneTokenResponse(issued.token(), BeijingTime.format(issued.expiresAt()), sceneId,
                issued.sessionId());
    }

    /**
     * 组装登录与换发响应。
     *
     * @param issued 签发结果
     * @param account 账号记录
     * @return 响应模型
     */
    private TokenResponse toResponse(TokenService.IssuedToken issued, Account account) {
        return new TokenResponse(issued.token(), BeijingTime.format(issued.expiresAt()), issued.sessionId(),
                Ids.of(account.getId()), account.getUsername(), Boolean.TRUE.equals(account.getMustChangePassword()),
                account.superAdmin());
    }
}
