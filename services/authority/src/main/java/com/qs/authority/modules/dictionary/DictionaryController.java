package com.qs.authority.modules.dictionary;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.dictionary.DictionaryDtos.CreateRequest;
import com.qs.authority.modules.dictionary.DictionaryDtos.Detail;
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
 * 字典接口（API-05）。
 *
 * <p>路径前缀 {@code /api/v1/auth/dictionaries}；调用方必须是授权中心自身应用，且登录账号拥有
 * 对应已登记操作。字典项是字符串数组，元素非空且不重复，提交即整组替换，空数组表示清空；删除
 * 需要 {@code ?version=}，重复删除返回 40401。
 */
@RestController
@RequestMapping("/api/v1/auth/dictionaries")
@SelfAppOnly
@Tag(name = "字典管理", description = "授权中心自身字典的增改删查，字典项为字符串数组")
public class DictionaryController {

    private final DictionaryService dictionaryService;

    /**
     * 构造控制器。
     *
     * @param dictionaryService 字典服务
     */
    public DictionaryController(DictionaryService dictionaryService) {
        this.dictionaryService = dictionaryService;
    }

    /**
     * 新增字典。
     *
     * @param request 新增请求
     * @return 新增后的字典
     */
    @PostMapping
    @RequireOperation(CenterOperations.Dictionary.CREATE)
    @Operation(summary = "新增字典", description = "dictCode 全局唯一；dictItems 必须是字符串数组，元素非空且不重复，允许空数组")
    public ApiResponse<Detail> create(@Valid @RequestBody CreateRequest request) {
        return ApiResponse.ok(dictionaryService.create(request));
    }

    /**
     * 分页查询字典。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param dictCode 字典编码精确筛选
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.Dictionary.LIST)
    @Operation(summary = "字典列表", description = "支持 dictCode 精确筛选；不支持的查询参数返回 40001")
    public ApiResponse<Paged<Detail>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String dictCode,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, DictionaryService.LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, DictionaryService.sortColumns(), "id",
                "desc");
        return ApiResponse.ok(dictionaryService.list(query, dictCode));
    }

    /**
     * 字典详情。
     *
     * @param id 字典标识
     * @return 字典详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.Dictionary.DETAIL)
    @Operation(summary = "字典详情")
    public ApiResponse<Detail> detail(@PathVariable String id) {
        return ApiResponse.ok(dictionaryService.detail(Ids.require(id, "id")));
    }

    /**
     * 编辑字典。
     *
     * @param id 字典标识
     * @param body PATCH 请求体
     * @return 编辑后的字典
     */
    @PatchMapping("/{id}")
    @RequireOperation(CenterOperations.Dictionary.UPDATE)
    @Operation(summary = "编辑字典", description = "可写字段：dictCode、dictItems、description；必须提交读取时的 version，dictItems 整组替换且不可提交 null")
    public ApiResponse<Detail> update(@PathVariable String id, @RequestBody Map<String, JsonNode> body) {
        return ApiResponse.ok(dictionaryService.update(Ids.require(id, "id"), PatchBody.of(body)));
    }

    /**
     * 删除字典。
     *
     * @param id 字典标识
     * @param version 读取时版本
     * @return 无业务数据的成功响应
     */
    @DeleteMapping("/{id}")
    @RequireOperation(CenterOperations.Dictionary.DELETE)
    @Operation(summary = "删除字典", description = "字典没有引用表，直接物理删除；重复删除返回 40401")
    public ApiResponse<Void> delete(@PathVariable String id, @RequestParam String version) {
        dictionaryService.delete(Ids.require(id, "id"), Ids.require(version, "version"));
        return ApiResponse.ok();
    }
}
