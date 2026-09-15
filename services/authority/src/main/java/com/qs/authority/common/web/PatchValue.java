package com.qs.authority.common.web;

/**
 * PATCH 字段的三态载体：未提交、提交为 null、提交为具体值。
 *
 * <p>Mapper 以 {@code value != null and value.present} 判断是否写入该列，因此显式 null
 * 也能生成 {@code column = NULL}。
 *
 * @param present 请求是否提交了该字段
 * @param value 字段值；显式 null 时 present 为 true 且 value 为 null
 * @param <T> 字段类型
 */
public final class PatchValue<T> {

    private static final PatchValue<?> ABSENT = new PatchValue<>(false, null);

    private final boolean present;
    private final T value;

    private PatchValue(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    /**
     * 未提交该字段。
     *
     * @param <T> 字段类型
     * @return 未提交载体
     */
    @SuppressWarnings("unchecked")
    public static <T> PatchValue<T> absent() {
        return (PatchValue<T>) ABSENT;
    }

    /**
     * 已提交该字段。
     *
     * @param value 字段值，可为 null 表示清空
     * @param <T> 字段类型
     * @return 已提交载体
     */
    public static <T> PatchValue<T> of(T value) {
        return new PatchValue<>(true, value);
    }

    /**
     * 是否提交了该字段。
     *
     * @return 提交为 true
     */
    public boolean isPresent() {
        return present;
    }

    /**
     * 字段值。
     *
     * @return 字段值，可能为 null
     */
    public T getValue() {
        return value;
    }
}
