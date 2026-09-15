package com.qs.authority.convention;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/**
 * 平台公约接口规则验收（AC-44、AC-28）：
 * 分页默认值与越界、稳定排序、ID 与 version 的字符串传输、时间格式、PATCH 的漏填/空值/
 * 只读字段规则、版本冲突与重复删除、统一响应与 HTTP 状态的对应关系。
 */
@DisplayName("平台公约：路径、分页、错误码与编辑规则")
class PlatformConventionIT extends AbstractAuthorityTest {

    private static final String TIME_PATTERN = "\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}";

    @Test
    @DisplayName("分页默认 1/20，越界返回 40001 且不静默改值")
    void paginationDefaultsAndBounds() {
        String token = adminToken();
        ApiResult first = self(HttpMethod.GET, "/api/v1/auth/accounts", token, null).assertCode(200);
        assertThat(first.intField("page")).isEqualTo(1);
        assertThat(first.intField("pageSize")).isEqualTo(20);

        self(HttpMethod.GET, "/api/v1/auth/accounts?page=0", token, null).assertCode(40001);
        self(HttpMethod.GET, "/api/v1/auth/accounts?pageSize=0", token, null).assertCode(40001);
        ApiResult tooLarge = self(HttpMethod.GET, "/api/v1/auth/accounts?pageSize=101", token, null).assertCode(40001);
        assertThat(tooLarge.fieldErrorNames()).contains("pageSize");

        self(HttpMethod.GET, "/api/v1/auth/accounts?sortBy=password", token, null).assertCode(40001);
        self(HttpMethod.GET, "/api/v1/auth/accounts?sortOrder=sideways", token, null).assertCode(40001);
        ApiResult unsupportedFilter = self(HttpMethod.GET, "/api/v1/auth/accounts?isSuperAdmin=true", token, null)
                .assertCode(40001);
        assertThat(unsupportedFilter.fieldErrorNames()).contains("isSuperAdmin");
    }

    @Test
    @DisplayName("超出末页返回空 items 并保留 total；同值排序追加 id 作为次排序键")
    void stableSortingAndOutOfRangePage() {
        String token = adminToken();
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("sort-a"), "password", MEMBER_PASSWORD)).assertCode(200);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("sort-b"), "password", MEMBER_PASSWORD)).assertCode(200);

        ApiResult empty = self(HttpMethod.GET, "/api/v1/auth/accounts?page=1000&pageSize=10", token, null)
                .assertCode(200);
        assertThat(empty.data().path("items").size()).isZero();
        assertThat(empty.intField("total")).isPositive();

        // 限定同一账号类型，才能验证“同值排序追加 id 作为次排序键”
        ApiResult byType = self(HttpMethod.GET,
                "/api/v1/auth/accounts?accountType=person&sortBy=accountType&sortOrder=desc&pageSize=100",
                token, null).assertCode(200);
        List<Long> ids = byType.data().path("items").values().stream()
                .map(item -> Long.parseLong(item.path("id").asString()))
                .toList();
        assertThat(ids).isSortedAccordingTo((left, right) -> Long.compare(right, left));
    }

    @Test
    @DisplayName("标识与 version 使用十进制字符串，大标识不丢精度")
    void identifiersAreStrings() {
        String token = adminToken();
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("str-id"), "password", MEMBER_PASSWORD)).assertCode(200);
        JsonNode data = created.data();
        assertThat(data.path("id").isString()).isTrue();
        assertThat(data.path("version").isString()).isTrue();
        assertThat(Long.parseLong(created.text("id"))).isPositive();

        // 超过 JavaScript 安全整数的标识按字符串传输后仍能精确命中：不存在则 40401 而不是 40001。
        self(HttpMethod.GET, "/api/v1/auth/accounts/9007199254740993", token, null).assertCode(40401);
        self(HttpMethod.GET, "/api/v1/auth/accounts/not-a-number", token, null).assertCode(40001);
    }

    @Test
    @DisplayName("时间统一为北京时间秒精度，响应带 traceId 与追踪头")
    void timeFormatAndTrace() {
        String token = adminToken();
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("time"), "password", MEMBER_PASSWORD)).assertCode(200);
        assertThat(created.text("createdAt")).matches(TIME_PATTERN);
        assertThat(created.text("updatedAt")).matches(TIME_PATTERN);

        ApiResult failure = self(HttpMethod.GET, "/api/v1/auth/accounts/999999999", token, null).assertCode(40401);
        assertThat(failure.data().path("traceId").isString()).isTrue();
        assertThat(failure.traceHeader()).isNotBlank();
        assertThat(failure.data().path("traceId").asString()).isEqualTo(failure.traceHeader());
    }

    @Test
    @DisplayName("PATCH：漏填保持、null 清空可空字段、空白串清空、必填拒绝、未知与只读字段拒绝、旧版本同值提交返回 40901")
    void patchSemantics() {
        String token = adminToken();
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("patch"), "password", MEMBER_PASSWORD, "remark", "原始备注",
                        "phone", "13900000001")).assertCode(200);
        String id = created.text("id");
        String version = created.text("version");

        // 只提交 version：没有有效变更，拒绝且不递增版本
        Map<String, Object> versionOnly = Map.of("version", version);
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, versionOnly).assertCode(40001);

        // 漏填字段保持原值
        Map<String, Object> remarkOnly = new LinkedHashMap<>();
        remarkOnly.put("version", version);
        remarkOnly.put("remark", "新备注");
        ApiResult updated = self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, remarkOnly).assertCode(200);
        assertThat(updated.text("remark")).isEqualTo("新备注");
        assertThat(updated.text("phone")).isEqualTo("13900000001");
        assertThat(Long.parseLong(updated.text("version"))).isEqualTo(Long.parseLong(version) + 1);

        // 显式 null 清空可空字段
        Map<String, Object> clearPhone = new LinkedHashMap<>();
        clearPhone.put("version", updated.text("version"));
        clearPhone.put("phone", null);
        ApiResult cleared = self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, clearPhone).assertCode(200);
        assertThat(cleared.text("phone")).isNull();

        // 空白字符串按平台公约清空可选文本
        Map<String, Object> blankRemark = new LinkedHashMap<>();
        blankRemark.put("version", cleared.text("version"));
        blankRemark.put("remark", "   ");
        assertThat(self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, blankRemark).text("remark")).isNull();

        // 必填字段不能清空或置空
        Map<String, Object> emptyUsername = new LinkedHashMap<>();
        emptyUsername.put("version", cleared.text("version"));
        emptyUsername.put("username", "  ");
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, emptyUsername).assertCode(40001);
        Map<String, Object> nullUsername = new LinkedHashMap<>();
        nullUsername.put("version", cleared.text("version"));
        nullUsername.put("username", null);
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, nullUsername).assertCode(40001);

        // 未知字段与只读字段一律拒绝
        Map<String, Object> readonly = new LinkedHashMap<>();
        readonly.put("version", cleared.text("version"));
        readonly.put("createdBy", "999");
        ApiResult readonlyResult = self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, readonly)
                .assertCode(40001);
        assertThat(readonlyResult.fieldErrorNames()).contains("createdBy");
        Map<String, Object> unknown = new LinkedHashMap<>();
        unknown.put("version", cleared.text("version"));
        unknown.put("nickname", "x");
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, unknown).assertCode(40001);

        // 缺少 version
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, Map.of("remark", "无版本")).assertCode(40001);

        // 旧 version 冲突：保留原值并返回 40901
        Map<String, Object> stale = new LinkedHashMap<>();
        stale.put("version", version);
        stale.put("remark", "旧版本提交");
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, stale).assertCode(40901);
        assertThat(self(HttpMethod.GET, "/api/v1/auth/accounts/" + id, token, null).text("remark")).isNull();

        // 旧 version 且提交与当前相同的值：版本判定优先，仍返回 40901，版本不变
        String latest = self(HttpMethod.GET, "/api/v1/auth/accounts/" + id, token, null).text("version");
        assertThat(latest).as("前置条件：提交的 version 已过旧").isNotEqualTo(version);
        Map<String, Object> staleIdentical = new LinkedHashMap<>();
        staleIdentical.put("version", version);
        staleIdentical.put("remark", null);
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + id, token, staleIdentical).assertCode(40901);
        assertThat(self(HttpMethod.GET, "/api/v1/auth/accounts/" + id, token, null).text("version"))
                .as("旧版本提交不递增版本").isEqualTo(latest);
    }

    @Test
    @DisplayName("新增不接受 id、version 等只读字段")
    void createRejectsReadOnlyFields() {
        String token = adminToken();
        Map<String, Object> withId = new LinkedHashMap<>();
        withId.put("id", "1");
        withId.put("username", unique("with-id"));
        withId.put("password", MEMBER_PASSWORD);
        ApiResult result = self(HttpMethod.POST, "/api/v1/auth/accounts", token, withId).assertCode(40001);
        assertThat(result.fieldErrorNames()).contains("id");

        Map<String, Object> withVersion = new LinkedHashMap<>();
        withVersion.put("version", "1");
        withVersion.put("username", unique("with-version"));
        withVersion.put("password", MEMBER_PASSWORD);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token, withVersion).assertCode(40001);
    }

    @Test
    @DisplayName("删除重复执行返回 40401，旧 version 返回 40901")
    void deleteRepeatsAndVersion() {
        String token = adminToken();
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("delete"), "password", MEMBER_PASSWORD)).assertCode(200);
        String id = created.text("id");
        String version = created.text("version");

        self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + id + "?version=" + (Long.parseLong(version) + 5), token,
                null).assertCode(40901);
        self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + id + "?version=" + version, token, null).assertCode(200);
        self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + id + "?version=" + version, token, null).assertCode(40401);
        self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + id, token, null).assertCode(40001);
    }

    @Test
    @DisplayName("路径不存在返回 40401，方法不支持返回 40001，未知查询参数返回 40001")
    void routingErrors() {
        String token = adminToken();
        self(HttpMethod.GET, "/api/v1/auth/unknown-resource", token, null).assertCode(40401);
        self(HttpMethod.PUT, "/api/v1/auth/accounts", token, Map.of("username", "x")).assertCode(40001);
        ApiResult unknownParam = self(HttpMethod.GET, "/api/v1/auth/accounts?foo=1", token, null).assertCode(40001);
        assertThat(unknownParam.fieldErrorNames()).contains("foo");
    }

    @Test
    @DisplayName("缺少或无效 AppKey 返回 40104，未带令牌返回 40101")
    void authenticationErrors() {
        call(HttpMethod.GET, "/api/v1/auth/accounts", null, null, null).assertCode(40104);
        call(HttpMethod.GET, "/api/v1/auth/accounts", "unknown-app-key", null, null).assertCode(40104);
        call(HttpMethod.GET, "/api/v1/auth/accounts", SELF_APP_KEY, null, null).assertCode(40101);
        call(HttpMethod.GET, "/api/v1/auth/accounts", SELF_APP_KEY, "qs_not-a-real-token", null).assertCode(40101);
    }
}
