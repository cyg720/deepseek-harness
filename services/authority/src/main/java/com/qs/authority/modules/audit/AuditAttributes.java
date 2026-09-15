package com.qs.authority.modules.audit;

import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 审计拦截器使用的请求属性名。
 *
 * <p>业务接口可通过这些属性补充审计上下文，或声明本次请求无需自动记录（已由服务内写入，
 * 例如授权判定的允许结果必须在返回许可前入库）。
 */
public final class AuditAttributes {

    /** 跳过自动记录，取值 {@code Boolean.TRUE}。 */
    public static final String SKIP = "qs.audit.skip";

    /** 本次事件的操作码。 */
    public static final String OPERATION_CODE = "qs.audit.operationCode";

    /** 本次事件的对象标识。 */
    public static final String RESOURCE_ID = "qs.audit.resourceId";

    /** 本次事件的对象类型。 */
    public static final String RESOURCE_TYPE = "qs.audit.resourceType";

    /** 本次事件的原因说明。 */
    public static final String REASON = "qs.audit.reason";

    /** 请求开始时刻（纳秒），由审计拦截器在进入处理器前写入。 */
    public static final String START_NANOS = "qs.audit.startNanos";

    private AuditAttributes() {
    }

    /**
     * 标记当前请求已由服务内写入审计，拦截器不再重复记录。
     */
    public static void markSkip() {
        set(SKIP, Boolean.TRUE);
    }

    /**
     * 本次请求已耗时毫秒数；请求尚未进入拦截器链时返回 null。
     *
     * @return 毫秒数，未知时为 null
     */
    public static Integer elapsedMillis() {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes == null) {
            return null;
        }
        Object start = attributes.getRequest().getAttribute(START_NANOS);
        if (start instanceof Long nanos) {
            return (int) ((System.nanoTime() - nanos) / 1_000_000L);
        }
        return null;
    }

    /**
     * 记录本次事件的对象与操作码，供自动审计使用。
     *
     * @param operationCode 操作码，可为 null
     * @param resourceId 对象标识，可为 null
     * @param resourceType 对象类型，可为 null
     */
    public static void markTarget(String operationCode, String resourceId, String resourceType) {
        set(OPERATION_CODE, operationCode);
        set(RESOURCE_ID, resourceId);
        set(RESOURCE_TYPE, resourceType);
    }

    private static void set(String name, Object value) {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            attributes.getRequest().setAttribute(name, value);
        }
    }
}
