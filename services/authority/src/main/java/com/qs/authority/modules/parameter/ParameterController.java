package com.qs.authority.modules.parameter;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.parameter.ParameterDtos.CreateRequest;
import com.qs.authority.modules.parameter.ParameterDtos.Detail;
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
 * 参数接口（API-04）。
 *
 * <p>路径前缀 {@code /api/v1/auth/parameters}；调用方必须是授权中心自身应用，且登录账号拥有对应
 * 已登记操作。参数值去首尾空白后必须非空，保存成功后立即生效：服务不缓存参数，消费方每次从
 * 数据库读取。删除需要 {@code ?version=}，重复删除返回 40401。
 */
@RestController
@RequestMapping("/api/v1/auth/parameters")
@SelfAppOnly
@Tag(name = "参数管理", description = "授权中心自身参数的增改删查，保存后立即生效")
public class ParameterController {

    private final ParameterService parameterService;

    /**
     * 构造控制器。
     *
     * @param parameterService 参数服务
     */
    public ParameterController(ParameterService parameterService) {
        this.parameterService = parameterService;
    }

    /**
     * 新增参数。
     *
     * @param request 新增请求
     * @return 新增后的参数
     */
    @PostMapping
    @RequireOperation(CenterOperations.Parameter.CREATE)
    @Operation(summary = "新增参数", description = "paramCode 全局唯一，paramValue 去首尾空白后不得为空；保存成功后立即生效")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(parameterService.create(request));
    }

    /**
     * 分页查询参数。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param paramCode 参数编码精确筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.Parameter.LIST)
    @Operation(summary = "参数列表", description = "支持 paramCode 精确筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String paramCode,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, ParameterService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, ParameterService.sortColumns(), "id", "desc");
        return ApiResponse.ok(parameterService.list(query, paramCode));
    }

    /**
     * 参数详情。
     *
     * @param id 参数标识
     * @return 参数详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.Parameter.DETAIL)
    @Operation(summary = "参数详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(parameterService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑参数。
     *
     * @param id 参数标识
     * @param body PATCH 请求体
     * @return 编辑后的参数
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.Parameter.UPDATE)
    @Operation(summary = "编辑参数", description = "可写字段：paramCode、paramValue、description；必须提交读取时的 version，paramValue 不可清空")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(parameterService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除参数。
     *
     * @param id 参数标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.Parameter.DELETE)
    @Operation(summary = "删除参数", description = "参数没有引用表，直接物理删除；重复删除返回 40401")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        parameterService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
