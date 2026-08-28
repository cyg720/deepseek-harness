/*
 * ================================ 文件注释 ================================
 * 【文件职责】把服务端权威顺序（baseline）合并进客户端已有顺序：不移动
 *   客户端已可见实体的位置，插入 baseline 新增实体，移除 baseline 缺失实体。
 * 【技术维度】纯函数；按稳定身份键（keyOf）对齐两个列表，保持已有相对
 *   顺序，新实体插到最近的后继已知实体之前。
 * 【产品维度】会话/工作区等列表需要"权威数据刷新"与"本地顺序稳定"兼得：
 *   刷新时不应让已显示的行跳动。
 * 【逻辑维度】baseline 建立键->值索引；先沿当前顺序映射并过滤缺失项；
 *   再遍历 baseline，把缺失实体插到其后第一个已知实体的位置。
 * 【关键边界】重复键会被合并去重；两处 v8 ignore 守卫假定数组无空洞；
 *   返回值与 baseline 等值，但顺序以 current 的相对顺序为准。
 * 【新手阅读建议】关注 merged 的两次构建（映射过滤 + 插入）即可理解全貌。
 * ==========================================================================
 */
/**
 * Merge an authoritative baseline without moving identities already visible to
 * the client. Baseline-only identities are inserted relative to the nearest
 * following known identity; identities absent from the baseline are removed.
 *
 * @param current - the established client order.
 * @param baseline - the latest authoritative rows.
 * @param keyOf - stable identity selector.
 * @returns baseline-valued rows with the established relative order retained.
 */
/*
 * 合并权威基线：不移动客户端已可见实体的身份。仅基线中的实体按"最近的后继
 * 已知实体"插入；基线缺失的实体被移除。
 * @param current 客户端已建立的顺序（旧列表）。
 * @param baseline 最新的权威数据行。
 * @param keyOf 稳定的身份选择函数（返回唯一键）。
 * @returns 取基线值、但保持既有相对顺序的合并结果。
 */
export function mergeOrderedBaseline<T>(
  current: readonly T[],
  baseline: readonly T[],
  keyOf: (value: T) => unknown,
): T[] {
  const baselineByKey = new Map<unknown, T>() // 键 -> baseline 值的索引，便于按身份取最新行
  for (const value of baseline) baselineByKey.set(keyOf(value), value)

  const merged = current
    .map(value => baselineByKey.get(keyOf(value))) // 沿旧顺序取 baseline 中的最新值
    .filter((value): value is T => value !== undefined) // 丢弃基线中已不存在的实体
  const mergedKeys = new Set(merged.map(keyOf)) // 已合并身份的集合，用于判重

  for (let index = 0; index < baseline.length; index++) {
    const value = baseline[index]
    /* v8 ignore next -- dense-array guard: index is bounded by baseline.length. */
    if (value === undefined || mergedKeys.has(keyOf(value))) continue
    let insertion = merged.length // 默认插到末尾
    for (let following = index + 1; following < baseline.length; following++) {
      const candidate = baseline[following]
      /* v8 ignore next -- dense-array guard: following is bounded by baseline.length. */
      if (candidate === undefined) continue
      const known = merged.findIndex(item => keyOf(item) === keyOf(candidate))
      if (known !== -1) {
        insertion = known // 找到最近的后继已知实体，插到它前面
        break
      }
    }
    merged.splice(insertion, 0, value)
    mergedKeys.add(keyOf(value))
  }
  return merged
}
