package com.qs.authority.modules.audit;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 审计日志，对应分区表 {@code qs__auth__audit_log}。
 *
 * <p>记录授权中心自身事件：登录、改密、权限配置、鉴权允许或拒绝、清理结果。身份未知时
 * {@code accountId} 与 {@code appCode} 可以为空；请求与响应体在写入前脱敏。
 */
@Getter
@Setter
public class AuditLog {

    private Long id;
    private String traceId;
    private Long accountId;
    private String appCode;
    private String operationCode;
    private String resourceId;
    private String resourceType;
    private String requestIp;
    private String userAgent;
    private String result;
    private String reason;
    private String logLevel;
    private String requestBody;
    private String responseBody;
    private Integer costMs;
    private LocalDateTime createdAt;
}
