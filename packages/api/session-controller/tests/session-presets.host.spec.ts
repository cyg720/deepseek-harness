/** Session creation and adoption rules for Agent preset identity.
 * @remarks 文件说明：文件职责：验证 api/session-controller 中 session presets host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import { agentPresetProjectionDefinition, UnknownPresetError } from '@deepseek-ai/dsh-agent-presets'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

/**
 * 功能说明：处理 stubAgent 相关流程；使用场景由所在模块及调用位置决定。
 * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Agent；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stubAgent(session)，并按返回类型处理结果。
 */
function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

/**
 * 功能说明：处理 roster 相关流程；使用场景由所在模块及调用位置决定。
 * @param ids （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 roster(ids)，并按返回类型处理结果。
 */
function roster(ids: readonly string[]): unknown {
  /**
   * 常量说明：presetOf 用于处理 presetOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 presetOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns object；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 presetOf(id)，并按返回类型处理结果。
   */
  const presetOf = (id: string): object => ({
    id,
    trust: 'system',
    path: `/presets/${id}/agent.cordis.yml`,
  })
  return {
    defaultId: ids[0],
    resolve: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（string）：标识本次操作关联的唯一对象；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
 */ (id?: string) => {
      /**
       * 常量说明：wanted 用于处理 wanted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const wanted = id ?? ids[0] ?? ''
      if (!ids.includes(wanted)) return Promise.reject(new UnknownPresetError(wanted, ids))
      return Promise.resolve(presetOf(wanted))
    },
    mount: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_ctx（Context）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：id（string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(_ctx, id)，并按返回类型处理结果。
 */ (_ctx: Context, id?: string) => Promise.resolve(presetOf(id ?? ids[0] ?? '')),
  }
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param presets （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(presets)，并按返回类型处理结果。
 */
async function harness(presets?: readonly string[]) {
  /**
   * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-session-preset-')))
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (presets !== undefined) {
    ctx.provide('agentPresets', roster(presets) as never)
  }

  /**
   * 常量说明：factory 用于处理 factory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const factory: AgentFactory = {
    /**
     * 功能说明：创建 Agent 相关流程；使用场景由所在模块及调用位置决定。
     * @param _ownerCtx （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param options （由 TypeScript 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 createAgent(_ownerCtx, options)，并按返回类型处理结果。
     */
    async createAgent(_ownerCtx, options) {
      /**
       * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      /**
       * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const agent = stubAgent(session)
      /**
       * 常量说明：agentCtx 用于处理 agentCtx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await options.setup?.(agentCtx)
      /**
       * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { unregister(); return Promise.resolve() } }
    },
    /**
     * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resume()，并按返回类型处理结果。
     */
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  /**
   * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  if (presets !== undefined) ctx.sessionProjections.register(agentPresetProjectionDefinition)
  return { ctx, remote }
}

describe('session.create Agent preset identity', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('records the requested preset on the Session header', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、remote 用于处理 ctx、remote 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, remote } = await harness(['standard', 'minimal'])

        /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const created = await remote.create({ sessionId: SessionId('s1'), agentPreset: 'minimal' })

        expect(created.ok).toBe(true)
        expect(ctx.sessions.get(SessionId('s1'))?.header.agentPreset).toBe('minimal')
      })

    it('records the roster default when the caller names no preset', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、remote 用于处理 ctx、remote 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, remote } = await harness(['standard', 'minimal'])

        await remote.create({ sessionId: SessionId('s2') })

        expect(ctx.sessions.get(SessionId('s2'))?.header.agentPreset).toBe('standard')
      })

    it('rejects an unknown preset', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { remote } = await harness(['standard'])

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote.create({ sessionId: SessionId('s3'), agentPreset: 'nope' })

        expect(response).toMatchObject({ ok: false, error: { code: 'agent-preset-not-found' } })
      })

    it('refuses to adopt a live Session under a different preset', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { remote } = await harness(['standard', 'minimal'])
        await remote.create({ sessionId: SessionId('s4'), agentPreset: 'minimal' })

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote.create({ sessionId: SessionId('s4'), agentPreset: 'standard' })

        expect(response).toMatchObject({
          ok: false,
          error: {
            code: 'agent-preset-conflict',
            details: {
              sessionId: 's4',
              requestedPreset: 'standard',
              existingPreset: 'minimal',
            },
          },
        })
      })

    it('adopts a live Session under the preset selected in its log', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、remote 用于处理 ctx、remote 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, remote } = await harness(['standard', 'minimal'])
        await remote.create({ sessionId: SessionId('s4b'), agentPreset: 'standard' })
        ctx.sessions.get(SessionId('s4b'))?.append('agent-preset/selected', { agentPreset: 'minimal' })

        /**
     * 常量说明：adopted 用于处理 adopted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const adopted = await remote.create({ sessionId: SessionId('s4b'), agentPreset: 'minimal' })
        /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stale = await remote.create({ sessionId: SessionId('s4b'), agentPreset: 'standard' })

        expect(adopted).toMatchObject({ ok: true, value: { agentPreset: 'minimal' } })
        expect(stale).toMatchObject({
          ok: false,
          error: { details: { existingPreset: 'minimal' } },
        })
      })

    it('adopts a live Session unchanged when the caller names no preset', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { remote } = await harness(['standard', 'minimal'])
        await remote.create({ sessionId: SessionId('s5'), agentPreset: 'minimal' })

        await expect(remote.create({ sessionId: SessionId('s5') }))
          .resolves.toMatchObject({ ok: true })
      })

    it('leaves the header preset-less when no roster is composed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、remote 用于处理 ctx、remote 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, remote } = await harness()

        await remote.create({ sessionId: SessionId('s6') })

        expect(ctx.sessions.get(SessionId('s6'))?.header.agentPreset).toBeUndefined()
      })

    it('explains why a preset-less Session cannot be adopted under one', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { remote } = await harness()
        await remote.create({ sessionId: SessionId('s7') })

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote.create({ sessionId: SessionId('s7'), agentPreset: 'standard' })

        expect(response).toMatchObject({
          ok: false,
          error: {
            code: 'agent-preset-conflict',
            details: {
              sessionId: 's7',
              requestedPreset: 'standard',
            },
          },
        })
        if (response.ok) throw new Error('unreachable')
        expect('existingPreset' in response.error.details).toBe(false)
        expect(response.error.message).toContain('records no agent preset')
      })
  })
