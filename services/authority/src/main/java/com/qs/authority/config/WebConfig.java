package com.qs.authority.config;

import com.qs.authority.modules.audit.AuditInterceptor;
import com.qs.authority.security.AuthenticationInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web 层装配：注册审计与认证拦截器。
 *
 * <p>审计拦截器必须在认证拦截器之前注册：认证失败时也要留下“拒绝”事件，而
 * {@code afterCompletion} 只对已经成功执行 {@code preHandle} 的拦截器回调。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final String API_PATTERN = "/api/v1/auth/**";

    private final AuditInterceptor auditInterceptor;
    private final AuthenticationInterceptor authenticationInterceptor;

    /**
     * 构造 Web 配置。
     *
     * @param auditInterceptor 审计拦截器
     * @param authenticationInterceptor 认证拦截器
     */
    public WebConfig(AuditInterceptor auditInterceptor, AuthenticationInterceptor authenticationInterceptor) {
        this.auditInterceptor = auditInterceptor;
        this.authenticationInterceptor = authenticationInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(auditInterceptor).addPathPatterns(API_PATTERN).order(0);
        registry.addInterceptor(authenticationInterceptor).addPathPatterns(API_PATTERN).order(1);
    }
}
