package com.qs.authority.modules.appauthorization;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.CreateRequest;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.CreateResponse;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.Detail;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.ListItem;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.StateSyncRequest;
import com.qs.authority.security.AppCenterOnly;
import com.qs.authority.security.AppCenterOrOperation;
import com.qs.authority.security.CenterOperations;
import com.qs.authority.security.RequireOperation;
import com.qs.authority.security.SelfAppOnly;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
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
 * 应用授权接口（API-11）。
 *
 * <p>建立授权记录与状态同步只接受应用中心受控调用；可见权限组的配置由授权中心的权限管理员
 * 完成；详情与列表对应用中心和授权中心管理员同时开放。授权中心没有应用注册、冻结或下线入口。
 */
@RestController
@RequestMapping("/api/v1/auth/application-authorizations")
@Tag(name = "应用授权", description = "建立授权记录、配置可见权限组、查询与状态同步")
public class ApplicationAuthorizationController {

    private final ApplicationAuthorizationService service;

    /**
     * 构造控制器。
     *
     * @param service 应用授权服务
     */
    public ApplicationAuthorizationController(ApplicationAuthorizationService service) {
        this.service = service;
    }

    /**
     * 建立应用授权记录。
     *
     * @param request 建立请求
     * @return 含 AppKey 与一次性 AppSecret 的响应
     */
    @PostMapping
    @AppCenterOnly
    @Operation(summary = "建立授权记录", description = "应用中心登记应用后调用；应用编码唯一，重复返回 40902 且不更新原 AppKey")
    public ApiResponse<CreateResponse> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(service.create(request));
    }

    /**
     * 分页查询授权记录。
     *
     * @param page 页码
     * @param pageSize 每页条数
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param appCode 应用编码筛选
     * @param status 状态筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @AppCenterOrOperation(CenterOperations.ApplicationAuthorization.LIST)
    @Operation(summary = "授权列表", description = "支持 appCode、status 筛选；不返回 AppSecret")
    public ApiResponse<Paged<ListItem>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String appCode,
            @RequestParam(required = false) String status,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, ApplicationAuthorizationService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder,
                ApplicationAuthorizationService.sortColumns(), "id", "desc");
        return ApiResponse.ok(service.list(query, appCode, status));
    }

    /**
     * 授权详情。
     *
     * @param id 授权记录标识
     * @return 授权详情，含 AppKey 与当前可见权限组，不含 AppSecret
     */
    @GetMapping("/{id}")
    @AppCenterOrOperation(CenterOperations.ApplicationAuthorization.DETAIL)
    @Operation(summary = "授权详情", description = "不返回 AppKey 或 AppSecret；应用凭据只在建立授权记录的一次性响应中交付")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(service.detail(Ids.require(id, "id")));
    }

    /**
     * 配置应用可见权限组，整体替换集合。
     *
     * @param id 授权记录标识
     * @param body PATCH 请求体
     * @return 配置后的授权详情
     */
    @PatchMapping("/{id}")
    @SelfAppOnly
    @RequireOperation(CenterOperations.ApplicationAuthorization.CONFIGURE)
    @Operation(summary = "配置可见权限组", description = "只接受 permissionGroupIds 与 version；空数组表示普通用户不可见")
    public ApiResponse<Detail> configure(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(service.configure(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 应用中心受控同步应用状态。
     *
     * @param id 授权记录标识
     * @param request 状态同步请求
     * @return 同步后的授权详情
     */
    @PostMapping("/{id}/state-sync")
    @AppCenterOnly
    @Operation(summary = "同步应用状态", description = "只接受 active、frozen、offline；旧 version 返回 40901，记录与组关联不删除")
    public ApiResponse<Detail> stateSync(@PathVariable String id, @Valid @RequestBody StateSyncRequest request) {
        return ApiResponse.ok(service.stateSync(Ids.require(id, "id"), request.status(),
                Ids.require(request.version(), "version")));
    }
}
