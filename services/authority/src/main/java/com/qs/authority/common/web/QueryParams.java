package com.qs.authority.common.web;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorData.FieldErrorItem;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 查询参数白名单校验。
 *
 * <p>各列表接口只接受第五章公布的筛选项；未支持的筛选或排序字段返回 40001，不静默忽略，
 * 也不把用户给出的字段名拼进 SQL。
 */
public final class QueryParams {

    private QueryParams() {
    }

    /**
     * 校验请求只包含允许的查询参数。
     *
     * @param request 当前请求
     * @param allowed 允许的参数名
     * @throws BusinessException 存在未支持参数时抛出 40001
     */
    public static void assertOnly(HttpServletRequest request, Set<String> allowed) {
        List<FieldErrorItem> errors = new ArrayList<>();
        request.getParameterMap().keySet().stream()
                .filter(name -> !allowed.contains(name))
                .forEach(name -> errors.add(new FieldErrorItem(name, "不支持的查询参数")));
        if (!errors.isEmpty()) {
            throw BusinessException.invalidFields(errors);
        }
    }

    /**
     * 校验当前线程绑定请求只包含允许的查询参数。
     *
     * @param allowed 允许的参数名
     * @throws BusinessException 存在未支持参数时抛出 40001
     */
    public static void assertOnlyCurrent(Set<String> allowed) {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            assertOnly(attributes.getRequest(), allowed);
        }
    }

    /**
     * 校验枚举型筛选值。
     *
     * @param field 参数名
     * @param value 参数值，可为 null
     * @param allowedValues 允许的取值
     * @return 规范化后的取值；入参为空时返回 null
     * @throws BusinessException 取值不在允许集合内时抛出 40001
     */
    public static String enumValue(String field, String value, Set<String> allowedValues) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        if (!allowedValues.contains(trimmed)) {
            throw BusinessException.invalidField(field, "不支持的筛选值");
        }
        return trimmed;
    }
}
