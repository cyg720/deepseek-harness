package com.qs.authority.common.error;

import com.qs.authority.common.api.ApiResponse;
import com.qs.authority.common.error.ErrorData.FieldErrorItem;
import com.qs.authority.common.trace.TraceContext;
import jakarta.validation.ConstraintViolationException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.ObjectError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import tools.jackson.databind.exc.UnrecognizedPropertyException;

/**
 * 统一异常出口：所有失败都转换为平台公约响应，且不泄露堆栈、SQL 或其他账号的信息。
 *
 * <p>50001 只返回服务器生成的诊断标识；数据库唯一、外键与检查约束作为兜底映射，业务规则仍应在
 * 服务层先行判断。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger LOG = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * 业务异常。
     *
     * @param exception 业务异常
     * @return 平台公约错误响应
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleBusiness(BusinessException exception) {
        ErrorCode code = exception.errorCode();
        ErrorData data;
        if (!exception.fieldErrors().isEmpty()) {
            data = ErrorData.ofFields(TraceContext.current(), exception.fieldErrors());
        } else if (!exception.references().isEmpty()) {
            data = ErrorData.ofReferences(TraceContext.current(), exception.references());
        } else {
            data = ErrorData.of(TraceContext.current());
        }
        return ResponseEntity.status(code.httpStatus()).body(ApiResponse.fail(code.code(), exception.getMessage(), data));
    }

    /**
     * 请求体字段校验失败。
     *
     * @param exception 校验异常
     * @return 40001 响应
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleValidation(MethodArgumentNotValidException exception) {
        List<FieldErrorItem> errors = new ArrayList<>();
        for (ObjectError error : exception.getBindingResult().getAllErrors()) {
            String field = error instanceof org.springframework.validation.FieldError fieldError
                    ? fieldError.getField()
                    : error.getObjectName();
            errors.add(new FieldErrorItem(field, defaultMessage(error)));
        }
        return invalidFields(errors);
    }

    /**
     * 查询参数校验失败。
     *
     * @param exception 校验异常
     * @return 40001 响应
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleConstraint(ConstraintViolationException exception) {
        List<FieldErrorItem> errors = new ArrayList<>();
        exception.getConstraintViolations().forEach(violation -> errors
                .add(new FieldErrorItem(String.valueOf(violation.getPropertyPath()), violation.getMessage())));
        return invalidFields(errors);
    }

    /**
     * 请求体无法解析或包含未知字段。
     *
     * @param exception 解析异常
     * @return 40001 响应
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleUnreadable(HttpMessageNotReadableException exception) {
        Throwable cause = exception.getMostSpecificCause();
        if (cause instanceof UnrecognizedPropertyException unrecognized) {
            return invalidFields(List.of(new FieldErrorItem(unrecognized.getPropertyName(),
                    "未知字段或只读字段，不允许提交")));
        }
        LOG.warn("请求体解析失败 traceId={} cause={}", TraceContext.current(), cause.getMessage());
        return invalidFields(List.of(new FieldErrorItem("body", "请求体不是合法的 JSON 或字段类型不正确")));
    }

    /**
     * 缺少必填查询参数。
     *
     * @param exception 参数异常
     * @return 40001 响应
     */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleMissingParameter(MissingServletRequestParameterException exception) {
        return invalidFields(List.of(new FieldErrorItem(exception.getParameterName(), "缺少必填查询参数")));
    }

    /**
     * 参数类型不匹配。
     *
     * @param exception 类型异常
     * @return 40001 响应
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleTypeMismatch(MethodArgumentTypeMismatchException exception) {
        return invalidFields(List.of(new FieldErrorItem(exception.getName(), "参数格式不正确")));
    }

    /**
     * 请求方法不支持。
     *
     * @param exception 方法异常
     * @return 40001 响应
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleMethod(HttpRequestMethodNotSupportedException exception) {
        return ResponseEntity.status(ErrorCode.INVALID_FIELD.httpStatus())
                .body(ApiResponse.fail(ErrorCode.INVALID_FIELD.code(), "该路径不支持此请求方法",
                        ErrorData.of(TraceContext.current())));
    }

    /**
     * 路径不存在。
     *
     * @param exception 资源异常
     * @return 40401 响应
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleNoResource(NoResourceFoundException exception) {
        return ResponseEntity.status(ErrorCode.NOT_FOUND.httpStatus())
                .body(ApiResponse.fail(ErrorCode.NOT_FOUND.code(), ErrorCode.NOT_FOUND.defaultMessage(),
                        ErrorData.of(TraceContext.current())));
    }

    /**
     * 唯一值并发冲突：按 40902 返回，不覆盖既有记录。
     *
     * @param exception 唯一约束异常
     * @return 40902 响应
     */
    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleDuplicate(DuplicateKeyException exception) {
        LOG.warn("唯一约束拒绝请求 traceId={}", TraceContext.current());
        return ResponseEntity.status(ErrorCode.DUPLICATE.httpStatus())
                .body(ApiResponse.fail(ErrorCode.DUPLICATE.code(), ErrorCode.DUPLICATE.defaultMessage(),
                        ErrorData.of(TraceContext.current())));
    }

    /**
     * 数据库约束兜底：按 SQLState 区分唯一冲突（23505）、外键引用（23503）与其他检查约束。
     *
     * @param exception 数据完整性异常
     * @return 平台公约错误响应
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleIntegrity(DataIntegrityViolationException exception) {
        String sqlState = sqlState(exception);
        ErrorCode code = switch (sqlState) {
            case "23505" -> ErrorCode.DUPLICATE;
            case "23503" -> ErrorCode.REFERENCED;
            default -> ErrorCode.INVALID_FIELD;
        };
        LOG.warn("数据库约束拒绝请求 traceId={} sqlState={} code={}", TraceContext.current(), sqlState, code.code());
        return ResponseEntity.status(code.httpStatus())
                .body(ApiResponse.fail(code.code(), code.defaultMessage(), ErrorData.of(TraceContext.current())));
    }

    private String sqlState(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof java.sql.SQLException sqlException && sqlException.getSQLState() != null) {
                return sqlException.getSQLState();
            }
            current = current.getCause();
        }
        return "";
    }

    /**
     * 数据库不可用。
     *
     * @param exception 连接异常
     * @return 50301 响应
     */
    @ExceptionHandler(DataAccessResourceFailureException.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleUnavailable(DataAccessResourceFailureException exception) {
        LOG.error("依赖数据库不可用 traceId={}", TraceContext.current(), exception);
        return ResponseEntity.status(ErrorCode.DEPENDENCY_UNAVAILABLE.httpStatus())
                .body(ApiResponse.fail(ErrorCode.DEPENDENCY_UNAVAILABLE.code(),
                        ErrorCode.DEPENDENCY_UNAVAILABLE.defaultMessage(), ErrorData.of(TraceContext.current())));
    }

    /**
     * 未预期异常：不返回堆栈与 SQL，只给出诊断标识。
     *
     * @param exception 未预期异常
     * @return 50001 响应
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<ErrorData>> handleUnexpected(Exception exception) {
        LOG.error("内部处理失败 traceId={}", TraceContext.current(), exception);
        return ResponseEntity.status(ErrorCode.INTERNAL_ERROR.httpStatus())
                .body(ApiResponse.fail(ErrorCode.INTERNAL_ERROR.code(), ErrorCode.INTERNAL_ERROR.defaultMessage(),
                        ErrorData.of(TraceContext.current())));
    }

    private ResponseEntity<ApiResponse<ErrorData>> invalidFields(List<FieldErrorItem> errors) {
        return ResponseEntity.status(ErrorCode.INVALID_FIELD.httpStatus())
                .body(ApiResponse.fail(ErrorCode.INVALID_FIELD.code(), ErrorCode.INVALID_FIELD.defaultMessage(),
                        ErrorData.ofFields(TraceContext.current(), errors)));
    }

    private String defaultMessage(ObjectError error) {
        return error.getDefaultMessage() == null ? "字段不合法" : error.getDefaultMessage();
    }
}
