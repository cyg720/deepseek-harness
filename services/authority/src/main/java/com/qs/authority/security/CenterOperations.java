package com.qs.authority.security;

import java.util.ArrayList;
import java.util.List;

/**
 * 授权中心自身管理操作的操作码。
 *
 * <p>完整操作码由应用编码、类名、方法名组成（BR-33）。这里的常量是去掉应用编码后的
 * {@code 类名.方法名} 部分，完整码在鉴权时由配置的授权中心应用编码拼接，因此应用编码可配置
 * 而不需要改动注解。初始化引导会把这些操作登记到授权中心自己的授权记录下。
 */
public final class CenterOperations {

    private CenterOperations() {
    }

    /** 账号管理。 */
    public static final class Account {
        /** 新增账号。 */
        public static final String CREATE = "AccountController.create";
        /** 编辑账号。 */
        public static final String UPDATE = "AccountController.update";
        /** 删除账号。 */
        public static final String DELETE = "AccountController.delete";
        /** 账号详情。 */
        public static final String DETAIL = "AccountController.detail";
        /** 账号列表。 */
        public static final String LIST = "AccountController.list";
        /** 冻结账号。 */
        public static final String FREEZE = "AccountController.freeze";
        /** 解冻账号。 */
        public static final String UNFREEZE = "AccountController.unfreeze";
        /** 随机重置他人密码。 */
        public static final String PASSWORD_RESET = "AccountController.passwordReset";

        private Account() {
        }
    }

    /** 组织管理。 */
    public static final class Organization {
        /** 新增组织。 */
        public static final String CREATE = "OrganizationController.create";
        /** 编辑组织。 */
        public static final String UPDATE = "OrganizationController.update";
        /** 删除组织。 */
        public static final String DELETE = "OrganizationController.delete";
        /** 组织详情。 */
        public static final String DETAIL = "OrganizationController.detail";
        /** 组织列表。 */
        public static final String LIST = "OrganizationController.list";

        private Organization() {
        }
    }

    /** 账号与组织关联。 */
    public static final class AccountOrganization {
        /** 新增关联。 */
        public static final String CREATE = "AccountOrganizationController.create";
        /** 编辑关联。 */
        public static final String UPDATE = "AccountOrganizationController.update";
        /** 删除关联。 */
        public static final String DELETE = "AccountOrganizationController.delete";
        /** 关联详情。 */
        public static final String DETAIL = "AccountOrganizationController.detail";
        /** 关联列表。 */
        public static final String LIST = "AccountOrganizationController.list";

        private AccountOrganization() {
        }
    }

    /** 用户组管理。 */
    public static final class UserGroup {
        /** 新增用户组。 */
        public static final String CREATE = "UserGroupController.create";
        /** 编辑用户组。 */
        public static final String UPDATE = "UserGroupController.update";
        /** 删除用户组。 */
        public static final String DELETE = "UserGroupController.delete";
        /** 用户组详情。 */
        public static final String DETAIL = "UserGroupController.detail";
        /** 用户组列表。 */
        public static final String LIST = "UserGroupController.list";

        private UserGroup() {
        }
    }

    /** 用户组成员。 */
    public static final class UserGroupMembership {
        /** 新增成员。 */
        public static final String CREATE = "UserGroupMembershipController.create";
        /** 编辑成员。 */
        public static final String UPDATE = "UserGroupMembershipController.update";
        /** 移除成员。 */
        public static final String DELETE = "UserGroupMembershipController.delete";
        /** 成员详情。 */
        public static final String DETAIL = "UserGroupMembershipController.detail";
        /** 成员列表。 */
        public static final String LIST = "UserGroupMembershipController.list";

        private UserGroupMembership() {
        }
    }

    /** 参数管理。 */
    public static final class Parameter {
        /** 新增参数。 */
        public static final String CREATE = "ParameterController.create";
        /** 编辑参数。 */
        public static final String UPDATE = "ParameterController.update";
        /** 删除参数。 */
        public static final String DELETE = "ParameterController.delete";
        /** 参数详情。 */
        public static final String DETAIL = "ParameterController.detail";
        /** 参数列表。 */
        public static final String LIST = "ParameterController.list";

        private Parameter() {
        }
    }

    /** 字典管理。 */
    public static final class Dictionary {
        /** 新增字典。 */
        public static final String CREATE = "DictionaryController.create";
        /** 编辑字典。 */
        public static final String UPDATE = "DictionaryController.update";
        /** 删除字典。 */
        public static final String DELETE = "DictionaryController.delete";
        /** 字典详情。 */
        public static final String DETAIL = "DictionaryController.detail";
        /** 字典列表。 */
        public static final String LIST = "DictionaryController.list";

        private Dictionary() {
        }
    }

    /** 操作登记与改名。 */
    public static final class Operation {
        /** 登记操作。 */
        public static final String CREATE = "OperationController.create";
        /** 操作改名或修改完整码。 */
        public static final String UPDATE = "OperationController.update";
        /** 操作详情。 */
        public static final String DETAIL = "OperationController.detail";
        /** 操作列表。 */
        public static final String LIST = "OperationController.list";

        private Operation() {
        }
    }

    /** 权限组管理。 */
    public static final class PermissionGroup {
        /** 新增权限组。 */
        public static final String CREATE = "PermissionGroupController.create";
        /** 编辑权限组。 */
        public static final String UPDATE = "PermissionGroupController.update";
        /** 删除权限组。 */
        public static final String DELETE = "PermissionGroupController.delete";
        /** 权限组详情。 */
        public static final String DETAIL = "PermissionGroupController.detail";
        /** 权限组列表。 */
        public static final String LIST = "PermissionGroupController.list";

        private PermissionGroup() {
        }
    }

    /** 用户与权限组关联。 */
    public static final class AccountPermissionGroup {
        /** 新增关联。 */
        public static final String CREATE = "AccountPermissionGroupController.create";
        /** 编辑关联。 */
        public static final String UPDATE = "AccountPermissionGroupController.update";
        /** 删除关联。 */
        public static final String DELETE = "AccountPermissionGroupController.delete";
        /** 关联详情。 */
        public static final String DETAIL = "AccountPermissionGroupController.detail";
        /** 关联列表。 */
        public static final String LIST = "AccountPermissionGroupController.list";

        private AccountPermissionGroup() {
        }
    }

    /** 组织与权限组关联。 */
    public static final class OrganizationPermissionGroup {
        /** 新增关联。 */
        public static final String CREATE = "OrganizationPermissionGroupController.create";
        /** 编辑关联。 */
        public static final String UPDATE = "OrganizationPermissionGroupController.update";
        /** 删除关联。 */
        public static final String DELETE = "OrganizationPermissionGroupController.delete";
        /** 关联详情。 */
        public static final String DETAIL = "OrganizationPermissionGroupController.detail";
        /** 关联列表。 */
        public static final String LIST = "OrganizationPermissionGroupController.list";

        private OrganizationPermissionGroup() {
        }
    }

    /** 应用授权。 */
    public static final class ApplicationAuthorization {
        /** 应用中心建立授权记录。 */
        public static final String CREATE = "ApplicationAuthorizationController.create";
        /** 配置可见权限组。 */
        public static final String CONFIGURE = "ApplicationAuthorizationController.configure";
        /** 授权详情。 */
        public static final String DETAIL = "ApplicationAuthorizationController.detail";
        /** 授权列表。 */
        public static final String LIST = "ApplicationAuthorizationController.list";
        /** 同步应用状态。 */
        public static final String STATE_SYNC = "ApplicationAuthorizationController.stateSync";

        private ApplicationAuthorization() {
        }
    }

    /** 审计日志。 */
    public static final class AuditLog {
        /** 日志列表。 */
        public static final String LIST = "AuditLogController.list";
        /** 日志详情。 */
        public static final String DETAIL = "AuditLogController.detail";

        private AuditLog() {
        }
    }

    /**
     * 全部管理操作的后缀，用于初始化登记。
     *
     * @return 操作码后缀列表
     */
    public static List<String> all() {
        List<String> operations = new ArrayList<>();
        operations.addAll(List.of(Account.CREATE, Account.UPDATE, Account.DELETE, Account.DETAIL, Account.LIST,
                Account.FREEZE, Account.UNFREEZE, Account.PASSWORD_RESET));
        operations.addAll(List.of(Organization.CREATE, Organization.UPDATE, Organization.DELETE, Organization.DETAIL,
                Organization.LIST));
        operations.addAll(List.of(AccountOrganization.CREATE, AccountOrganization.UPDATE, AccountOrganization.DELETE,
                AccountOrganization.DETAIL, AccountOrganization.LIST));
        operations.addAll(List.of(UserGroup.CREATE, UserGroup.UPDATE, UserGroup.DELETE, UserGroup.DETAIL,
                UserGroup.LIST));
        operations.addAll(List.of(UserGroupMembership.CREATE, UserGroupMembership.UPDATE,
                UserGroupMembership.DELETE, UserGroupMembership.DETAIL, UserGroupMembership.LIST));
        operations.addAll(List.of(Parameter.CREATE, Parameter.UPDATE, Parameter.DELETE, Parameter.DETAIL,
                Parameter.LIST));
        operations.addAll(List.of(Dictionary.CREATE, Dictionary.UPDATE, Dictionary.DELETE, Dictionary.DETAIL,
                Dictionary.LIST));
        operations.addAll(List.of(Operation.CREATE, Operation.UPDATE, Operation.DETAIL, Operation.LIST));
        operations.addAll(List.of(PermissionGroup.CREATE, PermissionGroup.UPDATE, PermissionGroup.DELETE,
                PermissionGroup.DETAIL, PermissionGroup.LIST));
        operations.addAll(List.of(AccountPermissionGroup.CREATE, AccountPermissionGroup.UPDATE,
                AccountPermissionGroup.DELETE, AccountPermissionGroup.DETAIL, AccountPermissionGroup.LIST));
        operations.addAll(List.of(OrganizationPermissionGroup.CREATE, OrganizationPermissionGroup.UPDATE,
                OrganizationPermissionGroup.DELETE, OrganizationPermissionGroup.DETAIL,
                OrganizationPermissionGroup.LIST));
        operations.addAll(List.of(ApplicationAuthorization.CREATE, ApplicationAuthorization.CONFIGURE,
                ApplicationAuthorization.DETAIL, ApplicationAuthorization.LIST, ApplicationAuthorization.STATE_SYNC));
        operations.addAll(List.of(AuditLog.LIST, AuditLog.DETAIL));
        return List.copyOf(operations);
    }

    /**
     * 拼接完整操作码。
     *
     * @param appCode 授权中心应用编码
     * @param suffix 操作码后缀
     * @return 完整操作码
     */
    public static String full(String appCode, String suffix) {
        return appCode + "." + suffix;
    }
}
