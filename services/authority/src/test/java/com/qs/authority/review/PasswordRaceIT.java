package com.qs.authority.review;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * 复核报告第 5.2 项的并发回归：登录与改密交错时，旧口令不得在改密之后产生有效会话。
 *
 * <p>用例并发触发“旧口令登录”与“本人改密”，随后校验不变量：改密完成后，任何由旧口令换来的令牌都
 * 必须已失效，且新口令可以正常登录。登录在同一事务内锁定账号行，因此结果不依赖线程调度顺序。
 */
@DisplayName("并发回归：旧口令登录与改密交错")
class PasswordRaceIT extends AbstractAuthorityTest {

    private static final int CONCURRENT_LOGINS = 12;

    @Test
    @DisplayName("改密完成后不存在由旧口令签发的有效令牌")
    void oldPasswordCannotSurvivePasswordChange() throws InterruptedException {
        String admin = adminToken();
        MemberSession member = createMember(admin, "race");
        String oldPassword = "Member@456";
        String newPassword = "Member@789";

        CountDownLatch start = new CountDownLatch(1);
        List<String> issuedTokens = java.util.Collections.synchronizedList(new ArrayList<>());
        List<Thread> logins = new ArrayList<>();
        for (int index = 0; index < CONCURRENT_LOGINS; index++) {
            Thread thread = new Thread(() -> {
                try {
                    start.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    return;
                }
                ApiResult result = login(member.username(), oldPassword);
                if (result.code() == 200) {
                    issuedTokens.add(result.token());
                }
            });
            thread.start();
            logins.add(thread);
        }

        start.countDown();
        ApiResult changed = call(HttpMethod.POST, "/api/v1/auth/password-changes", SELF_APP_KEY, member.token(),
                Map.of("oldPassword", oldPassword, "newPassword", newPassword));
        assertThat(changed.code()).as("改密结果: %s", changed.body()).isEqualTo(200);
        for (Thread thread : logins) {
            thread.join(10_000);
        }

        // 不变量：改密完成后，任何旧口令换来的令牌都必须已经失效
        for (String token : issuedTokens) {
            call(HttpMethod.GET, "/api/v1/auth/users/me", SELF_APP_KEY, token, null).assertCode(40103);
        }

        // 新口令可用；旧口令不可再登录
        login(member.username(), newPassword).assertCode(200);
        login(member.username(), oldPassword).assertCode(40101);
    }

    @Test
    @DisplayName("登录会等待账号行锁：账号被并发事务锁定时不签发令牌")
    void loginWaitsForAccountRowLock() throws Exception {
        String admin = adminToken();
        MemberSession member = createMember(admin, "lock");
        java.util.concurrent.atomic.AtomicReference<ApiResult> result = new java.util.concurrent.atomic.AtomicReference<>();
        Thread login = new Thread(() -> result.set(login(member.username(), "Member@456")));

        try (java.sql.Connection connection = jdbc().getDataSource().getConnection()) {
            connection.setAutoCommit(false);
            try (java.sql.PreparedStatement statement = connection.prepareStatement(
                    "SELECT id FROM qs__auth__account WHERE username = ? FOR UPDATE")) {
                statement.setString(1, member.username());
                statement.executeQuery();
            }
            login.start();
            Thread.sleep(1_500);
            assertThat(result.get()).as("账号行被锁定时登录必须等待，不得先行签发令牌").isNull();
            connection.rollback();
        }
        login.join(10_000);
        assertThat(result.get()).isNotNull();
        assertThat(result.get().code()).as("锁释放后登录成功: %s", result.get().body()).isEqualTo(200);
    }
}
