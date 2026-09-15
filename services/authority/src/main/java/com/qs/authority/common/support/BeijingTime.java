package com.qs.authority.common.support;

import com.qs.authority.common.error.BusinessException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * 北京时间处理：接口与数据库统一使用 {@code YYYY-MM-DD HH:mm:ss} 秒精度。
 *
 * <p>数据库列以“北京时间挂钟时间”存储 {@code TIMESTAMP(0)}，因此读写都不做时区换算。
 */
public final class BeijingTime {

    /** 统一时区：北京时间。 */
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private BeijingTime() {
    }

    /**
     * 当前北京时间。
     *
     * @return 秒精度的北京时间
     */
    public static LocalDateTime now() {
        return LocalDateTime.now(ZONE).withNano(0);
    }

    /**
     * 格式化时间为平台公约格式。
     *
     * @param value 时间，可为 null
     * @return 格式化文本；入参为 null 时返回 null
     */
    public static String format(LocalDateTime value) {
        return value == null ? null : FORMATTER.format(value);
    }

    /**
     * 按平台公约格式解析时间。
     *
     * @param text 时间文本
     * @param field 字段名，用于 40001 错误定位
     * @return 解析结果
     * @throws BusinessException 文本为空或格式不为 YYYY-MM-DD HH:mm:ss 时抛出 40001
     */
    public static LocalDateTime parse(String text, String field) {
        if (text == null || text.isBlank()) {
            throw BusinessException.invalidField(field, "请输入 YYYY-MM-DD HH:mm:ss 格式的时间");
        }
        try {
            return LocalDateTime.parse(text.trim(), FORMATTER);
        } catch (DateTimeParseException exception) {
            throw BusinessException.invalidField(field, "请输入 YYYY-MM-DD HH:mm:ss 格式的时间");
        }
    }
}
