package com.qs.authority.modules.organizationpermissiongroup;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 组织权限组关联，对应表 {@code qs__auth__permission_group_org}。
 *
 * <p>一行表示某组织的成员取得某权限组；唯一约束保证同一组合不重复。组织上下级不自动继承，
 * 取得关系只按明确的行判断。表结构没有 updated_by 列，修改人只能由下游审计日志追溯。
 */
@Getter
@Setter
public class OrganizationPermissionGroup {

    private Long id;
    private Long permissionGroupId;
    private Long orgId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long version;
}
