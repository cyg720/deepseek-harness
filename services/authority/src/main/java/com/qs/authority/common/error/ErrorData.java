package com.qs.authority.common.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 错误响应的 data 内容。
 *
 * <p>错误 data 固定为对象且包含 traceId；字段错误可附 fieldErrors，引用冲突可附 references。
 *
 * @param traceId 服务器生成的诊断标识
 * @param fieldErrors 字段级错误，可为空
 * @param references 阻止删除时当前操作者有权看到的引用，可为空
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorData(String traceId, List<FieldErrorItem> fieldErrors, List<ReferenceItem> references) {

    /**
     * 只有诊断标识的错误内容。
     *
     * @param traceId 服务器生成的诊断标识
     * @return 错误 data
     */
    public static ErrorData of(String traceId) {
        return new ErrorData(traceId, null, null);
    }

    /**
     * 带字段错误的错误内容。
     *
     * @param traceId 服务器生成的诊断标识
     * @param fieldErrors 字段级错误
     * @return 错误 data
     */
    public static ErrorData ofFields(String traceId, List<FieldErrorItem> fieldErrors) {
        return new ErrorData(traceId, fieldErrors, null);
    }

    /**
     * 带引用冲突的错误内容。
     *
     * @param traceId 服务器生成的诊断标识
     * @param references 有权查看的引用
     * @return 错误 data
     */
    public static ErrorData ofReferences(String traceId, List<ReferenceItem> references) {
        return new ErrorData(traceId, null, references);
    }

    /**
     * 单个字段错误。
     *
     * @param field 字段名
     * @param message 人工可读说明
     */
    public record FieldErrorItem(String field, String message) {
    }

    /**
     * 一条阻止删除的引用。
     *
     * @param type 引用类型，如 account、permissionGroup
     * @param id 引用对象标识；无权查看时为 null
     * @param description 说明；无权查看时为“存在无权查看的关联”
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReferenceItem(String type, String id, String description) {
    }
}
