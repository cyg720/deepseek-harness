package com.qs.authority.modules.openapi;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.account.AccountDtos;
import com.qs.authority.modules.openapi.OpenUserDtos.PermissionsResponse;
import com.qs.authority.security.AllowPasswordChange;
import com.qs.authority.security.AuthContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Set;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 开放能力接口（API-14）。
 *
 * <p>供已接入应用读取当前登录账号的详情与在目标应用内的可用操作；接口不接受目标账号标识，
 * 不能冒用他人身份，也不返回任何秘密字段。
 */
@RestController
@RequestMapping("/api/v1/auth/users")
@Tag(name = "开放能力", description = "当前用户详情与目标应用内的可用操作")
public class OpenUserController {

    private static final Set<String> ME_PARAMS = Set.of();
    private static final Set<String> PERMISSION_PARAMS = Set.of("appCode");

    private final OpenUserService openUserService;

    /**
     * 构造控制器。
     *
     * @param openUserService 开放能力服务
     */
    public OpenUserController(OpenUserService openUserService) {
        this.openUserService = openUserService;
    }

    /**
     * 当前登录账号详情。
     *
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 获准账号字段
     */
    @GetMapping("/me")
    @AllowPasswordChange
    @Operation(summary = "获取当前用户详情", description = "始终返回当前令牌对应的账号，不接受指定其他账号；首次登录的受限身份也可读取本人信息")
    public ApiResponse<AccountDtos.Detail> me(HttpServletRequest request) {
        QueryParams.assertOnly(request, ME_PARAMS);
        return ApiResponse.ok(openUserService.me(AuthContext.requireAccount().id()));
    }

    /**
     * 当前账号在目标应用内可用的操作。
     *
     * @param appCode 目标应用编码
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 应用可见性与可用操作
     */
    @GetMapping("/me/permissions")
    @Operation(summary = "获取当前用户权限", description = "传目标 appCode；应用不可见返回 40301，不返回数据范围")
    public ApiResponse<PermissionsResponse> permissions(@RequestParam String appCode, HttpServletRequest request) {
        QueryParams.assertOnly(request, PERMISSION_PARAMS);
        return ApiResponse.ok(openUserService.permissions(AuthContext.requireAccount(), appCode));
    }
}
