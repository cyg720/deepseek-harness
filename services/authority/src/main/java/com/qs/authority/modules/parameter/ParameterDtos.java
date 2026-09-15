package com.qs.authority.modules.parameter;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 参数接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}。
 */
public final class ParameterDtos {

    private ParameterDtos() {
    }

    /**
     * 新增参数请求。
     *
     * @param paramCode 参数编码，全局唯一
     * @param paramValue 参数值，去首尾空白后必须非空；可为文字或数值
     * @param description 参数描述，可为空
     */
    public record CreateRequest(
            @NotBlank(message = "请输入参数编码") @Size(max = 64, message = "长度不能超过 64 个字符") String paramCode,
            @NotBlank(message = "请输入参数值") @Size(max = 65535, message = "长度不能超过 65535 个字符") String paramValue,
            @Size(max = 512, message = "长度不能超过 512 个字符") String description) {
    }

    /**
     * 参数响应字段。
     *
     * @param id 参数标识
     * @param paramCode 参数编码
     * @param paramValue 参数值
     * @param description 参数描述
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String paramCode, String paramValue, String description, String createdAt,
            String updatedAt, String createdBy, String updatedBy, String version) {
    }
}
