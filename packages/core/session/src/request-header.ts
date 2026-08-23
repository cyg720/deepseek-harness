/**
 * Request-header reconstruction utilities over full `request/header` session
 * events. Anyone holding a session log reconstructs the {@link EpochHeader}
 * any request was built under by taking the latest canonical snapshot; the
 * loop uses the same equality helper to avoid logging unchanged headers.
 *
 * @module dsh-session/request-header
 */
/**
 * ================================ 文件注释 ================================
 * 【文件职责】基于完整的 request/header 会话事件做“请求头重建”：任何持有会话日志的人都能取最近一份
 *           规范快照，还原任一请求当时使用的 EpochHeader（调用配置 + 系统提示 + 工具集）；
 *           agent 循环也用这里的相等性函数避免把未变化的头部反复写进日志。
 * 【技术维度】纯函数式折叠（foldRequestHeader 顺序扫描、可从上次结果续算）；规范化表示
 *            （空系统提示/空工具表统一为“字段缺席”）+ 逐字段相等比较；工具 schema 用
 *            JSON.stringify 做规范化 JSON 相等。
 * 【产品维度】保证换一个进程、换一个读者也能准确还原每次模型请求的配置与提示词构成，
 *            支撑审计、调试与跨端重放——这是“模型可见 ⟺ 可从日志重建”承诺的一部分。
 * 【逻辑维度】canonicalHeader 负责规范化；sameSchema/headerEquals 负责比较；
 *            foldRequestHeader 从日志（或任意前缀）折出最后一份头部状态。
 * 【关键边界】headerEquals 假设双方都已是规范形态；工具 schema 相等依赖“经由同一路径组装”
 *            （键顺序一致的 stringify 才可靠）；日志中没有任何 request/header 事件时折叠结果为 undefined。
 * 【新手阅读建议】先看 canonicalHeader 理解“规范形态”，再看 headerEquals 的比较范围，
 *            最后读 foldRequestHeader 体会“最新快照胜出”的折叠语义。
 * ==========================================================================
 */

import { callConfigEquals } from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { EpochHeader, SessionEvent } from './types.ts'

/**
 * Normalize a header to canonical form: an empty system prompt and empty tool
 * list become absent fields, matching how requests are built. Logging, folding,
 * and comparison use this one representation.
 * @param header - the header to normalize (not mutated).
 * @returns the canonical header.
 */
/**
 * 把头部规范化为规范形态：空系统提示与空工具列表变成“字段缺席”，与请求的实际构建方式一致。
 * 写日志、折叠与比较都使用这一种表示。
 * @param header - 待规范化的头部（不会被修改）。
 * @returns 规范化后的头部。
 */
export function canonicalHeader(header: EpochHeader): EpochHeader {
  // adapterDefaults 仅在其中确有字段落实（reasoningEffort/maxTokens 标记为 true）时才保留。
  const adapterDefaults = header.adapterDefaults
  return {
    config: header.config,
    ...adapterDefaults?.reasoningEffort === true || adapterDefaults?.maxTokens === true
      ? { adapterDefaults }
      : {},
    ...header.system !== undefined && header.system.length > 0 ? { system: header.system } : {},
    ...header.tools !== undefined && header.tools.length > 0 ? { tools: header.tools } : {},
  }
}

/** Canonical JSON equality for tool schemas assembled through the same path. */
/** 对经同一路径组装的工具 schema 做 JSON 字符串相等比较（键顺序一致时可靠）。 */
function sameSchema(a: ToolSchema, b: ToolSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Field-wise equality over canonical headers. Tool schemas compare in order.
 * @param a - one canonical header.
 * @param b - the other.
 * @returns whether config, system, and tools all match.
 */
/**
 * 规范化头部之间的逐字段相等比较；工具 schema 按顺序一一比较。
 * @param a - 其中一个规范化头部。
 * @param b - 另一个规范化头部。
 * @returns config、system 与 tools 全部一致时为 true。
 */
export function headerEquals(a: EpochHeader, b: EpochHeader): boolean {
  if (
    !callConfigEquals(a.config, b.config)
    || a.adapterDefaults?.reasoningEffort !== b.adapterDefaults?.reasoningEffort
    || a.adapterDefaults?.maxTokens !== b.adapterDefaults?.maxTokens
    || a.system !== b.system
  ) return false
  // 双方工具列表缺省都按空数组处理。
  const at = a.tools ?? []
  const bt = b.tools ?? []
  return at.length === bt.length && at.every((tool, i) => sameSchema(tool, bt[i] as ToolSchema))
}

/**
 * Fold the header events of a log (or any prefix) into the
 * {@link EpochHeader} in force after the last snapshot. Non-header events are
 * skipped. This is the pure offline reconstruction path; the live session
 * tracks the same fold incrementally.
 * @param events - session events in log order.
 * @param from - a previously folded state to continue from.
 * @returns the latest canonical header, or undefined when none exists yet.
 */
/**
 * 把一段日志（或任意前缀）中的 request/header 事件折叠为“最后一份快照之后生效”的
 * {@link EpochHeader}；非 header 事件一律跳过。这是纯离线重建路径；
 * 在线会话内部以增量方式维护同样的折叠（见 Session.requestHeader）。
 * @param events - 按日志顺序排列的会话事件。
 * @param from - 上一次折叠的结果，用于续算。
 * @returns 最新的规范化头部；日志中还没有任何头部事件时为 undefined。
 */
export function foldRequestHeader(events: readonly SessionEvent[], from?: EpochHeader): EpochHeader | undefined {
  // 折叠状态：每遇到一条 request/header 就整体替换为新的规范头部。
  let state = from
  for (const event of events) {
    if (event.type === 'request/header') state = canonicalHeader(event.data.header)
  }
  return state
}
