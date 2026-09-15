package com.qs.authority.permission;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * 应用可见性与功能权限模型验收：AC-03（可见与功能分别检查）、AC-38（超级管理员不依赖权限组）、
 * AC-41（一个应用多个可见组，任一命中即可见）；对应用例 TC-31-004、TC-31-005、TC-32-001、TC-33-001。
 *
 * <p>每个应用先登记操作、再建引用这些操作的权限组、最后配置可见组；用户只通过
 * 用户权限组关联或组织关联取得组。落库结果用 {@code jdbc()} 直接核对。
 */
@DisplayName("权限模型：可见组、功能并集、超级管理员与非法配置")
class PermissionModelIT extends AbstractAuthorityTest {

    private static final String APPLICATIONS = "/api/v1/auth/application-authorizations";
    private static final String AUTHORIZATION_CHECKS = "/api/v1/auth/authorization-checks";
    private static final String PERMISSIONS = "/api/v1/auth/users/me/permissions";
    private static final String ACCOUNT_ORGANIZATIONS = "/api/v1/auth/account-organizations";
    private static final String ORGANIZATION_PERMISSION_GROUPS = "/api/v1/auth/organization-permission-groups";
    private static final String USER_ME = "/api/v1/auth/users/me";

    @Test
    @DisplayName("TC-33-001：应用关联多个可见组，只命中一个组也可见，功能仍只按取得的组")
    void anyVisibleGroupGrantsApplicationVisibility() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("vis-app"));
        Operation owned = register(app, "DeviceController", "controlA");
        Operation other = register(app, "DeviceController", "controlB");
        String groupA = createPermissionGroup(token, unique("vis-a"), List.of(owned.id()));
        String groupB = createPermissionGroup(token, unique("vis-b"), List.of(other.id()));
        configureVisibleGroups(token, app, List.of(groupA, groupB));

        MemberSession u1 = createMember(token, unique("vis-u1"));
        MemberSession u2 = createMember(token, unique("vis-u2"));
        linkAccountToGroup(token, groupA, u1.accountId());
        linkAccountToGroup(token, groupB, u2.accountId());

        // U1 只取得 groupA，U2 只取得 groupB，两者都命中可见组
        check(app, u1.token(), owned.code()).assertCode(200);
        check(app, u2.token(), other.code()).assertCode(200);
        // 功能仍按实际取得的组：命中可见组不等于取得其他可见组的功能
        check(app, u1.token(), other.code()).assertCode(40301);
        check(app, u2.token(), owned.code()).assertCode(40301);
    }

    @Test
    @DisplayName("TC-31-004：可见组不充当功能上限，操作来自不在可见组内的其他组仍允许")
    void visibleGroupIsNotOperationCeiling() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("ceil-app"));
        Operation visibleOperation = register(app, "VisibleController", "read");
        Operation otherOperation = register(app, "OtherController", "write");
        String visibleGroup = createPermissionGroup(token, unique("ceil-visible"), List.of(visibleOperation.id()));
        String otherGroup = createPermissionGroup(token, unique("ceil-other"), List.of(otherOperation.id()));
        configureVisibleGroups(token, app, List.of(visibleGroup));

        MemberSession user = createMember(token, unique("ceil-user"));
        linkAccountToGroup(token, visibleGroup, user.accountId());
        linkAccountToGroup(token, otherGroup, user.accountId());

        check(app, user.token(), visibleOperation.code()).assertCode(200);
        // otherOperation 只属于不在可见范围里的 otherGroup，仍应允许
        check(app, user.token(), otherOperation.code()).assertCode(200);

        ApiResult permissions = self(HttpMethod.GET, PERMISSIONS + "?appCode=" + app.appCode(), user.token(), null)
                .assertCode(200);
        assertThat(permissions.booleanField("appVisible")).isTrue();
        assertThat(operationCodes(permissions)).containsExactlyInAnyOrder(visibleOperation.code(),
                otherOperation.code());
    }

    @Test
    @DisplayName("TC-31-005：应用不可见、可见但无该操作、操作未登记分别返回 40301")
    void visibilityAndFunctionAreRejectedSeparately() {
        String token = adminToken();
        AppSession visibleApp = createApplication(token, null, unique("sep-app"));
        Operation owned = register(visibleApp, "DeviceController", "control");
        Operation notOwned = register(visibleApp, "DeviceController", "reboot");
        String groupA = createPermissionGroup(token, unique("sep-a"), List.of(owned.id()));
        String groupB = createPermissionGroup(token, unique("sep-b"), List.of(notOwned.id()));
        configureVisibleGroups(token, visibleApp, List.of(groupA));

        AppSession otherApp = createApplication(token, null, unique("sep-other"));
        Operation otherOperation = register(otherApp, "DeviceController", "control");
        String otherGroup = createPermissionGroup(token, unique("sep-other-group"), List.of(otherOperation.id()));
        configureVisibleGroups(token, otherApp, List.of(otherGroup));

        MemberSession user = createMember(token, unique("sep-user"));
        // 只取得 groupA：应用可见，但 groupB 内的操作未取得
        linkAccountToGroup(token, groupA, user.accountId());

        check(visibleApp, user.token(), owned.code()).assertCode(200);
        // 应用可见但没有该操作
        check(visibleApp, user.token(), notOwned.code()).assertCode(40301);
        // 应用对该账号不可见
        check(otherApp, user.token(), otherOperation.code()).assertCode(40301);
        // 操作未登记
        check(visibleApp, user.token(), visibleApp.appCode() + ".GhostController.ghost").assertCode(40301);
    }

    @Test
    @DisplayName("AC-03：没有任何权限组的普通用户对应用不可见，查询可用操作同样返回 40301")
    void userWithoutAnyGroupIsRejected() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("none-app"));
        Operation operation = register(app, "DeviceController", "control");
        String group = createPermissionGroup(token, unique("none-group"), List.of(operation.id()));
        configureVisibleGroups(token, app, List.of(group));

        MemberSession user = createMember(token, unique("none-user"));
        check(app, user.token(), operation.code()).assertCode(40301);
        self(HttpMethod.GET, PERMISSIONS + "?appCode=" + app.appCode(), user.token(), null).assertCode(40301);
        // 身份仍然有效：开放接口本身可用
        self(HttpMethod.GET, USER_ME, user.token(), null).assertCode(200);
    }

    @Test
    @DisplayName("TC-33-001：清空应用可见组后原先可见的用户被拒绝，关联行一并清空")
    void emptyingVisibleGroupsRemovesVisibility() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("empty-app"));
        Operation operation = register(app, "DeviceController", "control");
        String group = createPermissionGroup(token, unique("empty-group"), List.of(operation.id()));
        configureVisibleGroups(token, app, List.of(group));

        MemberSession user = createMember(token, unique("empty-user"));
        linkAccountToGroup(token, group, user.accountId());
        check(app, user.token(), operation.code()).assertCode(200);
        assertThat(appGroupRows(app)).isEqualTo(1L);

        configureVisibleGroups(token, app, List.of());
        check(app, user.token(), operation.code()).assertCode(40301);
        assertThat(appGroupRows(app)).isZero();
        self(HttpMethod.GET, PERMISSIONS + "?appCode=" + app.appCode(), user.token(), null).assertCode(40301);
    }

    @Test
    @DisplayName("AC-41：可用操作是取得组内操作的并集，权限查询结果与鉴权一致")
    void operationsAreUnionOfObtainedGroups() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("union-app"));
        Operation first = register(app, "DeviceController", "controlA");
        Operation second = register(app, "DeviceController", "controlB");
        String groupA = createPermissionGroup(token, unique("union-a"), List.of(first.id()));
        String groupB = createPermissionGroup(token, unique("union-b"), List.of(second.id()));
        configureVisibleGroups(token, app, List.of(groupA, groupB));

        MemberSession user = createMember(token, unique("union-user"));
        linkAccountToGroup(token, groupA, user.accountId());
        linkAccountToGroup(token, groupB, user.accountId());

        check(app, user.token(), first.code()).assertCode(200);
        check(app, user.token(), second.code()).assertCode(200);

        ApiResult permissions = self(HttpMethod.GET, PERMISSIONS + "?appCode=" + app.appCode(), user.token(), null)
                .assertCode(200);
        assertThat(permissions.text("appCode")).isEqualTo(app.appCode());
        assertThat(permissions.booleanField("appVisible")).isTrue();
        assertThat(operationCodes(permissions)).containsExactlyInAnyOrder(first.code(), second.code());
    }

    @Test
    @DisplayName("AC-04：通过组织关联取得的权限组同样可用于鉴权，解除关联后立即失效")
    void organizationDerivedGroupGrantsOperation() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("org-app"));
        Operation operation = register(app, "DeviceController", "control");
        String group = createPermissionGroup(token, unique("org-group"), List.of(operation.id()));
        configureVisibleGroups(token, app, List.of(group));

        String orgId = createOrganization(token, unique("组织"), "department");
        MemberSession user = createMember(token, unique("org-user"));

        ApiResult organizationLink = self(HttpMethod.POST, ORGANIZATION_PERMISSION_GROUPS, token,
                Map.of("permissionGroupId", group, "orgId", orgId)).assertCode(200);
        String accountLink = linkAccountToOrganization(token, user.accountId(), orgId);
        check(app, user.token(), operation.code()).assertCode(200);

        // 解除账号与组织的关联后，组织派生的权限组不再可用
        String version = self(HttpMethod.GET, ACCOUNT_ORGANIZATIONS + "/" + accountLink, token, null)
                .assertCode(200).text("version");
        self(HttpMethod.DELETE, ACCOUNT_ORGANIZATIONS + "/" + accountLink + "?version=" + version, token, null)
                .assertCode(200);
        check(app, user.token(), operation.code()).assertCode(40301);

        // 解除组织与权限组的关联，账号重新加入组织仍无该操作
        self(HttpMethod.DELETE, ORGANIZATION_PERMISSION_GROUPS + "/" + organizationLink.text("id")
                + "?version=" + organizationLink.text("version"), token, null).assertCode(200);
        linkAccountToOrganization(token, user.accountId(), orgId);
        check(app, user.token(), operation.code()).assertCode(40301);
    }

    @Test
    @DisplayName("TC-32-001：超级管理员不配任何权限组即可通过任意已登记操作，冻结后返回 40302")
    void superAdminDoesNotDependOnPermissionGroups() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("admin-app"));
        Operation operation = register(app, "AdminController", "run");
        // 该应用不配置任何可见组，也不为超级管理员建立任何组关联
        String adminId = self(HttpMethod.GET, USER_ME, token, null).assertCode(200).text("id");
        assertThat(queryOne("SELECT count(*) FROM qs__auth__permission_group_account WHERE account_id = ?",
                Long.class, Long.parseLong(adminId))).isZero();

        check(app, token, operation.code()).assertCode(200);
        ApiResult permissions = self(HttpMethod.GET, PERMISSIONS + "?appCode=" + app.appCode(), token, null)
                .assertCode(200);
        assertThat(permissions.booleanField("appVisible")).isTrue();
        assertThat(operationCodes(permissions)).contains(operation.code());

        // 冻结后身份检查仍然生效
        String version = self(HttpMethod.GET, "/api/v1/auth/accounts/" + adminId, token, null)
                .assertCode(200).text("version");
        try {
            self(HttpMethod.POST, "/api/v1/auth/accounts/" + adminId + "/freeze", token,
                    Map.of("version", version)).assertCode(200);
            check(app, token, operation.code()).assertCode(40302);
        } finally {
            // 冻结的账号无法用自己的令牌解冻，这里直接恢复状态并核对落库值。
            jdbc().update("UPDATE qs__auth__account SET status = 'normal' WHERE id = ?", Long.parseLong(adminId));
        }
        assertThat(queryOne("SELECT status FROM qs__auth__account WHERE id = ?", String.class,
                Long.parseLong(adminId))).isEqualTo("normal");
        assertThat(login(ADMIN_USERNAME, ADMIN_PASSWORD).code()).isEqualTo(200);
        check(app, token, operation.code()).assertCode(200);
    }

    @Test
    @DisplayName("TC-33-001：可见组提交不存在或重复的权限组整体拒绝 40001，原配置不变")
    void invalidVisibleGroupsAreRejectedWholesale() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("bad-app"));
        Operation operation = register(app, "DeviceController", "control");
        String group = createPermissionGroup(token, unique("bad-group"), List.of(operation.id()));
        configureVisibleGroups(token, app, List.of(group));
        long rowsBefore = appGroupRows(app);
        assertThat(rowsBefore).isEqualTo(1L);

        // 不存在的权限组
        ApiResult missing = patchVisibleGroups(token, app, List.of(group, "999999999")).assertCode(40001);
        assertThat(missing.fieldErrorNames()).contains("permissionGroupIds");
        assertThat(appGroupRows(app)).as("非法配置不改变已有可见组").isEqualTo(rowsBefore);

        // 重复的权限组标识
        ApiResult duplicated = patchVisibleGroups(token, app, List.of(group, group)).assertCode(40001);
        assertThat(duplicated.fieldErrorNames()).contains("permissionGroupIds");
        assertThat(appGroupRows(app)).as("非法配置不改变已有可见组").isEqualTo(rowsBefore);

        ApiResult detail = self(HttpMethod.GET, APPLICATIONS + "/" + app.id(), token, null).assertCode(200);
        assertThat(detail.data().path("permissionGroupIds").values().stream().map(node -> node.asString()).toList())
                .containsExactly(group);

        // 原可见组仍然生效
        MemberSession user = createMember(token, unique("bad-user"));
        linkAccountToGroup(token, group, user.accountId());
        check(app, user.token(), operation.code()).assertCode(200);
    }

    private record Operation(String id, String code) {
    }

    private Operation register(AppSession app, String className, String methodName) {
        String id = registerOperation(app.appCode(), className, methodName);
        return new Operation(id, app.appCode() + "." + className + "." + methodName);
    }

    private void configureVisibleGroups(String token, AppSession app, List<String> groupIds) {
        patchVisibleGroups(token, app, groupIds).assertCode(200);
    }

    private ApiResult patchVisibleGroups(String token, AppSession app, List<String> groupIds) {
        String version = self(HttpMethod.GET, APPLICATIONS + "/" + app.id(), token, null)
                .assertCode(200).text("version");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("version", version);
        patch.put("permissionGroupIds", groupIds);
        return self(HttpMethod.PATCH, APPLICATIONS + "/" + app.id(), token, patch);
    }

    private ApiResult check(AppSession app, String token, String operationCode) {
        return call(HttpMethod.POST, AUTHORIZATION_CHECKS, app.appKey(), token,
                Map.of("operationCode", operationCode));
    }

    private String createOrganization(String token, String name, String orgType) {
        return self(HttpMethod.POST, "/api/v1/auth/organizations", token,
                Map.of("orgName", name, "orgType", orgType)).assertCode(200).text("id");
    }

    private String linkAccountToOrganization(String token, String accountId, String orgId) {
        ApiResult linked = self(HttpMethod.POST, ACCOUNT_ORGANIZATIONS, token,
                Map.of("accountId", accountId, "orgId", orgId));
        assertThat(linked.code()).as("账号组织关联: %s", linked.body()).isEqualTo(200);
        return linked.text("id");
    }

    private long appGroupRows(AppSession app) {
        return queryOne("SELECT count(*) FROM qs__auth__app_permission_group WHERE app_authorization_id = ?",
                Long.class, Long.parseLong(app.id()));
    }

    private static List<String> operationCodes(ApiResult result) {
        return result.data().path("operations").values().stream()
                .map(node -> node.path("operationCode").asString()).toList();
    }
}
