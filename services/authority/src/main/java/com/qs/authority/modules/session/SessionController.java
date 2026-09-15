package com.qs.authority.modules.session;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.session.SessionDtos.LoginRequest;
import com.qs.authority.modules.session.SessionDtos.SceneTokenRequest;
import com.qs.authority.modules.session.SessionDtos.SceneTokenResponse;
import com.qs.authority.modules.session.SessionDtos.TokenResponse;
import com.qs.authority.security.AllowPasswordChange;
import com.qs.authority.security.Anonymous;
import com.qs.authority.security.AuthContext;
import com.qs.authority.security.AuthenticationInterceptor;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * 令牌与会话接口（API-10、API-17）。
 *
 * <p>三个入口都要求有效的 {@code X-App-Key}：登录不要求已有用户令牌，换发与退出从当前令牌
 * 确定登录实例，不接受客户端指定的其他设备标识。
 */
@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "令牌与会话", description = "登录、令牌换发、退出当前设备与场景令牌")
public class SessionController {

    private static final Set<String> LOGOUT_PARAMS = Set.of();

    private final SessionService sessionService;

    /**
     * 构造控制器。
     *
     * @param sessionService 会话服务
     */
    public SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    /**
     * 账号密码登录。
     *
     * @param request 登录请求
     * @param httpRequest 原始请求，用于提取客户端信息
     * @return 新令牌；响应禁止缓存
     */
    @PostMapping("/sessions/login")
    @Anonymous
    @Operation(summary = "登录", description = "签发新的 30 天令牌，不撤销其他设备令牌；响应包含是否必须先修改初始密码")
    public ResponseEntity<ApiResponse<TokenResponse>> login(@Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, Set.of());
        TokenResponse response = sessionService.login(request, AuthenticationInterceptor.clientIp(httpRequest),
                httpRequest.getHeader("User-Agent"));
        return noStore(response);
    }

    /**
     * 换发令牌。
     *
     * @param httpRequest 原始请求
     * @return 新令牌；响应禁止缓存
     */
    @PostMapping("/sessions/renew")
    @AllowPasswordChange
    @Operation(summary = "换发令牌", description = "剩余有效期严格不足阈值时撤销旧令牌并签发新令牌，登录实例不变；未到窗口返回 40904")
    public ResponseEntity<ApiResponse<TokenResponse>> renew(HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, Set.of());
        TokenResponse response = sessionService.renew(AuthContext.requireToken(),
                AuthenticationInterceptor.clientIp(httpRequest), httpRequest.getHeader("User-Agent"));
        return noStore(response);
    }

    /**
     * 退出当前设备。
     *
     * @param body 请求体必须为空；客户端不能指定其他设备
     * @param httpRequest 原始请求
     * @return 无业务数据的成功响应
     */
    @PostMapping("/sessions/logout")
    @AllowPasswordChange
    @Operation(summary = "退出当前设备", description = "只撤销当前登录实例下的令牌；重复退出因令牌已撤销返回 40103")
    public ApiResponse<Void> logout(@RequestBody(required = false) Map<String, JsonNode> body,
            HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, LOGOUT_PARAMS);
        if (body != null && !body.isEmpty()) {
            String field = body.keySet().iterator().next();
            throw BusinessException.invalidField(field, "退出不接受请求体字段，只能退出当前设备");
        }
        sessionService.logout(AuthContext.requireToken());
        return ApiResponse.ok();
    }

    /**
     * 签发场景令牌。
     *
     * @param request 场景令牌请求
     * @param httpRequest 原始请求
     * @return 场景令牌；响应禁止缓存
     */
    @PostMapping("/scene-tokens")
    @AllowPasswordChange
    @Operation(summary = "签发场景令牌", description = "按当前登录账号签发 Scene-Token，沿用当前登录实例并遵守同一有效期规则")
    public ResponseEntity<ApiResponse<SceneTokenResponse>> issueSceneToken(
            @Valid @RequestBody SceneTokenRequest request, HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, Set.of());
        SceneTokenResponse response = sessionService.issueSceneToken(request.sceneId(), AuthContext.requireToken(),
                AuthenticationInterceptor.clientIp(httpRequest), httpRequest.getHeader("User-Agent"));
        return noStore(response);
    }

    private ResponseEntity<ApiResponse<TokenResponse>> noStore(TokenResponse response) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(ApiResponse.ok(response));
    }

    private ResponseEntity<ApiResponse<SceneTokenResponse>> noStore(SceneTokenResponse response) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(ApiResponse.ok(response));
    }
}
