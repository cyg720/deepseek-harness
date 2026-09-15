package com.qs.authority.modules.accountpermissiongroup;

import jakarta.validation.constraints.NotBlank;

/**
 * 用户权限组关联接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输；时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}。
 * 表结构没有 updated_by 列，响应不含修改人。
 */
public final class AccountPermissionGroupDtos {

    private AccountPermissionGroupDtos() {
    }

    /**
     * 新增用户权限组关联请求。
     *
     * @param permissionGroupId 权限组标识，必须存在
     * @param accountId 账号标识，必须存在
     */
    public record CreateRequest(@NotBlank(message = "请输入权限组标识") String permissionGroupId,
            @NotBlank(message = "请输入账号标识") String accountId) {
    }

    /**
     * 用户权限组关联响应字段。
     *
     * @param id 关联标识
     * @param permissionGroupId 权限组标识
     * @param accountId 账号标识
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param version 当前版本
     */
    public record Detail(String id, String permissionGroupId, String accountId, String createdAt, String updatedAt,
            String createdBy, String version) {
    }
}
