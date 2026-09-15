package com.qs.authority.modules.operation;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.operation.OperationDtos.CreateRequest;
import com.qs.authority.modules.operation.OperationDtos.Detail;
import com.qs.authority.security.Anonymous;
import com.qs.authority.security.AppCenterOnly;
import com.qs.authority.security.AppCenterOrOperation;
import com.qs.authority.security.CenterOperations;
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
 * 操作登记接口（API-06）。
 *
 * <p>路径前缀 {@code /api/v1/auth/operations}。登记与改名是应用中心的受控服务间调用：AppKey 必须
 * 等于配置的应用中心 AppKey，不携带用户 token，也不需要授权中心的已登记操作。列表与详情是双主体
 * 接口：应用中心上报后可以立即回查现状，授权中心自身应用下的持权账号也可以查看已登记操作。
 * 本接口不提供删除。
 */
@RestController
@RequestMapping("/api/v1/auth/operations")
@Tag(name = "操作登记", description = "应用功能操作的上报、改名、详情与列表；不提供删除接口")
public class OperationController {

    private final OperationService operationService;

    /**
     * 构造控制器。
     *
     * @param operationService 操作服务
     */
    public OperationController(OperationService operationService) {
        this.operationService = operationService;
    }

    /**
     * 登记操作。
     *
     * @param request 登记请求
     * @return 登记后的操作
     */
    @PostMapping
    @AppCenterOnly
    @Anonymous
    @Operation(summary = "登记操作", description = "appCode 必须有授权记录；operationCode 必须以 appCode 加点号开头且全平台唯一")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(operationService.create(request));
    }

    /**
     * 分页查询操作。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param appCode 应用编码精确筛选
     * @param operationCode 完整操作码精确筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @AppCenterOrOperation(CenterOperations.Operation.LIST)
    @Operation(summary = "操作列表", description = "支持 appCode、operationCode 精确筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String appCode,
            @RequestParam(required = false) String operationCode,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, OperationService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, OperationService.sortColumns(), "id", "desc");
        return ApiResponse.ok(operationService.list(query, appCode, operationCode));
    }

    /**
     * 操作详情。
     *
     * @param id 操作标识
     * @return 操作详情
     */
    @GetMapping("/{id}")
    @AppCenterOrOperation(CenterOperations.Operation.DETAIL)
    @Operation(summary = "操作详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(operationService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑操作：改名或改完整码。
     *
     * @param id 操作标识
     * @param body PATCH 请求体
     * @return 编辑后的操作
     */
    @PatchMapping("/{id}")
    @AppCenterOnly
    @Anonymous
    @Operation(summary = "操作改名", description = "可写字段：operationCode、operationName、operationDesc、resourceType；必须提交读取时的 version，appCode 不可修改")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(operationService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }
}
