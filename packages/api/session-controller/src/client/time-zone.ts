/**
 * ================================ 文件注释 ================================
 * 【文件职责】从浏览器解析当前时区（IANA 名称），供提示词（prompt）的
 *   RPC 溯源（provenance）使用。
 * 【技术维度】利用内置 Intl.DateTimeFormat 的 resolvedOptions 读取
 *   浏览器所在时区；运行时校验返回值非空。
 * 【产品维度】请求带上来时区，Host 侧才能按用户本地时区解释时间相关的
 *   指令与展示，避免跨时区误解。
 * 【逻辑维度】单函数：取时区 -> 校验非空 -> 返回或抛错。
 * 【关键边界】浏览器无法提供非空时区时直接抛错（fail loud），不做兜底。
 * 【新手阅读建议】无需前置知识，理解 Intl 的 resolvedOptions 即可。
 * ==========================================================================
 */
/** Browser-owned time-zone sampling for prompt RPC provenance. */
/* 浏览器侧时区采样：为 prompt 的 RPC 溯源提供 IANA 时区。 */

/**
 * Resolve the current browser IANA zone for one outbound operation.
 * @returns The browser-provided canonical zone.
 * @throws when the runtime cannot provide a non-empty zone.
 */
/*
 * 解析当前浏览器的 IANA 时区（如 'Asia/Shanghai'），供一次出站操作使用。
 * @returns 浏览器提供的规范时区字符串。
 * @throws 运行时无法提供非空时区时抛出。
 */
export function resolvedClientTimeZone(): string {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone // 浏览器默认时区的 IANA 名称
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new Error('browser time zone is unavailable')
  }
  return timeZone
}
