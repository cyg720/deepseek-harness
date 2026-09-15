package com.qs.authority.support;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.common.support.Json;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;

/**
 * 接口测试基类：随机端口启动完整应用，用 HTTP 客户端走真实请求，另配 {@link JdbcTemplate}
 * 直接核对数据库前后值。
 *
 * <p>数据源指向独立的 {@code qs_auth_test} 库并在每次上下文启动前重建，因此用例可以自行创建
 * 唯一命名的对象；用例只清理自己创建的对象存储，不做全库清空。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@ExtendWith(DatabaseRequiredCondition.class)
public abstract class AbstractAuthorityTest {

    /** 授权中心自身应用的 AppKey。 */
    protected static final String SELF_APP_KEY = "test-self-app-key";
    /** 应用中心受控身份 AppKey。 */
    protected static final String APP_CENTER_KEY = "test-app-center-key";
    /** 内置超级管理员用户名。 */
    protected static final String ADMIN_USERNAME = "admin";
    /** 初始化口令。 */
    protected static final String ADMIN_INITIAL_PASSWORD = "TestAdmin@123";
    /** 首次改密后的口令。 */
    protected static final String ADMIN_PASSWORD = "TestAdmin@456";
    /** 普通成员口令。 */
    protected static final String MEMBER_PASSWORD = "Member@123";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static String cachedAdminToken;

    @LocalServerPort
    private int port;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private RestClient client;

    /**
     * 注册测试数据源。
     *
     * @param registry 动态属性注册表
     */
    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        TestDatabase.prepare(registry);
    }

    @BeforeEach
    void prepareClient() {
        client = RestClient.builder().baseUrl("http://127.0.0.1:" + port).build();
    }

    /**
     * 数据库直连模板，用于核对写入结果。
     *
     * @return JDBC 模板
     */
    protected JdbcTemplate jdbc() {
        return jdbcTemplate;
    }

    /**
     * 生成用例内唯一的编码后缀。
     *
     * @param prefix 前缀
     * @return 唯一编码
     */
    protected static String unique(String prefix) {
        return prefix + "-" + System.nanoTime() % 1_000_000_000L + SEQUENCE.incrementAndGet();
    }

    /**
     * 发送请求。
     *
     * @param method HTTP 方法
     * @param path 以 {@code /api/v1/auth} 开头的路径
     * @param appKey X-App-Key 取值，可为 null
     * @param token 用户令牌，可为 null
     * @param body 请求体对象或 JSON 文本，可为 null
     * @return 响应
     */
    protected ApiResult call(HttpMethod method, String path, String appKey, String token, Object body) {
        return call(method, path, appKey, token, body, Map.of());
    }

    /**
     * 发送请求并附加自定义请求头。
     *
     * @param method HTTP 方法
     * @param path 路径
     * @param appKey X-App-Key 取值，可为 null
     * @param token 用户令牌，可为 null
     * @param body 请求体，可为 null
     * @param headers 附加请求头
     * @return 响应
     */
    protected ApiResult call(HttpMethod method, String path, String appKey, String token, Object body,
            Map<String, String> headers) {
        RestClient.RequestBodySpec spec = client.method(method).uri(path);
        if (appKey != null) {
            spec = spec.header("X-App-Key", appKey);
        }
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        for (Map.Entry<String, String> header : headers.entrySet()) {
            spec = spec.header(header.getKey(), header.getValue());
        }
        if (body != null) {
            String payload = body instanceof String text ? text : Json.write(body);
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(payload);
        }
        return spec.exchange((request, response) -> {
            String text = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
            JsonNode json = null;
            if (text != null && !text.isBlank() && !text.startsWith("<")) {
                try {
                    json = Json.readTree(text);
                } catch (RuntimeException exception) {
                    // 非 JSON 响应（例如文档页面）保留原文，交由用例按需断言
                    json = null;
                }
            }
            return new ApiResult(response.getStatusCode().value(), text, json, response.getHeaders());
        }, false);
    }

    /**
     * 以授权中心自身应用身份调用管理接口。
     *
     * @param method HTTP 方法
     * @param path 路径
     * @param token 用户令牌
     * @param body 请求体
     * @return 响应
     */
    protected ApiResult self(HttpMethod method, String path, String token, Object body) {
        return call(method, path, SELF_APP_KEY, token, body);
    }

    /**
     * 以应用中心受控身份调用接口。
     *
     * @param method HTTP 方法
     * @param path 路径
     * @param body 请求体
     * @return 响应
     */
    protected ApiResult appCenter(HttpMethod method, String path, Object body) {
        return call(method, path, APP_CENTER_KEY, null, body);
    }

    /**
     * 超级管理员令牌；首次调用会完成强制改密流程。
     *
     * @return 可用令牌
     */
    protected String adminToken() {
        if (cachedAdminToken != null) {
            ApiResult probe = login(ADMIN_USERNAME, ADMIN_PASSWORD);
            if (probe.status() == 200) {
                cachedAdminToken = probe.token();
                return cachedAdminToken;
            }
        }
        ApiResult initial = login(ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD);
        assertThat(initial.code()).as("超级管理员初始口令登录: %s", initial.body()).isEqualTo(200);
        if (initial.booleanField("mustChangePassword")) {
            ApiResult changed = call(HttpMethod.POST, "/api/v1/auth/initial-password-changes", SELF_APP_KEY,
                    initial.token(), Map.of("newPassword", ADMIN_PASSWORD));
            assertThat(changed.code()).as("首次改密: %s", changed.body()).isEqualTo(200);
            initial = login(ADMIN_USERNAME, ADMIN_PASSWORD);
            assertThat(initial.code()).as("改密后登录: %s", initial.body()).isEqualTo(200);
        }
        cachedAdminToken = initial.token();
        return cachedAdminToken;
    }

    /**
     * 登录。
     *
     * @param username 用户名
     * @param password 口令
     * @return 响应
     */
    protected ApiResult login(String username, String password) {
        return call(HttpMethod.POST, "/api/v1/auth/sessions/login", SELF_APP_KEY, null,
                Map.of("username", username, "password", password));
    }

    /**
     * 创建一个已开通权限组的普通账号，并返回其登录令牌。
     *
     * @param adminToken 管理员令牌
     * @param prefix 用户名前缀
     * @return 账号标识与令牌
     */
    protected MemberSession createMember(String adminToken, String prefix) {
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/accounts", adminToken,
                Map.of("username", unique(prefix), "password", MEMBER_PASSWORD));
        assertThat(created.code()).as("新增账号: %s", created.body()).isEqualTo(200);
        String accountId = created.text("id");
        String username = created.text("username");
        ApiResult login = login(username, MEMBER_PASSWORD);
        assertThat(login.code()).as("成员登录: %s", login.body()).isEqualTo(200);
        ApiResult changed = call(HttpMethod.POST, "/api/v1/auth/initial-password-changes", SELF_APP_KEY,
                login.token(), Map.of("newPassword", "Member@456"));
        assertThat(changed.code()).as("成员首次改密: %s", changed.body()).isEqualTo(200);
        ApiResult again = login(username, "Member@456");
        assertThat(again.code()).as("成员改密后登录: %s", again.body()).isEqualTo(200);
        return new MemberSession(accountId, username, again.token());
    }

    /**
     * 建立带一个可见权限组的应用并返回其凭据。
     *
     * @param adminToken 管理员令牌
     * @param permissionGroupIds 可见权限组
     * @param prefix 应用编码前缀
     * @return 应用信息
     */
    protected AppSession createApplication(String adminToken, java.util.List<String> permissionGroupIds,
            String prefix) {
        String appCode = unique(prefix);
        ApiResult created = appCenter(HttpMethod.POST, "/api/v1/auth/application-authorizations",
                Map.of("appCode", appCode));
        assertThat(created.code()).as("登记应用: %s", created.body()).isEqualTo(200);
        String appId = created.text("id");
        if (permissionGroupIds != null) {
            Map<String, Object> patch = new LinkedHashMap<>();
            patch.put("version", created.text("version"));
            patch.put("permissionGroupIds", permissionGroupIds);
            ApiResult configured = self(HttpMethod.PATCH, "/api/v1/auth/application-authorizations/" + appId,
                    adminToken, patch);
            assertThat(configured.code()).as("配置可见组: %s", configured.body()).isEqualTo(200);
        }
        return new AppSession(appId, appCode, created.text("appKey"));
    }

    /**
     * 登记一个操作。
     *
     * @param appCode 应用编码
     * @param className 类名部分
     * @param methodName 方法名部分
     * @return 操作标识
     */
    protected String registerOperation(String appCode, String className, String methodName) {
        String operationCode = appCode + "." + className + "." + methodName;
        ApiResult created = appCenter(HttpMethod.POST, "/api/v1/auth/operations",
                Map.of("appCode", appCode, "operationCode", operationCode, "operationName", methodName));
        assertThat(created.code()).as("登记操作: %s", created.body()).isEqualTo(200);
        return created.text("id");
    }

    /**
     * 建立权限组。
     *
     * @param adminToken 管理员令牌
     * @param name 名称
     * @param operationIds 操作标识
     * @return 权限组标识
     */
    protected String createPermissionGroup(String adminToken, String name, java.util.List<String> operationIds) {
        ApiResult created = self(HttpMethod.POST, "/api/v1/auth/permission-groups", adminToken,
                Map.of("name", name, "operationIds", operationIds));
        assertThat(created.code()).as("新增权限组: %s", created.body()).isEqualTo(200);
        return created.text("id");
    }

    /**
     * 关联账号与权限组。
     *
     * @param adminToken 管理员令牌
     * @param permissionGroupId 权限组标识
     * @param accountId 账号标识
     */
    protected void linkAccountToGroup(String adminToken, String permissionGroupId, String accountId) {
        ApiResult linked = self(HttpMethod.POST, "/api/v1/auth/account-permission-groups", adminToken,
                Map.of("permissionGroupId", permissionGroupId, "accountId", accountId));
        assertThat(linked.code()).as("用户组关联: %s", linked.body()).isEqualTo(200);
    }

    /**
     * 读取数据库中的单个值。
     *
     * @param sql 查询语句
     * @param type 结果类型
     * @param args 绑定参数
     * @param <T> 结果类型
     * @return 查询结果
     */
    protected <T> T queryOne(String sql, Class<T> type, Object... args) {
        return jdbcTemplate.queryForObject(sql, type, args);
    }

    /**
     * 成员会话。
     *
     * @param accountId 账号标识
     * @param username 用户名
     * @param token 登录令牌
     */
    public record MemberSession(String accountId, String username, String token) {
    }

    /**
     * 应用会话。
     *
     * @param id 授权记录标识
     * @param appCode 应用编码
     * @param appKey 应用密钥
     */
    public record AppSession(String id, String appCode, String appKey) {
    }

    /**
     * 统一响应封装的调用结果。
     *
     * @param status HTTP 状态
     * @param body 原始响应体
     * @param json 解析后的响应体，空响应为 null
     * @param headers 响应头
     */
    public record ApiResult(int status, String body, JsonNode json, org.springframework.http.HttpHeaders headers) {

        /**
         * 响应头中的诊断标识。
         *
         * @return X-Trace-Id 取值
         */
        public String traceHeader() {
            return headers.getFirst("X-Trace-Id");
        }

        /**
         * 缓存控制头。
         *
         * @return Cache-Control 取值
         */
        public String cacheControl() {
            return headers.getFirst("Cache-Control");
        }

        /**
         * 业务码。
         *
         * @return code 字段
         */
        public int code() {
            return json == null ? -1 : json.path("code").asInt(-1);
        }

        /**
         * data 节点。
         *
         * @return data 节点
         */
        public JsonNode data() {
            return json == null ? null : json.path("data");
        }

        /**
         * 读取 data 下的文本字段。
         *
         * @param field 字段名
         * @return 文本值，缺失或为 null 时返回 null
         */
        public String text(String field) {
            JsonNode node = data() == null ? null : data().path(field);
            return node == null || node.isMissingNode() || node.isNull() ? null : node.asString();
        }

        /**
         * 读取 data 下的布尔字段。
         *
         * @param field 字段名
         * @return 布尔值，缺失时为 false
         */
        public boolean booleanField(String field) {
            JsonNode node = data() == null ? null : data().path(field);
            return node != null && node.isBoolean() && node.asBoolean();
        }

        /**
         * 读取 data 下的整数字段。
         *
         * @param field 字段名
         * @return 整数值，缺失时为 0
         */
        public int intField(String field) {
            JsonNode node = data() == null ? null : data().path(field);
            return node == null || !node.isNumber() ? 0 : node.asInt();
        }

        /**
         * 首次登录令牌。
         *
         * @return token 字段
         */
        public String token() {
            return text("token");
        }

        /**
         * 断言业务码，并核对 HTTP 状态与业务码一致（平台公约要求二者对应）。
         *
         * @param expectedCode 期望业务码
         * @return 自身，便于链式读取
         */
        public ApiResult assertCode(int expectedCode) {
            assertThat(code()).as("响应体: %s", body).isEqualTo(expectedCode);
            assertThat(status()).as("HTTP 状态与 code 不一致: %s", body).isEqualTo(httpStatusOf(expectedCode));
            return this;
        }

        /**
         * 平台公约业务码到 HTTP 状态的映射。
         *
         * @param code 业务码
         * @return HTTP 状态
         */
        static int httpStatusOf(int code) {
            return switch (code) {
                case 200 -> 200;
                case 40001 -> 400;
                case 40101, 40102, 40103, 40104 -> 401;
                case 40301, 40302, 40303 -> 403;
                case 40401 -> 404;
                case 40901, 40902, 40903, 40904 -> 409;
                case 50001 -> 500;
                case 50301 -> 503;
                default -> throw new IllegalArgumentException("未定义业务码 " + code);
            };
        }

        /**
         * 读取字段错误列表中的字段名。
         *
         * @return 字段名列表
         */
        public java.util.List<String> fieldErrorNames() {
            JsonNode errors = data() == null ? null : data().path("fieldErrors");
            if (errors == null || !errors.isArray()) {
                return java.util.List.of();
            }
            java.util.List<String> names = new java.util.ArrayList<>();
            errors.values().forEach(item -> names.add(item.path("field").asString()));
            return names;
        }
    }
}
