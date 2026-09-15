package com.qs.authority.modules.usergroup;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.usergroup.UserGroupDtos.CreateRequest;
import com.qs.authority.modules.usergroup.UserGroupDtos.Detail;
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
 * 用户组接口（API-03）。
 *
 * <p>路径前缀 {@code /api/v1/auth/user-groups}；调用方必须是授权中心自身应用，且登录账号拥有
 * 对应已登记操作。删除需要 {@code ?version=}，重复删除返回 40401，有成员返回 40903。
 */
@RestController
@RequestMapping("/api/v1/auth/user-groups")
@SelfAppOnly
@Tag(name = "用户组管理", description = "用户组增改删查；只维护跨部门人员集合，不授予权限")
public class UserGroupController {

    private final UserGroupService userGroupService;

    /**
     * 构造控制器。
     *
     * @param userGroupService 用户组服务
     */
    public UserGroupController(UserGroupService userGroupService) {
        this.userGroupService = userGroupService;
    }

    /**
     * 新增用户组。
     *
     * @param request 新增请求
     * @return 新增后的用户组
     */
    @PostMapping
    @RequireOperation(CenterOperations.UserGroup.CREATE)
    @Operation(summary = "新增用户组", description = "用户组编码全局唯一，重复返回 40902；用户组不授予权限")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(userGroupService.create(request));
    }

    /**
     * 分页查询用户组。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param groupCode 用户组编码精确筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.UserGroup.LIST)
    @Operation(summary = "用户组列表", description = "支持 groupCode 精确筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String groupCode,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, UserGroupService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, UserGroupService.sortColumns(), "id", "desc");
        return ApiResponse.ok(userGroupService.list(query, groupCode));
    }

    /**
     * 用户组详情。
     *
     * @param id 用户组标识
     * @return 用户组详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.UserGroup.DETAIL)
    @Operation(summary = "用户组详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(userGroupService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑用户组。
     *
     * @param id 用户组标识
     * @param body PATCH 请求体
     * @return 编辑后的用户组
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.UserGroup.UPDATE)
    @Operation(summary = "编辑用户组", description = "可写字段：groupCode、groupName、description；"
            + "必须提交读取时的 version")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(userGroupService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除用户组。
     *
     * @param id 用户组标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.UserGroup.DELETE)
    @Operation(summary = "删除用户组", description = "仍有成员时返回 40903，不连带删除账号或成员关系")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        userGroupService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
