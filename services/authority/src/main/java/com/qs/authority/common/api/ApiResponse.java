package com.qs.authority.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 平台公约统一响应外层。
 *
 * @param code 业务码，成功固定为 200
 * @param message 人工可读提示，客户端不据此分支
 * @param data 业务数据；无业务数据时为 null
 * @param <T> 业务数据类型
 */
public record ApiResponse<T>(int code, String message, T data) {

    /** 成功业务码。 */
    public static final int SUCCESS_CODE = 200;

    /**
     * 成功响应并携带业务数据。
     *
     * @param data 业务数据
     * @param <T> 业务数据类型
     * @return 成功响应
     */
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(SUCCESS_CODE, "成功", data);
    }

    /**
     * 成功响应且无业务数据。
     *
     * @return 成功响应，data 为 null
     */
    public static ApiResponse<Void> ok() {
        return new ApiResponse<>(SUCCESS_CODE, "成功", null);
    }

    /**
     * 失败响应。
     *
     * @param code 业务码
     * @param message 人工可读提示
     * @param data 错误数据，通常只包含 traceId
     * @return 失败响应
     */
    public static ApiResponse<com.qs.authority.common.error.ErrorData> fail(int code, String message,
            com.qs.authority.common.error.ErrorData data) {
        return new ApiResponse<>(code, message, data);
    }

    /**
     * 分页数据。
     *
     * @param items 当前页条目，超出末页为空数组
     * @param page 当前页码，从 1 开始
     * @param pageSize 每页条数
     * @param total 当前用户有权查看且符合筛选的数据总数
     * @param <T> 条目类型
     */
    public record Paged<T>(@JsonInclude(JsonInclude.Include.ALWAYS) java.util.List<T> items, int page, int pageSize,
            long total) {
    }
}
