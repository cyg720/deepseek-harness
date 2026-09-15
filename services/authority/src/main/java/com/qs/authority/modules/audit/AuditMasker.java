package com.qs.authority.modules.audit;

import com.qs.authority.common.support.Json;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;

/**
 * 审计内容脱敏：口令、令牌、应用密钥一律替换为占位符，且不记录超长内容。
 *
 * <p>脱敏发生在写入前，日志表、日志接口与下游导出都不会出现凭据原文。无法按 JSON 解析（包括被
 * 缓存上限截断）的正文不做任何猜测，直接记为省略：宁可缺少正文，也不能把口令或令牌原文写进库。
 */
@Component
public class AuditMasker {

    /** 需要脱敏的字段名（忽略大小写）。 */
    private static final Set<String> SENSITIVE_KEYS = Set.of("password", "oldpassword", "newpassword",
            "initialpassword", "token", "refreshtoken", "appsecret", "appkey", "authorization", "secret",
            "clientsecret");

    /** 单个字段最大长度，超出部分截断。 */
    private static final int MAX_LENGTH = 4096;

    private static final String MASK = "***";

    /** 无法安全解析的正文占位；该字段值不参与任何业务判断。 */
    private static final String OMITTED = "(正文无法安全解析，已省略)";

    /**
     * 脱敏 JSON 文本。
     *
     * @param body 请求或响应体，可为 null
     * @return 脱敏并截断后的文本；非 JSON 内容原样截断
     */
    public String mask(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            Map<String, Object> parsed = Json.read(body, new TypeReference<Map<String, Object>>() {
            });
            return truncate(Json.write(maskMap(parsed)));
        } catch (RuntimeException exception) {
            // 解析失败：可能是报文损坏、根节点不是对象、或正文超过请求缓存上限被截断。
            // 这些情况无法判断哪些字段是凭据，因此整体省略，绝不落原文。
            return OMITTED;
        }
    }

    /**
     * 截断超长文本到审计正文的通用上限。
     *
     * @param value 文本，可为 null
     * @return 截断后的文本
     */
    public String truncate(String value) {
        return truncate(value, MAX_LENGTH);
    }

    /**
     * 按目标列长度截断文本。
     *
     * @param value 文本，可为 null
     * @param maxLength 目标列允许的最大字符数
     * @return 截断后的文本
     */
    public String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    /**
     * 脱敏原因、错误提示等短文本，避免把凭据写进 reason 列。
     *
     * @param value 文本，可为 null
     * @return 截断到 512 字符的文本
     */
    public String truncateReason(String value) {
        if (value == null) {
            return null;
        }
        String masked = value;
        for (String key : SENSITIVE_KEYS) {
            if (masked.toLowerCase(Locale.ROOT).contains(key)) {
                masked = MASK;
                break;
            }
        }
        return masked.length() <= 512 ? masked : masked.substring(0, 512);
    }

    @SuppressWarnings("unchecked")
    private Object maskValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return maskMap((Map<String, Object>) map);
        }
        if (value instanceof List<?> list) {
            List<Object> masked = new ArrayList<>(list.size());
            list.forEach(element -> masked.add(maskValue(element)));
            return masked;
        }
        return value;
    }

    private Map<String, Object> maskMap(Map<String, Object> source) {
        Map<String, Object> masked = new LinkedHashMap<>();
        source.forEach((key, value) -> {
            if (key != null && SENSITIVE_KEYS.contains(key.toLowerCase(Locale.ROOT))) {
                masked.put(key, MASK);
            } else {
                masked.put(key, maskValue(value));
            }
        });
        return masked;
    }
}
