/**
 * 文件职责：验证 api/session-controller 中 controller host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import SessionController from '../src/index.ts'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

/**
 * 常量说明：defaults 用于处理 defaults 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const defaults = {
  defaultModelSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

describe('SessionController facade', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('does not require the Tools service', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(SessionController.inject).not.toContain('tools')
      })

    it('owns Host service methods and publishes Agent lifecycle projections', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        await ctx.plugin(AgentRegistry)
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('controller-session')
        /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const header: SessionHeader = {
          version: 0,
          id: sessionId,
          createdAt: 1,
          cwd: '/workspace',
        }
        /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const events: SessionEvent[] = []
        /**
     * 常量说明：inspect 用于处理 inspect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const inspect = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta: header, events }))
        ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([header]),
          inspect,
        }) as never)
        /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const controller = createSessionTestController(ctx, defaults)
        /**
     * 常量说明：status 用于处理 status 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const status = vi.fn()
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure = vi.fn()
        /**
     * 常量说明：activity 用于处理 activity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const activity = vi.fn()
        ctx.on('api-session/status', status)
        ctx.on('api-session/error', failure)
        ctx.on('api-session/activity', activity)

        await expect(controller.inspect(sessionId)).resolves.toEqual({ meta: header, events })
        expect(inspect).toHaveBeenCalledOnce()

        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(sessionId, { meta: header })
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = {
          id: sessionId,
          session,
          status: 'idle',
          ctx,
        } as Agent
        ctx.agents.register(agent)
        /**
     * 常量说明：consumeSelection 用于处理 consumeSelection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const consumeSelection = vi.spyOn(
          (controller as unknown as { agents: ApiSessionAgentController }).agents,
          'consumeSelection',
        )

        await expect(controller.resolveAgent(sessionId)).resolves.toEqual({ agent })
        await expect(controller.inspect(sessionId)).resolves.toEqual({ meta: header, events })
        expect(inspect).toHaveBeenCalledOnce()
        ctx.emit('agent/status', { agent, status: 'running' })
        ctx.emit('agent/error', { agent, turn: 1, step: 0, error: new Error('fixture failure') })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'hello' }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        expect(status).toHaveBeenCalledWith(sessionId, true)
        expect(failure).toHaveBeenCalledWith(sessionId, expect.stringContaining('fixture failure'))
        expect(activity).toHaveBeenCalledWith(sessionId, expect.any(Number))
        session.append('request/header', {
          header: { config: { provider: 'fixture', model: 'fixture-model' } },
          reason: 'initial',
        })
        expect(consumeSelection).toHaveBeenCalledWith(
          agent, 'fixture', 'fixture-model', undefined,
        )
        /**
     * 常量说明：unowned 用于处理 unowned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const unowned = ctx.sessions.create(SessionId('controller-unowned'), {
          meta: { cwd: '/workspace' },
        })
        unowned.append('request/header', {
          header: { config: { provider: 'fixture', model: 'other-model' } },
          reason: 'initial',
        })
        expect(consumeSelection).toHaveBeenCalledTimes(1)

        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = controller.follow({
          address: { kind: 'session', sessionId },
        }, abort.signal)[Symbol.asyncIterator]()
        await expect(iterator.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'snapshot', cursor: 1 },
        })
        abort.abort()
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
      })

    it.each(['success', 'domain-error', 'throw'] as const)(
      'promotes a prepared follow observation in the background: %s',
      /*
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
     */ async (outcome) => {
      /**
       * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        await ctx.plugin(AgentRegistry)
        /**
       * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const sessionId = SessionId(`background-${outcome}`)
        /**
       * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const header: SessionHeader = {
          version: 0, id: sessionId, createdAt: 1, cwd: '/workspace',
        }
        ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([header]),
          inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta: header, events: [] }),
        }) as never)
        /**
       * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
        const controller = createSessionTestController(ctx, defaults)
        /**
       * 常量说明：agents 用于处理 agents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const agents = (controller as unknown as { agents: ApiSessionAgentController }).agents
        /**
       * 常量说明：apiError 用于处理 apiError 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const apiError = vi.fn()
        ctx.on('api-session/error', apiError)
        /**
       * 常量说明：logError 用于处理 logError 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const logError = vi.spyOn(ctx.logger, 'error').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {})
        /**
       * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const live = { id: sessionId, session: { id: sessionId }, ctx, status: 'idle' } as unknown as Agent
        /**
       * 常量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const resolve = vi.spyOn(agents, 'resolveObservedAgent')
        if (outcome === 'success') resolve.mockResolvedValue({ agent: live })
        else if (outcome === 'domain-error') {
          resolve.mockResolvedValue({
            error: { code: 'internal', message: 'activation unavailable', details: {} },
          })
        } else {
          resolve.mockRejectedValue(new Error('activation crashed'))
        }
        /**
       * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const abort = new AbortController()
        /**
       * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const iterator = controller.follow({
          address: { kind: 'session', sessionId },
        }, abort.signal)[Symbol.asyncIterator]()

        await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
        /**
       * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const waiting = iterator.next()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(resolve).toHaveBeenCalledOnce() })
        if (outcome === 'domain-error') {
          await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
              expect(apiError).toHaveBeenCalledWith(sessionId, 'activation unavailable')
            })
        } else if (outcome === 'throw') {
          await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
              expect(logError).toHaveBeenCalledWith(expect.stringContaining('activation crashed'))
            })
        } else {
          expect(apiError).not.toHaveBeenCalled()
        }
        abort.abort()
        await expect(waiting).resolves.toMatchObject({ done: true })
        await ctx.fiber.dispose()
      },
    )

    it('waits for an admitted background promotion during teardown', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        await ctx.plugin(AgentRegistry)
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = SessionId('background-disposal')
        /**
     * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const header: SessionHeader = {
          version: 0, id: sessionId, createdAt: 1, cwd: '/workspace',
        }
        ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([header]),
          inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta: header, events: [] }),
        }) as never)
        /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const controller = createSessionTestController(ctx, defaults)
        /**
     * 常量说明：agents 用于处理 agents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agents = (controller as unknown as { agents: ApiSessionAgentController }).agents
        /**
     * 常量说明：started 用于处理 started 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const started = Promise.withResolvers<undefined>()
        /**
     * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const release = Promise.withResolvers<undefined>()
        vi.spyOn(agents, 'resolveObservedAgent').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
            started.resolve(undefined)
            await release.promise
            return {
              agent: { id: sessionId, session: { id: sessionId }, ctx, status: 'idle' } as unknown as Agent,
            }
          })
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = controller.follow({
          address: { kind: 'session', sessionId },
        }, new AbortController().signal)[Symbol.asyncIterator]()

        await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
        /**
     * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const waiting = iterator.next()
        await started.promise
        /**
     * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let disposed = false
        /**
     * 常量说明：disposal 用于处理 disposal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const disposal = ctx.fiber.dispose().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { disposed = true })
        await Promise.resolve()
        expect(disposed).toBe(false)

        release.resolve(undefined)
        await disposal
        await expect(waiting).resolves.toMatchObject({ done: true })
      })
  })
