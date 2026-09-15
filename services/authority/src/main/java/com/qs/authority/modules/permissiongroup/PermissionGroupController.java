package com.qs.authority.modules.permissiongroup;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.permissiongroup.PermissionGroupDtos.CreateRequest;
import com.qs.authority.modules.permissiongroup.PermissionGroupDtos.Detail;
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
 * 权限组接口（API-07）。
 *
 * <p>路径前缀 {@code /api/v1/auth/permission-groups}；调用方必须是授权中心自身应用，且登录账号
 * 拥有对应已登记操作。operationIds 提交即整体替换且每个元素必须是已登记操作；删除需要
 * {@code ?version=}，重复删除返回 40401，有引用返回 40903。
 */
@RestController
@RequestMapping("/api/v1/auth/permission-groups")
@SelfAppOnly
@Tag(name = "权限组管理", description = "权限组增改删查与操作集合维护")
public class PermissionGroupController {

    private final PermissionGroupService permissionGroupService;

    /**
     * 构造控制器。
     *
     * @param permissionGroupService 权限组服务
     */
    public PermissionGroupController(PermissionGroupService permissionGroupService) {
        this.permissionGroupService = permissionGroupService;
    }

    /**
     * 新增权限组。
     *
     * @param request 新增请求
     * @return 新增后的权限组
     */
    @PostMapping
    @RequireOperation(CenterOperations.PermissionGroup.CREATE)
    @Operation(summary = "新增权限组", description = "operationIds 省略表示空数组；每个元素必须是已登记操作，重复元素返回 40001")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(permissionGroupService.create(request));
    }

    /**
     * 分页查询权限组。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param name 名称精确筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.PermissionGroup.LIST)
    @Operation(summary = "权限组列表", description = "支持 name 精确筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String name,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, PermissionGroupService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, PermissionGroupService.sortColumns(), "id",
                "desc");
        return ApiResponse.ok(permissionGroupService.list(query, name));
    }

    /**
     * 权限组详情。
     *
     * @param id 权限组标识
     * @return 权限组详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.PermissionGroup.DETAIL)
    @Operation(summary = "权限组详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(permissionGroupService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑权限组。
     *
     * @param id 权限组标识
     * @param body PATCH 请求体
     * @return 编辑后的权限组
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.PermissionGroup.UPDATE)
    @Operation(summary = "编辑权限组", description = "可写字段：name、description、operationIds；提交 operationIds 时整体替换该集合")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(permissionGroupService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除权限组。
     *
     * @param id 权限组标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.PermissionGroup.DELETE)
    @Operation(summary = "删除权限组", description = "被应用可见范围、用户或组织关联引用时返回 40903，不牵连删除任何记录")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        permissionGroupService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
