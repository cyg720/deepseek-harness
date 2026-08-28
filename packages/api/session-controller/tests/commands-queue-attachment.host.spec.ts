/**
 * 文件职责：验证 api/session-controller 中 commands queue attachment host spec
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

/**
 * 功能说明：处理 commandHarness 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<{ ctx: Context controller: SessionCommandController
 * agent: Ag…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 commandHarness()，并按返回类型处理结果。
 */
async function commandHarness(): Promise<{
  ctx: Context
  controller: SessionCommandController
  agent: Agent
  inbox: Inbox
  steer: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const session = ctx.sessions.create(SessionId('commands-session'), { meta: { cwd: '/workspace' } })
  /**
   * 常量说明：inbox 用于处理 inbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inbox = new Inbox(session, { inserted: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, discarded: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}, claimed: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} })
  /**
   * 常量说明：steer 用于处理 steer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const steer = vi.fn()
  /**
   * 常量说明：cancel 用于处理 cancel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cancel = vi.fn()
  /**
   * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agent = {
    id: session.id,
    session,
    inbox,
    status: 'running',
    ctx,
    steer,
    followup: vi.fn(),
    cancel,
  } as unknown as Agent
  ctx.agents.register(agent)
  ctx.provide('workspaceRegistry', { get: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined, list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => [] } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(),
  } as never)
  /**
   * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selection: ModelSelectionRef = {
    current: { provider: 'fixture', model: 'fixture-model' },
    assembled: undefined,
  }
  /**
   * 常量说明：agents 用于处理 agents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agents = {
    resolveAgent: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ agent }),
    selectionFor: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => selection,
    serializeImageAdmission: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_agent（Agent）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：operation（() => Promise<Value>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(_agent, operation)，并按返回类型处理结果。
 */ <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
    composeAgent: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ setup: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} }),
  } as unknown as ApiSessionAgentController
  return { ctx, controller: new SessionCommandController(ctx, agents, '/workspace'), agent, inbox, steer, cancel }
}

/**
 * 功能说明：处理 expectFailure 相关流程；使用场景由所在模块及调用位置决定。
 * @param operation （Promise<unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 expectFailure(operation, code)，并按返回类型处理结果。
 */
async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ failure: { code } })
}

describe('Session queue commands', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('edits, removes, steers, and rejects stale queue occurrences', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、controller、agent、inbox、steer、cancel 用于处理
     * ctx、controller、agent、inbox、steer、cancel 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, controller, agent, inbox, steer, cancel } = await commandHarness()
        /**
     * 常量说明：queued 用于处理 queued 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const queued = createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } })
        /**
     * 常量说明：nextStep 用于处理 nextStep 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const nextStep = createUserMessage({ content: [{ type: 'text', text: 'step' }], source: { kind: 'user' } })
        inbox.append('next-turn', queued)
        inbox.append('next-step', nextStep)

        await expectFailure(Promise.resolve().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => controller.updateQueue({
            sessionId: agent.id,
            itemId: queued.id,
            action: {
              kind: 'edit',
              content: [{
                type: 'image',
                attachment: {
                  attachmentId: AttachmentId('att-edit'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
                },
              }],
            },
          })), 'attachment-error')
        await expectFailure(Promise.resolve().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => controller.updateQueue({
            sessionId: SessionId('missing'), itemId: queued.id, action: { kind: 'remove' },
          })), 'queue-item-not-found')
        await expectFailure(Promise.resolve().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => controller.updateQueue({
            sessionId: agent.id, itemId: MessageId('missing'), action: { kind: 'remove' },
          })), 'queue-item-not-found')
        await expectFailure(Promise.resolve().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => controller.updateQueue({
            sessionId: agent.id, itemId: nextStep.id, action: { kind: 'steer' },
          })), 'steer-unavailable')

        Object.assign(agent, { status: 'idle' })
        await expectFailure(Promise.resolve().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => controller.updateQueue({
            sessionId: agent.id, itemId: queued.id, action: { kind: 'steer' },
          })), 'steer-unavailable')
        expect(controller.updateQueue({
          sessionId: agent.id,
          itemId: queued.id,
          action: { kind: 'edit', content: [{ type: 'text', text: 'edited' }] },
        })).toEqual({ accepted: true })
        expect(inbox.nextTurn[0]?.content).toEqual([{ type: 'text', text: 'edited' }])
        expect(controller.updateQueue({
          sessionId: agent.id, itemId: nextStep.id, action: { kind: 'remove' },
        })).toEqual({ accepted: true })

        Object.assign(agent, { status: 'running' })
        /**
     * 常量说明：steered 用于处理 steered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const steered = inbox.nextTurn[0]
        if (steered === undefined) throw new Error('missing edited queue item')
        expect(controller.updateQueue({
          sessionId: agent.id, itemId: steered.id, action: { kind: 'steer' },
        })).toEqual({ accepted: true })
        expect(steer).toHaveBeenCalledWith(steered)

        await expectFailure(Promise.resolve().then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => controller.cancel({
            sessionId: SessionId('missing'),
          })), 'session-not-found')
        expect(controller.cancel({ sessionId: agent.id })).toEqual({ accepted: true })
        expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
        await ctx.fiber.dispose()
      })
  })

/**
 * 功能说明：处理 imageRef 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns ImageAttachmentRef；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 imageRef(id)，并按返回类型处理结果。
 */
function imageRef(id: string): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(id),
    mediaType: 'image/png',
    bytes: 1,
    width: 1,
    height: 1,
  }
}

/**
 * 功能说明：处理 event 相关流程；使用场景由所在模块及调用位置决定。
 * @param type （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEvent；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 event(type, seq, data)，并按返回类型处理结果。
 */
function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq + 1, data } as SessionEvent
}

/**
 * 功能说明：处理 persistedController 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param readImage （(ref: ImageAttachmentRef) => Promise<{ ref:
 * ImageAttachment…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<{ ctx: Context; controller: SessionCommandController;
 * session…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 persistedController(events, readImage)，并按返回类型处理结果。
 */
async function persistedController(
  events: SessionEvent[],
  readImage: (ref: ImageAttachmentRef) => Promise<{ ref: ImageAttachmentRef; data: Uint8Array }>,
): Promise<{ ctx: Context; controller: SessionCommandController; sessionId: SessionId }> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /**
   * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessionId = SessionId('cold-attachment')
  /**
   * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const meta: SessionHeader = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([meta]),
    inspect: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ meta, events }),
  }) as never)
  installSessionReadTestServices(ctx)
  ctx.provide('attachments', { readImage } as never)
  /**
   * 常量说明：agents 用于处理 agents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agents = { resolveAgent: vi.fn() } as unknown as ApiSessionAgentController
  return { ctx, controller: new SessionCommandController(ctx, agents, '/workspace'), sessionId }
}

describe('Session attachment authorization', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('finds references in direct, message, inserted, nested, and streamed content', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const nested = imageRef('nested')
        /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const message = imageRef('message')
        /**
     * 常量说明：inserted 用于处理 inserted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const inserted = imageRef('inserted')
        /**
     * 常量说明：streamed 用于处理 streamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const streamed = imageRef('streamed')
        /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const events = [
          event('fixture/direct', 0, {
            content: [null, [], { type: 'tool-result', content: [{ type: 'text', text: 'none' }] }, {
              type: 'tool-result', content: [{ type: 'image', attachment: nested }],
            }],
          }),
          { ...event('assistant/message', 1, {
            turn: 1,
            step: 1,
            message: createAssistantMessage({
              content: [{ type: 'image', attachment: message }],
              source: { provider: 'fixture', model: 'fixture' },
            }),
          }), surfaceOp: 'append' as const },
          event('agent/inbox/spliced', 2, {
            target: 'next-turn',
            start: 0,
            inserted: [createUserMessage({
              content: [{ type: 'image', attachment: inserted }],
              source: { kind: 'user' },
            })],
          }),
          event('assistant/chunk', 3, {
            turn: 1,
            step: 1,
            chunk: { type: 'block-end', index: 0, block: { type: 'image', attachment: streamed } },
          }),
        ]
        /**
     * 常量说明：readImage 用于读取 Image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const readImage = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ref（ImageAttachmentRef）：提供本次调用所需的
 * 数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * ；典型用法：在完成前置校验后调用 匿名回调(ref)，并按返回类型处理结果。
 */ (ref: ImageAttachmentRef) => Promise.resolve({ ref, data: Uint8Array.of(1) }))
        /**
     * 常量说明：ctx、controller、sessionId 用于处理 ctx、controller、sessionId 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx, controller, sessionId } = await persistedController(events, readImage)

        for (const /*
     * 变量说明：ref 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ ref of [nested, message, inserted, streamed]) {
          await expect(controller.attachment({ sessionId, attachmentId: ref.attachmentId }))
            .resolves.toEqual({ attachment: ref, data: 'AQ==' })
        }
        expect(readImage).toHaveBeenCalledTimes(4)
        await ctx.fiber.dispose()
      })

    it('maps missing persistence identities and attachment backend failures', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：noPersistence 用于处理 noPersistence 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const noPersistence = new Context()
        await noPersistence.plugin(SessionStore)
        installSessionReadTestServices(noPersistence)
        /**
     * 常量说明：noPersistenceController 用于处理 noPersistenceController 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const noPersistenceController = new SessionCommandController(
          noPersistence,
          { resolveAgent: vi.fn() } as unknown as ApiSessionAgentController,
          '/workspace',
        )
        await expectFailure(noPersistenceController.attachment({
          sessionId: SessionId('missing'), attachmentId: AttachmentId('att'),
        }), 'session-not-found')

        /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const missing = new Context()
        await missing.plugin(SessionStore)
        missing.provide('sessionPersistence', testSessionPersistence(missing, {
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([]),
          inspect: vi.fn(),
        }) as never)
        installSessionReadTestServices(missing)
        /**
     * 常量说明：missingController 用于处理 missingController 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const missingController = new SessionCommandController(
          missing,
          { resolveAgent: vi.fn() } as unknown as ApiSessionAgentController,
          '/workspace',
        )
        await expectFailure(missingController.attachment({
          sessionId: SessionId('missing'), attachmentId: 'att' as never,
        }), 'session-not-found')

        for (const /*
     * 变量说明：thrown 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ thrown of [
            new AttachmentError('stored image is unavailable', 'ATTACHMENT_NOT_FOUND'),
            new Error('backend offline'),
          ]) {
          /**
       * 常量说明：ref 用于处理 ref 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const ref = imageRef(`failure-${thrown.name}`)
          /**
       * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const fixture = await persistedController(
            [event('fixture/content', 0, { content: [{ type: 'image', attachment: ref }] })],
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */ () => Promise.reject(thrown),
          )
          await expectFailure(fixture.controller.attachment({
            sessionId: fixture.sessionId,
            attachmentId: ref.attachmentId,
          }), thrown instanceof AttachmentError ? 'attachment-error' : 'internal')
          await fixture.ctx.fiber.dispose()
        }
      })

    it('maps a cold observation failure to an internal authorization error', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        installSessionReadTestServices(ctx)
        vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(new Error('storage offline'))
        /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const controller = new SessionCommandController(
          ctx,
          { resolveAgent: vi.fn() } as unknown as ApiSessionAgentController,
          '/workspace',
        )

        await expectFailure(controller.attachment({
          sessionId: SessionId('unreadable'), attachmentId: AttachmentId('att'),
        }), 'internal')
        await ctx.fiber.dispose()
      })
  })
