// @vitest-environment jsdom
/*
 * 文件职责：验证消息反馈的 browser-plugin.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止消息反馈用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * ui-message-feedback browser half on a real cordis Context with fake slots/remote
 * faces: the plugin registers the feedback entry at
 * conversation.chat.assistant-actions, one controller per Session backs every
 * message in that Session, a reconnect refreshes only Sessions that were
 * already read, and registration plus controller disposal ride the plugin
 * fiber (HMR safety). The node half and the invariant companion are exercised
 * over the same Context.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { MessageFeedbackItem, MessageFeedbackVersion } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId
/** 中文说明：测试局部值 MSG，由紧邻初始化决定。 */
const MSG = 'm-1' as MessageId

/** 中文说明：测试局部值 seeded，由紧邻初始化决定。 */
const seeded: MessageFeedbackItem = {
  messageId: MSG,
  rating: 'positive',
  version: 'v1' as MessageFeedbackVersion,
  createdAt: 1,
  updatedAt: 1,
}

/** Boot the plugin over fake faces; the Remote namespace records every call. */
/* 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
  const calls: { method: string; request: unknown }[] = []
  // The generated face wraps every business result in the carrier envelope.
  /** 中文说明：测试局部值 carried，由紧邻初始化决定。 */
  const carried = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
  /** 中文说明：测试局部值 messageFeedback，由紧邻初始化决定。 */
  const messageFeedback = {
    list: (request: unknown) => {
      calls.push({ method: 'list', request })
      return carried({ ok: true as const, value: { items: [seeded] } })
    },
    put: (request: unknown) => {
      calls.push({ method: 'put', request })
      return carried({ ok: true as const, value: seeded })
    },
    delete: (request: unknown) => {
      calls.push({ method: 'delete', request })
      return carried({ ok: true as const, value: { absent: true as const } })
    },
  }
  /** 中文说明：类型或类 RemoteService 约束本文件数据或组件职责。 */
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.messageFeedback', messageFeedback)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    entry: () => {
      /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
      const entry = ctx.slots.entries('conversation.chat.assistant-actions')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => MessageFeedbackInjected) | undefined,
      }
    },
  }
}

describe('ui-message-feedback browser plugin', () => {
  it('registers the feedback entry with the documented id, order, and locale', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    expect(b.entry()).toMatchObject({ id: 'feedback', order: 10, locale: 'feedback' })
    expect(b.entry()?.inject).toBeTypeOf('function')
  })

  it('exposes the feedback hook plus the ensure/rate/clear verbs', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = b.entry()!.inject!(sid('s1'))
    expect(face.hooks.feedback.getSnapshot()).toMatchObject({ status: 'cold' })
    expect(face.ensure).toBeTypeOf('function')
    expect(face.rate).toBeTypeOf('function')
    expect(face.clear).toBeTypeOf('function')
  })

  it('shares one controller across every message in the same Session', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = b.entry()!.inject!(sid('s1'))
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = b.entry()!.inject!(sid('s1'))
    expect(first.hooks.feedback).toBe(second.hooks.feedback)

    await first.ensure()
    await second.ensure()
    expect(b.calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('keeps separate Sessions on separate controllers', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    /** 中文说明：测试局部值 one，由紧邻初始化决定。 */
    const one = b.entry()!.inject!(sid('s1'))
    /** 中文说明：测试局部值 two，由紧邻初始化决定。 */
    const two = b.entry()!.inject!(sid('s2'))
    expect(one.hooks.feedback).not.toBe(two.hooks.feedback)

    await one.ensure()
    await two.ensure()
    expect(b.calls.filter(call => call.method === 'list').map(call => call.request)).toEqual([
      { sessionId: 's1' },
      { sessionId: 's2' },
    ])
  })

  it('routes rate and clear to the Remote with the addressed message', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = b.entry()!.inject!(sid('s1'))
    expect(await face.rate(MSG, 'negative', 'wrong answer')).toEqual({ ok: true })
    expect(await face.clear(MSG)).toEqual({ ok: true })

    expect(b.calls.filter(call => call.method === 'put')[0]?.request).toMatchObject({
      sessionId: 's1', messageId: MSG, rating: 'negative', note: 'wrong answer',
    })
    expect(b.calls.filter(call => call.method === 'delete')[0]?.request).toMatchObject({
      sessionId: 's1', messageId: MSG,
    })
  })

  it('routes toggle and clearNote to the controller', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = b.entry()!.inject!(sid('s1'))
    expect(await face.toggle(MSG, 'negative')).toEqual({ ok: true })
    expect(await face.clearNote(MSG)).toEqual({ ok: true })

    // The seeded item is positive with no note, so a negative toggle replaces it
    // through put, and clearNote has nothing to drop and touches no wire.
    /** 中文说明：测试局部值 puts，由紧邻初始化决定。 */
    const puts = b.calls.filter(call => call.method === 'put').map(call => call.request)
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({ messageId: MSG, rating: 'negative' })
  })

  it('refreshes only Sessions already read when the connection resets', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()

    /** 中文说明：测试局部值 warm，由紧邻初始化决定。 */
    const warm = b.entry()!.inject!(sid('warm'))
    await warm.ensure()
    b.entry()!.inject!(sid('cold'))
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = b.calls.filter(call => call.method === 'list').length

    b.ctx.emit('connection/reset')
    await Promise.resolve()

    /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
    const reads = b.calls.filter(call => call.method === 'list')
    expect(reads).toHaveLength(before + 1)
    expect(reads.at(-1)?.request).toEqual({ sessionId: 'warm' })
  })

  it('withdraws the registration and disposes controllers with the plugin fiber', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = b.entry()!.inject!(sid('s1'))
    await face.ensure()

    await b.fiber.dispose()

    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
    // A disposed controller refuses further mutations, so no request outlives the fiber.
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = b.calls.length
    expect(await face.rate(MSG, 'positive')).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(b.calls).toHaveLength(before)
  })

  it('re-registers cleanly when the plugin is reloaded', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()
    await b.fiber.dispose()

    /** 中文说明：测试局部值 reloaded，由紧邻初始化决定。 */
    const reloaded = b.ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()

    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(1)
    expect(b.entry()).toMatchObject({ id: 'feedback' })
  })

  it('the node half applies without host-side behavior', () => {
    // The invariant companion is mounted by the vitest-wide invariant host on
    // every Context this suite creates; its registration is covered there.
    expect(() => { nodeApply() }).not.toThrow()
  })
})
