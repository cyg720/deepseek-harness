package com.qs.authority.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * 缓存授权中心接口的请求与响应正文，供审计脱敏后落库。
 *
 * <p>只缓存 {@code /api/v1/auth/**}：其他路径（文档、静态资源）不进入审计，也就不需要缓冲。
 * 缓存响应后必须回写正文，否则客户端收不到内容。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class AuditBodyCachingFilter extends OncePerRequestFilter {

    private static final String API_PREFIX = "/api/v1/auth/";

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(API_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        ContentCachingRequestWrapper cachedRequest = new ContentCachingRequestWrapper(request, 8192);
        ContentCachingResponseWrapper cachedResponse = new ContentCachingResponseWrapper(response);
        try {
            chain.doFilter(cachedRequest, cachedResponse);
        } finally {
            cachedResponse.copyBodyToResponse();
        }
    }
}
