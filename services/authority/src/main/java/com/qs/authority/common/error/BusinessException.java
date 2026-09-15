package com.qs.authority.common.error;

import com.qs.authority.common.error.ErrorData.FieldErrorItem;
import com.qs.authority.common.error.ErrorData.ReferenceItem;
import java.util.List;

/** 业务异常：携带平台公约错误码、字段错误或引用冲突。 */
public class BusinessException extends RuntimeException {

    private final transient ErrorCode errorCode;
    private final transient List<FieldErrorItem> fieldErrors;
    private final transient List<ReferenceItem> references;

    private BusinessException(ErrorCode errorCode, String message, List<FieldErrorItem> fieldErrors,
            List<ReferenceItem> references) {
        super(message);
        this.errorCode = errorCode;
        this.fieldErrors = fieldErrors;
        this.references = references;
    }

    /**
     * 使用错误码的默认提示构造异常。
     *
     * @param errorCode 平台公约错误码
     * @return 业务异常
     */
    public static BusinessException of(ErrorCode errorCode) {
        return new BusinessException(errorCode, errorCode.defaultMessage(), null, null);
    }

    /**
     * 使用自定义提示构造异常。
     *
     * @param errorCode 平台公约错误码
     * @param message 人工可读提示
     * @return 业务异常
     */
    public static BusinessException of(ErrorCode errorCode, String message) {
        return new BusinessException(errorCode, message, null, null);
    }

    /**
     * 构造单个字段错误。
     *
     * @param field 字段名
     * @param message 错误说明
     * @return 40001 业务异常
     */
    public static BusinessException invalidField(String field, String message) {
        return new BusinessException(ErrorCode.INVALID_FIELD, ErrorCode.INVALID_FIELD.defaultMessage(),
                List.of(new FieldErrorItem(field, message)), null);
    }

    /**
     * 构造多字段错误。
     *
     * @param fieldErrors 字段错误列表
     * @return 40001 业务异常
     */
    public static BusinessException invalidFields(List<FieldErrorItem> fieldErrors) {
        return new BusinessException(ErrorCode.INVALID_FIELD, ErrorCode.INVALID_FIELD.defaultMessage(), fieldErrors, null);
    }

    /**
     * 引用冲突：返回当前操作者有权看到的引用。
     *
     * @param references 引用列表
     * @return 40903 业务异常
     */
    public static BusinessException referenced(List<ReferenceItem> references) {
        return new BusinessException(ErrorCode.REFERENCED, ErrorCode.REFERENCED.defaultMessage(), null, references);
    }

    /**
     * 引用冲突：只提示存在无权查看的关联。
     *
     * @return 40903 业务异常
     */
    public static BusinessException referencedHidden() {
        return new BusinessException(ErrorCode.REFERENCED, ErrorCode.REFERENCED.defaultMessage(), null,
                List.of(new ReferenceItem("hidden", null, "存在无权查看的关联")));
    }

    /**
     * 平台公约错误码。
     *
     * @return 错误码
     */
    public ErrorCode errorCode() {
        return errorCode;
    }

    /**
     * 字段错误。
     *
     * @return 字段错误列表，无则为空列表
     */
    public List<FieldErrorItem> fieldErrors() {
        return fieldErrors == null ? List.of() : fieldErrors;
    }

    /**
     * 引用冲突详情。
     *
     * @return 引用列表，无则为空列表
     */
    public List<ReferenceItem> references() {
        return references == null ? List.of() : references;
    }
}
