package com.qs.authority.organization;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * 组织树接口验收：AC-04（多部门无主部门、父子不自动继承）、AC-10（组织增改删查、防环、物化路径、
 * 子树整体移动、有引用不删除）；对应用例 TC-31-006、TC-31-007、TC-31-008、TC-32-006。
 *
 * <p>落库结果一律用 {@code jdbc()} 直接核对 {@code qs__auth__organization} 的前后值；用例只创建和
 * 清理自己命名唯一的数据。另有一条无有效变更的用例：提交与当前值相同（含与当前相同的父组织）
 * 返回 40001，版本与更新时间不变，真实变更才递增版本；再以旧版本提交同一组值返回 40901，
 * 版本与更新时间仍不变——版本判定优先于有效变更判定。
 */
@DisplayName("组织：五类组织、物化路径、子树移动防环与引用删除")
class OrganizationTreeIT extends AbstractAuthorityTest {

    private static final String ORGANIZATIONS = "/api/v1/auth/organizations";
    private static final String ACCOUNT_ORGANIZATIONS = "/api/v1/auth/account-organizations";
    private static final String ORGANIZATION_PERMISSION_GROUPS = "/api/v1/auth/organization-permission-groups";
    private static final String APPLICATION_AUTHORIZATIONS = "/api/v1/auth/application-authorizations";
    private static final String AUTHORIZATION_CHECKS = "/api/v1/auth/authorization-checks";

    @Test
    @DisplayName("TC-32-006：单位/厂区/部门/岗位/班组五类组织均可新建并查询，未知类型返回 40001")
    void fiveOrgTypesCanBeCreatedAndQueried() {
        String token = adminToken();
        Map<String, String> created = new LinkedHashMap<>();
        created.put("company", createRoot(token, "company"));
        created.put("plant", createChild(token, created.get("company"), "plant"));
        created.put("department", createChild(token, created.get("plant"), "department"));
        created.put("post", createChild(token, created.get("department"), "post"));
        created.put("team", createChild(token, created.get("post"), "team"));

        created.forEach((orgType, id) -> {
            ApiResult detail = self(HttpMethod.GET, ORGANIZATIONS + "/" + id, token, null).assertCode(200);
            assertThat(detail.text("orgType")).as("组织 %s 的类型", id).isEqualTo(orgType);
            assertThat(detail.text("orgName")).as("组织 %s 的名称", id).isNotBlank();

            ApiResult list = self(HttpMethod.GET, ORGANIZATIONS + "?orgType=" + orgType + "&pageSize=100", token,
                    null).assertCode(200);
            assertThat(organizationIds(list)).as("按类型 %s 查询应包含新建组织", orgType).contains(id);
        });

        ApiResult unknown = self(HttpMethod.POST, ORGANIZATIONS, token,
                Map.of("orgName", unique("未知类型"), "orgType", "region")).assertCode(40001);
        assertThat(unknown.fieldErrorNames()).contains("orgType");
    }

    @Test
    @DisplayName("AC-10：根组织物化路径为 /id，子组织为父路径/id，落库值与响应一致")
    void materializedPathIsFormedOnInsert() {
        String token = adminToken();
        ApiResult root = createOrganization(token, null, unique("根组织"), "company");
        String rootId = root.text("id");
        assertThat(root.text("parentId")).isEqualTo("0");
        assertThat(root.text("orgPath")).isEqualTo("/" + rootId);

        ApiResult child = createOrganization(token, rootId, unique("子组织"), "department");
        String childId = child.text("id");
        assertThat(child.text("parentId")).isEqualTo(rootId);
        assertThat(child.text("orgPath")).isEqualTo("/" + rootId + "/" + childId);

        ApiResult grand = createOrganization(token, childId, unique("班组"), "team");
        String grandId = grand.text("id");
        assertThat(grand.text("orgPath")).isEqualTo("/" + rootId + "/" + childId + "/" + grandId);

        assertThat(pathOf(rootId)).isEqualTo("/" + rootId);
        assertThat(pathOf(childId)).isEqualTo("/" + rootId + "/" + childId);
        assertThat(pathOf(grandId)).isEqualTo("/" + rootId + "/" + childId + "/" + grandId);
    }

    @Test
    @DisplayName("TC-31-008：合法移动把子树整体改写，自身与全部后代路径同步且只改路径列")
    void legalMoveRewritesWholeSubtree() {
        String token = adminToken();
        String fromId = createRoot(token, "company");
        String toId = createRoot(token, "company");
        String movedId = createChild(token, fromId, "department");
        String childId = createChild(token, movedId, "post");
        String grandId = createChild(token, childId, "team");
        long grandVersionBefore = versionOf(grandId);

        ApiResult moved = self(HttpMethod.PATCH, ORGANIZATIONS + "/" + movedId, token,
                patchOf(token, movedId, "parentId", toId)).assertCode(200);
        assertThat(moved.text("parentId")).isEqualTo(toId);
        assertThat(moved.text("orgPath")).isEqualTo("/" + toId + "/" + movedId);

        assertThat(pathOf(movedId)).isEqualTo("/" + toId + "/" + movedId);
        assertThat(pathOf(childId)).isEqualTo("/" + toId + "/" + movedId + "/" + childId);
        assertThat(pathOf(grandId)).isEqualTo("/" + toId + "/" + movedId + "/" + childId + "/" + grandId);
        assertThat(parentOf(movedId)).isEqualTo(Long.parseLong(toId));
        assertThat(parentOf(childId)).isEqualTo(Long.parseLong(movedId));
        assertThat(parentOf(grandId)).isEqualTo(Long.parseLong(childId));

        // 后代只被重写路径列，编辑版本不受系统维护列影响。
        assertThat(versionOf(grandId)).as("子树移动不改变后代编辑版本").isEqualTo(grandVersionBefore);

        // 移动后仍然只能整树存在：原父组织下不再有该子树。
        ApiResult list = self(HttpMethod.GET, ORGANIZATIONS + "?parentId=" + fromId + "&pageSize=100", token, null)
                .assertCode(200);
        assertThat(organizationIds(list)).doesNotContain(movedId);
    }

    @Test
    @DisplayName("TC-31-008：移动到自身或自己的后代返回 40001，失败后原树路径与父级不变")
    void movingIntoOwnSubtreeIsRejected() {
        String token = adminToken();
        String rootId = createRoot(token, "company");
        String midId = createChild(token, rootId, "department");
        String leafId = createChild(token, midId, "team");
        String midPathBefore = pathOf(midId);
        String leafPathBefore = pathOf(leafId);
        long midVersionBefore = versionOf(midId);

        // 移动到自身
        ApiResult toSelf = self(HttpMethod.PATCH, ORGANIZATIONS + "/" + midId, token,
                patchOf(token, midId, "parentId", midId)).assertCode(40001);
        assertThat(toSelf.fieldErrorNames()).contains("parentId");

        // 把组织了移到自己下级（祖先移到后代下）
        ApiResult toDescendant = self(HttpMethod.PATCH, ORGANIZATIONS + "/" + midId, token,
                patchOf(token, midId, "parentId", leafId)).assertCode(40001);
        assertThat(toDescendant.fieldErrorNames()).contains("parentId");

        // 把根组织移到孙节点下
        self(HttpMethod.PATCH, ORGANIZATIONS + "/" + rootId, token,
                patchOf(token, rootId, "parentId", leafId)).assertCode(40001);

        assertThat(pathOf(midId)).as("拒绝成环后原路径不变").isEqualTo(midPathBefore);
        assertThat(pathOf(leafId)).as("拒绝成环后后代路径不变").isEqualTo(leafPathBefore);
        assertThat(parentOf(midId)).isEqualTo(Long.parseLong(rootId));
        assertThat(parentOf(leafId)).isEqualTo(Long.parseLong(midId));
        assertThat(versionOf(midId)).as("拒绝成环不递增版本").isEqualTo(midVersionBefore);
    }

    @Test
    @DisplayName("TC-31-007：父子组织不自动继承，只按账号实际所属组织取得权限组")
    void hierarchyDoesNotInheritPermissionGroups() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("hier-app"));
        String operationCode = registerOperation(app.appCode(), "DeviceController", "control");
        String groupId = createPermissionGroup(token, unique("hier-group"), List.of(operationCode));
        configureVisibleGroups(token, app, List.of(groupId));

        String d1 = createRoot(token, "department");
        String d2 = createChild(token, d1, "department");
        String linkId = linkOrganizationToGroup(token, groupId, d2);

        MemberSession member = createMember(token, unique("hier-user"));
        linkAccountToOrganization(token, member.accountId(), d1);

        // 账号只属于 D1，D1 没有组关联，子组织 D2 的组不自动继承
        check(app, member.token(), app.appCode() + ".DeviceController.control").assertCode(40301);

        String memberLinkId = linkAccountToOrganization(token, member.accountId(), d2);
        check(app, member.token(), app.appCode() + ".DeviceController.control").assertCode(200);

        deleteAccountOrganization(token, memberLinkId);
        check(app, member.token(), app.appCode() + ".DeviceController.control").assertCode(40301);

        // 解除组织与组的关联后，组织派生的权限组同样立即失效
        deleteOrganizationPermissionGroup(token, linkId);
        String againLinkId = linkAccountToOrganization(token, member.accountId(), d2);
        check(app, member.token(), app.appCode() + ".DeviceController.control").assertCode(40301);
        deleteAccountOrganization(token, againLinkId);
    }

    @Test
    @DisplayName("TC-31-006：同一账号关联两个组织时两条关联并存且都能查到，重复组合返回 40902")
    void accountCanBelongToMultipleOrganizations() {
        String token = adminToken();
        String first = createRoot(token, "department");
        String second = createRoot(token, "department");
        MemberSession member = createMember(token, unique("multi"));

        String firstLinkId = linkAccountToOrganization(token, member.accountId(), first);
        String secondLinkId = linkAccountToOrganization(token, member.accountId(), second);
        assertThat(firstLinkId).isNotEqualTo(secondLinkId);

        ApiResult list = self(HttpMethod.GET,
                ACCOUNT_ORGANIZATIONS + "?accountId=" + member.accountId() + "&pageSize=100", token, null)
                .assertCode(200);
        assertThat(list.intField("total")).isEqualTo(2);
        assertThat(linkOrgIds(list)).containsExactlyInAnyOrder(first, second);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account_organization WHERE account_id = ?",
                Long.class, Long.parseLong(member.accountId()))).isEqualTo(2L);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account_organization WHERE account_id = ? AND org_id = ?",
                Long.class, Long.parseLong(member.accountId()), Long.parseLong(first))).isEqualTo(1L);

        // 重复组合拒绝且不产生第三条记录
        self(HttpMethod.POST, ACCOUNT_ORGANIZATIONS, token,
                Map.of("accountId", member.accountId(), "orgId", first)).assertCode(40902);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account_organization WHERE account_id = ?",
                Long.class, Long.parseLong(member.accountId()))).isEqualTo(2L);

        // 解除其中一条不影响另一条
        deleteAccountOrganization(token, firstLinkId);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account_organization WHERE account_id = ?",
                Long.class, Long.parseLong(member.accountId()))).isEqualTo(1L);
        ApiResult remained = self(HttpMethod.GET, ACCOUNT_ORGANIZATIONS + "/" + secondLinkId, token, null)
                .assertCode(200);
        assertThat(remained.text("orgId")).isEqualTo(second);
    }

    @Test
    @DisplayName("AC-10：有子组织时删除返回 40903，子组织删除后目标可删除，重复删除返回 40401")
    void deleteBlockedByChildrenThenSucceeds() {
        String token = adminToken();
        String parentId = createRoot(token, "company");
        String childId = createChild(token, parentId, "department");

        ApiResult blocked = deleteOrganization(token, parentId).assertCode(40903);
        assertThat(referenceTypes(blocked)).contains("childOrganization");
        assertThat(pathOf(childId)).isEqualTo("/" + parentId + "/" + childId);

        // 子组织仍在，目标与子组织都不受影响
        self(HttpMethod.GET, ORGANIZATIONS + "/" + parentId, token, null).assertCode(200);
        self(HttpMethod.GET, ORGANIZATIONS + "/" + childId, token, null).assertCode(200);

        String childVersion = currentVersion(token, childId);
        self(HttpMethod.DELETE, ORGANIZATIONS + "/" + childId + "?version=" + childVersion, token, null)
                .assertCode(200);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__organization WHERE id = ?", Long.class,
                Long.parseLong(childId))).isZero();

        String parentVersion = currentVersion(token, parentId);
        self(HttpMethod.DELETE, ORGANIZATIONS + "/" + parentId + "?version=" + parentVersion, token, null)
                .assertCode(200);
        self(HttpMethod.DELETE, ORGANIZATIONS + "/" + parentId + "?version=" + parentVersion, token, null)
                .assertCode(40401);
    }

    @Test
    @DisplayName("AC-10：被账号组织关联引用时删除返回 40903，解除关联后可删除")
    void deleteBlockedByAccountLinkThenSucceeds() {
        String token = adminToken();
        String orgId = createRoot(token, "plant");
        MemberSession member = createMember(token, unique("del-link"));
        String linkId = linkAccountToOrganization(token, member.accountId(), orgId);

        ApiResult blocked = deleteOrganization(token, orgId).assertCode(40903);
        assertThat(referenceTypes(blocked)).contains("accountOrganization");
        assertThat(queryOne("SELECT count(*) FROM qs__auth__organization WHERE id = ?", Long.class,
                Long.parseLong(orgId))).isEqualTo(1L);

        deleteAccountOrganization(token, linkId);
        deleteOrganization(token, orgId).assertCode(200);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__organization WHERE id = ?", Long.class,
                Long.parseLong(orgId))).isZero();
    }

    @Test
    @DisplayName("AC-10：被组织权限组关联引用时删除返回 40903，解除关联后可删除")
    void deleteBlockedByOrganizationPermissionGroupThenSucceeds() {
        String token = adminToken();
        AppSession app = createApplication(token, null, unique("del-app"));
        String operationId = registerOperation(app.appCode(), "DeviceController", "control");
        String groupId = createPermissionGroup(token, unique("del-group"), List.of(operationId));
        String orgId = createRoot(token, "plant");
        String linkId = linkOrganizationToGroup(token, groupId, orgId);

        ApiResult blocked = deleteOrganization(token, orgId).assertCode(40903);
        assertThat(referenceTypes(blocked)).contains("permissionGroupOrganization");
        assertThat(queryOne("SELECT count(*) FROM qs__auth__organization WHERE id = ?", Long.class,
                Long.parseLong(orgId))).isEqualTo(1L);

        deleteOrganizationPermissionGroup(token, linkId);
        deleteOrganization(token, orgId).assertCode(200);
    }

    @Test
    @DisplayName("F-06 / AC-10：提交与当前值相同的组织字段（含相同父组织）返回 40001；同值 + 旧版本 40901；版本与路径都不变")
    void unchangedOrganizationPatchIsRejected() {
        String token = adminToken();
        String orgId = createRoot(token, "department");
        String name = self(HttpMethod.GET, ORGANIZATIONS + "/" + orgId, token, null).assertCode(200).text("orgName");
        long versionBefore = versionOf(orgId);
        Timestamp updatedAtBefore = queryOne("SELECT updated_at FROM qs__auth__organization WHERE id = ?",
                Timestamp.class, Long.parseLong(orgId));

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", currentVersion(token, orgId));
        identical.put("orgName", name);
        identical.put("orgType", "department");
        identical.put("sortOrder", 0);
        identical.put("parentId", "0");
        self(HttpMethod.PATCH, ORGANIZATIONS + "/" + orgId, token, identical).assertCode(40001);
        assertThat(versionOf(orgId)).as("空提交不递增版本").isEqualTo(versionBefore);
        assertThat(queryOne("SELECT updated_at FROM qs__auth__organization WHERE id = ?", Timestamp.class,
                Long.parseLong(orgId))).as("空提交不刷新更新时间").isEqualTo(updatedAtBefore);
        assertThat(pathOf(orgId)).isEqualTo("/" + orgId);

        ApiResult renamed = self(HttpMethod.PATCH, ORGANIZATIONS + "/" + orgId, token,
                patchOf(token, orgId, "orgName", unique("改名"))).assertCode(200);
        assertThat(renamed.text("orgName")).isNotEqualTo(name);
        assertThat(versionOf(orgId)).as("真实变更递增版本").isEqualTo(versionBefore + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本、更新时间与路径都不变。
        Timestamp updatedAtAfterRename = queryOne("SELECT updated_at FROM qs__auth__organization WHERE id = ?",
                Timestamp.class, Long.parseLong(orgId));
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(versionBefore));
        staleIdentical.put("orgName", renamed.text("orgName"));
        staleIdentical.put("orgType", "department");
        staleIdentical.put("sortOrder", 0);
        staleIdentical.put("parentId", "0");
        self(HttpMethod.PATCH, ORGANIZATIONS + "/" + orgId, token, staleIdentical).assertCode(40901);
        assertThat(versionOf(orgId)).as("旧版本提交不递增版本").isEqualTo(versionBefore + 1);
        assertThat(queryOne("SELECT updated_at FROM qs__auth__organization WHERE id = ?", Timestamp.class,
                Long.parseLong(orgId))).as("旧版本提交不刷新更新时间").isEqualTo(updatedAtAfterRename);
        assertThat(pathOf(orgId)).isEqualTo("/" + orgId);
    }

    private ApiResult createOrganization(String token, String parentId, String orgName, String orgType) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (parentId != null) {
            body.put("parentId", parentId);
        }
        body.put("orgName", orgName);
        body.put("orgType", orgType);
        return self(HttpMethod.POST, ORGANIZATIONS, token, body).assertCode(200);
    }

    private String createRoot(String token, String orgType) {
        return createOrganization(token, null, unique("组织"), orgType).text("id");
    }

    private String createChild(String token, String parentId, String orgType) {
        return createOrganization(token, parentId, unique("组织"), orgType).text("id");
    }

    private Map<String, Object> patchOf(String token, String id, String field, Object value) {
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("version", currentVersion(token, id));
        patch.put(field, value);
        return patch;
    }

    private String currentVersion(String token, String id) {
        return self(HttpMethod.GET, ORGANIZATIONS + "/" + id, token, null).assertCode(200).text("version");
    }

    private ApiResult deleteOrganization(String token, String id) {
        return self(HttpMethod.DELETE, ORGANIZATIONS + "/" + id + "?version=" + currentVersion(token, id), token,
                null);
    }

    private String linkAccountToOrganization(String token, String accountId, String orgId) {
        ApiResult linked = self(HttpMethod.POST, ACCOUNT_ORGANIZATIONS, token,
                Map.of("accountId", accountId, "orgId", orgId));
        assertThat(linked.code()).as("账号组织关联: %s", linked.body()).isEqualTo(200);
        return linked.text("id");
    }

    private void deleteAccountOrganization(String token, String linkId) {
        String version = self(HttpMethod.GET, ACCOUNT_ORGANIZATIONS + "/" + linkId, token, null)
                .assertCode(200).text("version");
        self(HttpMethod.DELETE, ACCOUNT_ORGANIZATIONS + "/" + linkId + "?version=" + version, token, null)
                .assertCode(200);
    }

    private String linkOrganizationToGroup(String token, String groupId, String orgId) {
        ApiResult linked = self(HttpMethod.POST, ORGANIZATION_PERMISSION_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", orgId));
        assertThat(linked.code()).as("组织权限组关联: %s", linked.body()).isEqualTo(200);
        return linked.text("id");
    }

    private void deleteOrganizationPermissionGroup(String token, String linkId) {
        String version = self(HttpMethod.GET, ORGANIZATION_PERMISSION_GROUPS + "/" + linkId, token, null)
                .assertCode(200).text("version");
        self(HttpMethod.DELETE, ORGANIZATION_PERMISSION_GROUPS + "/" + linkId + "?version=" + version, token, null)
                .assertCode(200);
    }

    private void configureVisibleGroups(String token, AppSession app, List<String> groupIds) {
        String version = self(HttpMethod.GET, APPLICATION_AUTHORIZATIONS + "/" + app.id(), token, null)
                .assertCode(200).text("version");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("version", version);
        patch.put("permissionGroupIds", groupIds);
        self(HttpMethod.PATCH, APPLICATION_AUTHORIZATIONS + "/" + app.id(), token, patch).assertCode(200);
    }

    private ApiResult check(AppSession app, String token, String operationCode) {
        return call(HttpMethod.POST, AUTHORIZATION_CHECKS, app.appKey(), token,
                Map.of("operationCode", operationCode));
    }

    private String pathOf(String id) {
        return queryOne("SELECT org_path FROM qs__auth__organization WHERE id = ?", String.class, Long.parseLong(id));
    }

    private Long parentOf(String id) {
        return queryOne("SELECT parent_id FROM qs__auth__organization WHERE id = ?", Long.class, Long.parseLong(id));
    }

    private Long versionOf(String id) {
        return queryOne("SELECT version FROM qs__auth__organization WHERE id = ?", Long.class, Long.parseLong(id));
    }

    private static List<String> organizationIds(ApiResult result) {
        return result.data().path("items").values().stream().map(node -> node.path("id").asString()).toList();
    }

    private static List<String> linkOrgIds(ApiResult result) {
        return result.data().path("items").values().stream().map(node -> node.path("orgId").asString()).toList();
    }

    private static List<String> referenceTypes(ApiResult result) {
        return result.data().path("references").values().stream()
                .map(node -> node.path("type").asString()).toList();
    }
}
