package com.qs.authority.common.web;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorData.FieldErrorItem;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/**
 * PATCH 请求体解析器，实现平台公约的“漏填保持、null 清空、空串统一按空白处理”规则。
 *
 * <p>使用 {@code Map<String, JsonNode>} 而不是实体绑定，是为了区分“未提交”和“显式 null”；
 * 调用方必须先用 {@link #rejectUnknown(Collection)} 声明可写字段集合，未知字段与只读字段
 * 一律 40001，不忽略。
 */
public final class PatchBody {

    private final Map<String, JsonNode> fields;

    private PatchBody(Map<String, JsonNode> fields) {
        this.fields = fields;
    }

    /**
     * 包装已解析的请求体。
     *
     * @param raw 请求体字段；null 视为空请求体
     * @return 解析器
     */
    public static PatchBody of(Map<String, JsonNode> raw) {
        return new PatchBody(raw == null ? Map.of() : raw);
    }

    /**
     * 拒绝未声明为可写的字段。
     *
     * @param allowed 允许写入的字段名
     * @throws BusinessException 存在未知或只读字段时抛出 40001，并列出全部字段错误
     */
    public void rejectUnknown(Collection<String> allowed) {
        List<FieldErrorItem> errors = new ArrayList<>();
        for (String field : fields.keySet()) {
            if (!allowed.contains(field)) {
                errors.add(new FieldErrorItem(field, "未知字段或只读字段，不允许提交"));
            }
        }
        if (!errors.isEmpty()) {
            throw BusinessException.invalidFields(errors);
        }
    }

    /**
     * 请求体是否提交了除 version 之外的字段。
     *
     * @return 存在其他字段时为 true
     */
    public boolean hasBusinessField() {
        return fields.keySet().stream().anyMatch(key -> !"version".equals(key));
    }

    /**
     * 读取必填的 version。
     *
     * @return 版本号
     * @throws BusinessException 缺失或非法时抛出 40001
     */
    public long requireVersion() {
        JsonNode node = fields.get("version");
        if (node == null || node.isNull()) {
            throw BusinessException.invalidField("version", "编辑必须提交读取时的 version");
        }
        Long value = toLong("version", node);
        if (value == null || value < 1) {
            throw BusinessException.invalidField("version", "请输入大于 0 的整数 version");
        }
        return value;
    }

    /**
     * 读取可选文本字段。
     *
     * @param field 字段名
     * @param required 该字段是否为必填
     * @param maxLength 最大长度
     * @return 三态字段值；空白文本按平台公约统一视为清空
     * @throws BusinessException 类型错误、必填为空或超长时抛出 40001
     */
    public PatchValue<String> text(String field, boolean required, int maxLength) {
        if (!fields.containsKey(field)) {
            return PatchValue.absent();
        }
        JsonNode node = fields.get(field);
        if (node == null || node.isNull()) {
            return nullOrReject(field, required);
        }
        if (!node.isString()) {
            throw BusinessException.invalidField(field, "请输入文本");
        }
        String value = node.asString();
        if (value.isBlank()) {
            return nullOrReject(field, required);
        }
        if (value.length() > maxLength) {
            throw BusinessException.invalidField(field, "长度不能超过 " + maxLength + " 个字符");
        }
        return PatchValue.of(value);
    }

    /**
     * 读取可选标识字段，接受十进制字符串或整数。
     *
     * @param field 字段名
     * @param required 该字段是否为必填
     * @return 三态字段值
     * @throws BusinessException 类型错误、非正整数或必填为空时抛出 40001
     */
    public PatchValue<Long> id(String field, boolean required) {
        if (!fields.containsKey(field)) {
            return PatchValue.absent();
        }
        JsonNode node = fields.get(field);
        if (node == null || node.isNull()) {
            return nullOrReject(field, required);
        }
        Long value = toLong(field, node);
        if (value == null || value <= 0) {
            throw BusinessException.invalidField(field, "请输入正整数标识");
        }
        return PatchValue.of(value);
    }

    /**
     * 读取可选整数字段。
     *
     * @param field 字段名
     * @param required 该字段是否为必填
     * @param min 允许的最小值，可为 null
     * @param max 允许的最大值，可为 null
     * @return 三态字段值
     * @throws BusinessException 类型错误、越界或必填为空时抛出 40001
     */
    public PatchValue<Integer> integer(String field, boolean required, Integer min, Integer max) {
        if (!fields.containsKey(field)) {
            return PatchValue.absent();
        }
        JsonNode node = fields.get(field);
        if (node == null || node.isNull()) {
            return nullOrReject(field, required);
        }
        Long value = toLong(field, node);
        if (value == null) {
            throw BusinessException.invalidField(field, "请输入整数");
        }
        if (min != null && value < min || max != null && value > max) {
            throw BusinessException.invalidField(field, "超出允许范围");
        }
        return PatchValue.of(value.intValue());
    }

    /**
     * 读取可选布尔字段。
     *
     * @param field 字段名
     * @param required 该字段是否为必填
     * @return 三态字段值
     * @throws BusinessException 类型错误或必填为空时抛出 40001
     */
    public PatchValue<Boolean> bool(String field, boolean required) {
        if (!fields.containsKey(field)) {
            return PatchValue.absent();
        }
        JsonNode node = fields.get(field);
        if (node == null || node.isNull()) {
            return nullOrReject(field, required);
        }
        if (!node.isBoolean()) {
            throw BusinessException.invalidField(field, "请输入布尔值");
        }
        return PatchValue.of(node.asBoolean());
    }

    /**
     * 读取标识集合字段，提交即整体替换。
     *
     * @param field 字段名
     * @param required 该字段是否必填；必填时 null 拒绝，空数组仍表示清空
     * @param rejectDuplicates 是否拒绝重复元素
     * @return 三态字段值，值包含解析后的标识与写入 JSONB 的文本
     * @throws BusinessException 类型错误或元素非法时抛出 40001
     */
    public PatchValue<IdArray> idArray(String field, boolean required, boolean rejectDuplicates) {
        if (!fields.containsKey(field)) {
            return PatchValue.absent();
        }
        JsonNode node = fields.get(field);
        if (node == null || node.isNull()) {
            return nullOrReject(field, required);
        }
        if (!node.isArray()) {
            throw BusinessException.invalidField(field, "请输入数组");
        }
        List<Long> values = new ArrayList<>();
        Set<Long> distinct = new LinkedHashSet<>();
        for (JsonNode element : node.values()) {
            Long value = toLong(field, element);
            if (value == null || value <= 0) {
                throw BusinessException.invalidField(field, "数组元素必须是正整数标识");
            }
            if (!distinct.add(value) && rejectDuplicates) {
                throw BusinessException.invalidField(field, "数组元素不能重复");
            }
            if (distinct.contains(value) && distinct.size() > values.size()) {
                values.add(value);
            }
        }
        return PatchValue.of(new IdArray(values, IdArray.toJson(values)));
    }

    /**
     * 读取文本集合字段，提交即整体替换。
     *
     * @param field 字段名
     * @param required 该字段是否必填
     * @param rejectDuplicates 是否拒绝重复元素
     * @param maxElementLength 元素最大长度
     * @return 三态字段值，值包含解析后的文本与写入 JSONB 的文本
     * @throws BusinessException 类型错误或元素非法时抛出 40001
     */
    public PatchValue<StringArray> stringArray(String field, boolean required, boolean rejectDuplicates,
            int maxElementLength) {
        if (!fields.containsKey(field)) {
            return PatchValue.absent();
        }
        JsonNode node = fields.get(field);
        if (node == null || node.isNull()) {
            return nullOrReject(field, required);
        }
        if (!node.isArray()) {
            throw BusinessException.invalidField(field, "请输入数组");
        }
        List<String> values = new ArrayList<>();
        for (JsonNode element : node.values()) {
            if (!element.isString() || element.asString().isBlank()) {
                throw BusinessException.invalidField(field, "数组元素必须是非空文本");
            }
            String value = element.asString();
            if (value.length() > maxElementLength) {
                throw BusinessException.invalidField(field, "数组元素长度不能超过 " + maxElementLength + " 个字符");
            }
            if (values.contains(value) && rejectDuplicates) {
                throw BusinessException.invalidField(field, "数组元素不能重复");
            }
            values.add(value);
        }
        return PatchValue.of(new StringArray(values, StringArray.toJson(values)));
    }

    private <T> PatchValue<T> nullOrReject(String field, boolean required) {
        if (required) {
            throw BusinessException.invalidField(field, "该字段不能为空");
        }
        return PatchValue.of(null);
    }

    private Long toLong(String field, JsonNode node) {
        if (node.isIntegralNumber()) {
            return node.asLong();
        }
        if (node.isString()) {
            try {
                return Long.valueOf(node.asString().trim());
            } catch (NumberFormatException exception) {
                throw BusinessException.invalidField(field, "请输入整数");
            }
        }
        throw BusinessException.invalidField(field, "请输入整数");
    }

    /**
     * 标识集合的解析结果。
     *
     * @param ids 标识列表
     * @param json 写入 JSONB 列的文本
     */
    public record IdArray(List<Long> ids, String json) {

        /**
         * 生成 JSONB 文本。
         *
         * @param ids 标识列表
         * @return JSON 数组文本
         */
        public static String toJson(List<Long> ids) {
            StringBuilder builder = new StringBuilder("[");
            for (int index = 0; index < ids.size(); index++) {
                if (index > 0) {
                    builder.append(',');
                }
                builder.append(ids.get(index));
            }
            return builder.append(']').toString();
        }
    }

    /**
     * 文本集合的解析结果。
     *
     * @param values 文本列表
     * @param json 写入 JSONB 列的文本
     */
    public record StringArray(List<String> values, String json) {

        /**
         * 生成 JSONB 文本。
         *
         * @param values 文本列表
         * @return JSON 数组文本
         */
        public static String toJson(List<String> values) {
            StringBuilder builder = new StringBuilder("[");
            for (int index = 0; index < values.size(); index++) {
                if (index > 0) {
                    builder.append(',');
                }
                builder.append('"').append(values.get(index).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
            }
            return builder.append(']').toString();
        }
    }
}
