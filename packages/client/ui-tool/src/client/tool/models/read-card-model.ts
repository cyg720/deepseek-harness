/** Pure read-card derivation from raw result content and metadata. @module
 * @remarks 文件说明：文件职责：实现 client/ui-tool 中 read card model 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-tool
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { ReadBlockLine, ReadBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import { relativizeToCwd, type ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall, singleResultText } from './raw-tool-call.ts'

/**
 * Content lines the chat row's resident read body shows before collapsing the
 * middle — half the primitive's own default, which the details panel keeps. A
 * chat row is a summary surface inside the message flow: the flow must stay
 * scannable across many calls, while the details panel is the single-call
 * reading surface. A design constant of this UI's row geometry, not a
 * deployment choice, so it is fixed here rather than a plugin Config field. The
 * same split [`CHAT_TERMINAL_MAX_LINES`](./terminal-card-model.ts) draws for
 * terminal output.
 * @remarks 中文说明：常量说明：CHAT_READ_MAX_LINES 用于处理 CHAT_READ_MAX_LINES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const CHAT_READ_MAX_LINES = 8

/**
 * The {@link ReadBlock} props this derivation owns. Picked off the primitive's
 * props so the two stay in step; `maxLines`/`className` belong to each render
 * site.
 */
export type ReadCardModel = Pick<ReadBlockProps, 'label' | 'lines' | 'totalLines' | 'lang'>

interface ReadMeta {
  path: string
  offset: number
  lines: ReadBlockLine[]
  totalLines: number
  lang?: string
}

/**
 * 功能说明：处理 validReadCall 相关流程；使用场景由所在模块及调用位置决定。
 * @param block （ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validReadCall(block)，并按返回类型处理结果。
 */
function validReadCall(block: ToolCallBlock): boolean {
  /**
   * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const call = parsedToolCall(block)
  if (call?.name !== 'read') return false
  /**
   * 常量说明：path、offset、limit 用于处理 path、offset、limit 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { file_path: path, offset, limit } = call.args
  if (typeof path !== 'string' || path.trim() === '') return false
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 1)) return false
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) return false
  return true
}

/**
 * 功能说明：读取 Meta 相关流程；使用场景由所在模块及调用位置决定。
 * @param meta （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ReadMeta | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readMeta(meta)，并按返回类型处理结果。
 */
function readMeta(meta: unknown): ReadMeta | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  /**
   * 常量说明：path、offset、lines、totalLines、lang 用于处理
   * path、offset、lines、totalLines、lang 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { path, offset, lines, totalLines, lang } = meta as Record<string, unknown>
  if (typeof path !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 1) return null
  if (typeof totalLines !== 'number' || !Number.isInteger(totalLines) || totalLines < 0 || !Array.isArray(lines)) return null
  if (lang !== undefined && typeof lang !== 'string') return null
  /**
   * 常量说明：narrowed 用于处理 narrowed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const narrowed: ReadBlockLine[] = []
  /**
   * 变量说明：previous 用于处理 previous 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let previous = offset - 1
  /**
   * 变量说明：line 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const line of lines) {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null
    /**
     * 常量说明：number、text 用于处理 number、text 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { number, text } = line as Record<string, unknown>
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number <= previous) return null
    if (number > totalLines || typeof text !== 'string') return null
    previous = number
    narrowed.push({ number, text })
  }
  return {
    path,
    offset,
    lines: narrowed,
    totalLines,
    ...lang === undefined ? {} : { lang },
  }
}

/**
 * Derive a settled root read card after validating its persisted metadata and
 * model-facing read envelope.
 * @param block - running or settled Tool block.
 * @param sessionCwd - the session workspace root; a workspace-rooted absolute
 *   path label displays relative to it. Absent leaves the path as authored.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @returns the read-card props, or null for the generic path.
 * @remarks 中文说明：功能说明：读取 Card Model 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionCwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：home（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ReadCardModel | null；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readCardModel(block,
 * sessionCwd, home)，并按返回类型处理结果。
 */
export function readCardModel(
  block: ToolCallBlock,
  sessionCwd?: string,
  home?: string,
): ReadCardModel | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  if (!validReadCall(block)) return null
  /**
   * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const meta = readMeta(block.meta)
  if (meta === null) return null
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = singleResultText(block)
  if (text === undefined) return null
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
  if (body === undefined) return null
  return {
    label: abbreviateHomePath(relativizeToCwd(meta.path, sessionCwd), home),
    lines: meta.lines,
    totalLines: meta.totalLines,
    lang: meta.lang,
  }
}
