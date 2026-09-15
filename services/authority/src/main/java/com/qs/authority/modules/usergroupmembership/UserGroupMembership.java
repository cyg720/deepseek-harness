package com.qs.authority.modules.usergroupmembership;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户组成员记录，对应表 {@code qs__auth__user_group_account}。
 *
 * <p>加入用户组只表示该账号属于这一跨部门人员集合，不增加任何功能权限：权限仍只按账号或组织
 * 显式关联的权限组计算。
 */
@Getter
@Setter
public class UserGroupMembership {

    private Long id;
    private Long userGroupId;
    private Long accountId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
