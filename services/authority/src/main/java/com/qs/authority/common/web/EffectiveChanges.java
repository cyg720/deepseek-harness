package com.qs.authority.common.web;

import com.qs.authority.common.error.BusinessException;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * PATCH 有效变更判定。
 *
 * <p>平台公约要求「提交后没有有效变更返回 40001，不递增版本」。服务在比较完所有可写字段后调用
 * {@link #requireAny(boolean)}：请求只带 version、或提交值与当前值完全相同时拒绝写入，避免空提交
 * 推进版本并让其他编辑者失效。
 */
public final class EffectiveChanges {

    private EffectiveChanges() {
    }

    /**
     * 要求至少存在一处有效变更。
     *
     * @param changed 是否存在与当前值不同的字段
     * @throws BusinessException 没有有效变更时抛出 40001
     */
    public static void requireAny(boolean changed) {
        if (!changed) {
            throw BusinessException.invalidField("body", "提交内容与当前值相同，没有可保存的变更");
        }
    }

    /**
     * 比较两个标量是否不同。
     *
     * @param submitted 提交值，可为 null
     * @param current 当前值，可为 null
     * @return 不同时为 true
     */
    public static boolean differs(Object submitted, Object current) {
        return !Objects.equals(submitted, current);
    }

    /**
     * 比较两个标识集合是否不同；顺序不同不算变更。
     *
     * @param submitted 提交集合，可为 null
     * @param current 当前集合，可为 null
     * @return 元素集合不同时为 true
     */
    public static boolean idSetDiffers(Collection<Long> submitted, Collection<Long> current) {
        return !asSet(submitted).equals(asSet(current));
    }

    /**
     * 比较两个文本序列是否不同；顺序不同算变更。
     *
     * @param submitted 提交序列，可为 null
     * @param current 当前序列，可为 null
     * @return 序列不同时为 true
     */
    public static boolean orderedDiffers(List<String> submitted, List<String> current) {
        return !asList(submitted).equals(asList(current));
    }

    /**
     * 比较两个文本集合是否不同；顺序不同不算变更。
     *
     * @param submitted 提交集合，可为 null
     * @param current 当前集合，可为 null
     * @return 元素集合不同时为 true
     */
    public static boolean textSetDiffers(Collection<String> submitted, Collection<String> current) {
        return !new HashSet<>(asList(submitted)).equals(new HashSet<>(asList(current)));
    }

    private static Set<Long> asSet(Collection<Long> values) {
        return values == null ? Set.of() : new HashSet<>(values);
    }

    private static List<String> asList(Collection<String> values) {
        return values == null ? List.of() : List.copyOf(values);
    }
}
