package com.qs.authority.modules.accountorganization;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.accountorganization.AccountOrganizationDtos.CreateRequest;
import com.qs.authority.modules.accountorganization.AccountOrganizationDtos.Detail;
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
 * 账号与组织关联接口（API-15）。
 *
 * <p>路径前缀 {@code /api/v1/auth/account-organizations}；调用方必须是授权中心自身应用，且登录
 * 账号拥有对应已登记操作。删除需要 {@code ?version=}，重复删除返回 40401。
 */
@RestController
@RequestMapping("/api/v1/auth/account-organizations")
@SelfAppOnly
@Tag(name = "账号组织关联", description = "账号与组织关联的增改删查；一个账号可关联多个组织")
public class AccountOrganizationController {

    private final AccountOrganizationService accountOrganizationService;

    /**
     * 构造控制器。
     *
     * @param accountOrganizationService 账号与组织关联服务
     */
    public AccountOrganizationController(AccountOrganizationService accountOrganizationService) {
        this.accountOrganizationService = accountOrganizationService;
    }

    /**
     * 新增关联。
     *
     * @param request 新增请求
     * @return 新增后的关联
     */
    @PostMapping
    @RequireOperation(CenterOperations.AccountOrganization.CREATE)
    @Operation(summary = "新增账号组织关联", description = "账号与组织都必须存在；同一组合重复返回 40902")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(accountOrganizationService.create(request));
    }

    /**
     * 分页查询关联。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param accountId 账号标识筛选
     * @param orgId 组织标识筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.AccountOrganization.LIST)
    @Operation(summary = "账号组织关联列表", description = "支持 accountId、orgId 筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String accountId,
            @RequestParam(required = false) String orgId,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, AccountOrganizationService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, AccountOrganizationService.sortColumns(),
                "id", "desc");
        return ApiResponse.ok(accountOrganizationService.list(query, accountId, orgId));
    }

    /**
     * 关联详情。
     *
     * @param id 关联标识
     * @return 关联详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.AccountOrganization.DETAIL)
    @Operation(summary = "账号组织关联详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(accountOrganizationService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑关联。
     *
     * @param id 关联标识
     * @param body PATCH 请求体
     * @return 编辑后的关联
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.AccountOrganization.UPDATE)
    @Operation(summary = "编辑账号组织关联", description = "可写字段：accountId、orgId；提交的一端与未提交的"
            + "另一端组成完整组合整体替换，必须提交读取时的 version")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(accountOrganizationService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除关联。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.AccountOrganization.DELETE)
    @Operation(summary = "删除账号组织关联", description = "只解除该条账号与组织的关系，不删除账号、组织或其他关联")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        accountOrganizationService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
