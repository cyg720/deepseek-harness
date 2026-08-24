/**
 * CPython subprocess code runtime for the DeepSeek Harness code-execution seam.
 *
 * The package owns the versionless fd-3 wire protocol between the Node host and
 * the CPython subprocess. The protocol's host-side codec and hostile-frame
 * validators are re-exported so every consumer of the wire shares one
 * vocabulary.
 * @module @deepseek-ai/dsh-code-runtime-python
 */
/**
 * 文件职责：作为 CPython 子进程代码运行时包的公共入口，统一重导出 fd 3 线协议类型与校验工具。
 * 技术维度：使用 TypeScript 类型导出和 ESM 命名导出，共享无版本 JSON Lines 协议实现。
 * 产品维度：让宿主安全执行模型生成的 Python 代码，并用同一套协议词汇处理结果、日志和工具调用。
 * 逻辑维度：先导出启动与回复消息类型，再导出完成值检查、JSON 编码、数值检查、截断标记和入站帧校验。
 * 关键边界：来自子进程的帧按不可信输入处理；消费者必须先检查完成错误，再读取可选完成值。
 * 新手阅读建议：先从 BootMessage、ChildToHost、ReplyMessage 理解消息方向，再阅读 validateChildFrame 和数值校验函数。
 */

// 协议类型：BootMessage 是宿主首帧；ChildToHost 是子进程上行消息联合；ReplyMessage 是宿主对工具调用的回复。
export type { BootMessage, ChildToHost, ReplyMessage } from './protocol.ts'
export {
  // checkDoneValue：按字节预算检查完成值并报告精确编码大小；示例 checkDoneValue(null, 16)。
  checkDoneValue,
  // encodeJsonPlain：无递归编码已由 JSON.parse 产生的普通值；返回紧凑 JSON 文本。
  encodeJsonPlain,
  // hasNonLosslessNumber：检查值中是否含 Infinity、负零等无法无损往返的数字。
  hasNonLosslessNumber,
  // hasUnsafeIntegerToken：扫描原始 JSON 行，识别解析后会丢失精度的整数记号。
  hasUnsafeIntegerToken,
  // logTruncationMarker：根据最大日志字节数生成统一截断提示文本。
  logTruncationMarker,
  // validateChildFrame：逐字段重建不可信的子进程帧；无效输入返回 undefined 并应被丢弃。
  validateChildFrame,
} from './protocol.ts'
