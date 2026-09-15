package com.qs.authority.support;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.test.context.DynamicPropertyRegistry;

/**
 * 测试库准备：在本地 Docker PostgreSQL 上建立独立的 {@code qs_auth_test} 库，并在每个测试
 * 上下文启动前重置 public schema，使 Flyway 从零建表。
 *
 * <p>连接参数取自环境变量（{@code AUTH_DB_PASSWORD} 必需，其余有默认值）。Docker 数据库不可用时
 * 测试整体跳过，而不是用别的库顶替。
 */
public final class TestDatabase {

    private static final Logger LOG = LoggerFactory.getLogger(TestDatabase.class);

    private static final String HOST = System.getenv().getOrDefault("AUTH_DB_HOST", "127.0.0.1");
    private static final String PORT = System.getenv().getOrDefault("AUTH_DB_PORT", "5432");
    private static final String USER = System.getenv().getOrDefault("AUTH_DB_USER", "qs");
    private static final String PASSWORD = System.getenv().getOrDefault("AUTH_DB_PASSWORD", "");
    private static final String ADMIN_DATABASE = System.getenv().getOrDefault("AUTH_DB_ADMIN_DATABASE", "postgres");
    private static final String TEST_DATABASE = System.getenv().getOrDefault("AUTH_TEST_DB_NAME", "qs_auth_test");

    private static Boolean available;

    private TestDatabase() {
    }

    /**
     * 本地测试库是否可用；缺少口令或端口不通时为 false。
     *
     * @return 可用时为 true
     */
    public static synchronized boolean available() {
        if (available != null) {
            return available;
        }
        if (PASSWORD.isBlank()) {
            LOG.warn("未设置 AUTH_DB_PASSWORD，跳过需要本地 PostgreSQL 的测试");
            available = false;
            return false;
        }
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(HOST, Integer.parseInt(PORT)), 1500);
            available = true;
        } catch (Exception exception) {
            LOG.warn("本地 PostgreSQL 不可达（{}:{}），跳过相关测试", HOST, PORT, exception);
            available = false;
        }
        return available;
    }

    /**
     * 建立测试库并重置 schema，随后把数据源指向该库。
     *
     * @param registry 动态属性注册表
     */
    public static synchronized void prepare(DynamicPropertyRegistry registry) {
        if (!available()) {
            // 没有本地数据库时让上下文仍能启动：不迁移、不提前建立连接，用例由基类逐个跳过。
            registry.add("spring.flyway.enabled", () -> "false");
            registry.add("spring.datasource.hikari.initialization-fail-timeout", () -> "-1");
            registry.add("spring.datasource.hikari.minimum-idle", () -> "0");
            // 初始化引导在启动期读取数据库，没有数据库时一并关闭。
            registry.add("authority.bootstrap.enabled", () -> "false");
            return;
        }
        createDatabaseIfAbsent();
        resetSchema();
        registry.add("spring.datasource.url",
                () -> "jdbc:postgresql://" + HOST + ":" + PORT + "/" + TEST_DATABASE);
        registry.add("spring.datasource.username", () -> USER);
        registry.add("spring.datasource.password", () -> PASSWORD);
    }

    private static void createDatabaseIfAbsent() {
        String adminUrl = "jdbc:postgresql://" + HOST + ":" + PORT + "/" + ADMIN_DATABASE;
        try (Connection connection = DriverManager.getConnection(adminUrl, USER, PASSWORD);
                Statement statement = connection.createStatement()) {
            try (ResultSet result = statement.executeQuery(
                    "SELECT 1 FROM pg_database WHERE datname = '" + TEST_DATABASE + "'")) {
                if (result.next()) {
                    return;
                }
            }
            statement.execute("CREATE DATABASE " + TEST_DATABASE);
            LOG.info("已建立测试库 {}", TEST_DATABASE);
        } catch (SQLException exception) {
            throw new IllegalStateException("无法建立测试库 " + TEST_DATABASE, exception);
        }
    }

    private static void resetSchema() {
        String url = "jdbc:postgresql://" + HOST + ":" + PORT + "/" + TEST_DATABASE;
        try (Connection connection = DriverManager.getConnection(url, USER, PASSWORD);
                Statement statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS public CASCADE");
            statement.execute("CREATE SCHEMA public");
        } catch (SQLException exception) {
            throw new IllegalStateException("无法重置测试库 schema", exception);
        }
    }
}
