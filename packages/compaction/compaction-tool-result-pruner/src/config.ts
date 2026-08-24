/** Configuration resolution for deterministic tool-result pruning. */
/**
 * 文件职责：实现上下文压缩的 config.ts 模块。
 * 技术维度：TypeScript、Cordis 插件、会话事件和严格判别联合。
 * 产品维度：控制模型请求中的上下文压缩信息。
 * 逻辑维度：读取日志或文件状态，计算投影并记录/注入结果。
 * 关键边界：不能静默丢失必需事件；裁剪和替换必须保持日志可重放。
 * 新手阅读建议：先读导出类型与配置，再跟踪事件和投影流程。
 */

import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig, ToolResultPruneConfig } from './types.ts'

/** Fixed marker substituted for every removed middle span. */
/** 中文说明：上下文局部值 PRUNE_MARKER，由紧邻初始化决定。 */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/** Low-friction defaults for coding-agent tool output. */
/** 中文说明：上下文局部值 DEFAULTS，由紧邻初始化决定。 */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
})

/** 中文说明：上下文局部值 CONFIG_KEYS，由紧邻初始化决定。 */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'thresholdChars',
  'headChars',
  'tailChars',
])

/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text to measure.
 * @returns the Unicode code-point count.
 */
/** 中文说明：函数 codePointLength 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Resolve and validate pruning budgets.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
/** 中文说明：函数 resolveConfig 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function resolveConfig(config: ToolResultPruneConfig = {}): ResolvedConfig {
  /** 中文说明：上下文局部值 key，由紧邻初始化决定。 */
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown key "${key}" `
        + '(allowed: thresholdChars, headChars, tailChars)',
      )
    }
  }

  /** 中文说明：上下文局部值 resolved，由紧邻初始化决定。 */
  const resolved: ResolvedConfig = {
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    headChars: config.headChars ?? DEFAULTS.headChars,
    tailChars: config.tailChars ?? DEFAULTS.tailChars,
  }
  assertPositiveInteger('thresholdChars', resolved.thresholdChars)
  assertNonNegativeInteger('headChars', resolved.headChars)
  assertNonNegativeInteger('tailChars', resolved.tailChars)

  /** 中文说明：上下文局部值 emittedChars，由紧邻初始化决定。 */
  const emittedChars = resolved.headChars
    + codePointLength(PRUNE_MARKER)
    + resolved.tailChars
  if (emittedChars > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + marker + tailChars (${emittedChars}) `
      + `must be at most thresholdChars (${resolved.thresholdChars})`,
    )
  }
  return deepFreeze(structuredClone(resolved))
}

/** 中文说明：函数 assertPositiveInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a positive integer`)
  }
}

/** 中文说明：函数 assertNonNegativeInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a non-negative integer`)
  }
}
