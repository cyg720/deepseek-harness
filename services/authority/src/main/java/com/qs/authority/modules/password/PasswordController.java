package com.qs.authority.modules.password;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.openapi.OpenUserDtos.ChangePasswordRequest;
import com.qs.authority.modules.openapi.OpenUserDtos.InitialPasswordRequest;
import com.qs.authority.security.AllowPasswordChange;
import com.qs.authority.security.AuthContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 密码维护接口（API-18）。
 *
 * <p>两个入口都是本人操作，从令牌确定账号，不接受指定他人；它们与退出登录同属强制改密阶段
 * 仍可调用的接口。改密成功后当前设备令牌同样失效，需要重新登录。
 */
@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "密码维护", description = "本人改密与首次登录强制改密")
public class PasswordController {

    private final PasswordChangeService passwordChangeService;

    /**
     * 构造控制器。
     *
     * @param passwordChangeService 密码维护服务
     */
    public PasswordController(PasswordChangeService passwordChangeService) {
        this.passwordChangeService = passwordChangeService;
    }

    /**
     * 本人修改密码。
     *
     * @param request 改密请求
     * @param httpRequest 原始请求，用于校验未支持的查询参数
     * @return 无业务数据的成功响应；响应禁止缓存
     */
    @PostMapping("/password-changes")
    @AllowPasswordChange
    @Operation(summary = "本人修改密码", description = "必须验证原密码；成功后该账号全部旧令牌失效，必须重新登录")
    public ResponseEntity<ApiResponse<Void>> changePassword(@Valid @RequestBody ChangePasswordRequest request,
            HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, Set.of());
        passwordChangeService.changeOwnPassword(AuthContext.requireAccount().id(), request.oldPassword(),
                request.newPassword());
        return noStore();
    }

    /**
     * 首次登录修改初始密码。
     *
     * @param request 初始密码修改请求
     * @param httpRequest 原始请求，用于校验未支持的查询参数
     * @return 无业务数据的成功响应；响应禁止缓存
     */
    @PostMapping("/initial-password-changes")
    @AllowPasswordChange
    @Operation(summary = "修改初始密码", description = "仅强制改密状态可用；成功后解除受限状态并作废全部旧令牌")
    public ResponseEntity<ApiResponse<Void>> changeInitialPassword(@Valid @RequestBody InitialPasswordRequest request,
            HttpServletRequest httpRequest) {
        QueryParams.assertOnly(httpRequest, Set.of());
        passwordChangeService.changeInitialPassword(AuthContext.requireAccount().id(), request.newPassword());
        return noStore();
    }

    private ResponseEntity<ApiResponse<Void>> noStore() {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(ApiResponse.ok());
    }
}
