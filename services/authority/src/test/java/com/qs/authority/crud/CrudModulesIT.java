package com.qs.authority.crud;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/**
 * 配置与授权资源的增改删查验收（AC-11/AC-12/AC-13/AC-14/AC-21/AC-35/AC-40；
 * TC-11-*、TC-12-*、TC-13-*、TC-14-*、TC-31-011/012/033/036、TC-32-004/005）。
 *
 * <p>每个资源都覆盖新增、详情、列表筛选、编辑、删除与 version 规则；字段校验、组合唯一性、
 * 引用阻止删除、集合整体替换与并发重复新增按每个对象的业务规则分别核对，落库结果一律用
 * {@code jdbc()} 复核。数据全部以 {@code unique()} 命名，用例只清理自己创建的对象。
 *
 * <p>每个资源另有一条无有效变更的用例：提交与当前值相同的字段返回 40001，且 {@code version} 与
 * {@code updated_at} 都不变；随后提交真实变更得到 200 与递增后的版本；再以旧版本提交同一组值返回
 * 40901，版本与更新时间仍不变——版本判定优先于有效变更判定。
 */
@DisplayName("配置与授权资源：增改删查、字段校验、组合唯一与引用保护")
class CrudModulesIT extends AbstractAuthorityTest {

    private static final String PARAMETERS = "/api/v1/auth/parameters";
    private static final String DICTIONARIES = "/api/v1/auth/dictionaries";
    private static final String USER_GROUPS = "/api/v1/auth/user-groups";
    private static final String MEMBERSHIPS = "/api/v1/auth/user-group-memberships";
    private static final String ACCOUNT_ORGS = "/api/v1/auth/account-organizations";
    private static final String PERMISSION_GROUPS = "/api/v1/auth/permission-groups";
    private static final String ACCOUNT_GROUPS = "/api/v1/auth/account-permission-groups";
    private static final String ORG_GROUPS = "/api/v1/auth/organization-permission-groups";
    private static final String ORGANIZATIONS = "/api/v1/auth/organizations";
    private static final String ACCOUNTS = "/api/v1/auth/accounts";
    private static final String APPLICATIONS = "/api/v1/auth/application-authorizations";

    @Test
    @DisplayName("AC-12 / TC-12-001~005：参数新增、详情、列表、编辑、删除与 version 规则")
    void parameterCrudAndVersionRules() {
        String token = adminToken();
        String code = unique("tc12-param");
        String id = createParameter(token, code, "文字初值");

        ApiResult detail = self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).assertCode(200);
        assertThat(detail.text("paramCode")).isEqualTo(code);
        assertThat(detail.text("paramValue")).isEqualTo("文字初值");
        assertThat(detail.text("version")).isEqualTo("1");
        assertThat(detail.text("createdAt")).isNotBlank();

        ApiResult list = self(HttpMethod.GET, PARAMETERS + "?paramCode=" + code, token, null).assertCode(200);
        assertThat(list.intField("total")).as("按 paramCode 精确命中").isEqualTo(1);
        assertThat(list.data().path("items").get(0).path("id").asString()).isEqualTo(id);

        String version = detail.text("version");
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, Map.of("version", version)).assertCode(40001);
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, Map.of("paramValue", "无版本")).assertCode(40001);
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, Map.of("version", version, "createdAt", "2026-01-01 00:00:00"))
                .assertCode(40001);

        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("version", version);
        edit.put("paramValue", "42");
        edit.put("description", "修改后说明");
        ApiResult updated = self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, edit).assertCode(200);
        assertThat(updated.text("paramValue")).isEqualTo("42");
        assertThat(updated.text("description")).isEqualTo("修改后说明");
        assertThat(updated.text("version")).isEqualTo("2");

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，已保存的值不被覆盖。
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, edit).assertCode(40901);
        Map<String, Object> stale = new LinkedHashMap<>();
        stale.put("version", version);
        stale.put("paramValue", "43");
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, stale).assertCode(40901);
        assertThat(self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).text("paramValue"))
                .as("旧版本提交不覆盖已保存的值").isEqualTo("42");

        self(HttpMethod.DELETE, PARAMETERS + "/" + id + "?version=1", token, null).assertCode(40901);
        self(HttpMethod.DELETE, PARAMETERS + "/" + id + "?version=2", token, null).assertCode(200);
        assertThat(countParamsByCode(code)).as("删除是物理删除").isZero();
        assertThat(self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).code()).isEqualTo(40401);
        self(HttpMethod.DELETE, PARAMETERS + "/" + id + "?version=2", token, null).assertCode(40401);
    }

    @Test
    @DisplayName("AC-35 / TC-31-033：参数值为空串、全空白或 null 一律 40001 且不落库")
    void parameterValueMustNotBeBlank() {
        String token = adminToken();
        for (String value : List.of("", "   ")) {
            String code = unique("tc31-033-blank");
            ApiResult denied = self(HttpMethod.POST, PARAMETERS, token,
                    Map.of("paramCode", code, "paramValue", value)).assertCode(40001);
            assertThat(denied.fieldErrorNames()).contains("paramValue");
            assertThat(countParamsByCode(code)).as("非法值不产生记录").isZero();
        }

        String code = unique("tc31-033-null");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("paramCode", code);
        body.put("paramValue", null);
        ApiResult denied = self(HttpMethod.POST, PARAMETERS, token, body).assertCode(40001);
        assertThat(denied.fieldErrorNames()).contains("paramValue");
        assertThat(countParamsByCode(code)).isZero();

        // 编辑同样拒绝：必填字段不能用 null 或空白替换
        String id = createParameter(token, code, "原值");
        String version = self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).text("version");
        assertThat(self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, Map.of("version", version, "paramValue", " "))
                .code()).isEqualTo(40001);
        Map<String, Object> nullValue = new LinkedHashMap<>();
        nullValue.put("version", version);
        nullValue.put("paramValue", null);
        assertThat(self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, nullValue).code()).isEqualTo(40001);
        assertThat(queryOne("SELECT param_value FROM qs__auth__sys_param WHERE id = ?", String.class,
                Long.parseLong(id))).as("拒绝的编辑不改变原值").isEqualTo("原值");
    }

    @Test
    @DisplayName("AC-35 / TC-31-033：参数可存文字与数值，保存后立刻读到新值")
    void parameterValueTakesEffectImmediately() {
        String token = adminToken();
        String code = unique("tc31-033-live");
        String id = createParameter(token, code, "text-value");
        assertThat(paramValue(token, id)).as("新增后第一次读取就是新值").isEqualTo("text-value");

        Map<String, Object> toNumber = new LinkedHashMap<>();
        toNumber.put("version", self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).text("version"));
        toNumber.put("paramValue", "1024");
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, toNumber).assertCode(200);
        assertThat(paramValue(token, id)).as("编辑后立即生效，不需要重启或刷新").isEqualTo("1024");
        assertThat(queryOne("SELECT param_value FROM qs__auth__sys_param WHERE id = ?", String.class,
                Long.parseLong(id))).isEqualTo("1024");

        Map<String, Object> toText = new LinkedHashMap<>();
        toText.put("version", self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).text("version"));
        toText.put("paramValue", "重新改回文字");
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, toText).assertCode(200);
        assertThat(paramValue(token, id)).isEqualTo("重新改回文字");

        deleteParameter(token, id);
    }

    @Test
    @DisplayName("AC-35 / TC-32-005：含 SQL 片段的参数值按普通数据原样存取，不被执行")
    void parameterSqlTextIsStoredAsData() {
        String token = adminToken();
        String code = unique("tc32-005");
        String injection = "'; DROP TABLE qs__auth__sys_param; --";
        String id = createParameter(token, code, injection);

        assertThat(paramValue(token, id)).as("注入串原样返回").isEqualTo(injection);
        assertThat(queryOne("SELECT param_value FROM qs__auth__sys_param WHERE id = ?", String.class,
                Long.parseLong(id))).isEqualTo(injection);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__sys_param", Long.class))
                .as("表仍然存在，注入串没有被当作 SQL 执行").isPositive();

        // 注入串作为筛选值也只被绑定为参数，不影响查询，也不改变数据
        ApiResult filtered = self(HttpMethod.GET, PARAMETERS + "?paramCode=1'OR'1'='1", token, null).assertCode(200);
        assertThat(filtered.intField("total")).isZero();
        assertThat(queryOne("SELECT count(*) FROM qs__auth__sys_param", Long.class)).isPositive();

        deleteParameter(token, id);
    }

    @Test
    @DisplayName("AC-12 / TC-12-006~010：字典新增、详情、列表、编辑、整组替换与删除")
    void dictionaryCrudAndItemReplacement() {
        String token = adminToken();
        String code = unique("tc12-dict");
        String id = createDictionary(token, code, List.of("启用", "禁用"));

        ApiResult detail = self(HttpMethod.GET, DICTIONARIES + "/" + id, token, null).assertCode(200);
        assertThat(detail.text("dictCode")).isEqualTo(code);
        assertThat(strings(detail.data().path("dictItems"))).containsExactly("启用", "禁用");
        assertThat(self(HttpMethod.GET, DICTIONARIES + "?dictCode=" + code, token, null).assertCode(200)
                .intField("total")).as("按 dictCode 精确命中").isEqualTo(1);

        Map<String, Object> replace = new LinkedHashMap<>();
        replace.put("version", detail.text("version"));
        replace.put("dictItems", List.of("a", "b", "c"));
        ApiResult replaced = self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, replace).assertCode(200);
        assertThat(strings(replaced.data().path("dictItems"))).as("提交数组即整组替换").containsExactly("a", "b", "c");
        assertThat(dictItemCount(id)).isEqualTo(3);

        // 只提交 description：字典项保持原值
        Map<String, Object> remark = new LinkedHashMap<>();
        remark.put("version", replaced.text("version"));
        remark.put("description", "修改后说明");
        ApiResult described = self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, remark).assertCode(200);
        assertThat(strings(described.data().path("dictItems"))).containsExactly("a", "b", "c");

        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("version", described.text("version"));
        clear.put("dictItems", List.of());
        ApiResult cleared = self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, clear).assertCode(200);
        assertThat(strings(cleared.data().path("dictItems"))).as("空数组表示清空").isEmpty();
        assertThat(queryOne("SELECT dict_items::text FROM qs__auth__sys_dict WHERE id = ?", String.class,
                Long.parseLong(id))).isEqualTo("[]");

        // 旧版本 + 与当前相同的字典项：版本判定优先，返回 40901。
        self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, clear).assertCode(40901);
        Map<String, Object> staleItems = new LinkedHashMap<>();
        staleItems.put("version", described.text("version"));
        staleItems.put("dictItems", List.of("旧版本写入"));
        self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, staleItems).assertCode(40901);
        assertThat(strings(self(HttpMethod.GET, DICTIONARIES + "/" + id, token, null).assertCode(200)
                .data().path("dictItems"))).as("旧版本提交不覆盖已保存的字典项").isEmpty();
        self(HttpMethod.DELETE, DICTIONARIES + "/" + id + "?version=" + cleared.text("version"), token, null)
                .assertCode(200);
        assertThat(countDictsByCode(code)).isZero();
        self(HttpMethod.DELETE, DICTIONARIES + "/" + id + "?version=" + cleared.text("version"), token, null)
                .assertCode(40401);
    }

    @Test
    @DisplayName("AC-12 / TC-31-036：dictItems 非数组、null、重复元素都拒绝且原值不变")
    void dictionaryItemsRejectInvalidStructures() {
        String token = adminToken();
        String code = unique("tc31-036");
        assertThat(self(HttpMethod.POST, DICTIONARIES, token,
                "{\"dictCode\":\"" + code + "\",\"dictItems\":{}}").code()).isEqualTo(40001);
        assertThat(countDictsByCode(code)).isZero();

        Map<String, Object> nullItems = new LinkedHashMap<>();
        nullItems.put("dictCode", code);
        nullItems.put("dictItems", null);
        ApiResult nullDenied = self(HttpMethod.POST, DICTIONARIES, token, nullItems).assertCode(40001);
        assertThat(nullDenied.fieldErrorNames()).contains("dictItems");
        assertThat(countDictsByCode(code)).isZero();

        self(HttpMethod.POST, DICTIONARIES, token,
                Map.of("dictCode", code, "dictItems", List.of("重复项", "重复项"))).assertCode(40001);
        assertThat(countDictsByCode(code)).as("非法结构不产生记录").isZero();

        String id = createDictionary(token, code, List.of("原值一", "原值二"));
        String version = self(HttpMethod.GET, DICTIONARIES + "/" + id, token, null).text("version");
        String stored = queryOne("SELECT dict_items::text FROM qs__auth__sys_dict WHERE id = ?", String.class,
                Long.parseLong(id));
        assertThat(dictItemCount(id)).isEqualTo(2);

        assertThat(self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token,
                "{\"version\":\"" + version + "\",\"dictItems\":{}}").code()).isEqualTo(40001);
        Map<String, Object> nullItemsPatch = new LinkedHashMap<>();
        nullItemsPatch.put("version", version);
        nullItemsPatch.put("dictItems", null);
        assertThat(self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, nullItemsPatch).code()).isEqualTo(40001);
        Map<String, Object> duplicates = new LinkedHashMap<>();
        duplicates.put("version", version);
        duplicates.put("dictItems", List.of("重复项", "重复项"));
        ApiResult duplicateDenied = self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, duplicates)
                .assertCode(40001);
        assertThat(duplicateDenied.fieldErrorNames()).contains("dictItems");
        Map<String, Object> blankElement = new LinkedHashMap<>();
        blankElement.put("version", version);
        blankElement.put("dictItems", List.of("合法", " "));
        self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, blankElement).assertCode(40001);

        assertThat(queryOne("SELECT dict_items::text FROM qs__auth__sys_dict WHERE id = ?", String.class,
                Long.parseLong(id))).as("任一元素不合法时整组拒绝，数据库原值不变").isEqualTo(stored);

        Map<String, Object> valid = new LinkedHashMap<>();
        valid.put("version", version);
        valid.put("dictItems", List.of("合法项"));
        self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, valid).assertCode(200);
        assertThat(dictItemCount(id)).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-11 / TC-11-001~005：用户组增改删查、编码唯一与成员引用保护")
    void userGroupCrudAndMemberReferenceGuard() {
        String token = adminToken();
        String code = unique("tc11-group");
        String id = createUserGroup(token, code);

        ApiResult detail = self(HttpMethod.GET, USER_GROUPS + "/" + id, token, null).assertCode(200);
        assertThat(detail.text("groupCode")).isEqualTo(code);
        assertThat(self(HttpMethod.GET, USER_GROUPS + "?groupCode=" + code, token, null).assertCode(200)
                .intField("total")).as("按 groupCode 精确命中").isEqualTo(1);

        self(HttpMethod.POST, USER_GROUPS, token, Map.of("groupCode", code, "groupName", "重复组")).assertCode(40902);
        assertThat(countUserGroupsByCode(code)).as("重复编码不覆盖既有对象").isEqualTo(1);
        self(HttpMethod.POST, USER_GROUPS, token, Map.of("groupCode", "  ", "groupName", "空编码")).assertCode(40001);

        Map<String, Object> rename = new LinkedHashMap<>();
        rename.put("version", detail.text("version"));
        rename.put("groupName", "修改后组");
        ApiResult renamed = self(HttpMethod.PATCH, USER_GROUPS + "/" + id, token, rename).assertCode(200);
        assertThat(renamed.text("groupName")).isEqualTo("修改后组");
        assertThat(renamed.text("version")).isEqualTo("2");
        assertThat(renamed.text("updatedAt")).isNotBlank();
        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901。
        self(HttpMethod.PATCH, USER_GROUPS + "/" + id, token, rename).assertCode(40901);
        Map<String, Object> staleRename = new LinkedHashMap<>();
        staleRename.put("version", detail.text("version"));
        staleRename.put("groupName", "旧版本改名");
        self(HttpMethod.PATCH, USER_GROUPS + "/" + id, token, staleRename).assertCode(40901);
        assertThat(self(HttpMethod.GET, USER_GROUPS + "/" + id, token, null).text("groupName"))
                .as("旧版本提交不覆盖已保存的用户组名").isEqualTo("修改后组");

        String accountId = createAccount(token, "tc11-member");
        ApiResult membership = self(HttpMethod.POST, MEMBERSHIPS, token,
                Map.of("userGroupId", id, "accountId", accountId)).assertCode(200);

        ApiResult blocked = self(HttpMethod.DELETE, USER_GROUPS + "/" + id + "?version=" + renamed.text("version"),
                token, null).assertCode(40903);
        assertThat(blocked.data().path("references").isArray()).as("引用阻止删除时给出引用详情").isTrue();
        assertThat(queryOne("SELECT count(*) FROM qs__auth__user_group WHERE id = ?", Long.class,
                Long.parseLong(id))).as("被引用时目标不变").isEqualTo(1);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__user_group_account WHERE id = ?", Long.class,
                Long.parseLong(membership.text("id")))).as("被引用时关联不变").isEqualTo(1);

        self(HttpMethod.DELETE, MEMBERSHIPS + "/" + membership.text("id") + "?version="
                + membership.text("version"), token, null).assertCode(200);
        self(HttpMethod.DELETE, USER_GROUPS + "/" + id + "?version=" + renamed.text("version"), token, null)
                .assertCode(200);
        assertThat(countUserGroupsByCode(code)).isZero();
        self(HttpMethod.DELETE, USER_GROUPS + "/" + id + "?version=" + renamed.text("version"), token, null)
                .assertCode(40401);
    }

    @Test
    @DisplayName("AC-11/AC-14 / TC-31-009：用户组成员组合唯一，编辑冲突不改动原关联，删除只解除关系")
    void userGroupMembershipUniquenessAndDetach() {
        String token = adminToken();
        String groupId = createUserGroup(token, unique("tc11-membership"));
        String firstAccount = createAccount(token, "tc11-acc-a");
        String secondAccount = createAccount(token, "tc11-acc-b");

        ApiResult first = self(HttpMethod.POST, MEMBERSHIPS, token,
                Map.of("userGroupId", groupId, "accountId", firstAccount)).assertCode(200);
        self(HttpMethod.POST, MEMBERSHIPS, token, Map.of("userGroupId", groupId, "accountId", firstAccount))
                .assertCode(40902);
        assertThat(countMemberships(groupId, firstAccount)).as("同一组合只有一条").isEqualTo(1);

        ApiResult second = self(HttpMethod.POST, MEMBERSHIPS, token,
                Map.of("userGroupId", groupId, "accountId", secondAccount)).assertCode(200);
        Map<String, Object> conflict = new LinkedHashMap<>();
        conflict.put("version", second.text("version"));
        conflict.put("accountId", firstAccount);
        ApiResult blocked = self(HttpMethod.PATCH, MEMBERSHIPS + "/" + second.text("id"), token, conflict)
                .assertCode(40902);
        assertThat(blocked.body()).isNotNull();
        assertThat(queryOne("SELECT account_id FROM qs__auth__user_group_account WHERE id = ?", Long.class,
                Long.parseLong(second.text("id")))).as("编辑冲突时原关联不变").isEqualTo(Long.parseLong(secondAccount));
        assertThat(countMemberships(groupId, secondAccount)).isEqualTo(1);

        assertThat(self(HttpMethod.GET, MEMBERSHIPS + "?userGroupId=" + groupId, token, null).assertCode(200)
                .intField("total")).as("按 userGroupId 精确命中").isEqualTo(2);

        self(HttpMethod.DELETE, MEMBERSHIPS + "/" + first.text("id") + "?version=" + first.text("version"), token,
                null).assertCode(200);
        assertThat(countMemberships(groupId, firstAccount)).isZero();
        assertThat(self(HttpMethod.GET, ACCOUNTS + "/" + firstAccount, token, null).code())
                .as("删除成员关系不删除账号").isEqualTo(200);
        assertThat(self(HttpMethod.GET, USER_GROUPS + "/" + groupId, token, null).code())
                .as("删除成员关系不删除用户组").isEqualTo(200);
        self(HttpMethod.DELETE, MEMBERSHIPS + "/" + first.text("id") + "?version=" + first.text("version"), token,
                null).assertCode(40401);

        assertThat(self(HttpMethod.GET, MEMBERSHIPS + "?userGroupId=" + groupId, token, null).assertCode(200)
                .intField("total")).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-14 / TC-31-006：账号组织关联组合唯一，编辑冲突不改动，删除只解除关系")
    void accountOrganizationUniquenessAndDetach() {
        String token = adminToken();
        String accountId = createAccount(token, "tc31-006");
        String orgId = createOrganization(token, unique("tc31-org"));
        String otherOrgId = createOrganization(token, unique("tc31-org-other"));

        ApiResult first = self(HttpMethod.POST, ACCOUNT_ORGS, token,
                Map.of("accountId", accountId, "orgId", orgId)).assertCode(200);
        self(HttpMethod.POST, ACCOUNT_ORGS, token, Map.of("accountId", accountId, "orgId", orgId)).assertCode(40902);
        assertThat(countAccountOrgs(accountId, orgId)).as("同一组合只有一条").isEqualTo(1);
        assertThat(self(HttpMethod.GET, ACCOUNT_ORGS + "?accountId=" + accountId, token, null).assertCode(200)
                .intField("total")).as("按 accountId 精确命中").isEqualTo(1);

        Map<String, Object> move = new LinkedHashMap<>();
        move.put("version", first.text("version"));
        move.put("orgId", otherOrgId);
        ApiResult moved = self(HttpMethod.PATCH, ACCOUNT_ORGS + "/" + first.text("id"), token, move).assertCode(200);
        assertThat(moved.text("orgId")).isEqualTo(otherOrgId);

        // 账号可以关联多个组织，无主部门
        ApiResult second = self(HttpMethod.POST, ACCOUNT_ORGS, token,
                Map.of("accountId", accountId, "orgId", orgId)).assertCode(200);
        Map<String, Object> conflict = new LinkedHashMap<>();
        conflict.put("version", second.text("version"));
        conflict.put("orgId", otherOrgId);
        self(HttpMethod.PATCH, ACCOUNT_ORGS + "/" + second.text("id"), token, conflict).assertCode(40902);
        assertThat(queryOne("SELECT org_id FROM qs__auth__account_organization WHERE id = ?", Long.class,
                Long.parseLong(second.text("id")))).as("编辑冲突时原关联不变").isEqualTo(Long.parseLong(orgId));

        self(HttpMethod.DELETE, ACCOUNT_ORGS + "/" + second.text("id") + "?version=" + second.text("version"), token,
                null).assertCode(200);
        assertThat(countAccountOrgs(accountId, orgId)).isZero();
        assertThat(self(HttpMethod.GET, ACCOUNTS + "/" + accountId, token, null).code())
                .as("解除关联不删除账号").isEqualTo(200);
        assertThat(self(HttpMethod.GET, ORGANIZATIONS + "/" + orgId, token, null).code())
                .as("解除关联不删除组织").isEqualTo(200);
        self(HttpMethod.DELETE, ACCOUNT_ORGS + "/" + second.text("id") + "?version=" + second.text("version"), token,
                null).assertCode(40401);
        assertThat(countAccountOrgs(accountId, otherOrgId)).as("其他组织关联不受影响").isEqualTo(1);
    }

    @Test
    @DisplayName("AC-13 / TC-13-001~004、TC-31-011：权限组增改删查与 operationIds 校验")
    void permissionGroupCrudAndOperationIdsValidation() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "tc13-app");
        String listOperation = registerOperation(app.appCode(), "Device", "list");
        String controlOperation = registerOperation(app.appCode(), "Device", "control");

        String name = unique("tc13-group");
        String id = createPermissionGroup(token, name, List.of(listOperation));
        ApiResult detail = self(HttpMethod.GET, PERMISSION_GROUPS + "/" + id, token, null).assertCode(200);
        assertThat(detail.text("name")).isEqualTo(name);
        assertThat(strings(detail.data().path("operationIds"))).containsExactly(listOperation);
        assertThat(self(HttpMethod.GET, PERMISSION_GROUPS + "?name=" + name, token, null).assertCode(200)
                .intField("total")).as("按 name 精确命中").isEqualTo(1);

        String version = detail.text("version");
        String stored = storedOperationIds(id);

        Map<String, Object> missingOperation = new LinkedHashMap<>();
        missingOperation.put("version", version);
        missingOperation.put("operationIds", List.of("999999999"));
        ApiResult unknown = self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, missingOperation)
                .assertCode(40001);
        assertThat(unknown.fieldErrorNames()).contains("operationIds");

        Map<String, Object> duplicates = new LinkedHashMap<>();
        duplicates.put("version", version);
        duplicates.put("operationIds", List.of(listOperation, listOperation));
        ApiResult repeated = self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, duplicates).assertCode(40001);
        assertThat(repeated.fieldErrorNames()).contains("operationIds");

        String notArray = "{\"version\":\"" + version + "\",\"operationIds\":{}}";
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, notArray).assertCode(40001);

        assertThat(storedOperationIds(id)).as("非法 operationIds 整体拒绝，原集合不变").isEqualTo(stored);

        self(HttpMethod.POST, PERMISSION_GROUPS, token,
                Map.of("name", unique("tc13-bad"), "operationIds", List.of("999999999"))).assertCode(40001);
        self(HttpMethod.POST, PERMISSION_GROUPS, token,
                Map.of("name", unique("tc13-bad"), "operationIds", List.of(listOperation, listOperation)))
                .assertCode(40001);
        self(HttpMethod.POST, PERMISSION_GROUPS, token,
                "{\"name\":\"" + unique("tc13-bad") + "\",\"operationIds\":{}}").assertCode(40001);

        Map<String, Object> replace = new LinkedHashMap<>();
        replace.put("version", version);
        replace.put("operationIds", List.of(listOperation, controlOperation));
        ApiResult replaced = self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, replace).assertCode(200);
        assertThat(strings(replaced.data().path("operationIds"))).containsExactly(listOperation, controlOperation);

        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("version", replaced.text("version"));
        clear.put("operationIds", List.of());
        ApiResult cleared = self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, clear).assertCode(200);
        assertThat(strings(cleared.data().path("operationIds"))).as("空数组表示不授予任何操作").isEmpty();
        assertThat(storedOperationIds(id)).isEqualTo("[]");

        // 旧版本 + 与当前相同的空集合：版本判定优先，返回 40901。
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, clear).assertCode(40901);
        Map<String, Object> staleGrant = new LinkedHashMap<>();
        staleGrant.put("version", replaced.text("version"));
        staleGrant.put("operationIds", List.of(listOperation));
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, staleGrant).assertCode(40901);
        assertThat(storedOperationIds(id)).as("旧版本提交不覆盖已保存的操作集合").isEqualTo("[]");
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + id + "?version=" + cleared.text("version"), token, null)
                .assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + id + "?version=" + cleared.text("version"), token, null)
                .assertCode(40401);
    }

    @Test
    @DisplayName("AC-21/AC-40 / TC-13-005、TC-32-004：权限组被三类引用阻止删除，解除后删除成功")
    void permissionGroupDeleteBlockedByReferences() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "tc32-app");
        String operation = registerOperation(app.appCode(), "Device", "list");

        // 引用一：应用可见范围
        String visibleGroup = createPermissionGroup(token, unique("tc32-visible-ref"), List.of(operation));
        AppSession visibleApp = createApplication(token, List.of(visibleGroup), "tc32-visible");
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + visibleGroup + "?version=1", token, null).assertCode(40903);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__permission_group WHERE id = ?", Long.class,
                Long.parseLong(visibleGroup))).as("被引用时不删除权限组").isEqualTo(1);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__app_permission_group WHERE permission_group_id = ?",
                Long.class, Long.parseLong(visibleGroup))).as("被引用时关联不变").isEqualTo(1);
        clearVisibleGroups(token, visibleApp.id());
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + visibleGroup + "?version=1", token, null).assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + visibleGroup + "?version=1", token, null).assertCode(40401);

        // 引用二：用户权限组关联
        String accountGroup = createPermissionGroup(token, unique("tc32-account-ref"), List.of(operation));
        String accountId = createAccount(token, "tc32-acc");
        linkAccountToGroup(token, accountGroup, accountId);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + accountGroup + "?version=1", token, null).assertCode(40903);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__permission_group_account WHERE permission_group_id = ?",
                Long.class, Long.parseLong(accountGroup))).as("被引用时用户关联不变").isEqualTo(1);
        String relationId = queryOne("SELECT id FROM qs__auth__permission_group_account WHERE permission_group_id = ?",
                Long.class, Long.parseLong(accountGroup)).toString();
        self(HttpMethod.DELETE, ACCOUNT_GROUPS + "/" + relationId + "?version=1", token, null).assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + accountGroup + "?version=1", token, null).assertCode(200);

        // 引用三：组织权限组关联
        String orgGroup = createPermissionGroup(token, unique("tc32-org-ref"), List.of(operation));
        String orgId = createOrganization(token, unique("tc32-org"));
        ApiResult orgLink = self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", orgGroup, "orgId", orgId)).assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + orgGroup + "?version=1", token, null).assertCode(40903);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__permission_group_org WHERE permission_group_id = ?",
                Long.class, Long.parseLong(orgGroup))).as("被引用时组织关联不变").isEqualTo(1);
        self(HttpMethod.DELETE, ORG_GROUPS + "/" + orgLink.text("id") + "?version=" + orgLink.text("version"), token,
                null).assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + orgGroup + "?version=1", token, null).assertCode(200);

        // 版本变化与重复删除
        String versioned = createPermissionGroup(token, unique("tc32-version"), List.of(operation));
        Map<String, Object> rename = new LinkedHashMap<>();
        rename.put("version", "1");
        rename.put("description", "修改后说明");
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + versioned, token, rename).assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + versioned + "?version=1", token, null).assertCode(40901);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + versioned + "?version=2", token, null).assertCode(200);
        self(HttpMethod.DELETE, PERMISSION_GROUPS + "/" + versioned + "?version=2", token, null).assertCode(40401);
    }

    @Test
    @DisplayName("AC-14 / TC-14-001~005：用户权限组关联增改删查、组合唯一与只解除关系")
    void accountPermissionGroupCrudAndUniqueness() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "tc14-app");
        String operation = registerOperation(app.appCode(), "Device", "list");
        String groupId = createPermissionGroup(token, unique("tc14-group"), List.of(operation));
        String firstAccount = createAccount(token, "tc14-acc-a");
        String secondAccount = createAccount(token, "tc14-acc-b");

        ApiResult first = self(HttpMethod.POST, ACCOUNT_GROUPS, token,
                Map.of("permissionGroupId", groupId, "accountId", firstAccount)).assertCode(200);
        self(HttpMethod.POST, ACCOUNT_GROUPS, token, Map.of("permissionGroupId", groupId, "accountId", firstAccount))
                .assertCode(40902);
        assertThat(countAccountGroups(groupId, firstAccount)).as("同一组合只有一条").isEqualTo(1);

        ApiResult detail = self(HttpMethod.GET, ACCOUNT_GROUPS + "/" + first.text("id"), token, null).assertCode(200);
        assertThat(detail.text("permissionGroupId")).isEqualTo(groupId);
        assertThat(detail.text("accountId")).isEqualTo(firstAccount);
        ApiResult list = self(HttpMethod.GET, ACCOUNT_GROUPS + "?permissionGroupId=" + groupId, token, null)
                .assertCode(200);
        assertThat(list.intField("total")).as("按 permissionGroupId 精确命中").isEqualTo(1);

        Map<String, Object> move = new LinkedHashMap<>();
        move.put("version", first.text("version"));
        move.put("accountId", secondAccount);
        ApiResult moved = self(HttpMethod.PATCH, ACCOUNT_GROUPS + "/" + first.text("id"), token, move).assertCode(200);
        assertThat(moved.text("accountId")).isEqualTo(secondAccount);

        ApiResult second = self(HttpMethod.POST, ACCOUNT_GROUPS, token,
                Map.of("permissionGroupId", groupId, "accountId", firstAccount)).assertCode(200);
        Map<String, Object> conflict = new LinkedHashMap<>();
        conflict.put("version", second.text("version"));
        conflict.put("accountId", secondAccount);
        self(HttpMethod.PATCH, ACCOUNT_GROUPS + "/" + second.text("id"), token, conflict).assertCode(40902);
        assertThat(queryOne("SELECT account_id FROM qs__auth__permission_group_account WHERE id = ?", Long.class,
                Long.parseLong(second.text("id")))).as("编辑冲突时原关联不变").isEqualTo(Long.parseLong(firstAccount));

        self(HttpMethod.DELETE, ACCOUNT_GROUPS + "/" + second.text("id") + "?version=" + second.text("version"),
                token, null).assertCode(200);
        assertThat(countAccountGroups(groupId, firstAccount)).isZero();
        assertThat(self(HttpMethod.GET, ACCOUNTS + "/" + firstAccount, token, null).code())
                .as("解除关联不删除账号").isEqualTo(200);
        assertThat(self(HttpMethod.GET, PERMISSION_GROUPS + "/" + groupId, token, null).code())
                .as("解除关联不删除权限组").isEqualTo(200);
        self(HttpMethod.DELETE, ACCOUNT_GROUPS + "/" + second.text("id") + "?version=" + second.text("version"),
                token, null).assertCode(40401);
        assertThat(countAccountGroups(groupId, secondAccount)).as("其他关联不受影响").isEqualTo(1);

        self(HttpMethod.POST, ACCOUNT_GROUPS, token,
                Map.of("permissionGroupId", "999999999", "accountId", firstAccount)).assertCode(40001);
    }

    @Test
    @DisplayName("AC-14 / TC-14-006~010：组织权限组关联增改删查、组合唯一与只解除关系")
    void organizationPermissionGroupCrudAndUniqueness() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "tc14-org-app");
        String operation = registerOperation(app.appCode(), "Device", "list");
        String groupId = createPermissionGroup(token, unique("tc14-org-group"), List.of(operation));
        String orgId = createOrganization(token, unique("tc14-org-a"));
        String otherOrgId = createOrganization(token, unique("tc14-org-b"));

        ApiResult first = self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", orgId)).assertCode(200);
        self(HttpMethod.POST, ORG_GROUPS, token, Map.of("permissionGroupId", groupId, "orgId", orgId))
                .assertCode(40902);
        assertThat(countOrgGroups(groupId, orgId)).as("同一组合只有一条").isEqualTo(1);

        self(HttpMethod.GET, ORG_GROUPS + "/" + first.text("id"), token, null).assertCode(200);
        assertThat(self(HttpMethod.GET, ORG_GROUPS + "?orgId=" + orgId, token, null).assertCode(200)
                .intField("total")).as("按 orgId 精确命中").isEqualTo(1);

        Map<String, Object> move = new LinkedHashMap<>();
        move.put("version", first.text("version"));
        move.put("orgId", otherOrgId);
        ApiResult moved = self(HttpMethod.PATCH, ORG_GROUPS + "/" + first.text("id"), token, move).assertCode(200);
        assertThat(moved.text("orgId")).isEqualTo(otherOrgId);

        ApiResult second = self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", orgId)).assertCode(200);
        Map<String, Object> conflict = new LinkedHashMap<>();
        conflict.put("version", second.text("version"));
        conflict.put("orgId", otherOrgId);
        self(HttpMethod.PATCH, ORG_GROUPS + "/" + second.text("id"), token, conflict).assertCode(40902);
        assertThat(queryOne("SELECT org_id FROM qs__auth__permission_group_org WHERE id = ?", Long.class,
                Long.parseLong(second.text("id")))).as("编辑冲突时原关联不变").isEqualTo(Long.parseLong(orgId));

        self(HttpMethod.DELETE, ORG_GROUPS + "/" + second.text("id") + "?version=" + second.text("version"), token,
                null).assertCode(200);
        assertThat(countOrgGroups(groupId, orgId)).isZero();
        assertThat(self(HttpMethod.GET, ORGANIZATIONS + "/" + orgId, token, null).code())
                .as("解除关联不删除组织").isEqualTo(200);
        assertThat(self(HttpMethod.GET, PERMISSION_GROUPS + "/" + groupId, token, null).code())
                .as("解除关联不删除权限组").isEqualTo(200);
        self(HttpMethod.DELETE, ORG_GROUPS + "/" + second.text("id") + "?version=" + second.text("version"), token,
                null).assertCode(40401);
        assertThat(countOrgGroups(groupId, otherOrgId)).as("其他关联不受影响").isEqualTo(1);

        self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", "999999999")).assertCode(40001);
    }

    @Test
    @DisplayName("AC-14：同一组合重复新增只保留一条，第二次 40902，不产生重复授权")
    void duplicateCombinationInsertsSingleRow() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "tc31-012");
        String operation = registerOperation(app.appCode(), "Device", "list");
        String groupId = createPermissionGroup(token, unique("tc31-012-group"), List.of(operation));
        String accountId = createAccount(token, "tc31-012-acc");
        String orgId = createOrganization(token, unique("tc31-012-org"));
        String userGroupId = createUserGroup(token, unique("tc31-012-ug"));

        self(HttpMethod.POST, ACCOUNT_GROUPS, token,
                Map.of("permissionGroupId", groupId, "accountId", accountId)).assertCode(200);
        self(HttpMethod.POST, ACCOUNT_GROUPS, token,
                Map.of("permissionGroupId", groupId, "accountId", accountId)).assertCode(40902);
        assertThat(countAccountGroups(groupId, accountId)).isEqualTo(1);

        self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", orgId)).assertCode(200);
        self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", orgId)).assertCode(40902);
        assertThat(countOrgGroups(groupId, orgId)).isEqualTo(1);

        self(HttpMethod.POST, ACCOUNT_ORGS, token,
                Map.of("accountId", accountId, "orgId", orgId)).assertCode(200);
        self(HttpMethod.POST, ACCOUNT_ORGS, token,
                Map.of("accountId", accountId, "orgId", orgId)).assertCode(40902);
        assertThat(countAccountOrgs(accountId, orgId)).isEqualTo(1);

        self(HttpMethod.POST, MEMBERSHIPS, token,
                Map.of("userGroupId", userGroupId, "accountId", accountId)).assertCode(200);
        self(HttpMethod.POST, MEMBERSHIPS, token,
                Map.of("userGroupId", userGroupId, "accountId", accountId)).assertCode(40902);
        assertThat(countMemberships(userGroupId, accountId)).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-12/AC-14：各列表拒绝未公布的筛选参数与非整数标识筛选值")
    void listsRejectUnsupportedFilters() {
        String token = adminToken();
        assertUnsupported(token, PARAMETERS, "appCode");
        assertUnsupported(token, DICTIONARIES, "paramCode");
        assertUnsupported(token, USER_GROUPS, "userGroupId");
        assertUnsupported(token, MEMBERSHIPS, "orgId");
        assertUnsupported(token, ACCOUNT_ORGS, "userGroupId");
        assertUnsupported(token, PERMISSION_GROUPS, "operationIds");
        assertUnsupported(token, ACCOUNT_GROUPS, "orgId");
        assertUnsupported(token, ORG_GROUPS, "accountId");

        assertUnsupported(token, ACCOUNT_ORGS, "accountId", "abc");
        assertUnsupported(token, MEMBERSHIPS, "userGroupId", "abc");
        assertUnsupported(token, ACCOUNT_GROUPS, "permissionGroupId", "abc");
        assertUnsupported(token, ORG_GROUPS, "orgId", "abc");
    }

    @Test
    @DisplayName("F-06 / AC-12：参数提交与当前值相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；真实变更才递增版本")
    void parameterPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        String code = unique("f06-param");
        String id = createParameter(token, code, "原值");
        long rowId = Long.parseLong(id);
        long version = storedVersion("qs__auth__sys_param", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__sys_param", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("paramCode", code);
        identical.put("paramValue", "原值");
        identical.put("description", null);
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__sys_param", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("paramValue", "新值");
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, changed).assertCode(200);
        assertThat(paramValue(token, id)).isEqualTo("新值");
        assertThat(storedVersion("qs__auth__sys_param", rowId)).as("真实变更递增版本").isEqualTo(version + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterChange = storedUpdatedAt("qs__auth__sys_param", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("paramValue", "新值");
        self(HttpMethod.PATCH, PARAMETERS + "/" + id, token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__sys_param", rowId, version + 1, afterChange);
        deleteParameter(token, id);
    }

    @Test
    @DisplayName("F-06 / AC-12：字典项内容相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；顺序不同算变更")
    void dictionaryPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        String code = unique("f06-dict");
        String id = createDictionary(token, code, List.of("启用", "禁用"));
        long rowId = Long.parseLong(id);
        long version = storedVersion("qs__auth__sys_dict", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__sys_dict", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("dictCode", code);
        identical.put("dictItems", List.of("启用", "禁用"));
        self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__sys_dict", rowId, version, updatedAt);
        assertThat(dictItemCount(id)).as("空提交不改变字典项").isEqualTo(2);

        // 字典项顺序有意义：提交逆序仍是有效变更。
        Map<String, Object> reordered = new LinkedHashMap<>();
        reordered.put("version", String.valueOf(version));
        reordered.put("dictItems", List.of("禁用", "启用"));
        ApiResult updated = self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, reordered).assertCode(200);
        assertThat(strings(updated.data().path("dictItems"))).containsExactly("禁用", "启用");
        assertThat(storedVersion("qs__auth__sys_dict", rowId)).as("真实变更递增版本").isEqualTo(version + 1);

        // 旧版本 + 与当前相同的字典项：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterReorder = storedUpdatedAt("qs__auth__sys_dict", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("dictItems", List.of("禁用", "启用"));
        self(HttpMethod.PATCH, DICTIONARIES + "/" + id, token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__sys_dict", rowId, version + 1, afterReorder);
    }

    @Test
    @DisplayName("F-06 / AC-11：用户组提交与当前值相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；真实变更才递增版本")
    void userGroupPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        String code = unique("f06-group");
        String id = createUserGroup(token, code);
        long rowId = Long.parseLong(id);
        long version = storedVersion("qs__auth__user_group", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__user_group", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("groupCode", code);
        identical.put("groupName", "组-" + code);
        self(HttpMethod.PATCH, USER_GROUPS + "/" + id, token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__user_group", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("groupName", "改后组名");
        ApiResult updated = self(HttpMethod.PATCH, USER_GROUPS + "/" + id, token, changed).assertCode(200);
        assertThat(updated.text("groupName")).isEqualTo("改后组名");
        assertThat(storedVersion("qs__auth__user_group", rowId)).as("真实变更递增版本").isEqualTo(version + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterChange = storedUpdatedAt("qs__auth__user_group", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("groupCode", code);
        staleIdentical.put("groupName", "改后组名");
        self(HttpMethod.PATCH, USER_GROUPS + "/" + id, token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__user_group", rowId, version + 1, afterChange);
    }

    @Test
    @DisplayName("F-06 / AC-11：用户组成员提交与当前值相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；真实变更才递增版本")
    void membershipPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        String groupId = createUserGroup(token, unique("f06-member"));
        String accountId = createAccount(token, "f06-member-a");
        String otherAccountId = createAccount(token, "f06-member-b");
        ApiResult created = self(HttpMethod.POST, MEMBERSHIPS, token,
                Map.of("userGroupId", groupId, "accountId", accountId)).assertCode(200);
        long rowId = Long.parseLong(created.text("id"));
        long version = storedVersion("qs__auth__user_group_account", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__user_group_account", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("userGroupId", groupId);
        identical.put("accountId", accountId);
        self(HttpMethod.PATCH, MEMBERSHIPS + "/" + created.text("id"), token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__user_group_account", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("accountId", otherAccountId);
        ApiResult moved = self(HttpMethod.PATCH, MEMBERSHIPS + "/" + created.text("id"), token, changed)
                .assertCode(200);
        assertThat(moved.text("accountId")).isEqualTo(otherAccountId);
        assertThat(storedVersion("qs__auth__user_group_account", rowId)).as("真实变更递增版本")
                .isEqualTo(version + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterMove = storedUpdatedAt("qs__auth__user_group_account", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("userGroupId", groupId);
        staleIdentical.put("accountId", otherAccountId);
        self(HttpMethod.PATCH, MEMBERSHIPS + "/" + created.text("id"), token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__user_group_account", rowId, version + 1, afterMove);
    }

    @Test
    @DisplayName("F-06 / AC-14：账号组织关联提交与当前值相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；真实变更才递增版本")
    void accountOrganizationPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        String accountId = createAccount(token, "f06-link");
        String orgId = createOrganization(token, unique("f06-link-org"));
        String otherOrgId = createOrganization(token, unique("f06-link-org-other"));
        ApiResult created = self(HttpMethod.POST, ACCOUNT_ORGS, token,
                Map.of("accountId", accountId, "orgId", orgId)).assertCode(200);
        long rowId = Long.parseLong(created.text("id"));
        long version = storedVersion("qs__auth__account_organization", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__account_organization", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("accountId", accountId);
        identical.put("orgId", orgId);
        self(HttpMethod.PATCH, ACCOUNT_ORGS + "/" + created.text("id"), token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__account_organization", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("orgId", otherOrgId);
        ApiResult moved = self(HttpMethod.PATCH, ACCOUNT_ORGS + "/" + created.text("id"), token, changed)
                .assertCode(200);
        assertThat(moved.text("orgId")).isEqualTo(otherOrgId);
        assertThat(storedVersion("qs__auth__account_organization", rowId)).as("真实变更递增版本")
                .isEqualTo(version + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterMove = storedUpdatedAt("qs__auth__account_organization", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("accountId", accountId);
        staleIdentical.put("orgId", otherOrgId);
        self(HttpMethod.PATCH, ACCOUNT_ORGS + "/" + created.text("id"), token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__account_organization", rowId, version + 1, afterMove);
    }

    @Test
    @DisplayName("F-06 / AC-13：权限组提交内容与当前相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；标识顺序不算变更")
    void permissionGroupPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "f06-pg");
        String listOperation = registerOperation(app.appCode(), "Device", "list");
        String controlOperation = registerOperation(app.appCode(), "Device", "control");
        String name = unique("f06-pg-group");
        String id = createPermissionGroup(token, name, List.of(listOperation, controlOperation));
        long rowId = Long.parseLong(id);
        long version = storedVersion("qs__auth__permission_group", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__permission_group", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("name", name);
        identical.put("operationIds", List.of(listOperation, controlOperation));
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__permission_group", rowId, version, updatedAt);

        // 标识集合不比较顺序：元素相同只是顺序不同仍是空提交。
        Map<String, Object> reordered = new LinkedHashMap<>();
        reordered.put("version", String.valueOf(version));
        reordered.put("operationIds", List.of(controlOperation, listOperation));
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, reordered).assertCode(40001);
        assertStoredUnchanged("qs__auth__permission_group", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("operationIds", List.of(listOperation));
        ApiResult updated = self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, changed).assertCode(200);
        assertThat(strings(updated.data().path("operationIds"))).containsExactly(listOperation);
        assertThat(storedVersion("qs__auth__permission_group", rowId)).as("真实变更递增版本")
                .isEqualTo(version + 1);

        // 旧版本 + 与当前相同的操作集合：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterChange = storedUpdatedAt("qs__auth__permission_group", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("operationIds", List.of(listOperation));
        self(HttpMethod.PATCH, PERMISSION_GROUPS + "/" + id, token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__permission_group", rowId, version + 1, afterChange);
    }

    @Test
    @DisplayName("F-06 / AC-14：用户权限组关联提交与当前值相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；真实变更才递增版本")
    void accountPermissionGroupPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "f06-apg");
        String operation = registerOperation(app.appCode(), "Device", "list");
        String groupId = createPermissionGroup(token, unique("f06-apg-group"), List.of(operation));
        String accountId = createAccount(token, "f06-apg-a");
        String otherAccountId = createAccount(token, "f06-apg-b");
        ApiResult created = self(HttpMethod.POST, ACCOUNT_GROUPS, token,
                Map.of("permissionGroupId", groupId, "accountId", accountId)).assertCode(200);
        long rowId = Long.parseLong(created.text("id"));
        long version = storedVersion("qs__auth__permission_group_account", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__permission_group_account", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("permissionGroupId", groupId);
        identical.put("accountId", accountId);
        self(HttpMethod.PATCH, ACCOUNT_GROUPS + "/" + created.text("id"), token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__permission_group_account", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("accountId", otherAccountId);
        ApiResult moved = self(HttpMethod.PATCH, ACCOUNT_GROUPS + "/" + created.text("id"), token, changed)
                .assertCode(200);
        assertThat(moved.text("accountId")).isEqualTo(otherAccountId);
        assertThat(storedVersion("qs__auth__permission_group_account", rowId)).as("真实变更递增版本")
                .isEqualTo(version + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterMove = storedUpdatedAt("qs__auth__permission_group_account", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("permissionGroupId", groupId);
        staleIdentical.put("accountId", otherAccountId);
        self(HttpMethod.PATCH, ACCOUNT_GROUPS + "/" + created.text("id"), token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__permission_group_account", rowId, version + 1, afterMove);
    }

    @Test
    @DisplayName("F-06 / AC-14：组织权限组关联提交与当前值相同时 40001，版本与更新时间不变；同值 + 旧版本 40901；真实变更才递增版本")
    void organizationPermissionGroupPatchWithoutEffectiveChangeIsRejected() {
        String token = adminToken();
        AppSession app = createApplication(token, null, "f06-opg");
        String operation = registerOperation(app.appCode(), "Device", "list");
        String groupId = createPermissionGroup(token, unique("f06-opg-group"), List.of(operation));
        String orgId = createOrganization(token, unique("f06-opg-org"));
        String otherOrgId = createOrganization(token, unique("f06-opg-org-other"));
        ApiResult created = self(HttpMethod.POST, ORG_GROUPS, token,
                Map.of("permissionGroupId", groupId, "orgId", orgId)).assertCode(200);
        long rowId = Long.parseLong(created.text("id"));
        long version = storedVersion("qs__auth__permission_group_org", rowId);
        Timestamp updatedAt = storedUpdatedAt("qs__auth__permission_group_org", rowId);

        Map<String, Object> identical = new LinkedHashMap<>();
        identical.put("version", String.valueOf(version));
        identical.put("permissionGroupId", groupId);
        identical.put("orgId", orgId);
        self(HttpMethod.PATCH, ORG_GROUPS + "/" + created.text("id"), token, identical).assertCode(40001);
        assertStoredUnchanged("qs__auth__permission_group_org", rowId, version, updatedAt);

        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("version", String.valueOf(version));
        changed.put("orgId", otherOrgId);
        ApiResult moved = self(HttpMethod.PATCH, ORG_GROUPS + "/" + created.text("id"), token, changed)
                .assertCode(200);
        assertThat(moved.text("orgId")).isEqualTo(otherOrgId);
        assertThat(storedVersion("qs__auth__permission_group_org", rowId)).as("真实变更递增版本")
                .isEqualTo(version + 1);

        // 旧版本 + 与当前相同的值：版本判定优先，返回 40901，版本与更新时间不变。
        Timestamp afterMove = storedUpdatedAt("qs__auth__permission_group_org", rowId);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", String.valueOf(version));
        staleIdentical.put("permissionGroupId", groupId);
        staleIdentical.put("orgId", otherOrgId);
        self(HttpMethod.PATCH, ORG_GROUPS + "/" + created.text("id"), token, staleIdentical).assertCode(40901);
        assertStoredUnchanged("qs__auth__permission_group_org", rowId, version + 1, afterMove);
    }

    /**
     * 读取行上的编辑版本。
     *
     * @param table 表名，取作用例内的固定常量
     * @param id 行标识
     * @return 编辑版本
     */
    private long storedVersion(String table, long id) {
        return queryOne("SELECT version FROM " + table + " WHERE id = ?", Long.class, id);
    }

    /**
     * 读取行上的更新时间。
     *
     * @param table 表名，取作用例内的固定常量
     * @param id 行标识
     * @return 更新时间
     */
    private Timestamp storedUpdatedAt(String table, long id) {
        return queryOne("SELECT updated_at FROM " + table + " WHERE id = ?", Timestamp.class, id);
    }

    /**
     * 核对被拒绝的空提交没有改动该行。
     *
     * @param table 表名，取作用例内的固定常量
     * @param id 行标识
     * @param version 提交前的编辑版本
     * @param updatedAt 提交前的更新时间
     */
    private void assertStoredUnchanged(String table, long id, long version, Timestamp updatedAt) {
        assertThat(storedVersion(table, id)).as("空提交不递增版本").isEqualTo(version);
        assertThat(storedUpdatedAt(table, id)).as("空提交不刷新更新时间").isEqualTo(updatedAt);
    }

    private void assertUnsupported(String token, String path, String parameter) {
        assertUnsupported(token, path, parameter, "1");
    }

    private void assertUnsupported(String token, String path, String parameter, String value) {
        ApiResult rejected = self(HttpMethod.GET, path + "?" + parameter + "=" + value, token, null).assertCode(40001);
        assertThat(rejected.fieldErrorNames()).as("%s 的筛选参数 %s 未公布", path, parameter).contains(parameter);
    }

    private static List<String> strings(JsonNode node) {
        List<String> values = new ArrayList<>();
        node.values().forEach(item -> values.add(item.asString()));
        return values;
    }

    private String paramValue(String token, String id) {
        return self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).assertCode(200).text("paramValue");
    }

    private long countParamsByCode(String code) {
        return queryOne("SELECT count(*) FROM qs__auth__sys_param WHERE param_code = ?", Long.class, code);
    }

    private long countDictsByCode(String code) {
        return queryOne("SELECT count(*) FROM qs__auth__sys_dict WHERE dict_code = ?", Long.class, code);
    }

    private int dictItemCount(String id) {
        return queryOne("SELECT jsonb_array_length(dict_items) FROM qs__auth__sys_dict WHERE id = ?", Integer.class,
                Long.parseLong(id));
    }

    private long countUserGroupsByCode(String code) {
        return queryOne("SELECT count(*) FROM qs__auth__user_group WHERE group_code = ?", Long.class, code);
    }

    private long countMemberships(String groupId, String accountId) {
        return queryOne("SELECT count(*) FROM qs__auth__user_group_account WHERE user_group_id = ? AND account_id = ?",
                Long.class, Long.parseLong(groupId), Long.parseLong(accountId));
    }

    private long countAccountOrgs(String accountId, String orgId) {
        return queryOne("SELECT count(*) FROM qs__auth__account_organization WHERE account_id = ? AND org_id = ?",
                Long.class, Long.parseLong(accountId), Long.parseLong(orgId));
    }

    private long countAccountGroups(String groupId, String accountId) {
        return queryOne("SELECT count(*) FROM qs__auth__permission_group_account"
                + " WHERE permission_group_id = ? AND account_id = ?", Long.class, Long.parseLong(groupId),
                Long.parseLong(accountId));
    }

    private long countOrgGroups(String groupId, String orgId) {
        return queryOne("SELECT count(*) FROM qs__auth__permission_group_org"
                + " WHERE permission_group_id = ? AND org_id = ?", Long.class, Long.parseLong(groupId),
                Long.parseLong(orgId));
    }

    private String storedOperationIds(String id) {
        return queryOne("SELECT operation_ids::text FROM qs__auth__permission_group WHERE id = ?", String.class,
                Long.parseLong(id));
    }

    private String createParameter(String token, String code, String value) {
        ApiResult created = self(HttpMethod.POST, PARAMETERS, token,
                Map.of("paramCode", code, "paramValue", value)).assertCode(200);
        String id = created.text("id");
        assertThat(created.text("paramCode")).isEqualTo(code);
        assertThat(created.text("version")).isEqualTo("1");
        return id;
    }

    private void deleteParameter(String token, String id) {
        String version = self(HttpMethod.GET, PARAMETERS + "/" + id, token, null).assertCode(200).text("version");
        self(HttpMethod.DELETE, PARAMETERS + "/" + id + "?version=" + version, token, null).assertCode(200);
    }

    private String createDictionary(String token, String code, List<String> items) {
        ApiResult created = self(HttpMethod.POST, DICTIONARIES, token,
                Map.of("dictCode", code, "dictItems", items)).assertCode(200);
        return created.text("id");
    }

    private String createUserGroup(String token, String code) {
        ApiResult created = self(HttpMethod.POST, USER_GROUPS, token,
                Map.of("groupCode", code, "groupName", "组-" + code)).assertCode(200);
        assertThat(created.text("groupCode")).isEqualTo(code);
        return created.text("id");
    }

    private String createAccount(String token, String prefix) {
        ApiResult created = self(HttpMethod.POST, ACCOUNTS, token,
                Map.of("username", unique(prefix), "password", MEMBER_PASSWORD)).assertCode(200);
        return created.text("id");
    }

    private String createOrganization(String token, String name) {
        ApiResult created = self(HttpMethod.POST, ORGANIZATIONS, token,
                Map.of("orgName", name, "orgType", "department")).assertCode(200);
        assertThat(created.text("parentId")).isEqualTo("0");
        return created.text("id");
    }

    private void clearVisibleGroups(String token, String appId) {
        ApiResult detail = self(HttpMethod.GET, APPLICATIONS + "/" + appId, token, null).assertCode(200);
        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("version", detail.text("version"));
        clear.put("permissionGroupIds", List.of());
        self(HttpMethod.PATCH, APPLICATIONS + "/" + appId, token, clear).assertCode(200);
    }
}
