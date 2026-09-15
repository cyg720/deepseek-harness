package com.qs.authority.modules.organization;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.organization.OrganizationDtos.CreateRequest;
import com.qs.authority.modules.organization.OrganizationDtos.Detail;
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
 * 组织接口（API-02）。
 *
 * <p>路径前缀 {@code /api/v1/auth/organizations}；调用方必须是授权中心自身应用，且登录账号拥有
 * 对应已登记操作。删除需要 {@code ?version=}，重复删除返回 40401，有子组织或关联返回 40903。
 */
@RestController
@RequestMapping("/api/v1/auth/organizations")
@SelfAppOnly
@Tag(name = "组织管理", description = "组织结构增改删查；编辑 parentId 表示移动子树")
public class OrganizationController {

    private final OrganizationService organizationService;

    /**
     * 构造控制器。
     *
     * @param organizationService 组织服务
     */
    public OrganizationController(OrganizationService organizationService) {
        this.organizationService = organizationService;
    }

    /**
     * 新增组织。
     *
     * @param request 新增请求
     * @return 新增后的组织
     */
    @PostMapping
    @RequireOperation(CenterOperations.Organization.CREATE)
    @Operation(summary = "新增组织", description = "省略 parentId 或提交 0 建为根组织；父组织必须存在，物化路径在插入时一次成型")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(organizationService.create(request));
    }

    /**
     * 分页查询组织。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param parentId 父组织标识精确筛选
     * @param orgType 组织类型筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.Organization.LIST)
    @Operation(summary = "组织列表", description = "支持 parentId、orgType 筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String parentId,
            @RequestParam(required = false) String orgType,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, OrganizationService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, OrganizationService.sortColumns(), "id",
                "desc");
        return ApiResponse.ok(organizationService.list(query, parentId, orgType));
    }

    /**
     * 组织详情。
     *
     * @param id 组织标识
     * @return 组织详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.Organization.DETAIL)
    @Operation(summary = "组织详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(organizationService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑组织。
     *
     * @param id 组织标识
     * @param body PATCH 请求体
     * @return 编辑后的组织
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.Organization.UPDATE)
    @Operation(summary = "编辑组织", description = "可写字段：parentId、orgName、orgType、leader、sortOrder、remark；"
            + "提交 parentId 即移动该组织及其全部后代，必须提交读取时的 version")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(organizationService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除组织。
     *
     * @param id 组织标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.Organization.DELETE)
    @Operation(summary = "删除组织", description = "有子组织、账号组织关联或组织权限组关联时返回 40903，不牵连删除任何记录")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        organizationService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
