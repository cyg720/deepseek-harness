package com.qs.authority.modules.usergroupmembership;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.usergroupmembership.UserGroupMembershipDtos.CreateRequest;
import com.qs.authority.modules.usergroupmembership.UserGroupMembershipDtos.Detail;
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
 * 用户组成员接口（API-15）。
 *
 * <p>路径前缀 {@code /api/v1/auth/user-group-memberships}；调用方必须是授权中心自身应用，且登录
 * 账号拥有对应已登记操作。删除需要 {@code ?version=}，重复删除返回 40401。
 */
@RestController
@RequestMapping("/api/v1/auth/user-group-memberships")
@SelfAppOnly
@Tag(name = "用户组成员", description = "用户组成员的增改删查；加入用户组不增加功能权限")
public class UserGroupMembershipController {

    private final UserGroupMembershipService userGroupMembershipService;

    /**
     * 构造控制器。
     *
     * @param userGroupMembershipService 用户组成员服务
     */
    public UserGroupMembershipController(UserGroupMembershipService userGroupMembershipService) {
        this.userGroupMembershipService = userGroupMembershipService;
    }

    /**
     * 新增成员。
     *
     * @param request 新增请求
     * @return 新增后的成员关系
     */
    @PostMapping
    @RequireOperation(CenterOperations.UserGroupMembership.CREATE)
    @Operation(summary = "新增用户组成员", description = "用户组与账号都必须存在；同一组合重复返回 40902")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(userGroupMembershipService.create(request));
    }

    /**
     * 分页查询成员。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param userGroupId 用户组标识筛选
     * @param accountId 账号标识筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.UserGroupMembership.LIST)
    @Operation(summary = "用户组成员列表", description = "支持 userGroupId、accountId 筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String userGroupId,
            @RequestParam(required = false) String accountId,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, UserGroupMembershipService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, UserGroupMembershipService.sortColumns(),
                "id", "desc");
        return ApiResponse.ok(userGroupMembershipService.list(query, userGroupId, accountId));
    }

    /**
     * 成员详情。
     *
     * @param id 成员关系标识
     * @return 成员详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.UserGroupMembership.DETAIL)
    @Operation(summary = "用户组成员详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(userGroupMembershipService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑成员关系。
     *
     * @param id 成员关系标识
     * @param body PATCH 请求体
     * @return 编辑后的成员关系
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.UserGroupMembership.UPDATE)
    @Operation(summary = "编辑用户组成员", description = "可写字段：userGroupId、accountId；提交的一端与未提交的"
            + "另一端组成完整组合整体替换，必须提交读取时的 version")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(userGroupMembershipService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除成员关系。
     *
     * @param id 成员关系标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.UserGroupMembership.DELETE)
    @Operation(summary = "删除用户组成员", description = "只解除该账号与用户组的关系，不删除用户组、账号或其他成员关系")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        userGroupMembershipService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
