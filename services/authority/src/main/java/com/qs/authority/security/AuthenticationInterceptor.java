package com.qs.authority.security;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.config.AuthorityProperties;
import com.qs.authority.modules.account.Account;
import com.qs.authority.modules.account.AccountMapper;
import com.qs.authority.modules.appauthorization.AppAuthorization;
import com.qs.authority.modules.appauthorization.AppAuthorizationMapper;
import com.qs.authority.modules.token.TokenRecord;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.annotation.Annotation;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 认证与授权拦截器：解析 AppKey 与 token，执行状态与操作权限检查。
 *
 * <p>调用顺序为：AppKey 有效且应用生效 → 用户 token 有效 → 账号未冻结 → 不在强制改密阶段 →
 * 受控身份或操作权限。任一环节失败都不返回许可；服务异常也不会退化为“无权限之外的允许路径”。
 */
@Component
public class AuthenticationInterceptor implements HandlerInterceptor {

    /** 应用身份请求头。 */
    public static final String APP_KEY_HEADER = "X-App-Key";

    private final AppAuthorizationMapper appAuthorizationMapper;
    private final AccountMapper accountMapper;
    private final TokenService tokenService;
    private final PermissionService permissionService;
    private final AuthorityProperties properties;

    /**
     * 构造拦截器。
     *
     * @param appAuthorizationMapper 应用授权持久层
     * @param accountMapper 账号持久层
     * @param tokenService 令牌服务
     * @param permissionService 权限服务
     * @param properties 部署配置
     */
    public AuthenticationInterceptor(AppAuthorizationMapper appAuthorizationMapper, AccountMapper accountMapper,
            TokenService tokenService, PermissionService permissionService, AuthorityProperties properties) {
        this.appAuthorizationMapper = appAuthorizationMapper;
        this.accountMapper = accountMapper;
        this.tokenService = tokenService;
        this.permissionService = permissionService;
        this.properties = properties;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        AppIdentity app = resolveApp(request);
        boolean appCenter = isAppCenter(app);
        boolean anonymous = find(method, Anonymous.class) != null;
        boolean appCenterOnly = find(method, AppCenterOnly.class) != null;
        AppCenterOrOperation dualSubject = find(method, AppCenterOrOperation.class);
        // 应用中心是服务间调用：以受控 AppKey 证明身份即可，不要求用户令牌。
        boolean serviceCall = appCenter && (appCenterOnly || dualSubject != null);
        boolean needsAccount = !anonymous && !serviceCall;

        AuthContext.AccountIdentity account = null;
        TokenRecord token = null;
        if (needsAccount) {
            token = tokenService.requireValid(bearerToken(request));
            account = resolveAccount(token);
            if (account.mustChangePassword() && find(method, AllowPasswordChange.class) == null) {
                throw BusinessException.of(ErrorCode.PASSWORD_CHANGE_REQUIRED);
            }
        }
        AuthContext.set(new AuthContext.Authentication(app, account, token, clientIp(request),
                request.getHeader("User-Agent")));

        if (appCenterOnly) {
            requireAppCenter(app);
        } else if (dualSubject != null) {
            if (!appCenter) {
                requireSelfApp(app);
                permissionService.requireOperation(account, dualSubject.value());
            }
        } else if (find(method, SelfAppOnly.class) != null) {
            requireSelfApp(app);
        }
        RequireOperation requiredOperation = find(method, RequireOperation.class);
        if (requiredOperation != null) {
            permissionService.requireOperation(account, requiredOperation.value());
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
            Exception exception) {
        // 认证上下文由 TraceIdFilter 在请求结束时清理，审计拦截器仍需要读取它。
    }

    private AppIdentity resolveApp(HttpServletRequest request) {
        String appKey = request.getHeader(APP_KEY_HEADER);
        if (appKey == null || appKey.isBlank()) {
            throw BusinessException.of(ErrorCode.INVALID_APP_KEY);
        }
        AppAuthorization authorization = appAuthorizationMapper.findByAppKey(appKey);
        if (authorization == null) {
            throw BusinessException.of(ErrorCode.INVALID_APP_KEY);
        }
        if (!authorization.active()) {
            throw BusinessException.of(ErrorCode.SUBJECT_UNAVAILABLE,
                    "frozen".equals(authorization.getStatus()) ? "应用已冻结" : "应用已下线");
        }
        return new AppIdentity(authorization.getId(), authorization.getAppCode(), authorization.getAppKey(),
                authorization.getStatus());
    }

    private AuthContext.AccountIdentity resolveAccount(TokenRecord record) {
        Account account = accountMapper.findById(record.getAccountId());
        if (account == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        if (!account.normal()) {
            throw BusinessException.of(ErrorCode.SUBJECT_UNAVAILABLE, "账号已冻结");
        }
        return new AuthContext.AccountIdentity(account.getId(), account.getUsername(), account.superAdmin(),
                Boolean.TRUE.equals(account.getMustChangePassword()), account.getStatus());
    }

    private void requireAppCenter(AppIdentity app) {
        if (!isAppCenter(app)) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "该接口仅接受应用中心受控调用");
        }
    }

    private boolean isAppCenter(AppIdentity app) {
        String expected = properties.appCenterAppKey();
        return expected != null && !expected.isBlank() && expected.equals(app.appKey());
    }

    private void requireSelfApp(AppIdentity app) {
        if (!properties.selfAppCode().equals(app.appCode())) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "该接口仅接受授权中心自身应用调用");
        }
    }

    private String bearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null) {
            return null;
        }
        String prefix = "Bearer ";
        if (header.length() <= prefix.length() || !header.regionMatches(true, 0, prefix, 0, prefix.length())) {
            return null;
        }
        return header.substring(prefix.length()).trim();
    }

    /**
     * 客户端 IP：优先取代理头，其次取连接地址。
     *
     * @param request 请求
     * @return 客户端 IP，最长 64 字符
     */
    public static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        String value = forwarded == null || forwarded.isBlank() ? request.getRemoteAddr() : forwarded.split(",")[0];
        value = value == null ? "" : value.trim();
        return value.length() > 64 ? value.substring(0, 64) : value;
    }

    private <A extends Annotation> A find(HandlerMethod method, Class<A> type) {
        A annotation = method.getMethodAnnotation(type);
        return annotation != null ? annotation : method.getBeanType().getAnnotation(type);
    }
}
