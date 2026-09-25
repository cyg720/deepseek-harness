/**
 * 工具行的共享视图模型：状态、身份、耗时与折叠行摘要。
 *
 * 全部为纯函数，便于逐分支单测；任何输入缺失都返回 `undefined`，由组件给出可见说明。
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import { callHead, isSettled, parseArgs } from './raw-tool-call.ts'

/** 工具呈现状态：运行中、成功、失败、被中断。 */
export type QsToolState = 'running' | 'ok' | 'error' | 'stopped'

/** 呈现层树遍历上限；官方投影已对环与超深子树设限，这里是第二道防线。 */
export const TOOL_TREE_MAX_DEPTH = 32

/**
 * 状态判定。
 *
 * 与官方一致：只有结算结果才算终态；`interrupted` 由客户端合成的中断结果写入，
 * 归为“已中断”而不是失败；`isError` 才是一般失败。不得用轮次结束推断成功。
 * @param block - 运行头或结算结果。
 * @returns 呈现状态。
 */
export function toolState(block: ToolCallBlock): QsToolState {
  if (!isSettled(block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/**
 * 状态文案键。
 * @param state - 呈现状态。
 * @returns 本地化键。
 */
export function stateKey(state: QsToolState): 'state.running' | 'state.ok' | 'state.error' | 'state.stopped' {
  if (state === 'running') return 'state.running'
  if (state === 'error') return 'state.error'
  if (state === 'stopped') return 'state.stopped'
  return 'state.ok'
}

/**
 * 工具名；孤儿结果没有调用头。
 * @param block - 运行头或结算结果。
 * @returns Wire 工具名；未知时为空串。
 */
export function toolName(block: ToolCallBlock): string {
  return callHead(block)?.name ?? ''
}

/**
 * 结算调用是否缺少调用头（窗口截断留下 `call === null`）。
 * @param block - 运行头或结算结果。
 * @returns 是孤儿结果时为 true。
 */
export function isOrphanResult(block: ToolCallBlock): boolean {
  return isSettled(block) && block.call === null
}

/**
 * 调用耗时（秒，保留一位小数）。
 *
 * 只在官方同时给出调用时间与结果时间时计算；缺 `callTime` 表示调用头不在窗口内，
 * 此时不显示耗时，也不用结果时间单独估算。
 * @param block - 运行头或结算结果。
 * @returns 耗时秒数；运行中或缺少配对时间时为 undefined。
 */
export function durationSeconds(block: ToolCallBlock): number | undefined {
  if (!isSettled(block) || block.callTime === null) return undefined
  return Math.round((block.time - block.callTime) / 100) / 10
}

/** 各工具折叠行优先展示的参数名；未列出的工具走通用顺序。 */
const SUMMARY_ARGS: Readonly<Record<string, readonly string[]>> = {
  // 命令原文可能携带任意凭据，只允许用户主动展开查看。
  bash: ['description'],
  pwsh: ['description'],
  read: ['file_path'],
  read_image: ['file_path'],
  write: ['file_path'],
  edit: ['file_path'],
  grep: ['pattern'],
  glob: ['pattern'],
  web_fetch: ['url'],
  web_search: ['queries'],
}

/** 工具协议参数键的回退顺序；这些键不是用户文案，不参与翻译。 */
const FALLBACK_ARGUMENT_KEYS: readonly string[] = ['description', 'file_path', 'path', 'pattern', 'url', 'query']

/**
 * 明显敏感的候选摘要不自动展示；这不是任意自由文本秘密的识别器。
 * @param text - 从已允许参数取得的摘要候选。
 * @returns 可以自动显示时为 true；原文始终保留在展开详情。
 */
function canShowSummary(text: string): boolean {
  // 省略整个候选，避免多词凭据、环境赋值和带认证信息 URL 的局部遮罩遗漏。
  return !/(?:authorization|proxy-authorization|cookie|password|passwd|token|secret|api[_-]?key)\s*['"]?\s*[:=]/i.test(text)
    && !/\b(?:bearer|basic)\s+\S+/i.test(text)
    && !/(?:^|\s)(?:\$env:|\$)?[a-z_][a-z0-9_]*\s*=/i.test(text)
    && !/https?:\/\/[^\s]*[?@#]/i.test(text)
}

/**
 * 把参数值渲染为一行摘要文本。
 * @param value - 参数值。
 * @returns 字符串（字符串数组按逗号连接）摘要；其他类型返回 undefined。
 */
function argText(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value
  if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string')) {
    return value.join(', ')
  }
  return undefined
}

/**
 * 折叠行摘要：按工具取允许的文本，省略明显敏感候选；不自动显示命令原文。
 * @param name - Wire 工具名。
 * @param argsRaw - 原始参数文本。
 * @returns 摘要文本；没有可读参数时为 undefined。
 */
export function summaryOf(name: string, argsRaw: string): string | undefined {
  const args = parseArgs(argsRaw)
  if (args === undefined) return undefined
  for (const key of SUMMARY_ARGS[name] ?? FALLBACK_ARGUMENT_KEYS) {
    const text = argText(args[key])
    if (text !== undefined && canShowSummary(text)) return text
  }
  return undefined
}

/**
 * 错误摘要。
 * @param block - 结算结果。
 * @returns `name` 与可选 `code`；没有结构化错误时为 undefined。
 */
export function errorOf(block: ToolCallBlock): { readonly name: string; readonly code?: string } | undefined {
  if (!isSettled(block)) return undefined
  return block.error
}

/**
 * 显示用路径：按会话工作区根相对化；未知工作区根时按原样显示。
 * @param path - 工具参数或结构化 meta 里的路径。
 * @param cwd - 会话工作区根。
 * @returns 相对显示路径。
 */
export function displayPath(path: string, cwd: string | undefined): string {
  return relativizeToCwd(path, cwd)
}
