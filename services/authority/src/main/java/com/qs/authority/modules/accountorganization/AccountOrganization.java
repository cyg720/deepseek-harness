package com.qs.authority.modules.accountorganization;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 账号与组织的关联记录，对应表 {@code qs__auth__account_organization}。
 *
 * <p>一个账号可以同时关联多个组织，不设主部门字段；关联本身不授予权限，账号取得的权限组只按
 * 权限组关联记录计算。
 */
@Getter
@Setter
public class AccountOrganization {

    private Long id;
    private Long accountId;
    private Long orgId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
