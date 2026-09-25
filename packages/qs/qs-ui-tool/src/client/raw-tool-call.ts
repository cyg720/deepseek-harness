/**
 * 官方持久字段的读取层：调用头、参数、单文本结果与退出状态。
 *
 * 这里只读官方 `ToolCallBlock` 上已持久的数据；任何解析失败都返回 `undefined`
 * 交给调用方回落，绝不猜测名称、参数或耗时。
 */
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { hasSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'

/** 调用头：工具名与原始参数文本；孤儿结果没有它。 */
export interface ToolCallHead {
  /** Wire 工具名。 */
  readonly name: string
  /** 原始参数 JSON 文本。 */
  readonly argsRaw: string
}

/**
 * 块是否已结算（是 `ToolResultNode`）。
 * @param block - 运行头或结算结果。
 * @returns 已结算时为 true。
 */
export function isSettled(block: ToolCallBlock): block is ToolResultNode {
  return 'kind' in block
}

/**
 * 读取调用的名称与参数。
 *
 * 窗口截断会让 `tool/result` 先于 `tool/call` 进入投影，此时官方把 `call` 置为
 * `null`：孤儿结果只能给出 callId，不补造名称与参数。
 * @param block - 运行头或结算结果。
 * @returns 调用头；孤儿结果返回 undefined。
 */
export function callHead(block: ToolCallBlock): ToolCallHead | undefined {
  if (!isSettled(block)) return { name: block.name, argsRaw: block.argsRaw }
  return block.call ?? undefined
}

/**
 * 解析参数 JSON 文本。
 * @param argsRaw - 原始参数文本。
 * @returns 顶层为对象的参数；非 JSON 或非对象时为 undefined。
 */
export function parseArgs(argsRaw: string): Record<string, unknown> | undefined {
  if (argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    // 参数不是合法 JSON 时由调用方回落到原始文本展示。
    return undefined
  }
}

/**
 * 读取字符串参数。
 * @param args - 已解析的参数对象。
 * @param key - 参数名。
 * @returns 非空字符串参数；缺失或类型不符时为 undefined。
 */
export function stringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 读取布尔参数。
 * @param args - 已解析的参数对象。
 * @param key - 参数名。
 * @returns 布尔参数；缺失或类型不符时为 undefined。
 */
export function booleanArg(args: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = args?.[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * 读取单文本结果。
 *
 * 官方约定：结果内容恰好是一个文本块时，该文本才是工具的输出正文；块数不符时
 * 上层要按非文本结果给出限制说明，而不是把某一块当作全部输出。
 * @param block - 结算结果。
 * @returns 输出正文；内容不是单个文本块时为 undefined。
 */
export function singleText(block: ToolResultNode): string | undefined {
  if (block.content.length !== 1) return undefined
  const only = block.content[0]
  return isTextBlock(only) ? only.text : undefined
}

/** 文本块判定。 */
function isTextBlock(block: unknown): block is { readonly text: string } {
  return typeof block === 'object' && block !== null
    && ('type' in block) && block.type === 'text'
    && 'text' in block && typeof block.text === 'string'
}

/**
 * 读取内容块的判别式类型名。
 * @param block - 结果内容中的一个块。
 * @returns 块类型名；不是带字符串 type 的对象时为 undefined。
 */
export function blockType(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const type = (block as { readonly type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

/** 结果内容的文字摘要：文本块正文与非文本块的类型标记。 */
export interface ContentSummary {
  /** 文本块正文，按空行分隔；没有文本块时为空串。 */
  readonly text: string
  /** 非文本块的类型标记，按出现顺序。 */
  readonly nonTextKinds: readonly string[]
  /** 非文本块的原始内容，供转义后展示（不执行、不解析）。 */
  readonly nonTextRaw: readonly unknown[]
}

/**
 * 汇总结果内容：文本块取正文，其余块只记录类型与原始内容。
 * @param blocks - 结果内容块。
 * @returns 文字摘要。
 */
export function contentSummary(blocks: readonly unknown[]): ContentSummary {
  const texts: string[] = []
  const nonTextKinds: string[] = []
  const nonTextRaw: unknown[] = []
  for (const block of blocks) {
    if (isTextBlock(block)) {
      texts.push(block.text)
      continue
    }
    nonTextKinds.push(blockType(block) ?? 'unknown')
    nonTextRaw.push(block)
  }
  return { text: texts.join('\n\n'), nonTextKinds, nonTextRaw }
}

/** 命令退出状态：正文与官方渲染器写在尾部的标记。 */
export interface ExitStatus {
  /** 去掉尾部标记后的输出正文。 */
  readonly body: string
  /** 文本尾部是否带有官方写入的退出标记。 */
  readonly reported: boolean
  /** 退出码；没有标记时固定为 0，调用方必须结合 `reported` 判断。 */
  readonly exitCode: number
  /** 终止信号；有信号时优先级高于退出码。 */
  readonly signal: string | undefined
}

/**
 * 解析命令输出的尾部退出标记。
 *
 * 依据官方 shell 渲染约定：干净退出不写标记，失败追加 `\n[exit code: N]`，
 * 信号终止追加 `\n[killed by signal: S]`，且标记固定在文本末尾。工具本身不产出
 * 结构化退出字段（bash/pwsh 不写 `presentationMeta`），因此这里必须如实报告
 * “有没有标记”，不能把“没标记”当成成功。
 * @param text - 单文本结果正文。
 * @returns 正文与退出状态。
 */
export function parseExitStatus(text: string): ExitStatus {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) {
    return { body: text.slice(0, signal.index), reported: true, exitCode: 0, signal: signal[1] }
  }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) {
    return { body: text.slice(0, exit.index), reported: true, exitCode: Number(exit[1]), signal: undefined }
  }
  return { body: text, reported: false, exitCode: 0, signal: undefined }
}

/**
 * 文本是否携带官方转存（spill）提示。
 *
 * 转存提示占据文本末尾，会掩盖退出标记；此时不能从文本推断退出状态。
 * @param text - 单文本结果正文。
 * @returns 末尾是完整转存提示时为 true。
 */
export function hasSpill(text: string): boolean {
  return hasSpillNotice(text)
}
