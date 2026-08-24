/**
 * 文件职责：验证多会话对话注册表的创建、复用、事件分发和释放。
 * 技术维度：Vitest、Map 注册表、会话标识和 ConversationAssembler。
 * 产品维度：让多个会话页共享正确投影实例，同时避免关闭页面后继续占用状态。
 * 逻辑维度：取得或创建会话投影，发送事件，比较实例与快照，再释放和重新创建。
 * 关键边界：不同会话不能共享事件；引用释放后旧实例不应继续作为当前注册项。
 * 新手阅读建议：先看注册表创建方式，再读实例复用、隔离和释放三个场景。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ConversationEventRegistry } from '../src/client/conversation/event-registry.ts'
import { ConversationViewRegistry } from '../src/client/conversation/view-registry.ts'
import type {
  ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode,
} from '../src/client/contract/conversation.ts'
import { Session } from '../src/client/sessions/session.ts'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

/** 中文说明：测试辅助函数 `eventDefinition`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function eventDefinition(kind: string): ConversationNodeDefinition<null> {
  return {
    kind,
    target: 'chat',
    match: () => null,
    start: () => null,
    update: context => context.state,
    buildViewNode: () => null,
  }
}

/** 中文说明：测试辅助函数 `viewDefinition`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function viewDefinition(target: string): ConversationViewDefinition<ConversationViewNode, null> {
  return {
    target,
    create: () => ({
      empty: null,
      replace: () => null,
      apply: () => null,
    }),
  }
}

/** 中文说明：测试辅助函数 `bootRegistries`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
async function bootRegistries(): Promise<{
  ctx: Context
  events: ConversationEventRegistry
  views: ConversationViewRegistry
}> {
  /** 中文说明：当前操作所属的 Cordis 上下文；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `events` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const events = ctx.get('conversationEvents') as ConversationEventRegistry
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `views` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const views = ctx.get('conversationViews') as ConversationViewRegistry
  return { ctx, events, views }
}

describe('Conversation registries', () => {
  it('rejects duplicate Event Definitions and disposes an ordinary registration once', async () => {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `{ events }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { events } = await bootRegistries()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition = eventDefinition('message')
    /** 中文说明：释放订阅、注册或后台任务的清理函数；变量 `dispose` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const dispose = events.register(definition)

    expect(events.entries()).toEqual([definition])
    expect(() => events.register(eventDefinition('message'))).toThrow(/already registered/)

    dispose()
    dispose()
    expect(events.entries()).toEqual([])
  })

  it('rejects a duplicate fallback and clears it through its idempotent disposer', async () => {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `{ events }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { events } = await bootRegistries()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fallback` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fallback = eventDefinition('unknown')
    /** 中文说明：释放订阅、注册或后台任务的清理函数；变量 `dispose` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const dispose = events.registerFallback(fallback)

    expect(events.fallbackEntry()).toBe(fallback)
    expect(() => events.registerFallback(eventDefinition('other'))).toThrow(/already registered/)

    dispose()
    dispose()
    expect(events.fallbackEntry()).toBeUndefined()
  })

  it('rejects rendering Definitions that omit either target or builder', async () => {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `{ events }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { events } = await bootRegistries()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `targetOnly` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const targetOnly: ConversationNodeDefinition<null> = {
      kind: 'target-only',
      target: 'chat',
      match: () => null,
      start: () => null,
      update: context => context.state,
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `builderOnly` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const builderOnly: ConversationNodeDefinition<null> = {
      kind: 'builder-only',
      match: () => null,
      start: () => null,
      update: context => context.state,
      buildViewNode: () => null,
    }

    expect(() => events.register(targetOnly)).toThrow(/target and buildViewNode together/)
    expect(() => events.register(builderOnly)).toThrow(/target and buildViewNode together/)
  })

  it('rejects a State-only Definition as the unmatched-event fallback', async () => {
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `{ events }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { events } = await bootRegistries()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fallback` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fallback: ConversationNodeDefinition<null> = {
      kind: 'state-only-fallback',
      match: () => null,
      start: () => null,
      update: context => context.state,
    }

    expect(() => events.registerFallback(fallback))
      .toThrow('conversation fallback Definition must declare a target')
  })

  it('rejects duplicate view targets and disposes a view registration once', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ views }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { views } = await bootRegistries()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition = viewDefinition('chat')
    /** 中文说明：释放订阅、注册或后台任务的清理函数；变量 `dispose` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const dispose = views.register(definition)

    expect(views.entries()).toEqual([definition])
    expect(() => views.register(viewDefinition('chat'))).toThrow(/already registered/)

    dispose()
    dispose()
    expect(views.entries()).toEqual([])
  })

  it('removes Event, fallback, and view contributions with their caller fiber', async () => {
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `{ ctx, events, views }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { ctx, events, views } = await bootRegistries()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `feature` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const feature = ctx.inject(['conversationEvents', 'conversationViews'], (featureCtx) => {
      featureCtx.conversationEvents.register(eventDefinition('message'))
      featureCtx.conversationEvents.registerFallback(eventDefinition('unknown'))
      featureCtx.conversationViews.register(viewDefinition('chat'))
    })
    await feature.await()

    expect(events.entries()).toHaveLength(1)
    expect(events.fallbackEntry()).toBeDefined()
    expect(views.entries()).toHaveLength(1)

    await feature.dispose()
    expect(events.entries()).toEqual([])
    expect(events.fallbackEntry()).toBeUndefined()
    expect(views.entries()).toEqual([])
  })

  it('coalesces registry changes into one rebuild of every resident Session', async () => {
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `{ ctx, events, views }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { ctx, events, views } = await bootRegistries()
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：当前会话或对话投影对象；变量 `sessionId` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sessionId = 'resident' as SessionId
    api.onList = () => Promise.resolve(ok({
      items: [{ sessionId, updatedAt: 1, running: false, blank: true }],
    }) as never)
    /** 中文说明：当前会话或对话投影对象；变量 `sessions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    await sessions.refresh()
    await Promise.resolve()
    sessions.scope(sessionId)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rebuild` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const rebuild = vi.spyOn(Session.prototype, 'rebuildConversationRegistry')

    events.register(eventDefinition('message'))
    views.register(viewDefinition('chat'))
    await Promise.resolve()

    expect(rebuild).toHaveBeenCalledOnce()
    rebuild.mockRestore()
  })
})
