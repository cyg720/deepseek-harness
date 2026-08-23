/**
 * ================================ 文件注释 ================================
 * 【文件职责】把会话事件中保存的失败信息（failure）转换成可安全展示在
 *   客户端 GUI 上的字符串，避免把敏感诊断原样暴露给用户界面。
 * 【技术维度】纯函数工具：对 unknown 输入做类型收窄（null/非对象/对象），
 *   按 code 字段识别提供商鉴权错误并替换为固定文案。
 * 【产品维度】用户界面需要友好、安全的错误提示；API Key 类鉴权失败时，
 *   不能把可能回显凭据的原始信息投递到 UI 状态，日志中仍保留完整诊断。
 * 【逻辑维度】非对象直接字符串化；code 为 'AUTH' 时返回固定文案
 *   'API key is invalid'；否则优先取 message 字段，缺失时 JSON 序列化兜底。
 * 【关键边界】'AUTH' 判定依赖 code 字段精确等于该字符串；本函数只负责
 *   展示层的脱敏，原始失败值仍完整保留在会话日志中。
 * 【新手阅读建议】结合 sessions/projection-store.ts 等投影层了解调用时机。
 * ==========================================================================
 */
/**
 * Convert a durable failure into copy that is safe to expose in the GUI.
 * @param failure - Failure value preserved by the session event.
 * @returns Display-safe copy for client projections.
 */
/**
 * 将持久化的失败值转换为可安全展示在 GUI 上的副本。
 * @param failure 会话事件中保存的失败值（类型未知，运行时才收窄）。
 * @returns 适合客户端投影层展示的字符串；鉴权类错误返回固定提示。
 */
export function displayFailureMessage(failure: unknown): string {
  if (failure === null || typeof failure !== 'object') return String(failure)
  const record = failure as { code?: unknown; message?: unknown } // 收窄为可读 code/message 的结构，避免盲目访问未知字段
  // Provider AUTH messages may echo a masked or partially preserved credential.
  // Keep the raw diagnostic in the session log, but never project it into UI state.
  // 鉴权失败信息可能回显（被部分掩盖的）凭据：会话日志保留原始诊断，
  // 但绝不把这类内容投递到 UI 状态中。
  if (record.code === 'AUTH') return 'API key is invalid'
  return typeof record.message === 'string' ? record.message : JSON.stringify(failure)
}
