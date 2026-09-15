package com.qs.authority.modules.authorizationcheck;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 鉴权接口模型。
 *
 * <p>请求只包含目标操作与可选事件信息；授权中心不返回行级数据范围，具体数据能否访问由业务
 * 应用自行判断。
 */
public final class AuthorizationCheckDtos {

    private AuthorizationCheckDtos() {
    }

    /**
     * 鉴权请求。
     *
     * @param operationCode 完整操作码，必须以所属应用编码加点号开头
     * @param resourceId 可选事件对象标识；不参与授权判定
     * @param resourceType 可选业务事件类型；不参与授权判定
     */
    public record CheckRequest(
            @NotBlank(message = "请输入操作码") @Size(max = 128, message = "长度不能超过 128 个字符") String operationCode,
            @Size(max = 128, message = "长度不能超过 128 个字符") String resourceId,
            @Size(max = 64, message = "长度不能超过 64 个字符") String resourceType) {
    }

    /**
     * 鉴权允许结果。
     *
     * @param allowed 固定为 true；拒绝时使用 40301 或 40302 错误响应
     * @param operationCode 被检查的操作码
     * @param appCode 操作所属应用编码
     * @param accountId 当前登录账号标识
     */
    public record CheckResponse(boolean allowed, String operationCode, String appCode, String accountId) {
    }
}
