package com.qs.authority.modules.account;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.account.AccountDtos.CreateRequest;
import com.qs.authority.modules.account.AccountDtos.Detail;
import com.qs.authority.modules.account.AccountDtos.PasswordResetResponse;
import com.qs.authority.modules.account.AccountDtos.VersionRequest;
import com.qs.authority.security.CenterOperations;
import com.qs.authority.security.RequireOperation;
import com.qs.authority.security.SelfAppOnly;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * 账号接口（API-01）。
 *
 * <p>路径前缀 {@code /api/v1/auth/accounts}；调用方必须是授权中心自身应用，且登录账号拥有对应
 * 已登记操作。删除需要 {@code ?version=}，重复删除返回 40401，有引用返回 40903。
 */
@RestController
@RequestMapping("/api/v1/auth/accounts")
@SelfAppOnly
@Tag(name = "账号管理", description = "账号增改删查、冻结解冻与随机重置密码")
public class AccountController {

    private final AccountService accountService;

    /**
     * 构造控制器。
     *
     * @param accountService 账号服务
     */
    public AccountController(AccountService accountService) {
        this.accountService = accountService;
    }

    /**
     * 新增账号。
     *
     * @param request 新增请求
     * @return 新增后的账号
     */
    @PostMapping
    @RequireOperation(CenterOperations.Account.CREATE)
    @Operation(summary = "新增账号", description = "自然人账号必须提交初始密码并处于强制改密状态；服务账号不得提交密码且必须配置 IP 白名单")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(accountService.create(request));
    }

    /**
     * 分页查询账号。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param username 用户名精确筛选
     * @param status 状态筛选
     * @param accountType 账号类型筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.Account.LIST)
    @Operation(summary = "账号列表", description = "支持 username、status、accountType 筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String username,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String accountType,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, AccountService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, AccountService.sortColumns(), "id", "desc");
        return ApiResponse.ok(accountService.list(query, username, status, accountType));
    }

    /**
     * 账号详情。
     *
     * @param id 账号标识
     * @return 账号详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.Account.DETAIL)
    @Operation(summary = "账号详情", description = "不返回密码散列或令牌摘要")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(accountService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑账号。
     *
     * @param id 账号标识
     * @param body PATCH 请求体
     * @return 编辑后的账号
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.Account.UPDATE)
    @Operation(summary = "编辑账号", description = "可写字段：username、phone、email、logo、remark、ipWhitelist；必须提交读取时的 version")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(accountService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除账号。
     *
     * @param id 账号标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.Account.DELETE)
    @Operation(summary = "删除账号", description = "有组织、用户组、权限组或令牌引用时返回 40903，不牵连删除任何记录")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        accountService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }

    /**
     * 冻结账号。
     *
     * @param id 账号标识
     * @param request 版本请求
     * @return 冻结后的账号
     */
    @PostMapping("/{id}/freeze")
    @RequireOperation(CenterOperations.Account.FREEZE)
    @Operation(summary = "冻结账号", description = "冻结后鉴权拒绝，令牌摘要保留；解冻后未到期未撤销的令牌可继续使用")
    public ApiResponse<Detail> freeze(@PathVariable String id, @Valid @RequestBody VersionRequest request) {
        return ApiResponse.ok(accountService.freeze(Ids.require(id, "id"), Ids.require(request.version(), "version")));
    }

    /**
     * 解冻账号。
     *
     * @param id 账号标识
     * @param request 版本请求
     * @return 解冻后的账号
     */
    @PostMapping("/{id}/unfreeze")
    @RequireOperation(CenterOperations.Account.UNFREEZE)
    @Operation(summary = "解冻账号")
    public ApiResponse<Detail> unfreeze(@PathVariable String id, @Valid @RequestBody VersionRequest request) {
        return ApiResponse.ok(accountService.unfreeze(Ids.require(id, "id"), Ids.require(request.version(),
                "version")));
    }

    /**
     * 随机重置目标账号密码并撤销其全部令牌。
     *
     * @param id 账号标识
     * @param request 版本请求
     * @return 含初始密码的成功响应；响应禁止缓存，明文只返回一次
     */
    @PostMapping("/{id}/password-reset")
    @RequireOperation(CenterOperations.Account.PASSWORD_RESET)
    @Operation(summary = "随机重置密码", description = "随机初始密码只在本次响应返回一次，目标账号全部旧令牌失效且下次登录必须改密")
    public ResponseEntity<ApiResponse<PasswordResetResponse>> resetPassword(@PathVariable String id,
            @Valid @RequestBody VersionRequest request) {
        PasswordResetResponse response = accountService.resetPassword(Ids.require(id, "id"),
                Ids.require(request.version(), "version"));
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(ApiResponse.ok(response));
    }
}
