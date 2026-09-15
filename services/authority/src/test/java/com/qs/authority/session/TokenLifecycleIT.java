package com.qs.authority.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * 令牌生命周期接口验收（AC-17、AC-18、AC-19、AC-43；TC-31-015/016/017/018、TC-33-004）。
 *
 * <p>覆盖两次登录各自签发 30 天令牌且互不影响、库中只保存摘要、到期判断精确到秒且不依赖清理
 * 任务、剩余不足 15 天换发并撤销旧令牌、剩余正好 15 天不换发、换发失败无半完成、退出只撤销
 * 当前登录实例、冻结暂停而解冻恢复未撤销令牌、改密撤销该账号全部设备、场景令牌沿用登录实例。
 * 到期与换发窗口都用 jdbc 直接改 {@code expires_at} 构造，不等待真实时间。
 */
@DisplayName("令牌生命周期：签发、到期、换发、退出与冻结")
class TokenLifecycleIT extends AbstractAuthorityTest {

    /** 成员完成首次改密后的口令，{@link #createMember} 已把账号改到该口令。 */
    private static final String MEMBER_PASSWORD_AFTER_CHANGE = "Member@456";
    /** 成员本人改密后的新口令。 */
    private static final String MEMBER_PASSWORD_CHANGED = "Member@789";
    /** 当前登录账号详情接口。 */
    private static final String ME = "/api/v1/auth/users/me";
    /** 令牌有效期 30 天，允许创建时间与签发时间跨秒造成的 5 秒内误差。 */
    private static final String TTL_30_DAYS =
            "(expires_at - created_at) BETWEEN interval '29 days 23:59:55' AND interval '30 days'";
    private static final String TIME_PATTERN = "\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}";
    private static final ZoneId BEIJING = ZoneId.of("Asia/Shanghai");

    @Test
    @DisplayName("AC-17/TC-31-015：同账号两次登录签发两枚不同令牌，同时有效、各 30 天、登录实例不同")
    void multipleLoginsIssueIndependentTokens() {
        MemberSession member = createMember(adminToken(), "token-device");
        ApiResult phone = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        ApiResult computer = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);

        assertThat(phone.token()).isNotEqualTo(computer.token());
        assertThat(phone.text("sessionId")).isNotEqualTo(computer.text("sessionId"));
        assertThat(phone.text("expiresAt")).matches(TIME_PATTERN);
        assertThat(computer.text("expiresAt")).matches(TIME_PATTERN);
        // 两枚令牌同时可用，互不撤销。
        self(HttpMethod.GET, ME, phone.token(), null).assertCode(200);
        self(HttpMethod.GET, ME, computer.token(), null).assertCode(200);

        // 响应中的到期时间就是库中该摘要记录的到期时间。
        assertThat(phone.text("expiresAt")).isEqualTo(storedExpiresAt(phone.token()));
        assertThat(computer.text("expiresAt")).isEqualTo(storedExpiresAt(computer.token()));

        Long ttlRows = queryOne("SELECT count(*) FROM qs__auth__token WHERE token_digest IN (?, ?) AND "
                + TTL_30_DAYS, Long.class, digestOf(phone.token()), digestOf(computer.token()));
        assertThat(ttlRows).as("两枚令牌都应保存 30 天有效期").isEqualTo(2L);
        Long sessions = queryOne("SELECT count(DISTINCT session_id) FROM qs__auth__token WHERE token_digest IN (?, ?)",
                Long.class, digestOf(phone.token()), digestOf(computer.token()));
        assertThat(sessions).as("两枚令牌属于不同登录实例").isEqualTo(2L);
    }

    @Test
    @DisplayName("AC-17/TC-31-015：令牌只落摘要，库中不存在令牌明文")
    void onlyDigestIsPersisted() {
        MemberSession member = createMember(adminToken(), "token-digest");
        ApiResult session = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        String token = session.token();

        assertThat(storedDigest(token)).as("库中摘要应为令牌明文的 SHA-256").isEqualTo(digestOf(token));
        assertThat(storedDigest(token)).as("库中摘要不得等于令牌明文").isNotEqualTo(token);
        Long plaintextRows = queryOne("SELECT count(*) FROM qs__auth__token WHERE token_digest = ?", Long.class,
                token);
        assertThat(plaintextRows).as("全表不得存在令牌明文").isZero();
    }

    @Test
    @DisplayName("AC-17/TC-31-016：到期判断精确到秒，到点即 40102，未到点仍 200")
    void expiryIsSecondPrecise() throws InterruptedException {
        MemberSession member = createMember(adminToken(), "token-expiry");
        String token = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200).token();
        self(HttpMethod.GET, ME, token, null).assertCode(200);

        // 约束 expires_at > created_at：等到「当前秒减 1 秒」晚于令牌创建秒再写入到期时间。
        setExpiresAt(token, awaitExpiryWritable(token));
        self(HttpMethod.GET, ME, token, null).assertCode(40102);
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(40102);

        setExpiresAt(token, beijingNow().plusHours(1));
        self(HttpMethod.GET, ME, token, null).assertCode(200);
    }

    @Test
    @DisplayName("AC-18/TC-31-017：剩余 14 天换发新 30 天令牌，旧令牌撤销、登录实例不变")
    void renewRotatesTokenAndKeepsLoginInstance() {
        MemberSession member = createMember(adminToken(), "token-renew");
        ApiResult session = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        String token = session.token();
        String sessionId = session.text("sessionId");

        setExpiresAt(token, beijingNow().plusDays(14));
        ApiResult renewed = self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(200);
        assertThat(renewed.token()).isNotEqualTo(token);
        assertThat(renewed.text("sessionId")).isEqualTo(sessionId);
        assertThat(renewed.text("expiresAt")).matches(TIME_PATTERN);

        assertThat(isRevoked(token)).as("旧令牌换发后应被撤销").isTrue();
        Long activeInSession = queryOne("SELECT count(*) FROM qs__auth__token WHERE session_id::text = ? "
                + "AND revoked = FALSE", Long.class, sessionId);
        assertThat(activeInSession).as("同一登录实例下只应有一条未撤销记录").isEqualTo(1L);
        Long newTtl = queryOne("SELECT count(*) FROM qs__auth__token WHERE token_digest = ? AND " + TTL_30_DAYS,
                Long.class, digestOf(renewed.token()));
        assertThat(newTtl).as("新令牌有效期为 30 天").isEqualTo(1L);
        assertThat(queryOne("SELECT session_id::text FROM qs__auth__token WHERE token_digest = ?", String.class,
                digestOf(renewed.token()))).isEqualTo(sessionId);

        self(HttpMethod.GET, ME, renewed.token(), null).assertCode(200);
        self(HttpMethod.GET, ME, token, null).assertCode(40103);
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(40103);
    }

    @Test
    @DisplayName("AC-18：剩余正好 15 天不换发返回 40904，少 1 秒即换发，阈值严格取 15 天")
    void renewBoundaryAtFifteenDaysIsRejected() throws InterruptedException {
        MemberSession member = createMember(adminToken(), "token-boundary");
        ApiResult session = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        String token = session.token();
        String sessionId = session.text("sessionId");

        // 剩余正好 15 天只在同一秒内可构造：等到当前秒刚开始再写入并立即请求。
        setExpiresAt(token, awaitSecondStart().plusDays(15));
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(40904);

        assertThat(isRevoked(token)).as("未进入换发窗口不得撤销旧令牌").isFalse();
        Long activeInSession = queryOne("SELECT count(*) FROM qs__auth__token WHERE session_id::text = ? "
                + "AND revoked = FALSE", Long.class, sessionId);
        assertThat(activeInSession).as("未换发不得新增或撤销记录").isEqualTo(1L);
        self(HttpMethod.GET, ME, token, null).assertCode(200);

        // 比边界少 1 秒即进入换发窗口，证明阈值既不提前也不滞后。
        setExpiresAt(token, awaitSecondStart().plusDays(15).minusSeconds(1));
        ApiResult renewed = self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(200);
        assertThat(renewed.text("sessionId")).isEqualTo(sessionId);
        assertThat(isRevoked(token)).isTrue();
        self(HttpMethod.GET, ME, renewed.token(), null).assertCode(200);
    }

    @Test
    @DisplayName("AC-18：换发失败不产生半完成，已换发令牌再次换发返回 40103 且库中记录不变")
    void failedRenewLeavesNoPartialWrite() {
        MemberSession member = createMember(adminToken(), "token-partial");
        ApiResult session = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        String token = session.token();
        String sessionId = session.text("sessionId");
        long accountId = Long.parseLong(member.accountId());

        setExpiresAt(token, beijingNow().plusDays(14));
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(200);
        String rotated = queryOne("SELECT token_digest FROM qs__auth__token WHERE session_id::text = ? "
                + "AND revoked = FALSE", String.class, sessionId);

        long rowsBefore = countTokens(accountId);
        long revokedBefore = countRevoked(accountId);
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", token, null).assertCode(40103);
        self(HttpMethod.POST, "/api/v1/auth/sessions/logout", token, null).assertCode(40103);

        assertThat(countTokens(accountId)).as("失败的换发不得新增记录").isEqualTo(rowsBefore);
        assertThat(countRevoked(accountId)).as("失败的换发不得撤销其他记录").isEqualTo(revokedBefore);
        assertThat(queryOne("SELECT token_digest FROM qs__auth__token WHERE session_id::text = ? AND revoked = FALSE",
                String.class, sessionId)).isEqualTo(rotated);
    }

    @Test
    @DisplayName("AC-43/TC-33-004：退出只撤销当前设备登录实例，其他设备令牌不受影响")
    void logoutOnlyRevokesCurrentDevice() {
        MemberSession member = createMember(adminToken(), "token-logout");
        ApiResult phone = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        ApiResult computer = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);

        self(HttpMethod.POST, "/api/v1/auth/sessions/logout", phone.token(), null).assertCode(200);
        self(HttpMethod.GET, ME, phone.token(), null).assertCode(40103);
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", phone.token(), null).assertCode(40103);
        self(HttpMethod.GET, ME, computer.token(), null).assertCode(200);

        // 重复退出不恢复凭据。
        self(HttpMethod.POST, "/api/v1/auth/sessions/logout", phone.token(), null).assertCode(40103);
        self(HttpMethod.GET, ME, computer.token(), null).assertCode(200);

        Long activeInPhoneSession = queryOne("SELECT count(*) FROM qs__auth__token WHERE session_id::text = ? "
                + "AND revoked = FALSE", Long.class, phone.text("sessionId"));
        assertThat(activeInPhoneSession).as("退出后该实例不应残留未撤销令牌").isZero();
    }

    @Test
    @DisplayName("AC-43/TC-33-004：退出不接受客户端指定设备，请求体字段返回 40001")
    void logoutRejectsClientSpecifiedDevice() {
        MemberSession member = createMember(adminToken(), "token-logout-body");
        ApiResult phone = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        ApiResult computer = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);

        ApiResult rejected = self(HttpMethod.POST, "/api/v1/auth/sessions/logout", computer.token(),
                Map.of("sessionId", phone.text("sessionId"))).assertCode(40001);
        assertThat(rejected.fieldErrorNames()).contains("sessionId");
        // 指定的设备与当前设备都不能被这条请求撤销。
        self(HttpMethod.GET, ME, computer.token(), null).assertCode(200);
        self(HttpMethod.GET, ME, phone.token(), null).assertCode(200);
    }

    @Test
    @DisplayName("AC-19/BR-17：冻结暂停鉴权但不注销令牌，解冻后未撤销令牌恢复、已撤销仍 40103")
    void freezeSuspendsWithoutRevokingTokens() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "token-freeze");
        String phone = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200).token();
        ApiResult computerSession = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        String computer = computerSession.token();
        self(HttpMethod.POST, "/api/v1/auth/sessions/logout", computer, null).assertCode(200);

        self(HttpMethod.POST, "/api/v1/auth/accounts/" + member.accountId() + "/freeze", admin,
                Map.of("version", accountVersion(member.accountId()))).assertCode(200);
        self(HttpMethod.GET, ME, phone, null).assertCode(40302);
        self(HttpMethod.GET, ME, computer, null).assertCode(40103);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__token WHERE token_digest = ?", Long.class,
                digestOf(phone))).as("冻结保留令牌摘要").isEqualTo(1L);

        self(HttpMethod.POST, "/api/v1/auth/accounts/" + member.accountId() + "/unfreeze", admin,
                Map.of("version", accountVersion(member.accountId()))).assertCode(200);
        self(HttpMethod.GET, ME, phone, null).assertCode(200);
        self(HttpMethod.GET, ME, computer, null).assertCode(40103);
        self(HttpMethod.POST, "/api/v1/auth/sessions/renew", computer, null).assertCode(40103);
    }

    @Test
    @DisplayName("AC-19/BR-32：改密撤销该账号全部设备令牌，其他账号令牌不受影响")
    void passwordChangeRevokesEveryDeviceOfTheAccount() {
        String admin = adminToken();
        MemberSession member = createMember(admin, "token-pwd");
        String first = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200).token();
        String second = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200).token();
        MemberSession other = createMember(admin, "token-pwd-other");

        self(HttpMethod.POST, "/api/v1/auth/password-changes", first,
                Map.of("oldPassword", MEMBER_PASSWORD_AFTER_CHANGE, "newPassword", MEMBER_PASSWORD_CHANGED))
                .assertCode(200);

        self(HttpMethod.GET, ME, first, null).assertCode(40103);
        self(HttpMethod.GET, ME, second, null).assertCode(40103);
        self(HttpMethod.GET, ME, other.token(), null).assertCode(200);
        login(member.username(), MEMBER_PASSWORD_CHANGED).assertCode(200);
        login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(40101);
    }

    @Test
    @DisplayName("AC-17/API-17：场景令牌沿用当前登录实例、有效期 30 天并可正常调用")
    void sceneTokenKeepsLoginInstance() {
        MemberSession member = createMember(adminToken(), "token-scene");
        ApiResult session = login(member.username(), MEMBER_PASSWORD_AFTER_CHANGE).assertCode(200);
        String sceneId = unique("scene");

        ApiResult issued = self(HttpMethod.POST, "/api/v1/auth/scene-tokens", session.token(),
                Map.of("sceneId", sceneId)).assertCode(200);
        assertThat(issued.text("sceneId")).isEqualTo(sceneId);
        assertThat(issued.text("sessionId")).isEqualTo(session.text("sessionId"));
        assertThat(issued.text("expiresAt")).matches(TIME_PATTERN);

        assertThat(queryOne("SELECT session_id::text FROM qs__auth__token WHERE scene_id = ?", String.class, sceneId))
                .isEqualTo(session.text("sessionId"));
        assertThat(queryOne("SELECT token_type FROM qs__auth__token WHERE scene_id = ?", String.class, sceneId))
                .isEqualTo("Scene-Token");
        Long ttl = queryOne("SELECT count(*) FROM qs__auth__token WHERE scene_id = ? AND " + TTL_30_DAYS, Long.class,
                sceneId);
        assertThat(ttl).isEqualTo(1L);
        assertThat(queryOne("SELECT count(*) FROM qs__auth__token WHERE token_digest = ?", Long.class,
                issued.token())).as("场景令牌同样只落摘要").isZero();

        self(HttpMethod.GET, ME, issued.token(), null).assertCode(200);

        // 场景令牌与主令牌同一登录实例：退出该设备同时终止场景令牌。
        self(HttpMethod.POST, "/api/v1/auth/sessions/logout", session.token(), null).assertCode(200);
        self(HttpMethod.GET, ME, issued.token(), null).assertCode(40103);
        self(HttpMethod.GET, ME, session.token(), null).assertCode(40103);
    }

    /**
     * 读取令牌记录中的到期时间，按北京时间秒精度格式化，与接口返回格式一致。
     *
     * @param raw 令牌明文
     * @return 库中到期时间文本
     */
    private String storedExpiresAt(String raw) {
        return queryOne("SELECT to_char(expires_at, 'YYYY-MM-DD HH24:MI:SS') FROM qs__auth__token WHERE id = ?",
                String.class, tokenId(raw));
    }

    private String storedDigest(String raw) {
        return queryOne("SELECT token_digest FROM qs__auth__token WHERE id = ?", String.class, tokenId(raw));
    }

    private boolean isRevoked(String raw) {
        return Boolean.TRUE.equals(queryOne("SELECT revoked FROM qs__auth__token WHERE id = ?", Boolean.class,
                tokenId(raw)));
    }

    /**
     * 把令牌到期时间改为给定北京时间；令牌记录由明文摘要定位。
     *
     * @param raw 令牌明文
     * @param expiresAt 新的到期时间
     */
    private void setExpiresAt(String raw, LocalDateTime expiresAt) {
        int rows = jdbc().update("UPDATE qs__auth__token SET expires_at = ? WHERE id = ?", expiresAt, tokenId(raw));
        assertThat(rows).as("到期时间写入失败，可能违反 expires_at > created_at").isEqualTo(1);
    }

    private long tokenId(String raw) {
        Long id = queryOne("SELECT id FROM qs__auth__token WHERE token_digest = ?", Long.class, digestOf(raw));
        assertThat(id).as("令牌摘要未落库").isNotNull();
        return id;
    }

    private long countTokens(long accountId) {
        return queryOne("SELECT count(*) FROM qs__auth__token WHERE account_id = ?", Long.class, accountId);
    }

    private long countRevoked(long accountId) {
        return queryOne("SELECT count(*) FROM qs__auth__token WHERE account_id = ? AND revoked = TRUE", Long.class,
                accountId);
    }

    private String accountVersion(String accountId) {
        return String.valueOf(queryOne("SELECT version FROM qs__auth__account WHERE id = ?", Long.class,
                Long.parseLong(accountId)));
    }

    /**
     * 返回一个既已过期又满足数据库约束 {@code expires_at > created_at} 的北京时间。
     *
     * @param raw 令牌明文
     * @return 可写入的到期时间，即当前秒减 1 秒且晚于令牌创建秒
     * @throws InterruptedException 等待被中断
     */
    private LocalDateTime awaitExpiryWritable(String raw) throws InterruptedException {
        long id = tokenId(raw);
        while (true) {
            LocalDateTime candidate = beijingNow().minusSeconds(1);
            if (queryOne("SELECT count(*) FROM qs__auth__token WHERE id = ? AND created_at < ?", Long.class, id,
                    candidate) == 1) {
                return candidate;
            }
            Thread.sleep(50);
        }
    }

    /**
     * 等到当前秒刚开始再返回秒精度时间，使“剩余正好 15 天”的构造与随后的请求落在同一秒内。
     *
     * @return 当前秒起点
     * @throws InterruptedException 等待被中断
     */
    private static LocalDateTime awaitSecondStart() throws InterruptedException {
        while (true) {
            LocalDateTime now = LocalDateTime.now(BEIJING);
            if (now.getNano() < 200_000_000) {
                return now.withNano(0);
            }
            Thread.sleep(20);
        }
    }

    private static LocalDateTime beijingNow() {
        return LocalDateTime.now(BEIJING).withNano(0);
    }

    /**
     * 令牌明文的 SHA-256 摘要，与签发实现一致。
     *
     * @param raw 令牌明文
     * @return 十六进制摘要
     */
    private static String digestOf(String raw) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行环境缺少 SHA-256", exception);
        }
    }
}
