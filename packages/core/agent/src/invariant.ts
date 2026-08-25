/*
 * ================================ 文件注释 ================================
 * 【文件职责】安装 dsh-agent 包的运行时不变量检查：监视 agent/status 事件，拒绝无变化的重复状态转换（no-op transition）。
 * 【技术维度】Cordis 伴生插件挂到 invariants 服务；用 WeakMap 记录每个 agent 的上一个状态，global 监听。
 * 【产品维度】开发期/测试期自检：状态机只允许真实翻转，防止插件误发重复状态污染订阅方逻辑。
 * 【逻辑维度】PACKAGE_NAME/name/inject → install（WeakMap + agent/status 监听比对）→ apply 注册。
 * 【关键边界】全局（global）监听意味着对所有 agent 生效；只 fail 不拦截，不改变行为。
 * 【新手阅读建议】很短，直接读完；可对照 agent.ts 的 setPhase 看真实状态转换如何产生。
 * ==========================================================================
 */
/** Package-owned agent lifecycle invariants. @module @deepseek-ai/dsh-agent/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'

// 本包在 invariants 注册表中的包名，作为该贡献的唯一标识。
const PACKAGE_NAME = '@deepseek-ai/dsh-agent'

/** Cordis companion plugin name. */
// 伴生插件名：与其它不变量插件一样，通过 invariants 服务统一装载与卸载。
export const name = 'agent-invariant'
/** Services required before the companion can register. */
// 依赖声明：必须先有 invariants 服务，本插件才能注册检查器。
export const inject = ['invariants']

/** Install the agent contribution into its child registration fiber. */
// 安装器本体：全局监听 agent/status，用 WeakMap 记住每个 agent 的上一个状态，发现重复转换即报错。
const install: InvariantInstaller = (ctx, fail) => {
  const lastStatus = new WeakMap<Agent, AgentStatus>()
  ctx.on('agent/status', ({ agent, status }) => {
    const previous = lastStatus.get(agent)
    if (previous === status) {
      fail(`agent/status repeated ${status} (no-op transition)`)
    }
    lastStatus.set(agent, status)
  }, { global: true })
}

/**
 * Register the agent invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 注册入口：把 install 安装到 invariants 服务中，返回的 disposer 用于卸载该检查贡献。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
