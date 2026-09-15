package com.qs.authority.modules.operation;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 操作接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}。
 */
public final class OperationDtos {

    private OperationDtos() {
    }

    /**
     * 登记操作请求。
     *
     * @param appCode 操作所属应用编码，必须已存在授权记录
     * @param operationCode 完整操作码，必须以 {@code appCode + "."} 开头且全平台唯一
     * @param operationName 操作名称
     * @param operationDesc 操作描述，可为空
     * @param resourceType 可选业务事件类型，可为空
     */
    public record CreateRequest(
            @NotBlank(message = "请输入应用编码") @Size(max = 64, message = "长度不能超过 64 个字符") String appCode,
            @NotBlank(message = "请输入完整操作码") @Size(max = 128, message = "长度不能超过 128 个字符") String operationCode,
            @NotBlank(message = "请输入操作名称") @Size(max = 128, message = "长度不能超过 128 个字符") String operationName,
            @Size(max = 512, message = "长度不能超过 512 个字符") String operationDesc,
            @Size(max = 64, message = "长度不能超过 64 个字符") String resourceType) {
    }

    /**
     * 操作响应字段。
     *
     * @param id 操作标识，改名后保持不变
     * @param appCode 操作所属应用编码
     * @param operationCode 完整操作码
     * @param operationName 操作名称
     * @param operationDesc 操作描述
     * @param resourceType 可选业务事件类型
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String appCode, String operationCode, String operationName, String operationDesc,
            String resourceType, String createdAt, String updatedAt, String createdBy, String updatedBy,
            String version) {
    }
}
