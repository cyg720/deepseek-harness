/**
 * Session Controller projection paths: the history tail page's
 * projections block reads the registry's watermark snapshot (asOfSeq = last
 * event seq, one consistent cut); loadOlder pages never carry the block; a
 * composition without the registry serves histories without it; a disposed
 * registration's key leaves subsequent responses; and every unit change is
 * pushed through the control stream.
 * @remarks 文件说明：文件职责：验证 api/session-controller 中 session projections host
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SessionControlController } from '@deepseek-ai/dsh-api-session-controller/src/control.ts'
import type { SessionControlFrame, SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'test/last-user': LastUserState
    'test/internal-count': number
  }
  interface SessionProjectionMap {
    'test/last-user': { text: string } | null
  }
}

/**
 * 功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。
 * @param payload （P）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns P；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 request(payload)，并按返回类型处理结果。
 */
function request<P>(payload: P): P {
  return payload
}

/**
 * 功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。
 * @param remote （TestSessionRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param request （{ sessionId: SessionId; throughSeq: number; beforeSeq?:
 * num…）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 page(remote, request)，并按返回类型处理结果。
 */
function page(
  remote: TestSessionRemote,
  request: { sessionId: SessionId; throughSeq: number; beforeSeq?: number; maxMessages?: number },
) {
  return remote.page({
    address: { kind: 'session', sessionId: request.sessionId },
    throughSeq: request.throughSeq,
    ...(request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq }),
    ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
  })
}

/** Read and close one snapshot-first follow generation.
 * @remarks 中文说明：功能说明：处理 opening 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：remote（TestSessionRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：maxMessages（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<Extract<SessionFollowFrame, { type: 'snapshot' }>>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 opening(remote,
 * sessionId, maxMessages)，并按返回类型处理结果。 */
async function opening(
  remote: TestSessionRemote,
  sessionId: SessionId,
  maxMessages?: number,
): Promise<Extract<SessionFollowFrame, { type: 'snapshot' }>> {
  /**
   * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const abort = new AbortController()
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const iterator = remote.follow({
    address: { kind: 'session', sessionId },
    ...(maxMessages === undefined ? {} : { maxMessages }),
  }, abort.signal)[Symbol.asyncIterator]()
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = await iterator.next()
  abort.abort()
  await iterator.return?.()
  if (first.done || first.value.type !== 'snapshot') throw new Error('follow did not open with a snapshot')
  return first.value
}

/** Whole-value unit folding the latest user/message text; null before the first. */
type LastUserState = { text: string } | null
/**
 * 常量说明：lastUserUnit 用于处理 lastUserUnit 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 lastUserUnit 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 lastUserUnit()，并按返回类型处理结果。
 */
const lastUserUnit = () => ({
  key: 'test/last-user',
  stateSchema: z.union([z.object({ text: z.string() }), z.null()]),
  init: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => null,
  apply: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state, event)，并按返回类型处理结果。
 */ (state, event) => (event.type === 'user/message'
    ? { text: (event.data.content[0] as { text?: string }).text ?? '' }
    : state),
  wire: {
    viewSchema: z.union([z.object({ text: z.string() }), z.null()]),
    view: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
 */ state => state,
  },
  stateVersion: 1,
}) satisfies ProjectionDefinition<'test/last-user', LastUserState>

/**
 * 常量说明：internalCountUnit 用于处理 internalCountUnit 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 internalCountUnit 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 internalCountUnit()，并按返回类型处理结果。
 */
const internalCountUnit = () => ({
  key: 'test/internal-count',
  stateSchema: z.number().int().nonnegative(),
  init: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => 0,
  apply: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（number）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
 */ (state: number) => state + 1,
  stateVersion: 1,
}) satisfies ProjectionDefinition<'test/internal-count', number>

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param withRegistry （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<{ ctx: Context; session: Session }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(withRegistry)，并按返回类型处理结果。
 */
async function harness(withRegistry: boolean): Promise<{ ctx: Context; session: Session }> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (withRegistry) await ctx.plugin(SessionProjectionRegistry)
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
  // The gateway reads both the session and durable inbox baseline.
  ctx.agents.register({ id: session.id, session, inbox: new Inbox(session, { inserted: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, discarded: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, claimed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} }), status: 'idle', ctx } as Agent)
  return { ctx, session }
}

/** Append `count` user messages so the log has paginable message boundaries.
 * @remarks 中文说明：功能说明：处理 seedMessages 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：count（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 seedMessages(session, count)，
 * 并按返回类型处理结果。 */
function seedMessages(session: Session, count: number): void {
  for (let /*
   * 变量说明：i 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ i = 0; i < count; i++) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `m${i}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
}

/**
 * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 remote 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remote(ctx)，并按返回类型处理结果。
 */
const remote = (ctx: Context) => createSessionTestRemote(ctx, { defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('session.history projections block', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('tracks pending and used model selections across repeated request headers', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        remote(ctx)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const selected = { provider: 'p', model: 'next' }
        session.append('model/selection', selected)
        session.append('model/selection', selected)
        session.append('request/header', {
          header: { config: { provider: 'p', model: 'used' } }, reason: 'initial',
        })
        session.append('request/header', {
          header: { config: { provider: 'p', model: 'used' } }, reason: 'initial',
        })

        expect(ctx.sessionProjections.snapshot(session).values.modelSelection).toEqual({
          lastUsed: { provider: 'p', model: 'used' },
          next: selected,
        })

        session.append('request/header', {
          header: { config: selected }, reason: 'initial',
        })
        expect(ctx.sessionProjections.snapshot(session).values.modelSelection).toEqual({
          lastUsed: selected,
          next: selected,
        })
      })

    it('serves the unit value on the tail page with asOfSeq = last event seq', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(lastUserUnit())
        seedMessages(session, 3)
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await opening(remote(ctx), session.id)
        /**
     * 常量说明：records、projections 用于处理 records、projections 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { records, projections } = snapshot
        expect(projections.asOfSeq).toBe(session.seq - 1)
        expect(projections.values['test/last-user']).toEqual({ text: 'm2' })
        // asOfSeq IS the window tail: the last served event carries it.
        /**
     * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const last = records.at(-1)
        expect(last?.event.seq).toBe(projections.asOfSeq)
      })

    it('returns a complete current replacement cut on each follow generation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(lastUserUnit())
        seedMessages(session, 2)

        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await opening(remote(ctx), session.id)

        expect(snapshot.records.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.event.seq)).toEqual([0, 1])
        expect(snapshot.projections.asOfSeq).toBe(1)
        expect(snapshot.projections.values).toEqual(
          expect.objectContaining({ 'test/last-user': { text: 'm1' } }),
        )
      })

    it('projects an empty log at cursor -1', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(lastUserUnit())

        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await opening(remote(ctx), session.id)

        expect(snapshot.records).toEqual([])
        expect(snapshot.projections.asOfSeq).toBe(-1)
        expect(snapshot.projections.values).toEqual(
          expect.objectContaining({ 'test/last-user': null }),
        )
      })

    it('publishes the attachments imageLimits as a constant unit while both seams are composed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        /**
     * 常量说明：limits 用于处理 limits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const limits = {
          maxImageBytes: 5 * 1024 * 1024,
          maxImagesPerMessage: 20,
          maxMessageImageBytes: 100 * 1024 * 1024,
          maxImagePixels: 40_000_000,
          maxImageDimension: 2000,
          mediaTypes: ['image/png'] as const,
        }
        await ctx.plugin(/**
 * 类说明：匿名类 用于集中封装 处理 匿名类 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。
 */
          class extends AttachmentStore {
            /**
       * 常量说明：imageLimits 用于处理 imageLimits 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
            readonly imageLimits = limits
            /**
       * 功能说明：校验 Image 相关流程；使用场景由所在模块及调用位置决定。
       * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 validateImage()，并按返回类型处理结果。
       */
            validateImage(): Promise<void> { return Promise.resolve() }
            /**
       * 功能说明：保存 Image 相关流程；使用场景由所在模块及调用位置决定。
       * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 saveImage()，并按返回类型处理结果。
       */
            saveImage(): Promise<never> { return Promise.reject(new Error('unused')) }
            /**
       * 功能说明：读取 Image 相关流程；使用场景由所在模块及调用位置决定。
       * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 readImage()，并按返回类型处理结果。
       */
            readImage(): Promise<never> { return Promise.reject(new Error('unused')) }
          })
        /**
     * 常量说明：gateway 用于处理 gateway 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gateway = remote(ctx)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        seedMessages(session, 2)
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await opening(gateway, session.id)
        expect(snapshot.projections.values['imageLimits']).toEqual(limits)
        // Constant unit: appending events must never broadcast an imageLimits projection.
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = gateway.control(abort.signal)[Symbol.asyncIterator]()
        await iterator.next()
        /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const next = iterator.next()
        seedMessages(session, 1)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        await expect(next).resolves.toMatchObject({
          done: false,
          value: { type: 'projection', key: 'sessionListMetadata' },
        })
        /**
     * 常量说明：extra 用于处理 extra 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const extra = iterator.next()
        /**
     * 常量说明：quiet 用于处理 quiet 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const quiet = Symbol('quiet')
        expect(await Promise.race([
          extra,
          new Promise<typeof quiet>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve(quiet) }, 0)),
        ])).toBe(quiet)
        abort.abort()
        await expect(extra).resolves.toEqual({ done: true, value: undefined })
      })

    it('leaves the imageLimits key absent while no attachment service is composed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        seedMessages(session, 1)
        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await opening(remote(ctx), session.id)
        expect('imageLimits' in snapshot.projections.values).toBe(false)
      })

    it('never carries the block on loadOlder pages (beforeSeq present)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(lastUserUnit())
        seedMessages(session, 5)
        /**
     * 常量说明：older 用于处理 older 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const older = await page(remote(ctx), request({
          sessionId: session.id, throughSeq: session.seq - 1, beforeSeq: 3, maxMessages: 2,
        }))
        expect(older.ok).toBe(true)
        if (!older.ok) throw new Error('unreachable')
        expect('projections' in older.value).toBe(false)
      })

    it('serves no block when the composition has no projection registry', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(false)
        seedMessages(session, 2)
        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await page(remote(ctx), request({ sessionId: session.id, throughSeq: session.seq - 1 }))
        expect(response.ok).toBe(true)
        if (!response.ok) throw new Error('unreachable')
        expect('projections' in response.value).toBe(false)
      })

    it('never exposes a host-only unit through history, listing, or push frames', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(internalCountUnit())
        /**
     * 常量说明：proxy 用于处理 proxy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const proxy = remote(ctx)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = proxy.control(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const baseline = await iterator.next()
        if (baseline.done || baseline.value.type !== 'baseline') {
          throw new Error('control stream ended before its baseline')
        }
        expect('test/internal-count' in (baseline.value.value.projections[session.id]?.values ?? {}))
          .toBe(false)

        seedMessages(session, 1)
        /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const changed = await iterator.next()
        expect(changed).toMatchObject({
          done: false,
          value: { type: 'projection', key: 'sessionListMetadata' },
        })
        abort.abort()
        await iterator.return?.()

        /**
     * 常量说明：history 用于处理 history 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const history = await opening(proxy, session.id)
        expect('test/internal-count' in history.projections.values).toBe(false)
        /**
     * 常量说明：listing 用于处理 listing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const listing = await proxy.list(request({}))
        if (!listing.ok) throw new Error('listing failed')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = listing.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === session.id)
        expect('test/internal-count' in (row?.projections?.values ?? {})).toBe(false)
      })

    it('drops a disposed registration from subsequent tail pages (empty block, key absent)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const dispose = ctx.sessionProjections.register(lastUserUnit())
        seedMessages(session, 1)
        /**
     * 常量说明：proxy 用于处理 proxy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const proxy = remote(ctx)
        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = await opening(proxy, session.id)
        expect(before.projections.values['test/last-user']).toEqual({ text: 'm0' })

        dispose()
        /**
     * 常量说明：after 用于处理 after 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const after = await opening(proxy, session.id)
        // The registry stays mounted; only the disposed key leaves while the
        // gateway-owned Session-list unit remains.
        expect(after.projections.asOfSeq).toBe(session.seq - 1)
        expect('test/last-user' in after.projections.values).toBe(false)
        expect(after.projections.values.sessionListMetadata).toEqual({
          blank: true,
          lastPromptAt: session.events.at(-1)?.time,
        })
      })

    it('removes the gateway-owned Session-list unit when the gateway fiber unloads', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        expect('sessionListMetadata' in ctx.sessionProjections.snapshot(session).values).toBe(false)
        /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const fiber = ctx.plugin(Object.assign(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：gatewayCtx（Context）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(gatewayCtx)，并按返回类型处理结果。
 */ (gatewayCtx: Context) => {
            createSessionTestRemote(gatewayCtx, { defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
          }, { inject: ['sessions', 'agents', 'sessionProjections'] }))
        await fiber.await()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(ctx.sessionProjections.snapshot(session).values.sessionListMetadata)
              .toEqual({ blank: true, lastPromptAt: null })
          })
        await fiber.dispose()
        expect('sessionListMetadata' in ctx.sessionProjections.snapshot(session).values).toBe(false)
      })
  })

describe('session.list projections column', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('serves every already-materialized wire value from the live registry without folding', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(lastUserUnit())
        /**
     * 常量说明：gateway 用于处理 gateway 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gateway = remote(ctx)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        session.append('turn/start', { turn: 1 })
        seedMessages(session, 1)
        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await gateway.list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === session.id)
        expect(row?.projections?.values['test/last-user']).toEqual({ text: 'm0' })
        expect(row?.projections?.values.sessionListMetadata).toEqual({
          blank: false,
          lastPromptAt: session.events.at(-1)?.time,
        })
        expect(row?.projections?.asOfSeq).toBe(session.seq - 1)
      })

    it('lists the latest preset selected by a blank Session instead of its creation preset', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness(true)
        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('preset-list'), {
          meta: { cwd: '/workspace', agentPreset: 'standard' },
        })
        ctx.sessionProjections.register(agentPresetProjectionDefinition)
        /**
     * 常量说明：gateway 用于处理 gateway 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gateway = remote(ctx)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        session.append('agent-preset/selected', { agentPreset: 'minimal' })

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await gateway.list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === session.id)
        expect(row?.projections?.values.agentPreset).toBe('minimal')
      })

    it('omits an unmaterialized live projection instead of folding history for listing', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        seedMessages(session, 1)
        /**
     * 常量说明：unit 用于处理 unit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const unit = lastUserUnit()
        /**
     * 常量说明：apply 用于注册并应用 apply 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const apply = vi.fn(unit.apply)
        ctx.sessionProjections.register({ ...unit, apply })

        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote(ctx).list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === session.id)
        expect(row).toBeDefined()
        expect('test/last-user' in (row?.projections?.values ?? {})).toBe(false)
        expect(apply).not.toHaveBeenCalled()
      })

    it('omits the column entirely when no registry is mounted', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(false)
        seedMessages(session, 1)
        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote(ctx).list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === session.id)
        expect(row).toBeDefined()
        expect(row !== undefined && 'projections' in row).toBe(false)
      })

    it('serves every available cold projection hint from the cache with zero log loads', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness(true)
        /**
     * 常量说明：coldId 用于处理 coldId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const coldId = SessionId('session-cold-listing')
        /**
     * 常量说明：load 用于加载 load 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：加载 load 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 load()，并按返回类型处理结果。
     */
        const load = () => { throw new Error('list must not load event logs') }
        ctx.provide('sessionPersistence', {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
          locate: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined,
          load,
          inspect: load,
          readFrom: load,
        } as never)
        ctx.provide('sessionProjectionCache', {
          // The carrier hands the listed header through as the identity witness.
          cachedSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：meta（{ id: unknown; createdAt:
 * number }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(meta)，并按返回类型处理结果。
 */ (meta: { id: unknown; createdAt: number }) =>
            (meta.id === coldId && meta.createdAt === 5
              ? {
                asOfSeq: 7,
                values: {
                  'test/last-user': { text: 'cached' },
                  sessionListMetadata: { blank: false, lastPromptAt: 6 },
                  title: 'Cached title',
                },
              }
              : undefined),
        } as never)
        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote(ctx).list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === coldId)
        expect(row?.running).toBe(false)
        expect(row?.projections).toEqual({
          asOfSeq: 7,
          values: {
            'test/last-user': { text: 'cached' },
            sessionListMetadata: { blank: false, lastPromptAt: 6 },
            title: 'Cached title',
          },
        })
      })

    it('cold rows without a cache plugin (or without a stored row) just lack the column', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx } = await harness(true)
        /**
     * 常量说明：coldId 用于处理 coldId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const coldId = SessionId('session-cold-uncached')
        ctx.provide('sessionPersistence', {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
          locate: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined,
        } as never)
        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote(ctx).list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === coldId)
        expect(row).toBeDefined()
        expect(row !== undefined && 'projections' in row).toBe(false)
      })

    it('a throwing column read degrades that row, never the listing', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register({
          ...lastUserUnit(),
          wire: {
            viewSchema: z.union([z.object({ text: z.string() }), z.null()]),
            view: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { throw new Error('unit exploded') },
          },
        })
        seedMessages(session, 1)
        /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const response = await remote(ctx).list(request({}))
        if (!response.ok) throw new Error('unreachable')
        /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const row = response.value.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.sessionId === session.id)
        expect(row).toBeDefined()
        expect(row !== undefined && 'projections' in row).toBe(false)
      })
  })

describe('Session control projection frames', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
  /** Drain frames until `count` projection replacements arrive.
   * @remarks 中文说明：功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：iterable（AsyncIterable<SessionControlFrame>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：count（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：abort（AbortController）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionControlFrame[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 collect(iterable, count, abort)，并按返回类型处理结果。 */
    async function collect(
      iterable: AsyncIterable<SessionControlFrame>,
      count: number,
      abort: AbortController,
    ): Promise<SessionControlFrame[]> {
    /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const frames: SessionControlFrame[] = []
      for await (const /*
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ frame of iterable) {
        frames.push(frame)
        if (frames.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.type === 'projection').length >= count) abort.abort()
      }
      return frames
    }

    it('broadcasts a frame per changed unit with the causing seq, and none for same-reference applies', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(true)
        ctx.sessionProjections.register(lastUserUnit())
        /**
     * 常量说明：proxy 用于处理 proxy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const proxy = remote(ctx)
        // The controller's onChanged subscription lives in an inject child whose
        // fiber activates asynchronously; yield until it lands before appending.
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = proxy.control(abort.signal)
        /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const collected = collect(stream, 5, abort)

        /**
     * 常量说明：now 用于处理 now 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const now = vi.spyOn(Date, 'now').mockReturnValue(100)
        seedMessages(session, 1)
        now.mockReturnValue(200)
        session.append('turn/start', { turn: 1 })
        now.mockReturnValue(300)
        seedMessages(session, 1)
        now.mockRestore()

        /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frames = await collected
        /**
     * 常量说明：pushes 用于处理 pushes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pushes = frames.filter(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：f（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：f is
       * Extract<SessionControlFrame, { type: 'projection' }>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(f)，并按返回类型处理结果。
       */ (f): f is Extract<SessionControlFrame, { type: 'projection' }> =>
            f.type === 'projection' && f.key === 'test/last-user',
        )
        expect(pushes).toEqual([
          { type: 'projection', sessionId: session.id, key: 'test/last-user', value: { text: 'm0' }, seq: 0 },
          { type: 'projection', sessionId: session.id, key: 'test/last-user', value: { text: 'm0' }, seq: 2 },
        ])
        expect(frames.filter(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：f（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：f is
       * Extract<SessionControlFrame, { type: 'projection' }>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(f)，并按返回类型处理结果。
       */ (f): f is Extract<SessionControlFrame, { type: 'projection' }> =>
            f.type === 'projection' && f.key === 'sessionListMetadata',
        )).toEqual([
          { type: 'projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: true, lastPromptAt: 100 }, seq: 0 },
          { type: 'projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 100 }, seq: 1 },
          { type: 'projection', sessionId: session.id, key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 300 }, seq: 2 },
        ])
        // Frame seq aligns with the tail block's asOfSeq vocabulary (higher-seq-wins compatible).
        /**
     * 常量说明：tail 用于处理 tail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const tail = await opening(proxy, session.id)
        expect(tail.projections.asOfSeq).toBe(pushes.at(-1)?.seq)
      })

    it('emits no projection frames when the composition has no registry', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、session 用于处理 ctx、session 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, session } = await harness(false)
        /**
     * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const control = new SessionControlController(ctx)
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const baseline = await iterator.next()
        /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const next = iterator.next()
        seedMessages(session, 2)
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => setTimeout(resolve, 0))
        abort.abort()
        if (baseline.done) throw new Error('Control stream ended before its baseline')
        expect(baseline.value.type).toBe('baseline')
        await expect(next).resolves.toEqual({ done: true, value: undefined })
      })
  })
