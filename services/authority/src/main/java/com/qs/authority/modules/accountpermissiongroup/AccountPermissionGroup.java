package com.qs.authority.modules.accountpermissiongroup;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户权限组关联，对应表 {@code qs__auth__permission_group_account}。
 *
 * <p>一行表示某账号取得某权限组；唯一约束保证同一组合不重复。表结构没有 updated_by 列，
 * 修改人只能由下游审计日志追溯。
 */
@Getter
@Setter
public class AccountPermissionGroup {

    private Long id;
    private Long permissionGroupId;
    private Long accountId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long version;
}
