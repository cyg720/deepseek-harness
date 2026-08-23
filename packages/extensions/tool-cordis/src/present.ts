/**
 * ================================ 文件注释 ================================
 * 【文件职责】Cordis 工具调用在 UI 卡片上的"纯展示意图"渲染函数集合：把每次工具
 *             调用转成可回放（replay-safe）的通用卡片视图（标题/类型/原始输入）。
 * 【技术维度】GenericCallView 来自 dsh-tools；这些函数都是 args 的纯函数，不含
 *             任何运行期副作用，可安全地用于会话日志回放。
 * 【产品维度】让工具调用在用户界面上呈现为清晰的卡片（"查询/执行/删除"等），
 *             便于用户理解模型每一步做了什么。
 * 【逻辑维度】每个工具一个 present*Call 函数：从参数提炼标题，定义阶段的卡片额外
 *             携带 rawInput 展示源码。
 * 【关键边界】只能使用调用参数，不能读取运行期状态；输出必须可 JSON 序列化。
 * 【新手阅读建议】对照 index.ts 中每个工具的 presentCall 字段逐个阅读即可。
 * ==========================================================================
 */

/** Pure replay-safe render intents for Cordis tools. */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/**
 * Render a runtime-inspection call.
 * @param args - requested runtime category and optional member name.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染运行时检查调用（cordis_runtime_inspect）的卡片标题。
 */
export function presentRuntimeInspectCall(args: { what?: string; name?: string }): GenericCallView {
  const target = args.name === undefined ? args.what : `${args.what}: ${args.name}`
  return { card: 'generic', kind: 'read', title: target === undefined ? 'Inspect Cordis runtime' : `Inspect Cordis runtime: ${target}` }
}

/**
 * Render provider-directory inspection.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染"列出 inspect 提供者"调用的卡片标题。
 */
export function presentInspectListCall(): GenericCallView {
  return { card: 'generic', kind: 'read', title: 'List Cordis Inspect Providers' }
}

/**
 * Render one provider query.
 * @param args - target platform, provider, and method.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染一次提供者查询调用的卡片标题（含平台与 提供者.方法）。
 */
export function presentInspectQueryCall(args: { platform: string; provider: string; method: string }): GenericCallView {
  return { card: 'generic', kind: 'read', title: `Query Cordis ${args.platform} ${args.provider}.${args.method}` }
}

/**
 * Render layered self-inspection.
 * @param args - optional Plugin and Package identity.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染分层自查调用的卡片标题（无 ID 时为插件列表，否则按层级细化）。
 */
export function presentInspectSelfCall(args: { pluginId?: string; packageId?: string }): GenericCallView {
  const target = args.pluginId === undefined
    ? 'dynamic Cordis Plugins'
    : args.packageId === undefined ? args.pluginId : `${args.pluginId}/${args.packageId}`
  return { card: 'generic', kind: 'read', title: `Inspect ${target}` }
}

/**
 * Render an immutable Package source-inspection call.
 * @param args - exact Plugin and Package identity.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染"检查包版本源码"调用的卡片标题。
 */
export function presentPackageInspectCall(args: { pluginId: string; packageId: string }): GenericCallView {
  return { card: 'generic', kind: 'read', title: `Inspect Cordis Package ${args.pluginId}/${args.packageId}` }
}

/**
 * Render a new or appended Package definition.
 * @param args - target Plugin, Package metadata, and source halves.
 * @returns replay-safe generic call presentation with source in raw input.
 */
/**
 * 渲染定义包版本调用的卡片：标题含目标插件与用途，rawInput 携带两端源码供展开查看。
 */
export function presentDefineCall(args: {
  plugin: { kind: 'new'; idPrefix: string } | { kind: 'existing'; pluginId: string }
  name: string
  purpose: string
  code: { host?: string; client?: string }
}): GenericCallView {
  const target = args.plugin.kind === 'new' ? `new ${args.plugin.idPrefix}-*` : args.plugin.pluginId
  return {
    card: 'generic',
    kind: 'execute',
    title: `Register Cordis Plugin "${args.name}" for ${target}: ${args.purpose}`,
    rawInput: args.code,
  }
}

/**
 * Render Plugin removal.
 * @param args - Plugin identity to remove.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染删除插件调用的卡片标题。
 */
export function presentUndefineCall(args: { pluginId: string }): GenericCallView {
  return { card: 'generic', kind: 'delete', title: `Remove Cordis Plugin ${args.pluginId}` }
}

/**
 * Render one exact Package activation.
 * @param args - Plugin, Package, and activation mode.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染激活包版本调用的卡片标题（update 与 run 措辞不同）。
 */
export function presentRunCall(args: { pluginId: string; packageId: string; mode: 'run' | 'update' }): GenericCallView {
  return {
    card: 'generic',
    kind: 'execute',
    title: `${args.mode === 'update' ? 'Update' : 'Run'} Cordis Plugin ${args.pluginId} · ${args.packageId}`,
  }
}

/**
 * Render Plugin stop.
 * @param args - Plugin identity to stop.
 * @returns replay-safe generic call presentation.
 */
/**
 * 渲染停止插件调用的卡片标题。
 */
export function presentStopCall(args: { pluginId: string }): GenericCallView {
  return { card: 'generic', kind: 'execute', title: `Stop Cordis Plugin ${args.pluginId}` }
}
