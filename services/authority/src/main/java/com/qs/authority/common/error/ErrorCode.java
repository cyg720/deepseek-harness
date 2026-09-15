package com.qs.authority.common.error;

import org.springframework.http.HttpStatus;

/**
 * 平台公约错误码表。
 *
 * <p>HTTP 状态与 code 一一对应：客户端按 HTTP 状态和 code 判断，不匹配中文提示。
 */
public enum ErrorCode {

    /** 成功；HTTP 200。新增、删除也使用 code 200，无业务数据时 data 为 null。 */
    SUCCESS(200, HttpStatus.OK, "成功"),
    /** 字段或参数不合法；HTTP 400。 */
    INVALID_FIELD(40001, HttpStatus.BAD_REQUEST, "请检查输入内容"),
    /** 缺少或无效用户凭据；HTTP 401。 */
    INVALID_CREDENTIAL(40101, HttpStatus.UNAUTHORIZED, "登录凭据缺失或无效，请重新登录"),
    /** token 已到期；HTTP 401。 */
    TOKEN_EXPIRED(40102, HttpStatus.UNAUTHORIZED, "登录已过期，请重新登录"),
    /** token 已撤销或被新 token 替换；HTTP 401。 */
    TOKEN_REVOKED(40103, HttpStatus.UNAUTHORIZED, "当前登录凭据已失效，请重新登录"),
    /** 缺少或无效 AppKey；HTTP 401。 */
    INVALID_APP_KEY(40104, HttpStatus.UNAUTHORIZED, "应用接入凭据缺失或无效"),
    /** 没有操作权限；HTTP 403。 */
    NO_PERMISSION(40301, HttpStatus.FORBIDDEN, "没有操作权限"),
    /** 账号冻结、应用冻结或应用下线；HTTP 403。 */
    SUBJECT_UNAVAILABLE(40302, HttpStatus.FORBIDDEN, "当前身份或应用不可用"),
    /** 必须先修改初始密码；HTTP 403。 */
    PASSWORD_CHANGE_REQUIRED(40303, HttpStatus.FORBIDDEN, "请先修改初始密码"),
    /** 目标不存在；HTTP 404。 */
    NOT_FOUND(40401, HttpStatus.NOT_FOUND, "目标不存在"),
    /** 版本已变化；HTTP 409。 */
    VERSION_CONFLICT(40901, HttpStatus.CONFLICT, "数据已被他人修改，请重新读取后再提交"),
    /** 唯一值重复；HTTP 409。 */
    DUPLICATE(40902, HttpStatus.CONFLICT, "唯一值重复"),
    /** 仍有引用，不能删除；HTTP 409。 */
    REFERENCED(40903, HttpStatus.CONFLICT, "仍有引用，不能删除"),
    /** 状态冲突；HTTP 409。 */
    STATE_CONFLICT(40904, HttpStatus.CONFLICT, "当前状态不允许该操作"),
    /** 内部处理失败；HTTP 500。 */
    INTERNAL_ERROR(50001, HttpStatus.INTERNAL_SERVER_ERROR, "内部处理失败"),
    /** 依赖不可用；HTTP 503。 */
    DEPENDENCY_UNAVAILABLE(50301, HttpStatus.SERVICE_UNAVAILABLE, "依赖服务不可用，请稍后重试");

    private final int code;
    private final HttpStatus httpStatus;
    private final String defaultMessage;

    ErrorCode(int code, HttpStatus httpStatus, String defaultMessage) {
        this.code = code;
        this.httpStatus = httpStatus;
        this.defaultMessage = defaultMessage;
    }

    /**
     * 业务码。
     *
     * @return 平台公约定义的数字码
     */
    public int code() {
        return code;
    }

    /**
     * 对应 HTTP 状态。
     *
     * @return HTTP 状态
     */
    public HttpStatus httpStatus() {
        return httpStatus;
    }

    /**
     * 默认人工可读提示。
     *
     * @return 默认 message
     */
    public String defaultMessage() {
        return defaultMessage;
    }
}
