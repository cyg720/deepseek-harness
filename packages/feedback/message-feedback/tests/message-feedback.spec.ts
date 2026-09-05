/**
 * 文件职责：验证反馈记录的 message-feedback.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证反馈记录在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import MessageFeedbackService, { messageFeedbackRowSchema } from '../src/index.ts'
import type {
  MessageFeedbackItem,
  MessageFeedbackVersion,
} from '../src/index.ts'
import {
  appendMessageFixture,
  messageFixture,
  setupHarness,
  /** 中文说明：类型或类 TestHarness 约束扩展或反馈数据职责。 */
  type TestHarness,
} from './helpers.ts'

/** 中文说明：测试局部值 harnesses，由紧邻初始化决定。 */
const harnesses: TestHarness[] = []

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(maxNoteBytes = 64): Promise<TestHarness> {
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
  const value = await setupHarness(maxNoteBytes)
  harnesses.push(value)
  return value
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

/** 中文说明：函数 staleVersion 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function staleVersion(): MessageFeedbackVersion {
  return randomUUID() as MessageFeedbackVersion
}

/** 中文说明：函数 expectItem 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function expectItem(
  result: Awaited<ReturnType<TestHarness['ctx']['messageFeedback']['put']>>,
): MessageFeedbackItem {
  if (!result.ok) throw new Error(`expected feedback item, got ${result.error.code}`)
  return result.value
}

describe('MessageFeedbackService public contract', () => {
  it('publishes the exact Gateway namespace and Remote method names', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness()
    /** 中文说明：测试局部值 binding，由紧邻初始化决定。 */
    const binding = ctx.messageFeedback.typertRemote
    expect(binding.serviceKey).toBe('messageFeedback')
    expect(binding.namespace).toBe('messageFeedback')
    expect(remoteMethods(ctx.messageFeedback)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'put', invocation: { kind: 'direct' } },
      { method: 'delete', invocation: { kind: 'direct' } },
    ])
  })

  it('returns session-not-found only for a definite persistence miss', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = SessionId('missing-session')
    await expect(ctx.messageFeedback.list({ sessionId: missing })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: missing },
    })

    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('corrupt-session')
    persistence.setDurable({ meta: fixture.session.header, events: fixture.session.snapshotEvents() })
    const corruption = new Error('stored log checksum mismatch')
    persistence.readFailure = corruption
    await expect(ctx.messageFeedback.list({ sessionId: fixture.session.id })).rejects.toBe(corruption)
  })

  it('rechecks live ownership before returning a cold catalog miss', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定。 */
    const sessionId = SessionId('catalog-live-race')
    /** 中文说明：测试局部值 listed，由紧邻初始化决定。 */
    const listed = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    persistence.onStat = async () => {
      listed.resolve(undefined)
      await release.promise
    }

    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.messageFeedback.list({ sessionId })
    await listed.promise
    ctx.sessions.create(sessionId, { meta: { createdAt: 1_700_000_000_001 } })
    release.resolve(undefined)

    await expect(pending).resolves.toEqual({ ok: true, value: { items: [] } })
    expect(persistence.statCalls).toBe(1)
    expect(persistence.readCalls).toBe(0)
  })

  it('returns session-not-found from mutations and conflicts on an observed version for an absent item', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = SessionId('missing-mutations')
    /** 中文说明：测试局部值 missingMessage，由紧邻初始化决定。 */
    const missingMessage = 'missing-message' as MessageId
    await expect(ctx.messageFeedback.put({
      sessionId: missing,
      messageId: missingMessage,
      rating: 'positive',
      ifVersion: null,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: missing },
    })
    await expect(ctx.messageFeedback.delete({
      sessionId: missing,
      messageId: missingMessage,
      ifVersion: staleVersion(),
    })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: missing },
    })

    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('absent-version-conflict')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 expected，由紧邻初始化决定。 */
    const expected = staleVersion()
    await expect(ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: expected,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'version-conflict', current: null },
    })
  })

  it('creates, updates, and retry-reads immutable items with monotonic Host times', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('timestamps')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
    const messageId = fixture.assistantMessageIds[0]

    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_001_000)
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      note: '  exact prose  ',
      ifVersion: null,
    }))
    expect(created).toMatchObject({
      messageId,
      rating: 'positive',
      note: '  exact prose  ',
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_001_000,
    })
    expect(created.version).toMatch(/^[0-9a-f-]{36}$/u)
    expect(Object.isFrozen(created)).toBe(true)

    vi.setSystemTime(1_700_000_000_000)
    /** 中文说明：测试局部值 updated，由紧邻初始化决定。 */
    const updated = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'negative',
      ifVersion: created.version,
    }))
    expect(updated).toMatchObject({
      messageId,
      rating: 'negative',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    })
    expect(updated.version).not.toBe(created.version)

    /** 中文说明：测试局部值 retry，由紧邻初始化决定。 */
    const retry = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'negative',
      ifVersion: updated.version,
    }))
    expect(retry).toEqual(updated)

    /** 中文说明：测试局部值 listed，由紧邻初始化决定。 */
    const listed = await ctx.messageFeedback.list({ sessionId: fixture.session.id })
    if (!listed.ok) throw new Error(`expected list success, got ${listed.error.code}`)
    expect(listed.value.items).toEqual([updated])
    expect(listed.value.items[0]).not.toBe(updated)
    expect(Object.isFrozen(listed.value)).toBe(true)
    expect(Object.isFrozen(listed.value.items)).toBe(true)
    expect(Object.isFrozen(listed.value.items[0])).toBe(true)
  })

  it('reports non-blank and complete UTF-8 byte limits without touching persistence', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness(4)
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('note-limits')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
    const messageId = fixture.assistantMessageIds[0]
    const before = persistence.statCalls + persistence.readCalls

    await expect(ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      note: ' \n\t ',
      ifVersion: null,
    })).resolves.toEqual({ ok: false, error: { code: 'note-blank' } })
    await expect(ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      note: 'ééé',
      ifVersion: null,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'note-too-large', maxBytes: 4, actualBytes: 6 },
    })
    expect(persistence.statCalls + persistence.readCalls).toBe(before)

    expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      note: '😀',
      ifVersion: null,
    }))
  })

  it('accepts only non-empty assistant projections as targets', async () => {
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('targets')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 rejectedTargets，由紧邻初始化决定。 */
    const rejectedTargets: MessageId[] = [
      fixture.userMessageId,
      fixture.emptyAssistantMessageId,
    ]
    /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
    for (const messageId of rejectedTargets) {
      await expect(ctx.messageFeedback.put({
        sessionId: fixture.session.id,
        messageId,
        rating: 'positive',
        ifVersion: null,
      })).resolves.toEqual({
        ok: false,
        error: {
          code: 'target-not-found',
          sessionId: fixture.session.id,
          messageId,
        },
      })
    }
    expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    }))
  })

  it('fails invalid direct configuration and a read before domain initialization', async () => {
    /** 中文说明：测试局部值 invalidCtx，由紧邻初始化决定。 */
    const invalidCtx = new Context()
    expect(() => new MessageFeedbackService(invalidCtx, { maxNoteBytes: 0 }))
      .toThrow(/positive safe integer/u)
    await invalidCtx.fiber.dispose()

    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('uninitialized-domain')
    /** 中文说明：测试局部值 rawCtx，由紧邻初始化决定。 */
    const rawCtx = new Context()
    rawCtx.provide('sessions', { get: () => undefined } as never)
    rawCtx.provide('sessionPersistence', {
      stat: () => Promise.resolve({ header: fixture.session.header, revision: 'test' }),
      open: () => Promise.resolve({
        header: fixture.session.header,
        read: () => Promise.resolve(fixture.session.snapshotEvents()),
        close: () => Promise.resolve(),
      }),
    } as never)
    /** 中文说明：测试局部值 raw，由紧邻初始化决定。 */
    const raw = new MessageFeedbackService(rawCtx, { maxNoteBytes: 1 })
    await expect(raw.list({ sessionId: fixture.session.id }))
      .rejects.toThrow(/durable domain is not initialized/u)
    await rawCtx.fiber.dispose()
  })

  it('rejects durable rows with duplicate message ids or reused item versions', () => {
    /** 中文说明：测试局部值 version，由紧邻初始化决定。 */
    const version = staleVersion()
    /** 中文说明：测试局部值 duplicate，由紧邻初始化决定。 */
    const duplicate = messageFeedbackRowSchema.safeParse({
      session: { createdAt: 1 },
      items: [
        {
          messageId: 'same-message',
          rating: 'positive',
          version,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          messageId: 'same-message',
          rating: 'negative',
          version,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    expect(duplicate.success).toBe(false)
    if (duplicate.success) throw new Error('expected duplicate row rejection')
    expect(duplicate.error.issues.map(issue => issue.path.join('.')))
      .toEqual(['items.1.messageId', 'items.1.version'])
  })
})

describe('MessageFeedbackService item concurrency', () => {
  it('serializes whole-row writes while keeping versions independent per message', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('concurrent-items')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 [firstId, secondId]，由紧邻初始化决定。 */
    const [firstId, secondId] = fixture.assistantMessageIds

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const [firstResult, secondResult] = await Promise.all([
      ctx.messageFeedback.put({
        sessionId: fixture.session.id,
        messageId: firstId,
        rating: 'positive',
        ifVersion: null,
      }),
      ctx.messageFeedback.put({
        sessionId: fixture.session.id,
        messageId: secondId,
        rating: 'negative',
        ifVersion: null,
      }),
    ])
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = expectItem(firstResult)
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = expectItem(secondResult)
    /** 中文说明：测试局部值 updated，由紧邻初始化决定。 */
    const updated = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId: firstId,
      rating: 'negative',
      note: 'changed',
      ifVersion: first.version,
    }))

    await expect(ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId: firstId,
      rating: 'positive',
      note: 'stale change',
      ifVersion: first.version,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'version-conflict', current: updated },
    })

    /** 中文说明：测试局部值 listed，由紧邻初始化决定。 */
    const listed = await ctx.messageFeedback.list({ sessionId: fixture.session.id })
    if (!listed.ok) throw new Error(`expected list success, got ${listed.error.code}`)
    expect(listed.value.items).toEqual([updated, second])
    expect(listed.value.items[1]?.version).toBe(second.version)
  })

  it('rejects a stale put even when the current value has returned to the same state', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('put-aba')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
    const messageId = fixture.assistantMessageIds[0]
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      ifVersion: null,
    }))
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'negative',
      ifVersion: first.version,
    }))
    /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
    const current = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      ifVersion: second.version,
    }))

    await expect(ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      ifVersion: first.version,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'version-conflict', current },
    })
  })

  it('makes delete retries stable and prevents delete/recreate ABA', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('delete-aba')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
    const messageId = fixture.assistantMessageIds[0]
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'positive',
      ifVersion: null,
    }))

    await expect(ctx.messageFeedback.delete({
      sessionId: fixture.session.id,
      messageId,
      ifVersion: staleVersion(),
    })).resolves.toEqual({
      ok: false,
      error: { code: 'version-conflict', current: created },
    })
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    const request = {
      sessionId: fixture.session.id,
      messageId,
      ifVersion: created.version,
    }
    await expect(ctx.messageFeedback.delete(request)).resolves.toEqual({
      ok: true,
      value: { absent: true },
    })
    await expect(ctx.messageFeedback.delete(request)).resolves.toEqual({
      ok: true,
      value: { absent: true },
    })

    /** 中文说明：测试局部值 recreated，由紧邻初始化决定。 */
    const recreated = expectItem(await ctx.messageFeedback.put({
      sessionId: fixture.session.id,
      messageId,
      rating: 'negative',
      ifVersion: null,
    }))
    expect(recreated.version).not.toBe(created.version)
    await expect(ctx.messageFeedback.delete(request)).resolves.toEqual({
      ok: false,
      error: { code: 'version-conflict', current: recreated },
    })
  })

  it('fences a reused Session id and lets the new lifecycle start cleanly', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 old，由紧邻初始化决定。 */
    const old = messageFixture('reused-session', { createdAt: 10, cwd: '/old' })
    persistence.persist(old.session)
    /** 中文说明：测试局部值 oldItem，由紧邻初始化决定。 */
    const oldItem = expectItem(await ctx.messageFeedback.put({
      sessionId: old.session.id,
      messageId: old.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    }))

    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = Session.create(
      old.session.id,
      old.session.snapshotEvents(),
      { ...old.session.header, createdAt: 20, cwd: '/new' },
    )
    persistence.persist(replacement)
    await expect(ctx.messageFeedback.list({ sessionId: replacement.id })).resolves.toEqual({
      ok: true,
      value: { items: [] },
    })
    await expect(ctx.messageFeedback.delete({
      sessionId: replacement.id,
      messageId: old.assistantMessageIds[0],
      ifVersion: oldItem.version,
    })).resolves.toEqual({ ok: true, value: { absent: true } })

    /** 中文说明：测试局部值 newItem，由紧邻初始化决定。 */
    const newItem = expectItem(await ctx.messageFeedback.put({
      sessionId: replacement.id,
      messageId: old.assistantMessageIds[0],
      rating: 'negative',
      ifVersion: null,
    }))
    expect(newItem.version).not.toBe(oldItem.version)
  })

  it('drains admitted mutations before domain close and rejects later admission', async () => {
    /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
    const current = await harness()
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = current
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = messageFixture('dispose-quiescence')
    persistence.persist(fixture.session)
    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = ctx.messageFeedback
    /** 中文说明：测试局部值 lifecycle，由紧邻初始化决定。 */
    const lifecycle = service as unknown as { readonly mutationAdmissionOpen: boolean }
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 physicalReads，由紧邻初始化决定。 */
    let physicalReads = 0
    /** 中文说明：测试局部值 committed，由紧邻初始化决定。 */
    let committed = 0
    persistence.onRead = async () => {
      physicalReads += 1
      if (physicalReads !== 1) return
      started.resolve(undefined)
      await release.promise
    }
    ctx.on('domain/changed', (change) => {
      if (change.domain === 'message_feedback') committed += 1
    })

    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = service.put({
      sessionId: fixture.session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    })
    await started.promise
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = service.put({
      sessionId: fixture.session.id,
      messageId: fixture.assistantMessageIds[1],
      rating: 'negative',
      ifVersion: null,
    })
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定。 */
    const disposal = current.disposeFeedback()
    await vi.waitFor(() => { expect(lifecycle.mutationAdmissionOpen).toBe(false) })

    await expect(service.delete({
      sessionId: fixture.session.id,
      messageId: fixture.assistantMessageIds[0],
      ifVersion: staleVersion(),
    })).rejects.toThrow('message-feedback: service is disposing')
    release.resolve(undefined)

    expectItem(await first)
    expectItem(await second)
    await disposal
    expect(physicalReads).toBe(4)
    expect(committed).toBe(2)
  })
})

describe('MessageFeedbackService durability ordering', () => {
  it('rejects a live target missing from the re-read physical durable prefix', async () => {
    const { ctx, persistence } = await harness()
    const session = ctx.sessions.create(SessionId('live-prefix'), {
      meta: { createdAt: 50, cwd: '/prefix' },
    })
    const fixture = appendMessageFixture(session)
    ctx.on('session/flush', () => {
      persistence.setDurable({ meta: session.header, events: [] })
    })

    await expect(ctx.messageFeedback.put({
      sessionId: session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'target-not-found',
        sessionId: session.id,
        messageId: fixture.assistantMessageIds[0],
      },
    })
    expect(persistence.readCalls).toBe(1)
    await expect(ctx.messageFeedback.list({ sessionId: session.id })).resolves.toEqual({
      ok: true,
      value: { items: [] },
    })
  })

  it('commits and physically verifies a live target checkpoint before the sidecar write', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('live-checkpoint'), {
      meta: { createdAt: 30, cwd: '/live' },
    })
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = appendMessageFixture(session)
    /** 中文说明：测试局部值 order，由紧邻初始化决定。 */
    const order: string[] = []
    ctx.on('session/flush', (current) => {
      order.push('session:durable')
      persistence.persist(current)
    })
    ctx.on('domain/changed', (change) => {
      if (change.domain === 'message_feedback') order.push('sidecar:durable')
    })
    persistence.onRead = () => { order.push('session:verified') }

    expectItem(await ctx.messageFeedback.put({
      sessionId: session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    }))
    expect(order).toEqual(['session:durable', 'session:verified', 'sidecar:durable'])
    expect(persistence.readCalls).toBe(1)
    expect(persistence.durable.get(session.id)?.events).toContainEqual(
      expect.objectContaining({ type: 'assistant/message' }),
    )
  })

  it('fails closed when a live checkpoint fails, has no participant, or is not physically durable', async () => {
    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = await harness()
    /** 中文说明：测试局部值 failedSession，由紧邻初始化决定。 */
    const failedSession = failed.ctx.sessions.create(SessionId('live-flush-failure'))
    /** 中文说明：测试局部值 failedFixture，由紧邻初始化决定。 */
    const failedFixture = appendMessageFixture(failedSession)
    /** 中文说明：测试局部值 diskFailure，由紧邻初始化决定。 */
    const diskFailure = new Error('disk unavailable')
    failed.ctx.on('session/flush', () => { throw diskFailure })
    await expect(failed.ctx.messageFeedback.put({
      sessionId: failedSession.id,
      messageId: failedFixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    })).rejects.toBe(diskFailure)
    await expect(failed.ctx.messageFeedback.list({ sessionId: failedSession.id })).resolves.toEqual({
      ok: true,
      value: { items: [] },
    })

    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = await harness()
    /** 中文说明：测试局部值 absentSession，由紧邻初始化决定。 */
    const absentSession = absent.ctx.sessions.create(SessionId('live-no-flush'))
    /** 中文说明：测试局部值 absentFixture，由紧邻初始化决定。 */
    const absentFixture = appendMessageFixture(absentSession)
    await expect(absent.ctx.messageFeedback.put({
      sessionId: absentSession.id,
      messageId: absentFixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    })).rejects.toThrow(/no durability listener participated/u)
    await expect(absent.ctx.messageFeedback.list({ sessionId: absentSession.id })).resolves.toEqual({
      ok: true,
      value: { items: [] },
    })

    /** 中文说明：测试局部值 noDurability，由紧邻初始化决定。 */
    const noDurability = await harness()
    /** 中文说明：测试局部值 unpersistedSession，由紧邻初始化决定。 */
    const unpersistedSession = noDurability.ctx.sessions.create(SessionId('live-unpersisted'))
    /** 中文说明：测试局部值 unpersistedFixture，由紧邻初始化决定。 */
    const unpersistedFixture = appendMessageFixture(unpersistedSession)
    noDurability.ctx.on('session/flush', () => {})
    await expect(noDurability.ctx.messageFeedback.put({
      sessionId: unpersistedSession.id,
      messageId: unpersistedFixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    })).rejects.toThrow(/not found/u)
    expect(noDurability.persistence.durable.has(unpersistedSession.id)).toBe(false)
    await expect(noDurability.ctx.messageFeedback.list({ sessionId: unpersistedSession.id })).resolves.toEqual({
      ok: true,
      value: { items: [] },
    })
  })

  it('finishes the captured live checkpoint when the Session detaches mid-flush', async () => {
    /** 中文说明：测试局部值 { ctx, persistence }，由紧邻初始化决定。 */
    const { ctx, persistence } = await harness()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.prepare(SessionId('detach-during-flush'), {
      meta: { createdAt: 40, cwd: '/detach' },
    })
    /** 中文说明：测试局部值 detach，由紧邻初始化决定。 */
    const detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = appendMessageFixture(session)
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('session/flush', async (current) => {
      started.resolve(undefined)
      await release.promise
      persistence.persist(current)
    })

    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.messageFeedback.put({
      sessionId: session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      ifVersion: null,
    })
    await started.promise
    detach()
    expect(ctx.sessions.get(session.id)).toBeUndefined()
    release.resolve(undefined)
    expectItem(await pending)
    expect(persistence.readCalls).toBe(1)
    await expect(ctx.messageFeedback.list({ sessionId: session.id })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ messageId: fixture.assistantMessageIds[0] }] },
    })
  })
})
