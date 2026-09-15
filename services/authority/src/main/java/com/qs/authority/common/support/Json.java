package com.qs.authority.common.support;

import java.util.ArrayList;
import java.util.List;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 服务内部使用的 JSON 工具：读取 JSONB 列返回的文本、序列化简单结构。
 *
 * <p>仅用于受信任的库内数据（数据库 JSONB 列、审计脱敏），不用于校验模型输入。
 */
public final class Json {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private Json() {
    }

    /**
     * 读取 JSON 数组中的标量为字符串列表。
     *
     * @param json JSON 文本，可为 null
     * @return 字符串列表；文本为空或不是数组时返回空列表
     */
    public static List<String> stringList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        JsonNode node = MAPPER.readTree(json);
        if (!node.isArray()) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        node.values().forEach(element -> values.add(element.asString()));
        return values;
    }

    /**
     * 读取 JSON 数组中的整数为长整型列表。
     *
     * @param json JSON 文本，可为 null
     * @return 长整型列表；文本为空或不是数组时返回空列表
     */
    public static List<Long> longList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        JsonNode node = MAPPER.readTree(json);
        if (!node.isArray()) {
            return List.of();
        }
        List<Long> values = new ArrayList<>();
        node.values().forEach(element -> values.add(element.asLong()));
        return values;
    }

    /**
     * 解析 JSON 文本。
     *
     * @param json JSON 文本
     * @return 解析结果树
     */
    public static JsonNode readTree(String json) {
        return MAPPER.readTree(json);
    }

    /**
     * 解析 JSON 文本为对象。
     *
     * @param json JSON 文本
     * @param type 目标类型引用
     * @param <T> 目标类型
     * @return 解析结果
     */
    public static <T> T read(String json, TypeReference<T> type) {
        return MAPPER.readValue(json, type);
    }

    /**
     * 序列化为 JSON 文本。
     *
     * @param value 任意对象
     * @return JSON 文本
     */
    public static String write(Object value) {
        return MAPPER.writeValueAsString(value);
    }
}
