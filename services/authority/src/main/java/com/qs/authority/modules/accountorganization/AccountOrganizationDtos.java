package com.qs.authority.modules.accountorganization;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 账号与组织关联接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}。
 */
public final class AccountOrganizationDtos {

    private AccountOrganizationDtos() {
    }

    /**
     * 新增关联请求。
     *
     * @param accountId 账号标识，账号必须存在
     * @param orgId 组织标识，组织必须存在
     */
    public record CreateRequest(
            @NotBlank(message = "请选择账号") @Size(max = 64, message = "长度不能超过 64 个字符") String accountId,
            @NotBlank(message = "请选择组织") @Size(max = 64, message = "长度不能超过 64 个字符") String orgId) {
    }

    /**
     * 关联响应字段。
     *
     * @param id 关联标识
     * @param accountId 账号标识
     * @param orgId 组织标识
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String accountId, String orgId, String createdAt, String updatedAt,
            String createdBy, String updatedBy, String version) {
    }
}
