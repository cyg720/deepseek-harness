package com.qs.authority.appauthorization;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/**
 * 应用授权与操作登记接口验收（AC-01、AC-15、AC-42；TC-31-001/002/013/014、TC-33-002/003）。
 *
 * <p>覆盖 AppKey 缺失与无效、应用中心登记与一次性 AppSecret、重复编码不覆盖原 AppKey、受控身份
 * 边界、操作码前缀与跨应用同名、重复上报、改名保留稳定 id 与权限组引用、状态同步与旧版本冲突、
 * 可见权限组配置的字段白名单，以及旧版本无变化提交的版本优先判定。响应秘密、记录不变性与关联
 * 行数都用 jdbc 或响应原文核对。
 */
@DisplayName("应用授权：AppKey、登记、操作上报与状态同步")
class ApplicationAuthorizationIT extends AbstractAuthorityTest {

    private static final String APPS = "/api/v1/auth/application-authorizations";
    private static final String OPERATIONS = "/api/v1/auth/operations";
    private static final String CHECKS = "/api/v1/auth/authorization-checks";
    private static final String ME = "/api/v1/auth/users/me";

    @Test
    @DisplayName("AC-01/TC-31-001：缺少或无效 AppKey 一律 40104，合法 AppKey 通过应用身份检查")
    void missingOrUnknownAppKeyIsRejected() {
        Map<String, Object> body = Map.of("appCode", unique("aa-nokey"));
        call(HttpMethod.POST, APPS, null, null, body).assertCode(40104);
        call(HttpMethod.POST, APPS, "unknown-app-key", null, body).assertCode(40104);
        call(HttpMethod.POST, APPS, "unknown-app-key", adminToken(), body).assertCode(40104);
        call(HttpMethod.GET, APPS, null, null, null).assertCode(40104);
        call(HttpMethod.GET, APPS, "unknown-app-key", null, null).assertCode(40104);
        // 鉴权入口同样先认 AppKey：带上有效令牌但不带 AppKey 仍是 40104。
        call(HttpMethod.POST, CHECKS, null, adminToken(), Map.of("operationCode", "auth-center.AccountController.list"))
                .assertCode(40104);

        // 对照：合法 AppKey 走到后续身份检查，而不是停在 40104。
        self(HttpMethod.GET, APPS, adminToken(), null).assertCode(200);
    }

    @Test
    @DisplayName("AC-15/TC-31-013：登记返回一次性 AppSecret，重复 appCode 返回 40902 且不改动原 AppKey")
    void registerReturnsOneTimeSecretAndRejectsDuplicate() {
        String admin = adminToken();
        String appCode = unique("aa-register");
        ApiResult created = appCenter(HttpMethod.POST, APPS, Map.of("appCode", appCode)).assertCode(200);
        String id = created.text("id");
        String appKey = created.text("appKey");
        String appSecret = created.text("appSecret");

        assertThat(appKey).startsWith("ak_");
        assertThat(appSecret).startsWith("sk_");
        assertThat(created.text("status")).isEqualTo("active");
        String storedSecret = queryOne("SELECT app_secret FROM qs__auth__app_authorization WHERE id = ?",
                String.class, Long.parseLong(id));
        assertThat(storedSecret).as("AppSecret 只落摘要").isNotEqualTo(appSecret).matches("[0-9a-f]{64}");
        assertThat(queryOne("SELECT app_key FROM qs__auth__app_authorization WHERE id = ?", String.class,
                Long.parseLong(id))).isEqualTo(appKey);

        // 详情不返回任何可用作身份的凭据：AppKey 与 AppSecret 只出现在建立授权记录的一次性响应里。
        ApiResult detail = self(HttpMethod.GET, APPS + "/" + id, admin, null).assertCode(200);
        assertThat(detail.data().has("appKey")).isFalse();
        assertThat(detail.body()).doesNotContain(appKey).doesNotContain(appSecret);

        // 列表不含 AppKey 与 AppSecret。
        ApiResult list = self(HttpMethod.GET, APPS + "?appCode=" + appCode, admin, null).assertCode(200);
        assertThat(list.intField("total")).isEqualTo(1);
        assertThat(list.body()).doesNotContain(appKey).doesNotContain(appSecret);
        List<JsonNode> items = new ArrayList<>();
        list.data().path("items").values().forEach(items::add);
        assertThat(items).hasSize(1);
        // 列表条目不含 AppKey 字段（既不出现明文，也不以 null 形式暴露字段）
        assertThat(items.get(0).has("appKey")).isFalse();
        assertThat(items.get(0).path("appCode").asString()).isEqualTo(appCode);

        // 重复登记不覆盖既有记录。
        appCenter(HttpMethod.POST, APPS, Map.of("appCode", appCode)).assertCode(40902);
        assertThat(queryOne("SELECT app_key FROM qs__auth__app_authorization WHERE app_code = ?", String.class,
                appCode)).isEqualTo(appKey);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__app_authorization WHERE app_code = ?", Long.class,
                appCode)).isEqualTo(1L);
    }

    @Test
    @DisplayName("AC-01/AC-15/TC-31-013：登记与状态同步只接受应用中心受控身份，受控 AppKey 也不越界")
    void registerAndStateSyncAreControlledByAppCenter() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "aa-control");
        String appCode = unique("aa-control");

        // 授权中心自身 AppKey 需要用户令牌，但不能调用应用中心专属接口。
        self(HttpMethod.POST, APPS, admin, Map.of("appCode", appCode)).assertCode(40301);
        self(HttpMethod.POST, APPS, member.token(), Map.of("appCode", appCode)).assertCode(40301);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__app_authorization WHERE app_code = ?", Long.class,
                appCode)).as("被拒绝的登记不得落库").isZero();

        ApiResult app = appCenter(HttpMethod.POST, APPS, Map.of("appCode", appCode)).assertCode(200);
        String syncPath = APPS + "/" + app.text("id") + "/state-sync";
        Map<String, Object> sync = Map.of("status", "frozen", "version", app.text("version"));
        self(HttpMethod.POST, syncPath, admin, sync).assertCode(40301);
        self(HttpMethod.POST, syncPath, member.token(), sync).assertCode(40301);
        self(HttpMethod.POST, syncPath, null, sync).assertCode(40101);
        assertThat(queryOne("SELECT status FROM qs__auth__app_authorization WHERE app_code = ?", String.class,
                appCode)).as("被拒绝的同步不得改动状态").isEqualTo("active");

        // 受控 AppKey 只在其专属接口生效，不能调用授权中心自身管理接口。
        call(HttpMethod.GET, "/api/v1/auth/accounts", APP_CENTER_KEY, admin, null).assertCode(40301);
        call(HttpMethod.POST, "/api/v1/auth/permission-groups", APP_CENTER_KEY, admin,
                Map.of("name", unique("group-control"), "operationIds", List.of())).assertCode(40301);
        // 受控 AppKey 也不因为身份受控就放行不存在的应用：上报操作仍要求该 appCode 已有授权记录。
        appCenter(HttpMethod.POST, OPERATIONS,
                Map.of("appCode", "aa-not-authorized", "operationCode", "aa-not-authorized.X.list",
                        "operationName", "list")).assertCode(40001);
        // 同一路径的两种主体：应用中心受控身份无需用户令牌，授权中心管理员需要令牌与操作权限。
        call(HttpMethod.GET, APPS, APP_CENTER_KEY, null, null).assertCode(200);
        call(HttpMethod.GET, APPS, SELF_APP_KEY, null, null).assertCode(40101);
        self(HttpMethod.GET, APPS, admin, null).assertCode(200);
    }

    @Test
    @DisplayName("AC-15/BR-33：操作码必须带所属应用前缀，跨应用同名可并存，重复上报 40902 且原记录不变")
    void operationRegistrationRules() {
        String admin = adminToken();
        AppSession appA = createApplication(admin, null, "aa-op");
        AppSession appB = createApplication(admin, null, "aa-op");
        String code = appA.appCode() + ".Device.list";

        ApiResult noPrefix = appCenter(HttpMethod.POST, OPERATIONS,
                Map.of("appCode", appA.appCode(), "operationCode", "Device.list", "operationName", "list"))
                .assertCode(40001);
        assertThat(noPrefix.fieldErrorNames()).contains("operationCode");
        appCenter(HttpMethod.POST, OPERATIONS,
                Map.of("appCode", appA.appCode(), "operationCode", appB.appCode() + ".Device.list",
                        "operationName", "list")).assertCode(40001);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__operation WHERE operation_code IN (?, ?)", Long.class,
                "Device.list", appB.appCode() + ".Device.list")).as("被拒绝的上报不得落库").isZero();

        String idA = registerOperation(appA.appCode(), "Device", "list");
        String idB = registerOperation(appB.appCode(), "Device", "list");
        assertThat(idA).isNotEqualTo(idB);
        assertThat(queryOne("SELECT operation_code FROM qs__auth__operation WHERE id = ?", String.class,
                Long.parseLong(idA))).isEqualTo(code);

        // 重复上报同一完整码：40902 且既有记录保持原样。
        appCenter(HttpMethod.POST, OPERATIONS,
                Map.of("appCode", appA.appCode(), "operationCode", code, "operationName", "覆盖名称"))
                .assertCode(40902);
        assertThat(queryOne("SELECT id FROM qs__auth__operation WHERE operation_code = ?", Long.class, code))
                .isEqualTo(Long.parseLong(idA));
        assertThat(queryOne("SELECT operation_name FROM qs__auth__operation WHERE id = ?", String.class,
                Long.parseLong(idA))).isEqualTo("list");

        // 部分失败可核对：按 appCode 回查能确认已登记内容。
        ApiResult listed = appCenter(HttpMethod.GET, OPERATIONS + "?appCode=" + appA.appCode(), null).assertCode(200);
        assertThat(listed.intField("total")).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-42/TC-33-003：改名保留稳定 id 与权限组引用，改完整码后新码生效、旧码 40301")
    void renameKeepsIdAndGrants() {
        String admin = adminToken();
        AppSession app = createApplication(admin, null, "aa-rename");
        String operationId = registerOperation(app.appCode(), "Device", "list");
        String groupId = createPermissionGroup(admin, unique("group-rename"), List.of(operationId));
        MemberSession member = createMember(admin, "aa-rename-user");
        linkAccountToGroup(admin, groupId, member.accountId());
        self(HttpMethod.PATCH, APPS + "/" + app.id(), admin,
                Map.of("version", appVersion(app.id()), "permissionGroupIds", List.of(groupId))).assertCode(200);

        String oldCode = app.appCode() + ".Device.list";
        checkAllowed(app, member, oldCode);

        // 只改名称：稳定 id 与权限组引用不变，授权关系继续有效。
        ApiResult renamed = appCenter(HttpMethod.PATCH, OPERATIONS + "/" + operationId,
                Map.of("version", operationVersion(operationId), "operationName", "listRenamed")).assertCode(200);
        assertThat(renamed.text("id")).isEqualTo(operationId);
        assertThat(renamed.text("operationName")).isEqualTo("listRenamed");
        assertThat(renamed.text("operationCode")).isEqualTo(oldCode);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__permission_group WHERE id = ? "
                + "AND operation_ids @> CAST(? AS jsonb)", Long.class, Long.parseLong(groupId),
                "[" + operationId + "]")).as("权限组引用不得因改名丢失").isEqualTo(1L);
        checkAllowed(app, member, oldCode);

        // 改完整码：旧码不再匹配，新码使用同一稳定 id 继续授权。
        String newCode = app.appCode() + ".Device.control";
        ApiResult recoded = appCenter(HttpMethod.PATCH, OPERATIONS + "/" + operationId,
                Map.of("version", renamed.text("version"), "operationCode", newCode)).assertCode(200);
        assertThat(recoded.text("operationCode")).isEqualTo(newCode);
        assertThat(queryOne("SELECT id FROM qs__auth__operation WHERE operation_code = ?", Long.class, newCode))
                .isEqualTo(Long.parseLong(operationId));
        checkAllowed(app, member, newCode);
        call(HttpMethod.POST, CHECKS, app.appKey(), member.token(), Map.of("operationCode", oldCode)).assertCode(40301);

        // 改成其他操作已占用的完整码：40902 且原记录不变。
        String takenCode = app.appCode() + ".Device.taken";
        registerOperation(app.appCode(), "Device", "taken");
        appCenter(HttpMethod.PATCH, OPERATIONS + "/" + operationId,
                Map.of("version", recoded.text("version"), "operationCode", takenCode)).assertCode(40902);
        assertThat(queryOne("SELECT operation_code FROM qs__auth__operation WHERE id = ?", String.class,
                Long.parseLong(operationId))).isEqualTo(newCode);
        assertThat(queryOne("SELECT operation_name FROM qs__auth__operation WHERE id = ?", String.class,
                Long.parseLong(operationId))).isEqualTo("listRenamed");

        // 旧 version + 与当前相同的操作名：版本判定优先，返回 40901，版本与记录都不变。
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", renamed.text("version"));
        staleIdentical.put("operationName", "listRenamed");
        appCenter(HttpMethod.PATCH, OPERATIONS + "/" + operationId, staleIdentical).assertCode(40901);
        assertThat(operationVersion(operationId)).as("旧版本提交不递增版本").isEqualTo(recoded.text("version"));
        assertThat(queryOne("SELECT operation_name FROM qs__auth__operation WHERE id = ?", String.class,
                Long.parseLong(operationId))).as("旧版本提交不覆盖已保存的名称").isEqualTo("listRenamed");
    }

    @Test
    @DisplayName("AC-42/TC-33-002：状态同步冻结与下线拒绝鉴权，恢复后未撤销令牌可用，旧 version 40901 且不删记录")
    void stateSyncFreezesAndRestoresAuthentication() {
        String admin = adminToken();
        String appCode = unique("aa-state");
        ApiResult created = appCenter(HttpMethod.POST, APPS, Map.of("appCode", appCode)).assertCode(200);
        String appId = created.text("id");
        String appKey = created.text("appKey");
        String operationId = registerOperation(appCode, "State", "ping");
        String groupId = createPermissionGroup(admin, unique("group-state"), List.of(operationId));
        MemberSession member = createMember(admin, "aa-state-user");
        String version = self(HttpMethod.PATCH, APPS + "/" + appId, admin,
                Map.of("version", created.text("version"), "permissionGroupIds", List.of(groupId)))
                .assertCode(200).text("version");

        // active：令牌可用。
        call(HttpMethod.GET, ME, appKey, member.token(), null).assertCode(200);

        version = stateSync(appId, "frozen", version);
        call(HttpMethod.GET, ME, appKey, member.token(), null).assertCode(40302);

        // 旧 version：40901，状态与鉴权结果保持同步前的一致。
        appCenter(HttpMethod.POST, APPS + "/" + appId + "/state-sync",
                Map.of("status", "offline", "version", created.text("version"))).assertCode(40901);
        assertThat(appStatus(appId)).isEqualTo("frozen");
        call(HttpMethod.GET, ME, appKey, member.token(), null).assertCode(40302);

        // 恢复 active：同一枚未撤销未到期令牌恢复可用。
        version = stateSync(appId, "active", version);
        call(HttpMethod.GET, ME, appKey, member.token(), null).assertCode(200);

        version = stateSync(appId, "offline", version);
        call(HttpMethod.GET, ME, appKey, member.token(), null).assertCode(40302);

        stateSync(appId, "active", version);
        call(HttpMethod.GET, ME, appKey, member.token(), null).assertCode(200);

        // 状态同步不删除授权记录与可见组关联。
        assertThat(queryOne("SELECT count(*) FROM qs__auth__app_authorization WHERE id = ?", Long.class,
                Long.parseLong(appId))).isEqualTo(1L);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__app_permission_group WHERE app_authorization_id = ?",
                Long.class, Long.parseLong(appId))).isEqualTo(1L);
        assertThat(queryOne("SELECT permission_group_id FROM qs__auth__app_permission_group "
                + "WHERE app_authorization_id = ?", Long.class, Long.parseLong(appId)))
                .isEqualTo(Long.parseLong(groupId));
        // 不支持的取值拒绝，状态不变。
        appCenter(HttpMethod.POST, APPS + "/" + appId + "/state-sync",
                Map.of("status", "suspended", "version", appVersion(appId))).assertCode(40001);
        assertThat(appStatus(appId)).isEqualTo("active");
    }

    @Test
    @DisplayName("AC-42/API-11：PATCH 只接受 permissionGroupIds 与 version，未知字段与不存在的权限组 40001，旧版本同值提交 40901")
    void visibleGroupConfigurationIsRestricted() {
        String admin = adminToken();
        String appCode = unique("aa-config");
        ApiResult created = appCenter(HttpMethod.POST, APPS, Map.of("appCode", appCode)).assertCode(200);
        String appId = created.text("id");
        String version = created.text("version");
        String groupA = createPermissionGroup(admin, unique("group-config-a"), List.of());
        String groupB = createPermissionGroup(admin, unique("group-config-b"), List.of());
        String path = APPS + "/" + appId;

        Map<String, Object> withStatus = new LinkedHashMap<>();
        withStatus.put("version", version);
        withStatus.put("status", "frozen");
        ApiResult statusRejected = self(HttpMethod.PATCH, path, admin, withStatus).assertCode(40001);
        assertThat(statusRejected.fieldErrorNames()).contains("status");
        assertThat(appStatus(appId)).as("PATCH 不得改动状态").isEqualTo("active");

        Map<String, Object> withUnknown = new LinkedHashMap<>();
        withUnknown.put("version", version);
        withUnknown.put("appKey", "ak_forged");
        assertThat(self(HttpMethod.PATCH, path, admin, withUnknown).assertCode(40001).fieldErrorNames())
                .contains("appKey");

        Map<String, Object> withMissingGroup = new LinkedHashMap<>();
        withMissingGroup.put("version", version);
        withMissingGroup.put("permissionGroupIds", List.of(groupA, "900000001"));
        ApiResult missingRejected = self(HttpMethod.PATCH, path, admin, withMissingGroup).assertCode(40001);
        assertThat(missingRejected.fieldErrorNames()).contains("permissionGroupIds");
        assertThat(linkCount(appId)).as("被拒绝的配置不得写入关联").isZero();
        assertThat(appStatus(appId)).isEqualTo("active");

        Map<String, Object> configure = new LinkedHashMap<>();
        configure.put("version", version);
        configure.put("permissionGroupIds", List.of(groupA, groupB));
        ApiResult configured = self(HttpMethod.PATCH, path, admin, configure).assertCode(200);
        assertThat(groupIdsOf(configured)).containsExactlyInAnyOrder(groupA, groupB);
        assertThat(linkCount(appId)).isEqualTo(2L);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__app_permission_group WHERE app_authorization_id = ? "
                + "AND permission_group_id IN (?, ?)", Long.class, Long.parseLong(appId), Long.parseLong(groupA),
                Long.parseLong(groupB))).isEqualTo(2L);

        // 空数组清空集合，提交即整体替换而不是追加。
        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("version", configured.text("version"));
        clear.put("permissionGroupIds", List.of());
        ApiResult cleared = self(HttpMethod.PATCH, path, admin, clear).assertCode(200);
        assertThat(groupIdsOf(cleared)).isEmpty();
        assertThat(linkCount(appId)).isZero();

        // 只提交 version 没有有效变更，拒绝且不递增版本。
        Map<String, Object> versionOnly = new LinkedHashMap<>();
        versionOnly.put("version", cleared.text("version"));
        self(HttpMethod.PATCH, path, admin, versionOnly).assertCode(40001);
        assertThat(appVersion(appId)).isEqualTo(cleared.text("version"));

        // 旧 version + 与当前相同的可见组：版本判定优先，返回 40901，关联与版本都不变。
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", version);
        staleIdentical.put("permissionGroupIds", List.of());
        self(HttpMethod.PATCH, path, admin, staleIdentical).assertCode(40901);
        assertThat(linkCount(appId)).as("旧版本提交不写入关联").isZero();
        assertThat(appVersion(appId)).as("旧版本提交不递增版本").isEqualTo(cleared.text("version"));
    }

    /**
     * 读取授权记录标识对应的 version 字符串。
     *
     * @param appId 授权记录标识
     * @return version 字符串
     */
    private String appVersion(String appId) {
        return String.valueOf(queryOne("SELECT version FROM qs__auth__app_authorization WHERE id = ?", Long.class,
                Long.parseLong(appId)));
    }

    private String appStatus(String appId) {
        return queryOne("SELECT status FROM qs__auth__app_authorization WHERE id = ?", String.class,
                Long.parseLong(appId));
    }

    private String operationVersion(String operationId) {
        return String.valueOf(queryOne("SELECT version FROM qs__auth__operation WHERE id = ?", Long.class,
                Long.parseLong(operationId)));
    }

    private long linkCount(String appId) {
        return queryOne("SELECT count(*) FROM qs__auth__app_permission_group WHERE app_authorization_id = ?",
                Long.class, Long.parseLong(appId));
    }

    /**
     * 以应用中心受控身份同步应用状态并回读新 version。
     *
     * @param appId 授权记录标识
     * @param status 目标状态
     * @param version 提交时读取到的版本
     * @return 同步后的版本
     */
    private String stateSync(String appId, String status, String version) {
        ApiResult synced = appCenter(HttpMethod.POST, APPS + "/" + appId + "/state-sync",
                Map.of("status", status, "version", version)).assertCode(200);
        assertThat(synced.text("status")).isEqualTo(status);
        return synced.text("version");
    }

    /**
     * 断言成员在目标应用内拥有指定操作（应用可见且操作在已取得权限组内）。
     *
     * @param app 目标应用
     * @param member 成员会话
     * @param operationCode 完整操作码
     */
    private void checkAllowed(AppSession app, MemberSession member, String operationCode) {
        ApiResult allowed = call(HttpMethod.POST, CHECKS, app.appKey(), member.token(),
                Map.of("operationCode", operationCode)).assertCode(200);
        assertThat(allowed.booleanField("allowed")).isTrue();
        assertThat(allowed.text("operationCode")).isEqualTo(operationCode);
        assertThat(allowed.text("appCode")).isEqualTo(app.appCode());
    }

    private static List<String> groupIdsOf(ApiResult result) {
        List<String> ids = new ArrayList<>();
        result.data().path("permissionGroupIds").values().forEach(item -> ids.add(item.asString()));
        return ids;
    }
}
