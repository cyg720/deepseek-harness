package com.qs.authority.modules.permissiongroup;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 权限组接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输；{@code operationIds} 是操作稳定标识的十进制字符串数组，
 * 提交数组时整体替换；时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}。
 */
public final class PermissionGroupDtos {

    private PermissionGroupDtos() {
    }

    /**
     * 新增权限组请求。
     *
     * @param name 权限组名称，不能为空
     * @param description 权限组描述，可为空
     * @param operationIds 操作稳定标识列表；省略或 null 表示空集合，空数组表示不授予任何操作的权限组
     */
    public record CreateRequest(
            @NotBlank(message = "请输入权限组名称") @Size(max = 128, message = "长度不能超过 128 个字符") String name,
            @Size(max = 512, message = "长度不能超过 512 个字符") String description,
            List<String> operationIds) {
    }

    /**
     * 权限组响应字段。
     *
     * @param id 权限组标识
     * @param name 权限组名称
     * @param description 权限组描述
     * @param operationIds 操作标识列表，保持库中顺序
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String name, String description, List<String> operationIds, String createdAt,
            String updatedAt, String createdBy, String updatedBy, String version) {
    }
}
