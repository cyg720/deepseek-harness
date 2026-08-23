/**
 * ================================ 文件注释 ================================
 * 【文件职责】subagent 包的运行时不变量（invariant）伴生插件：在 internal/dispatch 与公开事件
 *   之间分两阶段核对 provider 注册/注销与 start/end 配对是否合法，一旦违反立即 fail。
 * 【技术维度】遵循 dsh-invariants 插件的标准形态（name/inject/install/apply）；
 *   利用 Cordis internal/dispatch 先"暂存"再在公开事件上"落账"的两段式校验。
 * 【产品维度】开发期/测试期的守护网：防止重复注册、未知 provider 移除、start/end 身份不一致等
 *   非法生命周期在运行时悄悄发生。
 * 【逻辑维度】按代码顺序：校验函数 validateRunEnd → install（四类暂存集合 + 两套监听）→ apply。
 * 【关键边界】install 声明了 inject: ['subagents']，无该服务时不安装；global: true 表示跨作用域监听。
 * 【新手阅读建议】理解"internal/dispatch 暂存 → 公开事件落账"的配对思路即可，这是本仓库 invariants 的通用模式。
 * ==========================================================================
 */

/** Package-owned subagent registry and lifecycle invariants. @module @deepseek-ai/dsh-subagent/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SubagentProvider, SubagentRunEndInfo, SubagentRunInfo } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent'

/** Cordis companion plugin name. */
// 中文：伴生插件名（注册到 Cordis 插件清单的名字）。
export const name = 'subagent-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：本插件依赖 invariants 服务，Cordis 加载时保证它先可用。
export const inject = ['invariants']

/** Assert that a terminal lifecycle payload matches its start identity. */
// 中文：核对 end 事件与配对的 start 事件身份一致（provider、id、local 三项），
// 不一致即说明生命周期事件错配，触发 invariant 失败。
function validateRunEnd(start: SubagentRunInfo, end: SubagentRunEndInfo, fail: InvariantFailure): void {
  if (start.provider !== end.provider || start.id !== end.id || start.local !== end.local) {
    fail(`subagent/end identity diverges from subagent/start for run ${JSON.stringify(end.runId)}`)
  }
}

/** Install provider-registry and start/end pairing checks. */
// 中文：安装两段式校验：internal/dispatch 阶段把待核对对象暂存进集合，
// 公开事件阶段再落账（或报 fail），确保"先核对、后记账"的顺序。
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const providers = new Set(ctx.subagents.list())
  const runs = new Map<string, SubagentRunInfo>()
  const stagedProviders = new WeakSet<SubagentProvider>()
  const stagedRemovals = new Set<string>()
  const stagedStarts = new WeakSet<SubagentRunInfo>()
  const stagedEnds = new WeakSet<SubagentRunEndInfo>()

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'subagent/provider-added') {
      const provider = args[0] as SubagentProvider
      if (provider.name.length === 0) fail('subagent provider names must be non-empty')
      if (providers.has(provider.name)) fail(`subagent/provider-added repeated ${JSON.stringify(provider.name)}`)
      stagedProviders.add(provider)
      return
    }
    if (eventName === 'subagent/provider-removed') {
      const providerName = args[0] as string
      if (!providers.has(providerName)) fail(`subagent/provider-removed names unknown provider ${JSON.stringify(providerName)}`)
      stagedRemovals.add(providerName)
      return
    }
    if (eventName === 'subagent/start') {
      const info = args[0] as SubagentRunInfo
      // Provider availability is an admission-time relationship. A published
      // one-shot run may outlive provider removal, and a cold-resumed Activation
      // records the initial provider name without dispatching through it.
      if (info.provider.length === 0 || String(info.runId).length === 0 || String(info.id).length === 0) {
        fail('subagent/start provider, runId, and child id must be non-empty')
      }
      if (runs.has(info.runId)) fail(`subagent/start repeated run id ${JSON.stringify(info.runId)}`)
      stagedStarts.add(info)
      return
    }
    if (eventName !== 'subagent/end') return
    const info = args[0] as SubagentRunEndInfo
    const start = runs.get(info.runId)
    if (start === undefined) fail(`subagent/end has no matching subagent/start for run ${JSON.stringify(info.runId)}`)
    validateRunEnd(start, info, fail)
    stagedEnds.add(info)
  }, { global: true })

  ctx.on('subagent/provider-added', (provider) => {
    /* v8 ignore next -- internal/dispatch stages the same provider object */
    if (!stagedProviders.delete(provider)) return
    providers.add(provider.name)
  }, { global: true })
  ctx.on('subagent/provider-removed', (providerName) => {
    /* v8 ignore next -- internal/dispatch stages the same provider name */
    if (!stagedRemovals.delete(providerName)) return
    providers.delete(providerName)
  }, { global: true })
  ctx.on('subagent/start', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same lifecycle object */
    if (!stagedStarts.delete(info)) return
    runs.set(info.runId, info)
  }, { global: true })
  ctx.on('subagent/end', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same lifecycle object */
    if (!stagedEnds.delete(info)) return
    runs.delete(info.runId)
  }, { global: true })
}, { inject: ['subagents'] })

/**
 * Register the subagent invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 中文：插件的 apply 入口：把本包的 invariants 安装进 invariants 服务，返回其注销器。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
