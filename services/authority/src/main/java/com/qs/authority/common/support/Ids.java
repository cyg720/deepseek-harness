package com.qs.authority.common.support;

import com.qs.authority.common.error.BusinessException;

/**
 * 数据库 BIGINT 标识与 version 的十进制字符串转换。
 *
 * <p>按平台公约，标识符与 version 以字符串传输，避免浏览器丢失精度；分页数字与业务 code
 * 仍使用 JSON 整数。
 */
public final class Ids {

    private Ids() {
    }

    /**
     * 标识转传输字符串。
     *
     * @param id 数据库标识
     * @return 十进制字符串；入参为 null 时返回 null
     */
    public static String of(Long id) {
        return id == null ? null : Long.toString(id);
    }

    /**
     * 解析路径或请求体中的标识。
     *
     * @param text 十进制字符串
     * @param field 字段名，用于 40001 错误定位
     * @return 标识；文本为 null 时返回 null
     * @throws BusinessException 文本不是十进制整数时抛出 40001
     */
    public static Long parse(String text, String field) {
        if (text == null) {
            return null;
        }
        String trimmed = text.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        try {
            return Long.valueOf(trimmed);
        } catch (NumberFormatException exception) {
            throw BusinessException.invalidField(field, "请输入整数标识");
        }
    }

    /**
     * 解析必填标识。
     *
     * @param text 十进制字符串
     * @param field 字段名
     * @return 标识
     * @throws BusinessException 缺失或非法时抛出 40001
     */
    public static long require(String text, String field) {
        Long value = parse(text, field);
        if (value == null) {
            throw BusinessException.invalidField(field, "请输入整数标识");
        }
        return value;
    }
}
