package com.qs.authority.modules.audit;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.modules.audit.AuditLogDtos.Item;
import com.qs.authority.security.CenterOperations;
import com.qs.authority.security.RequireOperation;
import com.qs.authority.security.SelfAppOnly;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDateTime;
import java.util.Set;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 审计日志接口（API-13）。
 *
 * <p>只提供查询：日志由中心自身事件自动追加，超过保留期由内部任务物理删除；普通用户不能
 * 写入、修改或删除日志。
 */
@RestController
@RequestMapping("/api/v1/auth/audit-logs")
@SelfAppOnly
@Tag(name = "审计日志", description = "授权中心自身事件的只读查询")
public class AuditLogController {

    private static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "accountId",
            "appCode", "result", "createdAtFrom", "createdAtTo");

    private static final Set<String> DETAIL_PARAMS = Set.of("createdAt");

    private static final Set<String> RESULTS = Set.of("success", "failure", "denied");

    private final AuditService auditService;

    /**
     * 构造控制器。
     *
     * @param auditService 审计服务
     */
    public AuditLogController(AuditService auditService) {
        this.auditService = auditService;
    }

    /**
     * 分页查询日志。
     *
     * @param page 页码，从 1 开始
     * @param pageSize 每页条数，1 至 100
     * @param sortBy 排序字段
     * @param sortOrder 排序方向
     * @param accountId 账号筛选
     * @param appCode 应用筛选
     * @param result 结果筛选
     * @param createdAtFrom 起始时间，格式 YYYY-MM-DD HH:mm:ss
     * @param createdAtTo 结束时间，格式 YYYY-MM-DD HH:mm:ss
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 分页结果
     */
    @GetMapping
    @RequireOperation(CenterOperations.AuditLog.LIST)
    @Operation(summary = "日志列表", description = "默认按创建时间倒序再按 id 倒序；支持账号、应用、结果与时间范围筛选")
    public ApiResponse<Paged<Item>> list(
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String pageSize,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder,
            @RequestParam(required = false) String accountId,
            @RequestParam(required = false) String appCode,
            @RequestParam(required = false) String result,
            @RequestParam(required = false) String createdAtFrom,
            @RequestParam(required = false) String createdAtTo,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, LIST_PARAMS);
        PageQuery query = PageQuery.of(page, pageSize, sortBy, sortOrder, AuditLogDtos.SORT_COLUMNS, "createdAt",
                "desc");
        Long accountFilter = Ids.parse(accountId, "accountId");
        String resultFilter = QueryParams.enumValue("result", result, RESULTS);
        LocalDateTime from = createdAtFrom == null || createdAtFrom.isBlank() ? null
                : BeijingTime.parse(createdAtFrom, "createdAtFrom");
        LocalDateTime to = createdAtTo == null || createdAtTo.isBlank() ? null
                : BeijingTime.parse(createdAtTo, "createdAtTo");
        var rows = auditService.list(accountFilter, blankToNull(appCode), resultFilter, from, to, query.orderBy(),
                query.pageSize(), query.offset());
        long total = auditService.count(accountFilter, blankToNull(appCode), resultFilter, from, to);
        return ApiResponse.ok(new Paged<>(rows.stream().map(AuditLogDtos::toItem).toList(), query.page(),
                query.pageSize(), total));
    }

    /**
     * 日志详情；日志主键是 id 与创建时间的组合，因此必须同时提交 createdAt。
     *
     * @param id 日志标识
     * @param createdAt 创建时间，格式 YYYY-MM-DD HH:mm:ss
     * @param request 原始请求，用于校验未支持的查询参数
     * @return 日志详情
     */
    @GetMapping("/{id}")
    @RequireOperation(CenterOperations.AuditLog.DETAIL)
    @Operation(summary = "日志详情", description = "复合定位：路径参数 id 与查询参数 createdAt 必须同时提供")
    public ApiResponse<Item> detail(@PathVariable String id, @RequestParam String createdAt,
            HttpServletRequest request) {
        QueryParams.assertOnly(request, DETAIL_PARAMS);
        AuditLog log = auditService.findById(Ids.require(id, "id"), BeijingTime.parse(createdAt, "createdAt"));
        if (log == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return ApiResponse.ok(AuditLogDtos.toItem(log));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
