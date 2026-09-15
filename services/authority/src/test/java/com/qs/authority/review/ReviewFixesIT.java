package com.qs.authority.review;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * 综合复核缺陷的回归用例（F-01 至 F-07）。
 *
 * <p>每条用例验证复核报告中的异常行为已被拒绝：只读人员拿不到受控身份、管理与鉴权接口判定一致、
 * 异常正文不入库秘密、审计故障不伪造业务失败、多字节口令返回字段错误、无变化编辑被拒绝、
 * IP 白名单按真实地址解析。
 */
@DisplayName("复核缺陷回归：凭据、权限、脱敏、审计、输入边界")
class ReviewFixesIT extends AbstractAuthorityTest {

    /** 审计正文在无法安全解析时的占位文本。 */
    private static final String OMITTED = "(正文无法安全解析，已省略)";

    @Test
    @DisplayName("F-01：应用授权详情与列表都不返回可用作身份的 AppKey")
    void detailDoesNotLeakAppCenterCredential() {
        String admin = adminToken();
        long appCenterId = queryOne("SELECT id FROM qs__auth__app_authorization WHERE app_code = ?", Long.class,
                "app-center");
        long selfAppId = queryOne("SELECT id FROM qs__auth__app_authorization WHERE app_code = ?", Long.class,
                "auth-center");

        // 有详情权限的普通账号：管理接口按授权中心自身应用判可见性，因此授予该应用可见性后再读详情
        MemberSession member = createMember(admin, "f01");
        String groupId = createPermissionGroup(admin, unique("f01-group"),
                List.of(centerOperationId("ApplicationAuthorizationController.detail")));
        linkAccountToGroup(admin, groupId, member.accountId());
        setVisibleGroups(admin, String.valueOf(selfAppId), List.of(groupId));

        ApiResult detail = call(HttpMethod.GET, "/api/v1/auth/application-authorizations/" + appCenterId,
                SELF_APP_KEY, member.token(), null).assertCode(200);
        assertThat(detail.body()).doesNotContain(APP_CENTER_KEY);
        assertThat(detail.data().has("appKey")).isFalse();
        assertThat(detail.data().has("appSecret")).isFalse();

        ApiResult list = self(HttpMethod.GET, "/api/v1/auth/application-authorizations?appCode=app-center", admin,
                null).assertCode(200);
        assertThat(list.body()).doesNotContain(APP_CENTER_KEY);
        assertThat(list.body()).doesNotContain("appKey");

        // 受控路径本身仍可用：应用中心凭据照常建立授权记录并拿到一次性凭据
        ApiResult created = appCenter(HttpMethod.POST, "/api/v1/auth/application-authorizations",
                Map.of("appCode", unique("f01-app"))).assertCode(200);
        assertThat(created.text("appKey")).startsWith("ak_");
        assertThat(created.text("appSecret")).startsWith("sk_");
    }

    @Test
    @DisplayName("F-02：管理接口与鉴权接口使用同一套可见性加操作判定")
    void managementInterfaceHonoursVisibility() {
        String admin = adminToken();
        long selfAppId = queryOne("SELECT id FROM qs__auth__app_authorization WHERE app_code = ?", Long.class,
                "auth-center");
        MemberSession member = createMember(admin, "f02");
        String groupId = createPermissionGroup(admin, unique("f02-group"),
                List.of(centerOperationId("AccountController.list")));
        linkAccountToGroup(admin, groupId, member.accountId());
        String operationCode = "auth-center.AccountController.list";

        // 只有操作、没有可见性：管理接口与鉴权接口都必须拒绝
        call(HttpMethod.GET, "/api/v1/auth/accounts", SELF_APP_KEY, member.token(), null).assertCode(40301);
        call(HttpMethod.POST, "/api/v1/auth/authorization-checks", SELF_APP_KEY, member.token(),
                Map.of("operationCode", operationCode)).assertCode(40301);

        // 加上可见性后两条路径同时放行
        setVisibleGroups(admin, String.valueOf(selfAppId), List.of(groupId));
        call(HttpMethod.GET, "/api/v1/auth/accounts", SELF_APP_KEY, member.token(), null).assertCode(200);
        call(HttpMethod.POST, "/api/v1/auth/authorization-checks", SELF_APP_KEY, member.token(),
                Map.of("operationCode", operationCode)).assertCode(200);

        // 移除可见性后两条路径又同时拒绝
        setVisibleGroups(admin, String.valueOf(selfAppId), List.of());
        call(HttpMethod.GET, "/api/v1/auth/accounts", SELF_APP_KEY, member.token(), null).assertCode(40301);
        call(HttpMethod.POST, "/api/v1/auth/authorization-checks", SELF_APP_KEY, member.token(),
                Map.of("operationCode", operationCode)).assertCode(40301);

        // 超级管理员不依赖可见组
        self(HttpMethod.GET, "/api/v1/auth/accounts", admin, null).assertCode(200);
    }

    @Test
    @DisplayName("F-03：解析失败的请求体不把口令写进审计")
    void malformedBodyIsNotStored() {
        String marker = "ReviewSecret@123";
        String broken = "{\"username\":\"review-broken\",\"password\":\"" + marker + "\"";
        ApiResult failure = call(HttpMethod.POST, "/api/v1/auth/sessions/login", SELF_APP_KEY, null, broken)
                .assertCode(40001);
        assertThat(storedBody(failure)).doesNotContain(marker).isEqualTo(OMITTED);

        // 根节点不是对象的报文同样整体省略
        ApiResult arrayFailure = call(HttpMethod.POST, "/api/v1/auth/sessions/login", SELF_APP_KEY, null,
                "[\"" + marker + "\"]").assertCode(40001);
        assertThat(storedBody(arrayFailure)).isEqualTo(OMITTED);

        // 正常 JSON 仍按字段脱敏，而不是整体省略
        ApiResult normal = call(HttpMethod.POST, "/api/v1/auth/sessions/login", SELF_APP_KEY, null,
                Map.of("username", "review-normal", "password", marker)).assertCode(40101);
        assertThat(storedBody(normal)).doesNotContain(marker).contains("***");

        // 成功登录的响应正文里令牌被脱敏，不落库明文
        ApiResult success = login(ADMIN_USERNAME, ADMIN_PASSWORD).assertCode(200);
        String responseBody = queryOne(
                "SELECT coalesce(response_body, '') FROM qs__auth__audit_log WHERE trace_id = CAST(? AS uuid)",
                String.class, success.traceHeader());
        assertThat(responseBody).contains("***");
        assertThat(responseBody).doesNotContain(success.token());
    }

    @Test
    @DisplayName("F-04：超长请求头不再造成审计失败，业务结果如实返回")
    void overlongHeadersDoNotBreakAudit() {
        String admin = adminToken();
        String paramCode = unique("f04-param");
        ApiResult created = call(HttpMethod.POST, "/api/v1/auth/parameters", SELF_APP_KEY, admin,
                Map.of("paramCode", paramCode, "paramValue", "v"), Map.of("User-Agent", "A".repeat(600)))
                .assertCode(200);

        assertThat(created.text("paramCode")).isEqualTo(paramCode);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__sys_param WHERE param_code = ?", Long.class, paramCode))
                .isEqualTo(1L);
        Integer storedLength = queryOne(
                "SELECT length(user_agent) FROM qs__auth__audit_log WHERE trace_id = CAST(? AS uuid)", Integer.class,
                created.traceHeader());
        assertThat(storedLength).isNotNull().isLessThanOrEqualTo(512);
    }

    @Test
    @DisplayName("F-04：审计存储故障时，已提交业务如实返回，授权判定不返回许可")
    void auditFailureDoesNotFabricateBusinessFailure() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "f04");
        AppSession app = createApplication(admin, null, "f04-app");
        String operationId = registerOperation(app.appCode(), "DeviceController", "audit");
        String groupId = createPermissionGroup(admin, unique("f04-group"), List.of(operationId));
        setVisibleGroups(admin, app.id(), List.of(groupId));
        linkAccountToGroup(admin, groupId, member.accountId());
        String operationCode = app.appCode() + ".DeviceController.audit";

        jdbc().execute("CREATE OR REPLACE FUNCTION qs__auth__review_audit_fail() RETURNS trigger LANGUAGE plpgsql "
                + "AS $body$ BEGIN RAISE EXCEPTION 'review: audit storage unavailable'; END; $body$");
        jdbc().execute("CREATE TRIGGER qs__auth__review_audit_fail_trigger BEFORE INSERT ON qs__auth__audit_log "
                + "FOR EACH ROW EXECUTE FUNCTION qs__auth__review_audit_fail()");
        String paramCode = unique("f04-fail");
        try {
            // 业务已提交：真实结果照常返回，不因缺少审计记录改判为失败
            call(HttpMethod.POST, "/api/v1/auth/parameters", SELF_APP_KEY, admin,
                    Map.of("paramCode", paramCode, "paramValue", "v")).assertCode(200);
            assertThat(queryOne("SELECT count(*) FROM qs__auth__sys_param WHERE param_code = ?", Long.class,
                    paramCode)).isEqualTo(1L);

            // 授权判定在同一事务内写审计：写失败即不返回许可
            call(HttpMethod.POST, "/api/v1/auth/authorization-checks", app.appKey(), member.token(),
                    Map.of("operationCode", operationCode)).assertCode(50001);
        } finally {
            jdbc().execute("DROP TRIGGER IF EXISTS qs__auth__review_audit_fail_trigger ON qs__auth__audit_log");
            jdbc().execute("DROP FUNCTION IF EXISTS qs__auth__review_audit_fail()");
        }

        // 故障恢复后同一判定恢复正常允许
        call(HttpMethod.POST, "/api/v1/auth/authorization-checks", app.appKey(), member.token(),
                Map.of("operationCode", operationCode)).assertCode(200);
    }

    @Test
    @DisplayName("F-05：多字节口令按 UTF-8 字节长度校验，返回 40001 而不是 500")
    void multibytePasswordIsRejected() {
        String admin = adminToken();
        ApiResult rejected = self(HttpMethod.POST, "/api/v1/auth/accounts", admin,
                Map.of("username", unique("f05-long"), "password", "密".repeat(25) + "A1!")).assertCode(40001);
        assertThat(rejected.fieldErrorNames()).contains("password");

        self(HttpMethod.POST, "/api/v1/auth/accounts", admin,
                Map.of("username", unique("f05-ok"), "password", "密".repeat(20) + "A1!")).assertCode(200);
    }

    @Test
    @DisplayName("F-06：账号与应用授权配置的无变化编辑被拒绝且不推进版本")
    void unchangedPatchIsRejected() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "f06");
        String version = self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), admin, null)
                .text("version");

        Map<String, Object> same = new LinkedHashMap<>();
        same.put("version", version);
        same.put("remark", null);
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + member.accountId(), admin, same).assertCode(40001);
        assertThat(queryOne("SELECT version FROM qs__auth__account WHERE id = ?", Long.class,
                Long.parseLong(member.accountId()))).isEqualTo(Long.parseLong(version));

        ApiResult app = appCenter(HttpMethod.POST, "/api/v1/auth/application-authorizations",
                Map.of("appCode", unique("f06-app"))).assertCode(200);
        Map<String, Object> emptyGroups = new LinkedHashMap<>();
        emptyGroups.put("version", app.text("version"));
        emptyGroups.put("permissionGroupIds", List.of());
        self(HttpMethod.PATCH, "/api/v1/auth/application-authorizations/" + app.text("id"), admin, emptyGroups)
                .assertCode(40001);
        assertThat(queryOne("SELECT version FROM qs__auth__app_authorization WHERE id = ?", Long.class,
                Long.parseLong(app.text("id")))).isEqualTo(Long.parseLong(app.text("version")));
    }

    @Test
    @DisplayName("F-07：IP 白名单按真实地址与网段解析")
    void ipWhitelistIsValidated() {
        String admin = adminToken();
        for (String invalid : List.of("999.999.999.999/99", "192.168.1.256", "10.0.0.0/33", "192.168.1",
                "not-an-address", "2001:db8::/129", "::gg")) {
            ApiResult rejected = self(HttpMethod.POST, "/api/v1/auth/accounts", admin,
                    Map.of("username", unique("f07"), "accountType", "service", "ipWhitelist", List.of(invalid)))
                    .assertCode(40001);
            assertThat(rejected.fieldErrorNames()).contains("ipWhitelist");
        }
        for (String valid : List.of("192.168.1.10", "10.0.0.0/24", "0.0.0.0/0", "::1", "2001:db8::/32")) {
            self(HttpMethod.POST, "/api/v1/auth/accounts", admin,
                    Map.of("username", unique("f07"), "accountType", "service", "ipWhitelist", List.of(valid)))
                    .assertCode(200);
        }
    }

    private String storedBody(ApiResult result) {
        return queryOne("SELECT coalesce(request_body, '') FROM qs__auth__audit_log WHERE trace_id = CAST(? AS uuid)",
                String.class, result.traceHeader());
    }

    private String centerOperationId(String suffix) {
        return String.valueOf(queryOne("SELECT id FROM qs__auth__operation WHERE operation_code = ?", Long.class,
                "auth-center." + suffix));
    }

    private void setVisibleGroups(String admin, String appId, List<String> groupIds) {
        String version = self(HttpMethod.GET, "/api/v1/auth/application-authorizations/" + appId, admin, null)
                .text("version");
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("version", version);
        patch.put("permissionGroupIds", groupIds);
        self(HttpMethod.PATCH, "/api/v1/auth/application-authorizations/" + appId, admin, patch).assertCode(200);
    }

    @Test
    @DisplayName("R-01：成功鉴权日志带请求来源、正文与耗时，与普通请求记录一致")
    void allowedCheckAuditCarriesRequestContext() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "r01");
        AppSession app = createApplication(admin, null, "r01-app");
        String operationId = registerOperation(app.appCode(), "DeviceController", "list");
        String groupId = createPermissionGroup(admin, unique("r01-group"), List.of(operationId));
        setVisibleGroups(admin, app.id(), List.of(groupId));
        linkAccountToGroup(admin, groupId, member.accountId());
        String operationCode = app.appCode() + ".DeviceController.list";

        ApiResult allowed = call(HttpMethod.POST, "/api/v1/auth/authorization-checks", app.appKey(), member.token(),
                Map.of("operationCode", operationCode, "resourceId", "dev-001", "resourceType", "device"),
                Map.of("User-Agent", "review-agent/1.0")).assertCode(200);

        Map<String, Object> row = jdbc().queryForMap(
                "SELECT request_ip, user_agent, cost_ms, request_body, response_body FROM qs__auth__audit_log "
                        + "WHERE trace_id = CAST(? AS uuid)", allowed.traceHeader());
        assertThat((String) row.get("request_ip")).isNotBlank();
        assertThat(row.get("user_agent")).isEqualTo("review-agent/1.0");
        assertThat(row.get("cost_ms")).isNotNull();
        assertThat((String) row.get("request_body")).contains(operationCode).contains("dev-001");
        assertThat((String) row.get("response_body")).contains("allowed");

        // 拒绝路径同样保留来源
        ApiResult denied = call(HttpMethod.POST, "/api/v1/auth/authorization-checks", app.appKey(), member.token(),
                Map.of("operationCode", app.appCode() + ".DeviceController.delete"),
                Map.of("User-Agent", "review-agent/1.0")).assertCode(40301);
        Map<String, Object> deniedRow = jdbc().queryForMap(
                "SELECT request_ip, user_agent FROM qs__auth__audit_log WHERE trace_id = CAST(? AS uuid)",
                denied.traceHeader());
        assertThat((String) deniedRow.get("request_ip")).isNotBlank();
        assertThat(deniedRow.get("user_agent")).isEqualTo("review-agent/1.0");
    }

    @Test
    @DisplayName("R-02：版本冲突优先于无变化判定")
    void staleVersionPrecedesUnchangedBody() {
        String admin = adminToken();
        String paramCode = unique("r02-param");
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/parameters", admin,
                Map.of("paramCode", paramCode, "paramValue", "a")).assertCode(200);
        String firstVersion = created.text("version");

        Map<String, Object> change = new LinkedHashMap<>();
        change.put("version", firstVersion);
        change.put("paramValue", "b");
        ApiResult updated = self(HttpMethod.PATCH, "/api/v1/auth/parameters/" + created.text("id"), admin, change)
                .assertCode(200);
        String secondVersion = updated.text("version");
        assertThat(Long.parseLong(secondVersion)).isEqualTo(Long.parseLong(firstVersion) + 1);

        // 旧版本 + 与当前相同的值：版本冲突优先
        Map<String, Object> staleSame = new LinkedHashMap<>();
        staleSame.put("version", firstVersion);
        staleSame.put("paramValue", "b");
        self(HttpMethod.PATCH, "/api/v1/auth/parameters/" + created.text("id"), admin, staleSame).assertCode(40901);

        // 旧版本 + 不同的值：仍是版本冲突
        Map<String, Object> staleDifferent = new LinkedHashMap<>();
        staleDifferent.put("version", firstVersion);
        staleDifferent.put("paramValue", "c");
        self(HttpMethod.PATCH, "/api/v1/auth/parameters/" + created.text("id"), admin, staleDifferent).assertCode(40901);

        // 最新版本 + 相同的值：没有有效变更
        Map<String, Object> currentSame = new LinkedHashMap<>();
        currentSame.put("version", secondVersion);
        currentSame.put("paramValue", "b");
        self(HttpMethod.PATCH, "/api/v1/auth/parameters/" + created.text("id"), admin, currentSame).assertCode(40001);

        assertThat(queryOne("SELECT version FROM qs__auth__sys_param WHERE param_code = ?", Long.class, paramCode))
                .isEqualTo(Long.parseLong(secondVersion));
        assertThat(queryOne("SELECT param_value FROM qs__auth__sys_param WHERE param_code = ?", String.class,
                paramCode)).isEqualTo("b");
    }
}
