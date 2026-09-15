package com.qs.authority.common.trace;

import java.util.UUID;
import org.slf4j.MDC;

/**
 * 当前请求的全链路追踪标识。
 *
 * <p>审计日志、错误响应与访问日志共用同一标识；服务器生成，不接受客户端传入的任意字符串。
 */
public final class TraceContext {

    private static final String MDC_KEY = "traceId";

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private TraceContext() {
    }

    /**
     * 生成并绑定新的追踪标识。
     *
     * @return 新标识
     */
    public static String start() {
        String traceId = UUID.randomUUID().toString();
        CURRENT.set(traceId);
        MDC.put(MDC_KEY, traceId);
        return traceId;
    }

    /**
     * 当前追踪标识；尚未绑定时生成一个，保证错误响应始终带 traceId。
     *
     * @return 追踪标识
     */
    public static String current() {
        String traceId = CURRENT.get();
        if (traceId == null) {
            return start();
        }
        return traceId;
    }

    /**
     * 清除当前线程绑定。
     */
    public static void clear() {
        CURRENT.remove();
        MDC.remove(MDC_KEY);
    }
}
