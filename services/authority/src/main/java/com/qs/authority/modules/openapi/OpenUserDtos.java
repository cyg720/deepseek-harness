package com.qs.authority.modules.openapi;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 开放能力接口模型（API-14）。
 *
 * <p>开放接口复用同一套身份与权限计算，只返回获准字段，不返回密码散列、令牌摘要或应用密钥。
 */
public final class OpenUserDtos {

    private OpenUserDtos() {
    }

    /**
     * 当前应用内的一个可用操作。
     *
     * @param id 操作标识
     * @param operationCode 完整操作码
     * @param operationName 操作名称
     */
    public record OperationItem(String id, String operationCode, String operationName) {
    }

    /**
     * 当前用户权限查询结果。
     *
     * @param appCode 目标应用编码
     * @param appVisible 目标应用对当前账号是否可见
     * @param operations 当前账号在该应用内可用的操作；超级管理员为该应用全部已登记操作
     */
    public record PermissionsResponse(String appCode, boolean appVisible, List<OperationItem> operations) {
    }

    /**
     * 本人修改密码请求。
     *
     * @param oldPassword 原密码
     * @param newPassword 新密码，至少 8 位且同时包含数字、字母与特殊字符
     */
    public record ChangePasswordRequest(
            @NotBlank(message = "请输入原密码") @Size(max = 64, message = "长度不能超过 64 个字符") String oldPassword,
            @NotBlank(message = "请输入新密码") @Size(max = 64, message = "长度不能超过 64 个字符") String newPassword) {
    }

    /**
     * 首次登录修改初始密码请求。
     *
     * @param newPassword 新密码，至少 8 位且同时包含数字、字母与特殊字符
     */
    public record InitialPasswordRequest(
            @NotBlank(message = "请输入新密码") @Size(max = 64, message = "长度不能超过 64 个字符") String newPassword) {
    }
}
