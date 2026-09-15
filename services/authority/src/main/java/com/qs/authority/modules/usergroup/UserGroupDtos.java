package com.qs.authority.modules.usergroup;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 用户组接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}。
 */
public final class UserGroupDtos {

    private UserGroupDtos() {
    }

    /**
     * 新增用户组请求。
     *
     * @param groupCode 用户组编码，全局唯一
     * @param groupName 用户组名称
     * @param description 用户组描述
     */
    public record CreateRequest(
            @NotBlank(message = "请输入用户组编码") @Size(max = 64, message = "长度不能超过 64 个字符") String groupCode,
            @NotBlank(message = "请输入用户组名称") @Size(max = 128, message = "长度不能超过 128 个字符") String groupName,
            @Size(max = 512, message = "长度不能超过 512 个字符") String description) {
    }

    /**
     * 用户组响应字段。
     *
     * @param id 用户组标识
     * @param groupCode 用户组编码
     * @param groupName 用户组名称
     * @param description 用户组描述
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String groupCode, String groupName, String description, String createdAt,
            String updatedAt, String createdBy, String updatedBy, String version) {
    }
}
