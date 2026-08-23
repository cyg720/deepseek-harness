/**
 * ================================ 文件注释 ================================
 * 【文件职责】Cordis 生命周期工具调用的"可回放稳定视图模型"：把冻结的调用/结果
 *             切片（args/meta/output/state）规范化为 Define/Run/Action 三种卡片的
 *             纯数据模型，供 UI 组件渲染。
 * 【技术维度】输入是 ToolCallViewProps['block']（进行中或已结算）；meta 由工具的
 *             presentationMeta 写入（优先取用），args 做 JSON 解析兜底；所有推导
 *             都是纯函数，保证会话日志回放时卡片渲染一致。
 * 【产品维度】把工具调用历史渲染成信息清晰的卡片：定义卡展示名称/用途/源码，
 *             运行卡展示激活结果与最新卡片竞争信息，动作卡展示停止/删除结果。
 * 【逻辑维度】基础工具（firstLine/stringAt/objectAt/parseArgs/resultText/stateOf/
 *             metaObject）→ 三个卡片推导函数（define/run/action）。
 * 【关键边界】运行中的调用输出为 null（只有结算后才有结果文本）；状态区分
 *             interrupted（停止）与 error；所有字段只读且容忍缺失（null）。
 * 【新手阅读建议】先看 stateOf/resultText 两个基础函数，再看三个推导函数如何
 *             组合它们。
 * ==========================================================================
 */

/** Replay-stable view models for Cordis lifecycle Tool calls. */

import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, CordisDynamicRunMode,
} from './events.ts'

type Block = ToolCallViewProps['block']

/** Lifecycle of the tool call itself. */
export type CordisToolState = 'running' | 'ok' | 'error' | 'stopped'

/** Frozen `cordis_define` presentation data. */
/**
 * 冻结的 cordis_define 展示数据：解析后的插件/包 ID、名称/用途、两端源码、
 * 输出文本、错误摘要与调用状态（空值表示该字段不可得）。
 */
export interface CordisDefineCard {
  readonly pluginId: CordisDynamicPluginId | null
  readonly packageId: CordisDynamicPackageId | null
  readonly name: string | null
  readonly purpose: string | null
  readonly hostCode: string | null
  readonly clientCode: string | null
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: CordisToolState
}

/** Frozen `cordis_run` presentation data. */
/**
 * 冻结的 cordis_run 展示数据：解析后的插件/包/运行 ID、模式、日志序列号、
 * 输出、错误摘要与调用状态。
 */
export interface CordisRunCard {
  readonly pluginId: CordisDynamicPluginId | null
  readonly packageId: CordisDynamicPackageId | null
  readonly pluginRunId: CordisDynamicPluginRunId | null
  readonly mode: CordisDynamicRunMode | null
  readonly seq: number | null
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: CordisToolState
}

/** Frozen `cordis_stop` or `cordis_undefine` presentation data. */
/**
 * 冻结的 stop/undefine 动作展示数据：插件 ID、输出、错误摘要与调用状态。
 */
export interface CordisActionCard {
  readonly pluginId: CordisDynamicPluginId | null
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: CordisToolState
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function parseArgs(argsRaw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    // Running calls can expose a truncated JSON prefix.
    return null
  }
}

function resultText(block: Extract<Block, { kind: 'tool-result' }>): string | null {
  const text = block.content
    .map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
    .join('\n')
  if (text !== '') return text
  return block.error === undefined ? null : `${block.error.name}: ${block.error.code}`
}

function stateOf(block: Block): CordisToolState {
  if (!('kind' in block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

function metaObject(block: Block): Record<string, unknown> | null {
  if (!('kind' in block) || block.isError || typeof block.meta !== 'object' || block.meta === null) return null
  return block.meta as Record<string, unknown>
}

/**
 * Derive one Define card from its frozen call/result slice.
 * @param block - active or settled tool-call block.
 * @returns normalized Define card fields.
 */
/**
 * 从冻结的调用/结果切片推导一张 Define 卡片：优先用展示元数据（meta）中的
 * ID，回退解析 args；进行中的调用输出为 null。
 */
export function cordisDefineCard(block: Block): CordisDefineCard {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parseArgs(argsRaw)
  const code = args === null ? null : objectAt(args, 'code')
  const state = stateOf(block)
  const output = settled ? resultText(block) : null
  const meta = metaObject(block)
  const rawName = argsRaw === '' ? null : firstLine(argsRaw)
  return {
    pluginId: meta === null ? null : stringAt(meta, 'pluginId') as CordisDynamicPluginId | null,
    packageId: meta === null ? null : stringAt(meta, 'packageId') as CordisDynamicPackageId | null,
    name: args === null ? rawName : stringAt(args, 'name') ?? rawName,
    purpose: args === null ? null : stringAt(args, 'purpose'),
    hostCode: code === null ? null : stringAt(code, 'host'),
    clientCode: code === null ? null : stringAt(code, 'client'),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/**
 * Derive one Run card and its successful activation metadata.
 * @param block - active or settled tool-call block.
 * @returns normalized Run card fields.
 */
/**
 * 从冻结切片推导一张 Run 卡片：ID 优先取 meta、回退 args；seq 仅已结算块有值；
 * mode 只接受 run/update 两个合法值。
 */
export function cordisRunCard(block: Block): CordisRunCard {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parseArgs(argsRaw)
  const meta = metaObject(block)
  const state = stateOf(block)
  const output = settled ? resultText(block) : null
  const rawMode = args === null ? null : stringAt(args, 'mode')
  const argsPluginId = args === null ? null : stringAt(args, 'pluginId')
  const argsPackageId = args === null ? null : stringAt(args, 'packageId')
  return {
    pluginId: (meta === null ? argsPluginId : stringAt(meta, 'pluginId') ?? argsPluginId) as CordisDynamicPluginId | null,
    packageId: (meta === null ? argsPackageId : stringAt(meta, 'packageId') ?? argsPackageId) as CordisDynamicPackageId | null,
    pluginRunId: (meta === null ? null : stringAt(meta, 'pluginRunId')) as CordisDynamicPluginRunId | null,
    mode: rawMode === 'run' || rawMode === 'update' ? rawMode : null,
    seq: settled ? block.seq : null,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/**
 * Derive one Stop or Remove card from its frozen call/result slice.
 * @param block - active or settled tool-call block.
 * @returns normalized lifecycle-action card fields.
 */
/**
 * 从冻结切片推导一张 Stop/Remove 动作卡片：插件 ID 取 args.pluginId 或 args.id。
 */
export function cordisActionCard(block: Block): CordisActionCard {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parseArgs(argsRaw)
  const state = stateOf(block)
  const output = settled ? resultText(block) : null
  return {
    pluginId: (args === null ? null : stringAt(args, 'pluginId') ?? stringAt(args, 'id')) as CordisDynamicPluginId | null,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}
