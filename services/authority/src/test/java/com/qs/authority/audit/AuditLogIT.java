package com.qs.authority.audit;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.modules.audit.AuditService;
import com.qs.authority.support.AbstractAuthorityTest;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/**
 * 审计日志接口验收（AC-22、AC-34；TC-31-021、TC-31-032）。
 *
 * <p>覆盖自身事件自动追加（含未知身份）、鉴权允许与拒绝的操作码、凭据脱敏、日志只读、列表筛选与
 * 稳定排序、详情复合定位，以及保留期清理只物理删除过期数据。清理用例是白盒：直接注入
 * {@link AuditService} 并按截点前后各一秒写入日志，避免等待调度器。
 */
@DisplayName("审计日志：自动追加、脱敏、只读、筛选排序、复合定位与保留期清理")
class AuditLogIT extends AbstractAuthorityTest {

    private static final String AUDIT_PATH = "/api/v1/auth/audit-logs";
    private static final String CHECK_PATH = "/api/v1/auth/authorization-checks";

    @Autowired
    private AuditService auditService;

    @Test
    @DisplayName("AC-22 / TC-31-021：登录失败留下 denied 日志，身份未知时 account_id 为空")
    void loginFailureIsAuditedWithUnknownAccount() {
        String username = unique("ghost-user");
        String password = "Ghost@123456";
        long watermark = maxAuditId();

        login(username, password).assertCode(40101);

        List<Map<String, Object>> rows = auditRowsAfter(watermark);
        assertThat(rows).hasSize(1);
        Map<String, Object> row = rows.get(0);
        assertThat(row.get("account_id")).as("账号不存在时身份未知，account_id 为空").isNull();
        assertThat(row.get("result")).isEqualTo("denied");
        assertThat(row.get("operation_code")).isNull();
        assertThat(text(row, "request_body")).contains("***").doesNotContain(password);
    }

    @Test
    @DisplayName("AC-22：鉴权允许记 success、拒绝记 denied，都带被检查的操作码")
    void authorizationCheckIsAuditedWithCheckedOperationCode() {
        String admin = adminToken();
        long adminId = accountIdOf(ADMIN_USERNAME);
        AppSession app = createApplication(admin, null, "audit-allow");
        String operationCode = app.appCode() + ".Device.control";
        registerOperation(app.appCode(), "Device", "control");

        long allowWatermark = maxAuditId();
        ApiResult allowed = call(HttpMethod.POST, CHECK_PATH, app.appKey(), admin,
                Map.of("operationCode", operationCode)).assertCode(200);
        assertThat(allowed.booleanField("allowed")).isTrue();

        List<Map<String, Object>> allowRows = auditRowsAfter(allowWatermark);
        assertThat(allowRows).hasSize(1);
        assertThat(allowRows.get(0).get("result")).isEqualTo("success");
        assertThat(allowRows.get(0).get("operation_code")).isEqualTo(operationCode);
        assertThat(allowRows.get(0).get("account_id")).isEqualTo(adminId);
        assertThat(allowRows.get(0).get("app_code")).isEqualTo(app.appCode());

        MemberSession member = createMember(admin, "audit-deny-member");
        long denyWatermark = maxAuditId();
        call(HttpMethod.POST, CHECK_PATH, app.appKey(), member.token(),
                Map.of("operationCode", operationCode)).assertCode(40301);

        List<Map<String, Object>> denyRows = auditRowsAfter(denyWatermark);
        assertThat(denyRows).hasSize(1);
        assertThat(denyRows.get(0).get("result")).isEqualTo("denied");
        assertThat(denyRows.get(0).get("operation_code")).as("拒绝事件记录被检查的操作码").isEqualTo(operationCode);
        assertThat(denyRows.get(0).get("account_id")).isEqualTo(Long.parseLong(member.accountId()));
    }

    @Test
    @DisplayName("AC-22 / BR-22：口令与令牌明文不落审计库，只保存脱敏占位")
    void credentialsAreMasked() {
        String admin = adminToken();
        String username = unique("mask-user");
        String password = "MaskPlain@123";
        long watermark = maxAuditId();

        self(HttpMethod.POST, "/api/v1/auth/accounts", admin,
                Map.of("username", username, "password", password)).assertCode(200);
        ApiResult login = login(username, password).assertCode(200);
        String token = login.token();
        assertThat(token).isNotBlank();

        List<Map<String, Object>> rows = auditRowsAfter(watermark);
        assertThat(rows).hasSize(2);
        assertThat(text(rows.get(0), "request_body")).as("新增账号请求体只保留脱敏占位")
                .contains("***").doesNotContain(password);
        for (Map<String, Object> row : rows) {
            assertThat(text(row, "request_body")).doesNotContain(password);
            assertThat(text(row, "response_body")).as("登录响应体中的令牌明文不入库")
                    .doesNotContain(token).doesNotContain(password);
            assertThat(text(row, "reason")).doesNotContain(password);
        }

        assertThat(countAuditContaining(password)).as("全表不出现明文口令").isZero();
        assertThat(countAuditContaining(token)).as("全表不出现令牌明文").isZero();
        assertThat(queryOne("SELECT count(*) FROM qs__auth__token WHERE token_digest = ?", Long.class, token))
                .as("令牌表只保存摘要").isZero();
    }

    @Test
    @DisplayName("AC-22 / BR-22：普通用户没有写入或删除日志的入口，既有日志不被删除也不被伪造")
    void auditLogIsReadOnly() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "audit-forge");
        Map<String, Object> existing = jdbc().queryForMap("SELECT id::text AS id,"
                + " to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at FROM qs__auth__audit_log"
                + " ORDER BY id DESC LIMIT 1");
        String id = String.valueOf(existing.get("id"));
        String createdAt = String.valueOf(existing.get("created_at"));

        long before = countAuditRows();
        for (String token : List.of(admin, member.token())) {
            ApiResult forgedCreate = self(HttpMethod.POST, AUDIT_PATH, token,
                    Map.of("accountId", "1", "result", "success"));
            assertThat(forgedCreate.code()).as("日志没有手工追加入口: %s", forgedCreate.body())
                    .isIn(40001, 40401);
            ApiResult forgedDelete = self(HttpMethod.DELETE, AUDIT_PATH + "/" + id, token, null);
            assertThat(forgedDelete.code()).as("日志没有删除入口: %s", forgedDelete.body()).isIn(40001, 40401);
            ApiResult forgedDeleteWithVersion = self(HttpMethod.DELETE, AUDIT_PATH + "/" + id + "?version=1", token,
                    null);
            assertThat(forgedDeleteWithVersion.code()).as("日志没有带版本的删除入口: %s", forgedDeleteWithVersion.body())
                    .isIn(40001, 40401);
        }

        assertThat(countAuditRows()).as("调用前后审计行数不变：既没有伪造写入也没有删除").isEqualTo(before);

        // 对照：正常请求仍会追加日志，证明上面的行数核对确实在观察审计表
        self(HttpMethod.GET, "/api/v1/auth/accounts?pageSize=1", admin, null).assertCode(200);
        assertThat(countAuditRows()).as("正常请求追加一条日志").isEqualTo(before + 1);

        // 被尝试删除的日志仍然可读，只读入口不受影响
        self(HttpMethod.GET, AUDIT_PATH + "/" + id + "?createdAt=" + createdAt, admin, null).assertCode(200);
    }

    @Test
    @DisplayName("AC-22：无权限的普通成员读取日志返回 40301")
    void memberCannotReadAuditLogs() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "audit-reader");
        self(HttpMethod.GET, AUDIT_PATH, member.token(), null).assertCode(40301);
        self(HttpMethod.GET, AUDIT_PATH + "/1?createdAt=" + format(BeijingTime.now()), member.token(), null)
                .assertCode(40301);
    }

    @Test
    @DisplayName("AC-22：账号、应用、结果与时间范围筛选生效，非法筛选 40001，默认按 createdAt 与 id 倒序")
    void listFiltersAndStableOrdering() {
        String admin = adminToken();
        long adminId = accountIdOf(ADMIN_USERNAME);
        AppSession app = createApplication(admin, null, "audit-filter");
        String operationCode = app.appCode() + ".Device.control";
        registerOperation(app.appCode(), "Device", "control");
        call(HttpMethod.POST, CHECK_PATH, app.appKey(), admin, Map.of("operationCode", operationCode)).assertCode(200);
        MemberSession member = createMember(admin, "audit-filter-member");
        call(HttpMethod.POST, CHECK_PATH, app.appKey(), member.token(),
                Map.of("operationCode", operationCode)).assertCode(40301);

        ApiResult byAccountAndApp = self(HttpMethod.GET,
                AUDIT_PATH + "?accountId=" + adminId + "&appCode=" + app.appCode(), admin, null).assertCode(200);
        assertThat(byAccountAndApp.intField("total")).isEqualTo(1);
        JsonNode hit = byAccountAndApp.data().path("items").get(0);
        assertThat(hit.path("operationCode").asString()).isEqualTo(operationCode);
        assertThat(hit.path("result").asString()).isEqualTo("success");
        assertThat(hit.path("accountId").asString()).isEqualTo(Long.toString(adminId));
        assertThat(hit.path("appCode").asString()).isEqualTo(app.appCode());

        ApiResult deniedOnly = self(HttpMethod.GET, AUDIT_PATH + "?result=denied&pageSize=100", admin, null)
                .assertCode(200);
        assertThat(deniedOnly.data().path("items").size()).isPositive();
        deniedOnly.data().path("items").values()
                .forEach(item -> assertThat(item.path("result").asString()).isEqualTo("denied"));

        String yesterday = format(BeijingTime.now().minusDays(1));
        String tomorrow = format(BeijingTime.now().plusDays(1));
        assertThat(self(HttpMethod.GET, AUDIT_PATH + "?appCode=" + app.appCode() + "&createdAtFrom=" + tomorrow,
                admin, null).assertCode(200).intField("total")).as("起始时间在发布之后没有数据").isZero();
        assertThat(self(HttpMethod.GET, AUDIT_PATH + "?appCode=" + app.appCode() + "&createdAtTo=" + yesterday,
                admin, null).assertCode(200).intField("total")).as("结束时间在发布之前没有数据").isZero();
        assertThat(self(HttpMethod.GET,
                AUDIT_PATH + "?appCode=" + app.appCode() + "&createdAtFrom=" + yesterday + "&createdAtTo=" + tomorrow,
                admin, null).assertCode(200).intField("total")).as("时间范围覆盖本次事件").isEqualTo(2);

        ApiResult unsupported = self(HttpMethod.GET, AUDIT_PATH + "?operationCode=" + operationCode, admin, null)
                .assertCode(40001);
        assertThat(unsupported.fieldErrorNames()).contains("operationCode");
        ApiResult badResult = self(HttpMethod.GET, AUDIT_PATH + "?result=ok", admin, null).assertCode(40001);
        assertThat(badResult.fieldErrorNames()).contains("result");
        ApiResult badTime = self(HttpMethod.GET, AUDIT_PATH + "?createdAtFrom=2026-13-01", admin, null)
                .assertCode(40001);
        assertThat(badTime.fieldErrorNames()).contains("createdAtFrom");
        self(HttpMethod.GET, AUDIT_PATH + "?sortBy=traceId", admin, null).assertCode(40001);

        for (int index = 0; index < 3; index++) {
            self(HttpMethod.GET, "/api/v1/auth/accounts?pageSize=1", admin, null).assertCode(200);
        }
        List<JsonNode> items = itemsOf(self(HttpMethod.GET, AUDIT_PATH + "?pageSize=100", admin, null).assertCode(200));
        assertThat(items).hasSizeGreaterThan(1);
        for (int index = 1; index < items.size(); index++) {
            String previous = items.get(index - 1).path("createdAt").asString();
            String current = items.get(index).path("createdAt").asString();
            assertThat(current).as("默认按 createdAt 倒序").isLessThanOrEqualTo(previous);
            if (current.equals(previous)) {
                assertThat(Long.parseLong(items.get(index).path("id").asString()))
                        .as("同秒按 id 倒序")
                        .isLessThan(Long.parseLong(items.get(index - 1).path("id").asString()));
            }
        }

        // 同秒的两条日志必须严格按 id 倒序返回，与写入顺序相反。
        LocalDateTime sameSecond = BeijingTime.now().minusMinutes(1).withNano(0);
        long earlier = insertAuditRow(unique("same-second-earlier"), sameSecond);
        long later = insertAuditRow(unique("same-second-later"), sameSecond);
        List<JsonNode> sameSecondItems = itemsOf(self(HttpMethod.GET,
                AUDIT_PATH + "?createdAtFrom=" + format(sameSecond) + "&createdAtTo=" + format(sameSecond),
                admin, null).assertCode(200));
        List<Long> ids = new ArrayList<>();
        sameSecondItems.forEach(item -> ids.add(Long.parseLong(item.path("id").asString())));
        assertThat(ids).contains(earlier, later);
        assertThat(ids.indexOf(later)).as("同秒按 id 倒序").isLessThan(ids.indexOf(earlier));
    }

    @Test
    @DisplayName("AC-22：日志详情按 id 与 createdAt 复合定位，缺参 40001、不匹配 40401")
    void detailRequiresCompositeKey() {
        String admin = adminToken();
        long watermark = maxAuditId();
        self(HttpMethod.GET, "/api/v1/auth/accounts?pageSize=1", admin, null).assertCode(200);
        Map<String, Object> row = jdbc().queryForMap("SELECT id::text AS id,"
                + " to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at FROM qs__auth__audit_log"
                + " WHERE id > ? ORDER BY id LIMIT 1", watermark);
        String id = String.valueOf(row.get("id"));
        String createdAt = String.valueOf(row.get("created_at"));

        self(HttpMethod.GET, AUDIT_PATH + "/" + id, admin, null).assertCode(40001);

        ApiResult detail = self(HttpMethod.GET, AUDIT_PATH + "/" + id + "?createdAt=" + createdAt, admin, null)
                .assertCode(200);
        assertThat(detail.text("id")).isEqualTo(id);
        assertThat(detail.text("createdAt")).isEqualTo(createdAt);
        assertThat(detail.text("operationCode")).isEqualTo("auth-center.AccountController.list");
        assertThat(detail.text("result")).isEqualTo("success");
        assertThat(detail.text("traceId")).isNotBlank();

        String shifted = format(BeijingTime.parse(createdAt, "createdAt").plusDays(1));
        self(HttpMethod.GET, AUDIT_PATH + "/" + id + "?createdAt=" + shifted, admin, null).assertCode(40401);
        self(HttpMethod.GET, AUDIT_PATH + "/" + (Long.parseLong(id) + 1_000_000L) + "?createdAt=" + createdAt,
                admin, null).assertCode(40401);
        self(HttpMethod.GET, AUDIT_PATH + "/" + id + "?createdAt=" + createdAt + "&page=1", admin, null)
                .assertCode(40001);
        self(HttpMethod.GET, AUDIT_PATH + "/" + id + "?createdAt=not-a-time", admin, null).assertCode(40001);
        self(HttpMethod.GET, AUDIT_PATH + "/not-a-number?createdAt=" + createdAt, admin, null).assertCode(40001);
    }

    @Test
    @DisplayName("AC-34 / TC-31-032：清理物理删除超过 90 天的日志，恰好 90 天的保留，且只删过期数据")
    void cleanupDeletesOnlyExpiredLogs() {
        // 截点由服务按“当前北京时间减保留天数”计算，秒精度；在同一秒内完成测量与清理，
        // 保证用例测得的截点与 cleanup() 使用的截点一致。
        awaitFreshSecond();
        LocalDateTime cutoff = auditService.retentionCutoff();
        assertThat(cutoff).as("保留期按当前北京时间减 90 天计算，不按自然月")
                .isBetween(BeijingTime.now().minusDays(90).minusSeconds(2), BeijingTime.now().minusDays(90)
                        .plusSeconds(1));
        String expiredReason = unique("retention-expired");
        String boundaryReason = unique("retention-boundary");
        String freshReason = unique("retention-fresh");
        insertAuditRow(expiredReason, cutoff.minusSeconds(1));
        insertAuditRow(boundaryReason, cutoff);
        insertAuditRow(freshReason, cutoff.plusSeconds(1));

        long retainedBefore = countAuditAtOrAfter(cutoff);

        long deleted = auditService.cleanup();

        assertThat(deleted).as("至少删除一条超期日志").isPositive();
        assertThat(countAuditByReason(expiredReason)).as("截点前一秒的日志被物理删除").isZero();
        assertThat(countAuditByReason(boundaryReason)).as("恰好等于截点的日志保留").isEqualTo(1);
        assertThat(countAuditByReason(freshReason)).as("截点后一秒的日志保留").isEqualTo(1);
        assertThat(countAuditAtOrAfter(cutoff)).as("保留期内的行数不变").isEqualTo(retainedBefore);
    }

    private static String format(LocalDateTime value) {
        return BeijingTime.format(value);
    }

    private static String text(Map<String, Object> row, String column) {
        Object value = row.get(column);
        return value == null ? null : value.toString();
    }

    private static List<JsonNode> itemsOf(ApiResult result) {
        List<JsonNode> items = new ArrayList<>();
        result.data().path("items").values().forEach(items::add);
        return items;
    }

    private long accountIdOf(String username) {
        return queryOne("SELECT id FROM qs__auth__account WHERE username = ?", Long.class, username);
    }

    private long maxAuditId() {
        return queryOne("SELECT COALESCE(max(id), 0) FROM qs__auth__audit_log", Long.class);
    }

    private long countAuditRows() {
        return queryOne("SELECT count(*) FROM qs__auth__audit_log", Long.class);
    }

    private long countAuditContaining(String value) {
        return queryOne("SELECT count(*) FROM qs__auth__audit_log WHERE strpos(coalesce(request_body, ''), ?) > 0"
                + " OR strpos(coalesce(response_body, ''), ?) > 0 OR strpos(coalesce(reason, ''), ?) > 0",
                Long.class, value, value, value);
    }

    private long countAuditByReason(String reason) {
        return queryOne("SELECT count(*) FROM qs__auth__audit_log WHERE reason = ?", Long.class, reason);
    }

    private long countAuditAtOrAfter(LocalDateTime cutoff) {
        return queryOne("SELECT count(*) FROM qs__auth__audit_log WHERE created_at >= ?", Long.class, cutoff);
    }

    private List<Map<String, Object>> auditRowsAfter(long watermark) {
        return jdbc().queryForList("SELECT id, account_id, app_code, operation_code, result, reason,"
                + " request_body, response_body FROM qs__auth__audit_log WHERE id > ? ORDER BY id", watermark);
    }

    private long insertAuditRow(String reason, LocalDateTime createdAt) {
        jdbc().update("INSERT INTO qs__auth__audit_log (trace_id, result, log_level, reason, created_at)"
                + " VALUES (gen_random_uuid(), 'success', 'info', ?, ?)", reason, createdAt);
        return queryOne("SELECT id FROM qs__auth__audit_log WHERE reason = ?", Long.class, reason);
    }

    /** 等待进入新的一秒，使随后测量的截点与清理使用的截点落在同一秒内。 */
    private static void awaitFreshSecond() {
        LocalDateTime start = BeijingTime.now();
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (BeijingTime.now().equals(start) && System.nanoTime() < deadline) {
            Thread.onSpinWait();
        }
    }
}
