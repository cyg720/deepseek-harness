package com.qs.authority.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 接口文档配置。
 *
 * <p>文档由 springdoc 生成 OpenAPI 3.1：Swagger UI 位于 {@code /swagger-ui.html}，
 * Knife4j UI 位于 {@code /doc.html}。Knife4j 只使用其静态界面，不使用其 starter，
 * 因为 knife4j 4.5.0 的 starter 固定依赖面向 Spring Boot 3 的 springdoc 2.x。
 */
@Configuration
public class OpenApiConfig {

    /**
     * 授权中心接口文档定义。
     *
     * @return OpenAPI 描述
     */
    @Bean
    public OpenAPI authorityOpenApi() {
        SecurityScheme appKey = new SecurityScheme()
                .type(SecurityScheme.Type.APIKEY)
                .in(SecurityScheme.In.HEADER)
                .name("X-App-Key")
                .description("调用应用身份；未知或非生效状态的应用被拒绝");
        SecurityScheme bearer = new SecurityScheme()
                .type(SecurityScheme.Type.HTTP)
                .scheme("bearer")
                .description("当前登录人 token；登录接口不需要");
        return new OpenAPI()
                .info(new Info()
                        .title("授权中心接口")
                        .version("0.4.2")
                        .description("账号、组织、用户组、权限组、应用授权、令牌与会话、审计日志；"
                                + "统一响应 {code,message,data}，标识与 version 使用十进制字符串"))
                .servers(List.of(new Server().url("/").description("当前服务")))
                .components(new Components().addSecuritySchemes("AppKey", appKey).addSecuritySchemes("Bearer", bearer));
    }
}
