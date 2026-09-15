package com.qs.authority.modules.authorizationcheck;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.authorizationcheck.AuthorizationCheckDtos.CheckRequest;
import com.qs.authority.modules.authorizationcheck.AuthorizationCheckDtos.CheckResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Set;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 鉴权入口（API-11）。
 *
 * <p>业务应用或工具携带当前登录人的 token 与自己的 AppKey 调用；AppKey 标识实际调用应用，
 * 不强制等于被检查操作所属的应用。拒绝返回 40301 或 40302，不返回任何行级数据范围。
 */
@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "应用鉴权", description = "验证当前登录账号在目标应用中的操作权限")
public class AuthorizationCheckController {

    private final AuthorizationCheckService service;

    /**
     * 构造控制器。
     *
     * @param service 鉴权服务
     */
    public AuthorizationCheckController(AuthorizationCheckService service) {
        this.service = service;
    }

    /**
     * 验证应用授权。
     *
     * @param request 鉴权请求
     * @param httpRequest 原始请求，用于校验未支持的查询参数
     * @return 允许结果；拒绝时返回 40301 或 40302
     */
    @PostMapping("/authorization-checks")
    @Operation(summary = "验证应用授权", description = "依次检查 AppKey、用户令牌、账号状态、应用可见性与操作权限；允许结果在返回前写入审计")
    public ApiResponse<CheckResponse> check(@Valid @RequestBody CheckRequest request,
            HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, Set.of());
        return ApiResponse.ok(service.check(request));
    }
}
