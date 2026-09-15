package com.qs.authority.modules.organization;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 组织接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}；
 * {@code parentId} 为 "0" 表示根组织。
 */
public final class OrganizationDtos {

    private OrganizationDtos() {
    }

    /**
     * 新增组织请求。
     *
     * @param parentId 父组织标识；省略或 "0" 表示根组织
     * @param orgName 组织名称
     * @param orgType company:单位, plant:厂区, department:部门, post:岗位, team:班组
     * @param leader 负责人姓名
     * @param sortOrder 排序顺序；省略时为 0
     * @param remark 备注
     */
    public record CreateRequest(
            @Size(max = 64, message = "长度不能超过 64 个字符") String parentId,
            @NotBlank(message = "请输入组织名称") @Size(max = 128, message = "长度不能超过 128 个字符") String orgName,
            @NotBlank(message = "请选择组织类型") @Size(max = 32, message = "长度不能超过 32 个字符") String orgType,
            @Size(max = 64, message = "长度不能超过 64 个字符") String leader,
            @Min(value = 0, message = "请输入大于等于 0 的整数") Integer sortOrder,
            @Size(max = 512, message = "长度不能超过 512 个字符") String remark) {
    }

    /**
     * 组织响应字段。
     *
     * @param id 组织标识
     * @param parentId 父组织标识，根组织为 "0"
     * @param orgPath 物化路径
     * @param orgName 组织名称
     * @param orgType 组织类型
     * @param leader 负责人姓名
     * @param sortOrder 排序顺序
     * @param remark 备注
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String parentId, String orgPath, String orgName, String orgType, String leader,
            Integer sortOrder, String remark, String createdAt, String updatedAt, String createdBy, String updatedBy,
            String version) {
    }
}
