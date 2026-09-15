package com.qs.authority.modules.audit;

import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import java.util.Map;

/**
 * 审计日志接口模型。
 *
 * <p>日志只读：没有手工追加、编辑或删除接口；列表与详情返回脱敏后的请求与响应摘录。
 */
public final class AuditLogDtos {

    /** 日志列表公布的排序字段。 */
    public static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "createdAt", "created_at",
            "costMs", "cost_ms");

    private AuditLogDtos() {
    }

    /**
     * 日志响应字段。
     *
     * @param id 日志标识
     * @param createdAt 创建时间
     * @param traceId 全链路追踪标识
     * @param accountId 账号标识，未知身份时为 null
     * @param appCode 调用应用编码，未知时为 null
     * @param operationCode 操作码，可为 null
     * @param resourceId 事件对象标识，可为 null
     * @param resourceType 事件对象类型，可为 null
     * @param requestIp 请求 IP
     * @param userAgent 用户代理
     * @param result success、failure 或 denied
     * @param reason 事件原因，已脱敏
     * @param logLevel info、warn 或 error
     * @param requestBody 脱敏后的请求体
     * @param responseBody 脱敏后的响应体
     * @param costMs 接口耗时
     */
    public record Item(String id, String createdAt, String traceId, String accountId, String appCode,
            String operationCode, String resourceId, String resourceType, String requestIp, String userAgent,
            String result, String reason, String logLevel, String requestBody, String responseBody, Integer costMs) {
    }

    /**
     * 转换为响应字段。
     *
     * @param log 日志记录
     * @return 响应字段
     */
    public static Item toItem(AuditLog log) {
        return new Item(Ids.of(log.getId()), BeijingTime.format(log.getCreatedAt()), log.getTraceId(),
                Ids.of(log.getAccountId()), log.getAppCode(), log.getOperationCode(), log.getResourceId(),
                log.getResourceType(), log.getRequestIp(), log.getUserAgent(), log.getResult(), log.getReason(),
                log.getLogLevel(), log.getRequestBody(), log.getResponseBody(), log.getCostMs());
    }
}
