package com.qs.authority.docs;

import static org.assertj.core.api.Assertions.assertThat;

import com.qs.authority.support.AbstractAuthorityTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/**
 * 接口文档可用性验收：OpenAPI 描述覆盖全部接口组，Swagger UI 与 Knife4j UI 均可访问。
 *
 * <p>文档路径不在 {@code /api/v1/auth} 下，因此不需要应用身份或用户令牌。
 */
@DisplayName("接口文档：OpenAPI、Swagger UI 与 Knife4j")
class OpenApiDocsIT extends AbstractAuthorityTest {

    @Test
    @DisplayName("OpenAPI 描述包含全部接口组与统一响应约定")
    void openApiDescriptionCoversAllGroups() {
        ApiResult result = call(HttpMethod.GET, "/v3/api-docs", null, null, null);
        assertThat(result.status()).isEqualTo(200);
        JsonNode paths = result.json().path("paths");
        for (String path : new String[] {"/api/v1/auth/accounts", "/api/v1/auth/organizations",
                "/api/v1/auth/user-groups", "/api/v1/auth/parameters", "/api/v1/auth/dictionaries",
                "/api/v1/auth/operations", "/api/v1/auth/permission-groups",
                "/api/v1/auth/account-permission-groups", "/api/v1/auth/organization-permission-groups",
                "/api/v1/auth/application-authorizations", "/api/v1/auth/authorization-checks",
                "/api/v1/auth/audit-logs", "/api/v1/auth/users/me", "/api/v1/auth/sessions/login",
                "/api/v1/auth/sessions/renew", "/api/v1/auth/sessions/logout", "/api/v1/auth/scene-tokens",
                "/api/v1/auth/password-changes", "/api/v1/auth/initial-password-changes"}) {
            assertThat(paths.has(path)).as("OpenAPI 缺少路径 %s", path).isTrue();
        }
        assertThat(result.body()).contains("X-App-Key");
        assertThat(result.json().path("info").path("title").asString()).contains("授权中心");
    }

    @Test
    @DisplayName("Swagger UI 与 Knife4j 界面及其静态资源可访问")
    void userInterfacesAreServed() {
        assertThat(call(HttpMethod.GET, "/swagger-ui/index.html", null, null, null).status()).isEqualTo(200);
        ApiResult knife4j = call(HttpMethod.GET, "/doc.html", null, null, null);
        assertThat(knife4j.status()).isEqualTo(200);
        assertThat(knife4j.body().toLowerCase(java.util.Locale.ROOT)).contains("knife4j");
        assertThat(knife4j.body()).contains("webjars/js/app");
        assertThat(call(HttpMethod.GET, "/v3/api-docs/swagger-config", null, null, null).status()).isEqualTo(200);
    }
}
