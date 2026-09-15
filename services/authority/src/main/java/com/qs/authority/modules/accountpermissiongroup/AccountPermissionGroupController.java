package com.qs.authority.modules.accountpermissiongroup;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.accountpermissiongroup.AccountPermissionGroupDtos.CreateRequest;
import com.qs.authority.modules.accountpermissiongroup.AccountPermissionGroupDtos.Detail;
import com.qs.authority.security.CenterOperations;
import com.qs.authority.security.RequireOperation;
import com.qs.authority.security.SelfAppOnly;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
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
 * 用户权限组关联接口（API-08）。
 *
 * <p>路径前缀 {@code /api/v1/auth/account-permission-groups}；调用方必须是授权中心自身应用，
 * 且登录账号拥有对应已登记操作。账号与权限组都必须已存在，同一组合返回 40902；删除只解除
 * 该条关联，需要 {@code ?version=}，重复删除返回 40401。
 */
@RestController
@RequestMapping("/api/v1/auth/account-permission-groups")
@SelfAppOnly
@Tag(name = "用户权限组关联", description = "用户与权限组关联的增改删查")
public class AccountPermissionGroupController {

    private final AccountPermissionGroupService accountPermissionGroupService;

    /**
     * 构造控制器。
     *
     * @param accountPermissionGroupService 用户权限组关联服务
     */
    public AccountPermissionGroupController(AccountPermissionGroupService accountPermissionGroupService) {
        this.accountPermissionGroupService = accountPermissionGroupService;
    }

    /**
     * 新增用户权限组关联。
     *
     * @param request 新增请求
     * @return 新增后的关联
     */
    @PostMapping
    @RequireOperation(CenterOperations.AccountPermissionGroup.CREATE)
    @Operation(summary = "新增用户权限组关联", description = "权限组与账号都必须存在；同一组合已存在返回 40902")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(accountPermissionGroupService.create(request));
    }

    /**
     * 分页查询用户权限组关联。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param permissionGroupId 权限组标识筛选
     * @param accountId 账号标识筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.AccountPermissionGroup.LIST)
    @Operation(summary = "用户权限组关联列表", description = "支持 permissionGroupId、accountId 筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String permissionGroupId,
            @RequestParam(required = false) String accountId,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, AccountPermissionGroupService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder,
                AccountPermissionGroupService.sortColumns(), "id", "desc");
        return ApiResponse.ok(accountPermissionGroupService.list(query,
                Ids.parse(permissionGroupId, "permissionGroupId"), Ids.parse(accountId, "accountId")));
    }

    /**
     * 用户权限组关联详情。
     *
     * @param id 关联标识
     * @return 关联详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.AccountPermissionGroup.DETAIL)
    @Operation(summary = "用户权限组关联详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(accountPermissionGroupService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑用户权限组关联。
     *
     * @param id 关联标识
     * @param body PATCH 请求体
     * @return 编辑后的关联
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.AccountPermissionGroup.UPDATE)
    @Operation(summary = "编辑用户权限组关联", description = "可写字段：permissionGroupId、accountId；替换后组合重复返回 40902")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(accountPermissionGroupService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除用户权限组关联。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.AccountPermissionGroup.DELETE)
    @Operation(summary = "删除用户权限组关联", description = "只解除该条用户与权限组的关联，不删除权限组或账号")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        accountPermissionGroupService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
