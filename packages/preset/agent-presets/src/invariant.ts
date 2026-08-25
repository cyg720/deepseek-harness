/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-presets`.
 * @module @deepseek-ai/dsh-agent-presets/invariant
 */
/*
 * 文件职责：实现 invariant.ts 承担的 Agent 预设元数据、校验与装载职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置解析和运行时不变量检查。
 * 产品维度：让用户能通过预设组合 Agent 能力，并在启动时获得明确配置反馈。
 * 逻辑维度：读取预设定义，校验元数据，解析引用并挂载对应插件。
 * 关键边界：缺失或冲突配置应尽早失败；注册必须可撤销；用户路径不得被隐式改写。
 * 新手阅读建议：先看导出类型和元数据，再读校验与挂载，最后关注失败分支。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
// Type-only: resolves the `system-prompt/assemble` waterfall this companion
// joins, and the `agent` field `dsh-agent` merges into its context.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
// Imported through the package name, not `./mount.ts`: a module shared between
// the two build entry points becomes a third chunk that the published `files`
// list does not carry, which `verify-built-package-invariants` rejects.
import { leakedServices, livePresetMounts } from '@deepseek-ai/dsh-agent-presets'

/** 中文说明：常量 PACKAGE_NAME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-agent-presets'

/** Cordis companion plugin name. */
/* 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'agent-presets-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['invariants']

/**
 * Assert that no installed preset composition reaches the root service realm,
 * and that a deployment configuring a roster composes every agent from it.
 *
 * `mountPreset` proves the first once, when the subtree settles. A row that
 * publishes later — from a timer, or an asynchronous continuation after its
 * plugin returned — would escape that one-shot audit, so re-check every live
 * mount whenever a service registration changes.
 */
/* 中文说明：函数值 install 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/service', function (this: Context, name) {
    /** 中文说明：该循环依次处理预设数据；循环变量仅在当前循环中有效。 */
    for (const mount of livePresetMounts()) {
      /** 中文说明：变量 leaked 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const leaked = leakedServices(ctx, mount.fiber)
      if (leaked.length === 0) continue
      fail(
        `preset "${mount.presetId}" published process-global service(s) [${leaked.join(', ')}] `
        + `after its mount was audited (observed while notifying "${name}") — `
        + 'a preset service must sit behind an `isolate` realm or move to the host composition',
      )
    }
  }, { global: true })

  // An agent that joined no preset resolves `tools`, `system-prompt`, and
  // `skill` against the empty global layer, so the model receives nothing.
  // `composedPreset()` is the roster's own answer to "did this agent join",
  // read from the live scope chain — see the [Agent
  // Note](../../../../.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md)
  // for why the warning beside it is advisory while this one fails.
  //
  // Two conditions, each load-bearing. `context.agent` is what makes this an
  // AGENT assembly: a scope-only assembly — a cold read resolving presenters
  // in a standing key, a diagnostic — is not an agent and must not be judged
  // on whether it joined anything. And assembly rather than publication is the
  // moment that matters, because an unjoined agent is legal until it addresses
  // a model: `recompose` binds a bare agent as its first link, and that agent
  // is unjoined for its whole life up to the switch.
  ctx.on('system-prompt/assemble', (_assembly, context, next) => {
    /** 中文说明：变量 presets 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const presets = ctx.get('agentPresets')
    /** 中文说明：变量 agent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agent
    if (presets !== undefined && presets.roots.length > 0
      && agent !== undefined && presets.composedPreset(agent.ctx) === undefined) {
      fail(
        `agent "${agent.id}" addressed a model without joining any agent preset while a roster is `
        + 'composed; its tools, prompt sections, and skill catalog resolve against the empty global layer',
      )
    }
    return next()
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：函数值 apply 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
