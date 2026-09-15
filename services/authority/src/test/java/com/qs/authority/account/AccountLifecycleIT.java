package com.qs.authority.account;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * 账号生命周期验收（AC-09、AC-28、AC-31、AC-32、AC-38、AC-39）：
 * 账号增改删查与字段边界、服务账号限制、冻结解冻、引用阻止删除、超级管理员保护、
 * 首次强制改密、本人改密与随机重置密码。
 */
@DisplayName("账号：生命周期、口令与删除保护")
class AccountLifecycleIT extends AbstractAuthorityTest {

    @Test
    @DisplayName("新增自然人账号：默认状态与强制改密标记，响应不含密码散列")
    void createPersonAccount() {
        String token = adminToken();
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("acct"), "password", MEMBER_PASSWORD)).assertCode(200);

        assertThat(created.text("accountType")).isEqualTo("person");
        assertThat(created.text("status")).isEqualTo("normal");
        assertThat(created.booleanField("mustChangePassword")).isTrue();
        assertThat(created.booleanField("isSuperAdmin")).isFalse();
        assertThat(created.body()).doesNotContain("password");
        long id = Long.parseLong(created.text("id"));
        assertThat(queryOne("SELECT account_type FROM qs__auth__account WHERE id = ?", String.class, id))
                .isEqualTo("person");
        assertThat(queryOne("SELECT must_change_password FROM qs__auth__account WHERE id = ?", Boolean.class, id))
                .isTrue();
    }

    @Test
    @DisplayName("账号名、手机号与邮箱在单企业内唯一")
    void uniqueFields() {
        String token = adminToken();
        String username = unique("uniq");
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", username, "password", MEMBER_PASSWORD)).assertCode(200);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", username, "password", MEMBER_PASSWORD)).assertCode(40902);

        String phone = "139" + String.format("%08d", Math.abs(System.nanoTime() % 100_000_000L));
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("phone"), "password", MEMBER_PASSWORD, "phone", phone)).assertCode(200);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("phone"), "password", MEMBER_PASSWORD, "phone", phone)).assertCode(40902);

        String email = unique("mail") + "@example.com";
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("mail"), "password", MEMBER_PASSWORD, "email", email)).assertCode(200);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("mail"), "password", MEMBER_PASSWORD, "email", email)).assertCode(40902);

        ApiResult other = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("other"), "password", MEMBER_PASSWORD)).assertCode(200);
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("version", other.text("version"));
        patch.put("username", username);
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + other.text("id"), token, patch).assertCode(40902);
    }

    @Test
    @DisplayName("初始密码必须满足复杂度，反例不落库")
    void passwordComplexityOnCreate() {
        String token = adminToken();
        for (String password : List.of("Ab1!xyz", "Abcd!xyz", "1234!567", "Abcd1234")) {
            ApiResult result = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                    Map.of("username", unique("weak"), "password", password)).assertCode(40001);
            assertThat(result.fieldErrorNames()).contains("password");
        }
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("strong"), "password", "Ab1!xyza")).assertCode(200);
    }

    @Test
    @DisplayName("服务账号：不得设置密码、必须配置 IP 白名单、不允许密码登录")
    void serviceAccountRules() {
        String token = adminToken();
        String username = unique("svc");
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", username, "accountType", "service", "ipWhitelist",
                        List.of("192.168.1.10", "10.0.0.0/24"))).assertCode(200);
        assertThat(created.text("accountType")).isEqualTo("service");
        assertThat(created.booleanField("mustChangePassword")).isFalse();
        assertThat(created.data().path("ipWhitelist").size()).isEqualTo(2);

        Map<String, Object> withPassword = new LinkedHashMap<>();
        withPassword.put("username", unique("svc"));
        withPassword.put("accountType", "service");
        withPassword.put("ipWhitelist", List.of("192.168.1.11"));
        withPassword.put("password", MEMBER_PASSWORD);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token, withPassword).assertCode(40001);

        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("svc"), "accountType", "service")).assertCode(40001);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("svc"), "accountType", "service", "ipWhitelist",
                        List.of("not-an-address"))).assertCode(40001);

        ApiResult login = login(username, "Any@12345");
        assertThat(login.code()).isEqualTo(40101);
        assertThat(login.body()).doesNotContain("服务账号");
    }

    @Test
    @DisplayName("字段边界：用户名长度、未知枚举、只读字段")
    void fieldBoundaries() {
        String token = adminToken();
        StringBuilder builder = new StringBuilder("u" + Math.abs(System.nanoTime()));
        while (builder.length() < 64) {
            builder.append('u');
        }
        String name64 = builder.substring(0, 64);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", name64, "password", MEMBER_PASSWORD)).assertCode(200);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", name64 + "u", "password", MEMBER_PASSWORD)).assertCode(40001);

        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("type"), "password", MEMBER_PASSWORD, "accountType", "robot"))
                .assertCode(40001);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("status"), "password", MEMBER_PASSWORD, "status", "frozen"))
                .assertCode(40001);
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("super"), "password", MEMBER_PASSWORD, "isSuperAdmin", true))
                .assertCode(40001);
        self(HttpMethod.GET, "/api/v1/auth/accounts?accountType=robot", token, null).assertCode(40001);
    }

    @Test
    @DisplayName("冻结与解冻带 version：冻结后登录拒绝，旧版本重放拒绝，解冻后恢复")
    void freezeAndUnfreeze() {
        String token = adminToken();
        MemberSession member = createMember(token, "freeze");
        String version = self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), token, null)
                .text("version");

        self(HttpMethod.POST, "/api/v1/auth/accounts/" + member.accountId() + "/freeze", token,
                Map.of("version", version)).assertCode(200);
        assertThat(queryOne("SELECT status FROM qs__auth__account WHERE id = ?", String.class,
                Long.parseLong(member.accountId()))).isEqualTo("frozen");
        login(member.username(), "Member@456").assertCode(40302);

        self(HttpMethod.POST, "/api/v1/auth/accounts/" + member.accountId() + "/unfreeze", token,
                Map.of("version", version)).assertCode(40901);

        String latest = self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), token, null)
                .text("version");
        self(HttpMethod.POST, "/api/v1/auth/accounts/" + member.accountId() + "/unfreeze", token,
                Map.of("version", latest)).assertCode(200);
        login(member.username(), "Member@456").assertCode(200);
    }

    @Test
    @DisplayName("删除保护：有引用返回 40903 且不连带删除，无引用的账号可被物理删除")
    void deleteProtection() {
        String token = adminToken();
        MemberSession member = createMember(token, "delref");
        ApiResult organization = self(HttpMethod.POST, "/api/v1/auth/organizations", token,
                Map.of("orgName", unique("delorg"), "orgType", "department")).assertCode(200);
        ApiResult link = self(HttpMethod.POST, "/api/v1/auth/account-organizations", token,
                Map.of("accountId", member.accountId(), "orgId", organization.text("id"))).assertCode(200);

        String version = self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), token, null)
                .text("version");
        ApiResult blocked = self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + member.accountId() + "?version="
                + version, token, null).assertCode(40903);
        assertThat(blocked.data().path("references").size()).isPositive();
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account WHERE id = ?", Long.class,
                Long.parseLong(member.accountId()))).isEqualTo(1L);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account_organization WHERE id = ?", Long.class,
                Long.parseLong(link.text("id")))).isEqualTo(1L);

        // 解除账号与组织关联后，登录令牌仍然构成引用：令牌属于「不连带删除」的数据
        self(HttpMethod.DELETE, "/api/v1/auth/account-organizations/" + link.text("id") + "?version="
                + link.text("version"), token, null).assertCode(200);
        String afterUnlink = self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), token, null)
                .text("version");
        ApiResult stillBlocked = self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + member.accountId() + "?version="
                + afterUnlink, token, null).assertCode(40903);
        assertThat(stillBlocked.body()).contains("令牌");

        // 从未登录且无任何关联的账号可以物理删除，重复删除返回 40401
        ApiResult clean = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("clean"), "password", MEMBER_PASSWORD)).assertCode(200);
        self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + clean.text("id") + "?version=" + clean.text("version"),
                token, null).assertCode(200);
        self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + clean.text("id") + "?version=" + clean.text("version"),
                token, null).assertCode(40401);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__account WHERE id = ?", Long.class,
                Long.parseLong(clean.text("id")))).isZero();
    }

    @Test
    @DisplayName("内置超级管理员不可删除、身份不可通过编辑接口修改")
    void superAdminProtection() {
        String token = adminToken();
        long adminId = queryOne("SELECT id FROM qs__auth__account WHERE is_super_admin", Long.class);
        String version = self(HttpMethod.GET, "/api/v1/auth/accounts/" + adminId, token, null).text("version");

        ApiResult blocked = self(HttpMethod.DELETE, "/api/v1/auth/accounts/" + adminId + "?version=" + version, token,
                null).assertCode(40903);
        assertThat(blocked.body()).contains("内置超级管理员");

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("version", version);
        patch.put("isSuperAdmin", true);
        self(HttpMethod.PATCH, "/api/v1/auth/accounts/" + adminId, token, patch).assertCode(40001);

        assertThat(queryOne("SELECT count(*) FROM qs__auth__account WHERE is_super_admin", Long.class)).isEqualTo(1L);
    }

    @Test
    @DisplayName("首次登录强制改密：改密前拒绝普通业务，改密后必须重新登录")
    void forcedInitialPasswordChange() {
        String token = adminToken();
        String username = unique("first");
        self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", username, "password", MEMBER_PASSWORD)).assertCode(200);

        ApiResult first = login(username, MEMBER_PASSWORD).assertCode(200);
        assertThat(first.booleanField("mustChangePassword")).isTrue();
        String restricted = first.token();

        call(HttpMethod.GET, "/api/v1/auth/accounts", SELF_APP_KEY, restricted, null).assertCode(40303);
        call(HttpMethod.GET, "/api/v1/auth/users/me", SELF_APP_KEY, restricted, null).assertCode(200);

        call(HttpMethod.POST, "/api/v1/auth/initial-password-changes", SELF_APP_KEY, restricted,
                Map.of("newPassword", "First@789")).assertCode(200);
        call(HttpMethod.GET, "/api/v1/auth/users/me", SELF_APP_KEY, restricted, null).assertCode(40103);

        ApiResult again = login(username, "First@789").assertCode(200);
        assertThat(again.booleanField("mustChangePassword")).isFalse();
        call(HttpMethod.GET, "/api/v1/auth/users/me", SELF_APP_KEY, again.token(), null).assertCode(200);

        call(HttpMethod.POST, "/api/v1/auth/initial-password-changes", SELF_APP_KEY, again.token(),
                Map.of("newPassword", "First@790")).assertCode(40904);
    }

    @Test
    @DisplayName("本人改密：校验原密码与复杂度，成功后该账号全部旧令牌失效")
    void selfPasswordChange() {
        String token = adminToken();
        MemberSession member = createMember(token, "selfpw");

        call(HttpMethod.POST, "/api/v1/auth/password-changes", SELF_APP_KEY, member.token(),
                Map.of("oldPassword", "Wrong@456", "newPassword", "Renewed@789")).assertCode(40101);
        call(HttpMethod.POST, "/api/v1/auth/password-changes", SELF_APP_KEY, member.token(),
                Map.of("oldPassword", "Member@456", "newPassword", "weakpassword")).assertCode(40001);

        ApiResult changed = call(HttpMethod.POST, "/api/v1/auth/password-changes", SELF_APP_KEY, member.token(),
                Map.of("oldPassword", "Member@456", "newPassword", "Renewed@789")).assertCode(200);
        assertThat(changed.cacheControl()).isEqualTo("no-store");

        call(HttpMethod.GET, "/api/v1/auth/users/me", SELF_APP_KEY, member.token(), null).assertCode(40103);
        login(member.username(), "Member@456").assertCode(40101);
        login(member.username(), "Renewed@789").assertCode(200);
    }

    @Test
    @DisplayName("随机重置密码：一次展示、目标旧令牌全部失效、下次登录强制改密")
    void randomPasswordReset() {
        String token = adminToken();
        MemberSession member = createMember(token, "reset");
        String version = self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), token, null)
                .text("version");

        ApiResult reset = self(HttpMethod.POST, "/api/v1/auth/accounts/" + member.accountId() + "/password-reset",
                token, Map.of("version", version)).assertCode(200);
        String initialPassword = reset.text("initialPassword");
        assertThat(initialPassword).matches("^(?=.*\\d)(?=.*[A-Za-z])(?=.*[^A-Za-z0-9]).{8,}$");
        assertThat(reset.cacheControl()).isEqualTo("no-store");
        assertThat(reset.booleanField("mustChangePassword")).isTrue();

        call(HttpMethod.GET, "/api/v1/auth/users/me", SELF_APP_KEY, member.token(), null).assertCode(40103);
        assertThat(self(HttpMethod.GET, "/api/v1/auth/accounts/" + member.accountId(), token, null).body())
                .doesNotContain(initialPassword);

        ApiResult login = login(member.username(), initialPassword).assertCode(200);
        assertThat(login.booleanField("mustChangePassword")).isTrue();
        assertThat(queryOne("SELECT password FROM qs__auth__account WHERE id = ?", String.class,
                Long.parseLong(member.accountId()))).doesNotContain(initialPassword);

        // 服务账号不使用密码流程
        ApiResult service = self(HttpMethod.POST, "/api/v1/auth/accounts", token,
                Map.of("username", unique("svc"), "accountType", "service", "ipWhitelist",
                        List.of("192.168.1.20"))).assertCode(200);
        self(HttpMethod.POST, "/api/v1/auth/accounts/" + service.text("id") + "/password-reset", token,
                Map.of("version", service.text("version"))).assertCode(40001);
    }
}
