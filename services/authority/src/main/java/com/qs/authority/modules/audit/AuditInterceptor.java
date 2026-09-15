package com.qs.authority.modules.audit;

import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.Json;
import com.qs.authority.common.trace.TraceContext;
import com.qs.authority.config.AuthorityProperties;
import com.qs.authority.security.AuthContext;
import com.qs.authority.security.AuthenticationInterceptor;
import com.qs.authority.security.CenterOperations;
import com.qs.authority.security.RequireOperation;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.WebUtils;
import tools.jackson.databind.JsonNode;

/**
 * 自动记录授权中心自身事件的拦截器。
 *
 * <p>成功、业务失败与权限拒绝都会落库；身份未知时账号与应用为空。
 *
 * <p>审计写失败不伪造业务失败：本拦截器在业务提交之后运行，把已经生效的写入改判为失败会让客户端
 * 重复提交。这里记录错误日志并保留真实响应；需要严格“无审计不许可”的授权判定在服务层于同一事务
 * 内写审计，写失败即回滚且不返回许可。
 */
@Component
public class AuditInterceptor implements HandlerInterceptor {

    private static final Logger LOG = LoggerFactory.getLogger(AuditInterceptor.class);

    private static final String RECORDED = "qs.audit.recorded";

    private final AuditService auditService;
    private final AuthorityProperties properties;

    /**
     * 构造审计拦截器。
     *
     * @param auditService 审计服务
     * @param properties 部署配置，用于拼装授权中心自身操作码
     */
    public AuditInterceptor(AuditService auditService, AuthorityProperties properties) {
        this.auditService = auditService;
        this.properties = properties;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        request.setAttribute(AuditAttributes.START_NANOS, System.nanoTime());
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
            Exception exception) {
        Object skipped = request.getAttribute(AuditAttributes.SKIP);
        if (Boolean.TRUE.equals(skipped)) {
            return;
        }
        if (exception != null && !response.isCommitted()) {
            // 异常尚未渲染，等待渲染后的回调再记录，才能得到真实的 code 与响应体
            return;
        }
        if (request.getAttribute(RECORDED) != null) {
            return;
        }
        request.setAttribute(RECORDED, Boolean.TRUE);

        AuditLog log = buildLog(request, response, handler, exception);
        try {
            auditService.record(log);
        } catch (RuntimeException failure) {
            // 业务已提交，不能因为审计缺失就把结果改判为失败；保留真实响应并告警。
            LOG.error("审计写入失败，本次请求缺少审计记录 traceId={} code={} 请检查审计存储与告警",
                    TraceContext.current(), responseCode(response), failure);
        }
    }

    private AuditLog buildLog(HttpServletRequest request, HttpServletResponse response, Object handler,
            Exception exception) {
        AuditLog log = new AuditLog();
        log.setTraceId(TraceContext.current());
        AuthContext.Authentication authentication = AuthContext.get();
        if (authentication != null) {
            log.setAppCode(authentication.app() == null ? null : authentication.app().appCode());
            log.setAccountId(authentication.account() == null ? null : authentication.account().id());
        }
        log.setRequestIp(AuthenticationInterceptor.clientIp(request));
        log.setUserAgent(request.getHeader("User-Agent"));
        log.setRequestBody(readRequestBody(request));
        log.setResponseBody(readResponseBody(response));
        log.setCostMs(costMillis(request));
        log.setOperationCode(operationCode(request, handler));
        log.setResourceType((String) request.getAttribute(AuditAttributes.RESOURCE_TYPE));
        log.setResourceId(resourceId(request));
        log.setReason(reason(request, response, exception));

        int code = responseCode(response);
        log.setResult(resultOf(code));
        log.setLogLevel(levelOf(code));
        return log;
    }

    private String operationCode(HttpServletRequest request, Object handler) {
        Object override = request.getAttribute(AuditAttributes.OPERATION_CODE);
        if (override instanceof String value) {
            return value;
        }
        if (handler instanceof HandlerMethod method) {
            RequireOperation required = method.getMethodAnnotation(RequireOperation.class);
            if (required == null) {
                required = method.getBeanType().getAnnotation(RequireOperation.class);
            }
            if (required != null) {
                return CenterOperations.full(properties.selfAppCode(), required.value());
            }
        }
        return null;
    }

    private String resourceId(HttpServletRequest request) {
        Object override = request.getAttribute(AuditAttributes.RESOURCE_ID);
        if (override instanceof String value) {
            return value;
        }
        String[] segments = request.getRequestURI().split("/");
        if (segments.length >= 6) {
            String candidate = segments[5];
            if (candidate.chars().allMatch(Character::isDigit)) {
                return candidate;
            }
        }
        return null;
    }

    private String reason(HttpServletRequest request, HttpServletResponse response, Exception exception) {
        Object override = request.getAttribute(AuditAttributes.REASON);
        if (override instanceof String value) {
            return value;
        }
        if (exception != null) {
            return exception.getMessage();
        }
        String message = responseMessage(response);
        return message == null ? "请求处理完成" : message;
    }

    private String responseMessage(HttpServletResponse response) {
        String body = readResponseBody(response);
        if (body == null) {
            return null;
        }
        try {
            JsonNode node = Json.readTree(body).get("message");
            return node != null && node.isString() ? node.asString() : null;
        } catch (RuntimeException exception) {
            // 非统一响应体：没有可用的原因文本，交由调用方使用默认值
            return null;
        }
    }

    private Integer costMillis(HttpServletRequest request) {
        Object start = request.getAttribute(AuditAttributes.START_NANOS);
        if (start instanceof Long nanos) {
            return (int) ((System.nanoTime() - nanos) / 1_000_000L);
        }
        return null;
    }

    private String readRequestBody(HttpServletRequest request) {
        ContentCachingRequestWrapper wrapper = WebUtils.getNativeRequest(request, ContentCachingRequestWrapper.class);
        if (wrapper == null) {
            return null;
        }
        byte[] content = wrapper.getContentAsByteArray();
        return content.length == 0 ? null : new String(content, StandardCharsets.UTF_8);
    }

    private String readResponseBody(HttpServletResponse response) {
        ContentCachingResponseWrapper wrapper = WebUtils.getNativeResponse(response,
                ContentCachingResponseWrapper.class);
        if (wrapper == null) {
            return null;
        }
        byte[] content = wrapper.getContentAsByteArray();
        return content.length == 0 ? null : new String(content, StandardCharsets.UTF_8);
    }

    private int responseCode(HttpServletResponse response) {
        String body = readResponseBody(response);
        if (body != null) {
            try {
                JsonNode node = Json.readTree(body).get("code");
                if (node != null && node.isNumber()) {
                    return node.asInt();
                }
            } catch (RuntimeException exception) {
                // 非统一响应体（例如容器错误页）：退回 HTTP 状态判断
                return response.getStatus();
            }
        }
        return response.getStatus();
    }

    private String resultOf(int code) {
        if (code == ErrorCode.SUCCESS.code()) {
            return "success";
        }
        return switch (code) {
            case 40101, 40102, 40103, 40104, 40301, 40302, 40303 -> "denied";
            default -> "failure";
        };
    }

    private String levelOf(int code) {
        if (code == ErrorCode.SUCCESS.code()) {
            return "info";
        }
        return switch (code) {
            case 50001, 50301 -> "error";
            default -> "warn";
        };
    }

}
