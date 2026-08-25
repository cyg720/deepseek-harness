/**
 * Fixture impl semantics: the demo data source must honor the same contract
 * shapes as the real host (paging boundaries, rpcId echo, replay lifecycle,
 * baseline replay, timing hooks) — this is the vitest-side drift detector for
 * the hand-written fixture/host parallel implementations.
 */
/*
 * 文件职责：验证连接夹具的 fixture 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import type { HostFrame, MuxFrame, RpcMessage, RpcRequest } from '../src/client/api.ts'
import { FixtureApiClient, createFixtureApi } from '../src/client/fixture.ts'

/** 中文说明：标识或顺序值 sid，取值由紧邻初始化决定，仅在当前作用域使用。 */
const sid = (id: string): SessionId => id as SessionId
/** 中文说明：测试场景的局部值 req，取值由紧邻初始化决定，仅在当前作用域使用。 */
const req = <P>(payload: P): RpcRequest<P> => ({ rpcId: RpcId(`t-${Math.abs(Math.sin(reqCount++)).toString(36).slice(2, 10)}`), payload })
/** 中文说明：标识或顺序值 reqCount，取值由紧邻初始化决定，仅在当前作用域使用。 */
let reqCount = 0

/** 中文说明：类型 TimingHooks 约束本文件数据字段及允许取值。 */
interface TimingHooks {
  /** 中文说明：方法 setHistoryDelay 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  setHistoryDelay(ms: number): void
  /** 中文说明：方法 failNextHistory 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  failNextHistory(): void
  /** 中文说明：方法 appendUser 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  appendUser(id: string, msg: string): void
  /** 中文说明：方法 appendTitle 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  appendTitle(id: string, title: string): void
  /** 中文说明：方法 startReasoningChunkStorm 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  startReasoningChunkStorm(id: string, chunkCount: number, chunksPerInterval: number, intervalMs: number): string
  /** 中文说明：方法 reasoningChunkStormState 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  reasoningChunkStormState(): {
    sessionId: string
    chunkCount: number
    chunksPerInterval: number
    intervalMs: number
    emitted: number
    marker: string
    emitting: boolean
  } | null
  /** 中文说明：方法 beginModelRetry 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  beginModelRetry(id: string): void
  /** 中文说明：方法 scheduleModelRetry 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  scheduleModelRetry(id: string, retry?: number, delayMs?: number): void
  /** 中文说明：方法 cancelModelRetryDuringBackoff 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  cancelModelRetryDuringBackoff(id: string, delayMs?: number): void
  /** 中文说明：方法 completeModelRetry 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  completeModelRetry(id: string): void
  /** 中文说明：方法 appendSilent 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  appendSilent(id: string, msg: string): void
  /** 中文说明：方法 breakStreams 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  breakStreams(): void
}
/** 中文说明：测试场景的局部值 timing，取值由紧邻初始化决定，仅在当前作用域使用。 */
const timing = (): TimingHooks => (globalThis as Record<string, unknown>).__fxTiming as TimingHooks

/** Collect stream frames until the predicate or a soft cap; abort ends the stream. */
/* 中文说明：函数 collect 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
async function collect<F>(stream: AsyncIterable<RpcRequest<F>>, abort: AbortController, done: (frames: F[]) => boolean): Promise<F[]> {
  /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const frames: F[] = []
  /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
  for await (const envelope of stream) {
    frames.push(envelope.payload)
    if (done(frames) || frames.length > 500) {
      abort.abort()
      break
    }
  }
  return frames
}

describe('createFixtureApi', () => {
  it('serves the session list sorted by updatedAt desc and echoes rpcIds on every unary', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：当前传输或投影数据 request，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const request = req({})
    /** 中文说明：当前传输或投影数据 response，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const response = await api.sessions.list(request)
    expect(response.rpcId).toBe(request.rpcId)
    if (!response.result.ok) throw new Error('list failed')
    expect(response.result.value.items.map(s => s.sessionId)).toEqual(['fx-alpha', 'fx-beta', 'fx-gamma'])
    expect(response.result.value.items[1]?.parentSessionId).toBe('fx-alpha') // lineage material
  })

  it('searches current message text with literal unicode61-style token phrases', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 signal，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const signal = new AbortController().signal
    /** 中文说明：测试场景的局部值 phrase，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const phrase = await api.sessions.search(req({ query: 'FIXTURE 历史消息' }), signal)
    expect(phrase.result).toMatchObject({
      ok: true,
      value: {
        items: [{ sessionId: 'fx-alpha' }],
        hasMore: false,
      },
    })
    if (!phrase.result.ok) throw new Error('search failed')
    expect(phrase.result.value.items[0]?.snippet).toContain('fixture 历史消息')

    timing().appendUser(
      'fx-alpha',
      `${'leading context '.repeat(20)}late café token${' trailing context'.repeat(20)}`,
    )
    /** 中文说明：测试场景的局部值 late，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const late = await api.sessions.search(req({ query: 'LATE CAFE TOKEN' }), signal)
    if (!late.result.ok) throw new Error('late search failed')
    /** 中文说明：测试场景的局部值 lateSnippet，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const lateSnippet = late.result.value.items[0]?.snippet ?? ''
    expect(lateSnippet).toContain('late café token')
    expect(lateSnippet.startsWith('…')).toBe(true)
    expect(lateSnippet.endsWith('…')).toBe(true)
    expect(Array.from(lateSnippet).length).toBeLessThanOrEqual(120)

    timing().appendUser('fx-alpha', 'Greek final sigma: ος')
    /** 中文说明：测试场景的局部值 finalSigma，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const finalSigma = await api.sessions.search(req({ query: 'ΟΣ' }), signal)
    if (!finalSigma.result.ok) throw new Error('final sigma search failed')
    expect(finalSigma.result.value.items[0]?.snippet).toContain('ος')

    /** 中文说明：测试场景的局部值 substring，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const substring = await api.sessions.search(req({ query: 'ixtur' }), signal)
    expect(substring.result).toEqual({
      ok: true,
      value: { items: [], hasMore: false },
    })
    /** 中文说明：测试场景的局部值 punctuationOnly，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const punctuationOnly = await api.sessions.search(req({ query: '*' }), signal)
    expect(punctuationOnly.result).toEqual({
      ok: true,
      value: { items: [], hasMore: false },
    })
    /** 中文说明：测试场景的局部值 reasoningOnly，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const reasoningOnly = await api.sessions.search(req({ query: '思考过程' }), signal)
    expect(reasoningOnly.result).toEqual({
      ok: true,
      value: { items: [], hasMore: false },
    })

    /** 中文说明：异步取消状态 aborted，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const aborted = new AbortController()
    aborted.abort()
    await expect(api.sessions.search(req({ query: 'fixture' }), aborted.signal))
      .resolves.toMatchObject({ result: { ok: false, error: { code: 'cancelled' } } })
  })

  it('pages history backwards on message-boundary cuts with seq-contiguous stitching', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 tail，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tail = await api.sessions.history(req({ sessionId: sid('fx-alpha'), maxMessages: 10 }))
    if (!tail.result.ok) throw new Error('history failed')
    /** 中文说明：测试场景的局部值 tailPage，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tailPage = tail.result.value
    expect(tailPage.hasMore).toBe(true)
    expect(tailPage.events[0]?.event.type).toBe('turn/start') // cut lands on a turn boundary
    /** 中文说明：测试场景的局部值 boundary，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const boundary = tailPage.events[0]?.event.seq ?? 0
    expect(boundary).toBeGreaterThan(0)
    /** 中文说明：测试场景的局部值 older，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const older = await api.sessions.history(req({ sessionId: sid('fx-alpha'), beforeSeq: boundary, maxMessages: 10 }))
    if (!older.result.ok) throw new Error('older failed')
    /** 中文说明：测试场景的局部值 olderTail，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const olderTail = older.result.value.events.at(-1)?.event
    expect((olderTail?.seq ?? -1) + 1).toBe(boundary) // pages stitch with no hole/overlap
    // Out-of-range beforeSeq clamps instead of exploding.
    /** 中文说明：测试场景的局部值 clamped，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const clamped = await api.sessions.history(req({ sessionId: sid('fx-alpha'), beforeSeq: -5, maxMessages: 10 }))
    if (!clamped.result.ok) throw new Error('clamped failed')
    expect(clamped.result.value.events).toEqual([])
    // Unknown session: empty page, not an error (history of a bare id). The
    // tail block still rides it — empty-log cut at -1, the host convention.
    /** 中文说明：测试场景的局部值 empty，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const empty = await api.sessions.history(req({ sessionId: sid('no-such'), maxMessages: 10 }))
    if (!empty.result.ok) throw new Error('empty failed')
    // Fixture composes the todos + plan units (host parallel when tool-todo
    // and plan-mode are mounted): the empty-log values.
    expect(empty.result.value).toEqual({
      events: [], hasMore: false, projections: { asOfSeq: -1, values: {
        todos: null,
        // Permission unit composed: the composition-default select.
        permissions: {
          options: [
            { value: 'workspace-write', name: 'workspace-write', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.' },
            { value: 'danger-full-access', name: 'danger-full-access', description: 'Full file access without approval prompts.' },
          ],
          currentValue: 'workspace-write',
        },
        plan: { active: false, pending: false },
        goal: null,
        tokenUsage: {
          uncachedInputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        // No request ran, so neither pressure nor capacity is known yet.
        contextPressure: {},
        contextBreakdown: {
          systemTokens: 0,
          toolsTokens: 0,
          messageTokens: 0,
        },
        // Session-stats unit composed: no figure accrues on the empty log.
        sessionStats: {
          turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
        },
        imageLimits: {
          maxImageBytes: 5 * 1024 * 1024,
          maxImagesPerMessage: 20,
          maxMessageImageBytes: 100 * 1024 * 1024,
          maxImagePixels: 40_000_000,
          maxImageDimension: 2000,
          mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        },
      } },
    })
  })

  it('serves grouped models and keeps a selection for later history and fixture requests', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：标识或顺序值 sessionId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const sessionId = sid('fx-alpha')
    /** 中文说明：测试场景的局部值 catalog，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const catalog = await api.sessions.models(req({ sessionId }))
    if (!catalog.result.ok) throw new Error('models failed')
    expect(catalog.result.value.groups.map(group => group.name)).toEqual(['DeepSeek', 'OpenAI'])
    expect(catalog.result.value.groups[0]?.models.map(model => model.id))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])

    /** 中文说明：测试场景的局部值 selected，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const selected = await api.sessions.selectModel(req({
      sessionId,
      provider: 'openai',
      model: 'gpt-5',
    }))
    if (!selected.result.ok) throw new Error('selection failed')
    expect(selected.result.value.selected).toEqual({ provider: 'openai', model: 'gpt-5' })
    /** 中文说明：测试场景的局部值 history，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const history = await api.sessions.history(req({ sessionId }))
    if (!history.result.ok) throw new Error('history failed')

    /** 中文说明：测试场景的局部值 prompt，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const prompt = await api.sessions.prompt(req({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'report model' }],
    }))
    expect(prompt.result.ok).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 600))
    /** 中文说明：测试场景的局部值 after，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const after = await api.sessions.history(req({ sessionId }))
    if (!after.result.ok) throw new Error('history failed')
    expect(JSON.stringify(after.result.value.events)).toContain('openai/gpt-5')
  })

  it('serves configured DeepSeek readiness and keeps credential values write-only', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 settings，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const settings = await api.settings.describe(req({}))
    if (!settings.result.ok) throw new Error('settings describe failed')
    expect(settings.result.value.namespaces).toMatchObject([{
      ns: 'llm-deepseek',
      value: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
      secrets: [{ path: ['apiKey'], set: false }],
    }])

    /** 中文说明：测试场景的局部值 initial，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const initial = await api.credentials.describe(req({ refs: ['DEEPSEEK_API_KEY', 'TEST_API_KEY'] }))
    if (!initial.result.ok) throw new Error('credential describe failed')
    expect(initial.result.value.credentials).toEqual({
      DEEPSEEK_API_KEY: { configured: true, source: 'file', writable: true },
      TEST_API_KEY: { configured: false, writable: true },
    })
    await api.credentials.set(req({ ref: 'TEST_API_KEY', value: 'write-only-fixture-secret' }))
    /** 中文说明：测试场景的局部值 configured，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const configured = await api.credentials.describe(req({ refs: ['TEST_API_KEY'] }))
    if (!configured.result.ok) throw new Error('credential describe failed')
    expect(configured.result.value.credentials.TEST_API_KEY).toEqual({
      configured: true,
      source: 'file',
      writable: true,
    })
    await api.credentials.unset(req({ ref: 'TEST_API_KEY' }))
    /** 中文说明：测试场景的局部值 cleared，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const cleared = await api.credentials.describe(req({ refs: ['TEST_API_KEY'] }))
    if (!cleared.result.ok) throw new Error('credential describe failed')
    expect(cleared.result.value.credentials.TEST_API_KEY).toEqual({ configured: false, writable: true })
  })

  it('emits the todo/write snapshot at the real tool boundary: between tool/call and tool/result, timestamps monotonic', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 tail，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tail = await api.sessions.history(req({ sessionId: sid('fx-alpha'), maxMessages: 10 }))
    if (!tail.result.ok) throw new Error('history failed')
    /** 中文说明：当前传输或投影数据 events，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const events = tail.result.value.events.map(e => e.event)
    /** 中文说明：测试场景的局部值 todoAt，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const todoAt = events.findIndex(e => e.type === 'todo/write')
    expect(todoAt).toBeGreaterThan(0)
    // Production ordering (the tool appends mid-execution): call → snapshot → result.
    expect(events[todoAt - 1]?.type).toBe('tool/call')
    expect(events[todoAt + 1]?.type).toBe('tool/result')
    /** 中文说明：测试场景的局部值 times，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const times = events.slice(todoAt - 1, todoAt + 2).map(e => e.time)
    expect(times[0]).toBeLessThanOrEqual(times[1] ?? 0)
    expect(times[1]).toBeLessThanOrEqual(times[2] ?? 0)
    // The sample is a parallel plan: this fixture chooses the parallel policy,
    // so the surfaces fed from here face more than one active item.
    /** 中文说明：当前状态或快照 snapshot，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const snapshot = events[todoAt] as { data: { todos: { status: string }[] } }
    expect(snapshot.data.todos.filter(t => t.status === 'in_progress')).toHaveLength(2)
  })

  it('create adds a session and pushes host/session-added to open host streams', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: HostFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.host(req({}), abort.signal)) {
        seen.push(envelope.payload)
        if (seen.length >= 1) abort.abort()
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10)) // let the stream register
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({}))
    if (!created.result.ok) throw new Error('create failed')
    await consuming
    if (!created.result.ok) throw new Error('create failed')
    /** 中文说明：标识或顺序值 createdId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const createdId = created.result.value.sessionId
    expect(seen).toHaveLength(1)
    /** 中文说明：测试场景的局部值 added，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const added = seen[0]
    if (added?.type !== 'host/session-added') throw new Error('session-added frame missing')
    expect(added).toEqual({
      type: 'host/session-added', sessionId: createdId, blank: true, cwd: '/tmp/fixture',
    })
    /** 中文说明：按序保存的数据集合 list，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const list = await api.sessions.list(req({}))
    if (!list.result.ok) throw new Error('list failed')
    expect(list.result.value.items.some(s => s.sessionId === createdId)).toBe(true)
  })

  it('prompt replays a full streamed turn and cancel mid-replay freezes with (已中断)', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({}))
    if (!created.result.ok) throw new Error('create failed')
    /** 中文说明：标识或顺序值 id，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const id = created.result.value.sessionId
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.mux(req({}), abort.signal)) {
        frames.push(envelope.payload)
        /** 中文说明：测试场景的局部值 last，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const last = envelope.payload
        if (last.type === 'session/event' && last.event.type === 'turn/end') {
          abort.abort()
        }
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    // Unknown session → session-not-found with the id echoed in details.
    /** 中文说明：测试场景的局部值 missing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const missing = await api.sessions.prompt(req({ sessionId: sid('ghost'), mode: 'queue' as const, content: [{ type: 'text' as const, text: 'x' }] }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'session-not-found', details: { sessionId: 'ghost' } } })
    // Real prompt: replay starts (running flips true), cancel freezes it.
    /** 中文说明：测试场景的局部值 accepted，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const accepted = await api.sessions.prompt(req({ sessionId: id, mode: 'queue' as const, content: [{ type: 'text' as const, text: 'render markdown' }] }))
    expect(accepted.result).toMatchObject({ ok: true, value: { accepted: true } })
    await new Promise(resolve => setTimeout(resolve, 120)) // a couple of typewriter ticks
    await api.sessions.cancel(req({ sessionId: id }))
    await consuming
    /** 中文说明：测试场景的局部值 types，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const types = frames.filter((f): f is Extract<MuxFrame, { type: 'session/event' }> => f.type === 'session/event').map(f => f.event.type)
    expect(types).toContain('turn/start')
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/chunk')
    expect(types).toContain('assistant/message')
    expect(types.at(-1)).toBe('turn/end')
    // Capacity is durable log state, not a transient frame: the prompt path
    // records request/context and the projection carries it to the client.
    expect(types).toContain('request/context')
    expect(frames.some(frame =>
      frame.type === 'session/projection'
      && frame.key === 'tokenUsage'
      && (frame.value as { outputTokens?: number }).outputTokens === 8)).toBe(true)
    expect(frames.some(frame =>
      frame.type === 'session/projection'
      && frame.key === 'contextPressure'
      && (frame.value as { contextWindow?: number }).contextWindow === 128_000)).toBe(true)
    expect(frames.some(frame =>
      frame.type === 'session/projection'
      && frame.key === 'contextBreakdown'
      && (frame.value as { messageTokens?: number }).messageTokens! > 0)).toBe(true)
    /** 中文说明：测试场景的局部值 finalize，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const finalize = frames.find((f): f is Extract<MuxFrame, { type: 'session/event' }> => f.type === 'session/event' && f.event.type === 'assistant/message')
    expect(JSON.stringify(finalize?.event.data)).toContain('（已中断）')
    // Idle cancel: no replay in flight, must not explode; running flips false.
    /** 中文说明：标识或顺序值 idleCancel，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const idleCancel = await api.sessions.cancel(req({ sessionId: id }))
    expect(idleCancel.result).toMatchObject({ ok: true })
  })

  it('steer during a replay lands a user/message inside the current turn and the replay continues', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({}))
    if (!created.result.ok) throw new Error('create failed')
    /** 中文说明：标识或顺序值 id，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const id = created.result.value.sessionId
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前传输或投影数据 framesPromise，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const framesPromise = collect<MuxFrame>(api.events.mux(req({}), abort.signal), abort,
      frames => frames.some(f => f.type === 'session/event' && f.event.type === 'turn/end'))
    await new Promise(resolve => setTimeout(resolve, 10))
    await api.sessions.prompt(req({ sessionId: id, mode: 'queue' as const, content: [{ type: 'text' as const, text: '短' }] }))
    await api.sessions.prompt(req({ sessionId: id, mode: 'steer' as const, content: [{ type: 'text' as const, text: '插话' }] }))
    /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frames = await framesPromise
    /** 中文说明：测试场景的局部值 types，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const types = frames.filter((f): f is Extract<MuxFrame, { type: 'session/event' }> => f.type === 'session/event').map(f => f.event.type)
    expect(JSON.stringify(frames)).toContain('插话')
    expect(types.at(-1)).toBe('turn/end') // steer did not restart the turn
  })

  it('mux open replays subscribed sessions and resident interactions with stable rpcIds', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 openOnce，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const openOnce = async (): Promise<RpcRequest<MuxFrame>[]> => {
      /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const abort = new AbortController()
      /** 中文说明：测试场景的局部值 envelopes，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const envelopes: RpcRequest<MuxFrame>[] = []
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.mux(req({}), abort.signal)) {
        envelopes.push(envelope)
        if (envelopes.length >= 13) abort.abort()
      }
      return envelopes
    }
    /** 中文说明：测试场景的局部值 first，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const first = await openOnce()
    /** 中文说明：测试场景的局部值 second，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const second = await openOnce()
    expect(first[0]?.payload).toMatchObject({ type: 'session/subscribed', sessionId: 'fx-alpha' })
    expect((first[0]?.payload as { lastSeq: number }).lastSeq).toBeGreaterThan(0)
    // Projection baseline frames follow subscribed (domain units + token usage).
    expect(first[1]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'title', value: 'Fixture 历史会话' })
    expect(first[2]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'todos' })
    expect(first[3]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'permissions' })
    expect(first[4]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'plan', value: { active: false, pending: false } })
    expect(first[5]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'goal', value: null })
    expect(first[6]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'tokenUsage' })
    expect(first[7]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'contextPressure' })
    expect(first[8]?.payload).toMatchObject({
      type: 'session/projection', sessionId: 'fx-alpha', key: 'contextBreakdown',
      value: { systemTokens: 0, toolsTokens: 0 },
    })
    expect((first[8]?.payload as { value: { messageTokens: number } }).value.messageTokens).toBeGreaterThan(0)
    expect(first[9]?.payload).toMatchObject({ type: 'session/projection', sessionId: 'fx-alpha', key: 'sessionStats' })
    expect((first[9]?.payload as { value: { turns: number; steps: number } }).value.steps).toBeGreaterThan(0)
    expect(first[10]?.payload).toMatchObject({
      type: 'session/projection', sessionId: 'fx-alpha', key: 'imageLimits',
      value: { maxImagesPerMessage: 20, maxImageBytes: 5 * 1024 * 1024 },
    })
    expect(first[11]?.payload).toMatchObject({ type: 'approval/requested', toolName: 'dangerous_tool' })
    expect(second[11]?.rpcId).toBe(first[11]?.rpcId) // stable rpcId across replays (host replay semantics)
    expect(first[12]?.payload).toMatchObject({ type: 'question/requested', sessionId: 'fx-alpha' })
    expect(second[12]?.rpcId).toBe(first[12]?.rpcId)
  })

  it('steer with no replay in flight falls through to a fresh queued turn; non-text blocks stringify empty', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前传输或投影数据 framesPromise，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const framesPromise = collect<MuxFrame>(api.events.mux(req({}), abort.signal), abort,
      frames => frames.some(f => f.type === 'session/event' && f.event.type === 'turn/end'))
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({}))
    if (!created.result.ok) throw new Error('create failed')
    // steer while idle + a non-text content block (covers the '' arm of the text join).
    await api.sessions.prompt(req({
      sessionId: created.result.value.sessionId, mode: 'steer' as const,
      content: [{ type: 'text' as const, text: '短' }, { type: 'image', data: 'x' } as never],
    }))
    /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frames = await framesPromise
    /** 中文说明：测试场景的局部值 types，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const types = frames.filter((f): f is Extract<MuxFrame, { type: 'session/event' }> => f.type === 'session/event').map(f => f.event.type)
    expect(types[0]).toBe('turn/start') // idle steer degraded to a queued turn, not an in-turn insert
  })

  it('gamma interval flip emits host/session-status and a running log-less session subscribes at lastSeq -1', async () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const api = createFixtureApi()
      /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const abort = new AbortController()
      /** 中文说明：按序保存的数据集合 hostSeen，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const hostSeen: HostFrame[] = []
      /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const consuming = (async () => {
        /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
        for await (const envelope of api.events.host(req({}), abort.signal)) hostSeen.push(envelope.payload)
      })()
      await vi.advanceTimersByTimeAsync(5001) // interval fires: fx-gamma flips running=true (no log exists)
      expect(hostSeen).toContainEqual({ type: 'host/session-status', sessionId: sid('fx-gamma'), running: true })
      // A mux stream opened now sees gamma in the baseline with lastSeq = -1 (empty log arm).
      /** 中文说明：异步取消状态 mabort，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const mabort = new AbortController()
      /** 中文说明：测试场景的局部值 baseline，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const baseline: MuxFrame[] = []
      /** 中文说明：测试场景的局部值 muxConsuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const muxConsuming = (async () => {
        /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
        for await (const envelope of api.events.mux(req({}), mabort.signal)) {
          baseline.push(envelope.payload)
          if (baseline.length >= 3) mabort.abort()
        }
      })()
      await vi.advanceTimersByTimeAsync(10)
      mabort.abort()
      await muxConsuming
      expect(baseline).toContainEqual({ type: 'session/subscribed', sessionId: sid('fx-gamma'), lastSeq: -1 })
      abort.abort()
      await vi.advanceTimersByTimeAsync(10)
      await consuming
    } finally {
      vi.useRealTimers()
    }
  })

  it('respond resolves the resident question once and rejects duplicate or unrelated ids', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    expect(await api.respond({ type: 'client-response', rpcId: RpcId('x'), result: { ok: true, value: {} } })).toEqual({ accepted: false, reason: 'not-pending' })
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：测试场景的局部值 解构结果，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let question: RpcRequest<MuxFrame> | undefined
    /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
    for await (const envelope of api.events.mux(req({}), abort.signal)) {
      if (envelope.payload.type !== 'question/requested') continue
      question = envelope
      abort.abort()
    }
    if (question === undefined) throw new Error('fixture question missing')
    /** 中文说明：当前传输或投影数据 response，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const response = { type: 'client-response' as const, rpcId: question.rpcId, result: { ok: true as const, value: {} } }
    expect(await api.respond(response)).toEqual({ accepted: true })
    expect(await api.respond(response)).toEqual({ accepted: false, reason: 'not-pending' })

    /** 中文说明：异步取消状态 replayAbort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const replayAbort = new AbortController()
    /** 中文说明：测试场景的局部值 replayed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const replayed = await collect(api.events.mux(req({}), replayAbort.signal), replayAbort, frames => frames.length === 2)
    expect(replayed.every(frame => frame.type !== 'question/requested')).toBe(true)

    /** 中文说明：当前服务或测试对象 cancelledApi，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const cancelledApi = createFixtureApi()
    /** 中文说明：异步取消状态 cancelAbort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const cancelAbort = new AbortController()
    /** 中文说明：测试场景的局部值 解构结果，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let cancelQuestion: RpcRequest<MuxFrame> | undefined
    /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
    for await (const envelope of cancelledApi.events.mux(req({}), cancelAbort.signal)) {
      if (envelope.payload.type !== 'question/requested') continue
      cancelQuestion = envelope
      cancelAbort.abort()
    }
    if (cancelQuestion === undefined) throw new Error('fixture cancellation question missing')
    expect(await cancelledApi.respond({
      type: 'client-response', rpcId: cancelQuestion.rpcId,
      result: { ok: false, error: { code: 'cancelled', message: 'skip', details: {} } },
    })).toEqual({ accepted: true })
  })

  it('respond answers the resident approval once: routing, validation, resolved broadcast, then not-pending', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    // Discover the resident approval's stable rpcId from the mux baseline.
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: { rpcId: string; frame: MuxFrame }[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.mux(req({}), abort.signal)) seen.push({ rpcId: envelope.rpcId, frame: envelope.payload })
    })()
    await vi.waitFor(() => {
      expect(seen.some(s => s.frame.type === 'approval/requested')).toBe(true)
    })
    /** 中文说明：当前传输或投影数据 requested，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const requested = seen.find(s => s.frame.type === 'approval/requested')
    if (requested === undefined || requested.frame.type !== 'approval/requested') throw new Error('unreachable')
    /** 中文说明：标识或顺序值 approvalId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const approvalId = requested.frame.approvalId

    // Routed but malformed answers.
    expect(await api.respond({ type: 'client-response', rpcId: RpcId(requested.rpcId), result: { ok: false, error: { code: 'internal', message: 'x', details: {} } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    expect(await api.respond({ type: 'client-response', rpcId: RpcId(requested.rpcId), result: { ok: true, value: { approvalId: 'wrong', outcome: 'rejected' } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    expect(await api.respond({ type: 'client-response', rpcId: RpcId(requested.rpcId), result: { ok: true, value: { approvalId, outcome: 'maybe' } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    // The real answer settles the question and broadcasts resolved.
    expect(await api.respond({ type: 'client-response', rpcId: RpcId(requested.rpcId), result: { ok: true, value: { sessionId: sid('fx-alpha'), approvalId, outcome: 'allowed-once' } } }))
      .toEqual({ accepted: true })
    await vi.waitFor(() => {
      expect(seen.some(s => s.frame.type === 'approval/resolved' && s.frame.outcome === 'allowed-once')).toBe(true)
    })
    // Settled: a duplicate answer is late, and a fresh mux open replays nothing.
    expect(await api.respond({ type: 'client-response', rpcId: RpcId(requested.rpcId), result: { ok: true, value: { sessionId: sid('fx-alpha'), approvalId, outcome: 'rejected' } } }))
      .toEqual({ accepted: false, reason: 'not-pending' })
    abort.abort()
    await consuming
    /** 中文说明：异步取消状态 abort2，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort2 = new AbortController()
    /** 中文说明：测试场景的局部值 replayed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const replayed = await collect(api.events.mux(req({}), abort2.signal), abort2, frames => frames.length === 2)
    expect(replayed.some(f => f.type === 'approval/requested')).toBe(false)
  })

  it('describe answers the fixture identity', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：当前传输或投影数据 response，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const response = await api.host.describe(req({}))
    expect(response.result).toMatchObject({
      ok: true, value: { version: '0.0.0-fixture', attachedSessions: 1, home: '/home/fixture' },
    })
    /** 中文说明：测试场景的局部值 empty，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const empty = await createFixtureApi({ empty: true }).host.describe(req({}))
    expect(empty.result).toMatchObject({ ok: true, value: { attachedSessions: 0 } })
  })

  it('createDirectory under the root mints /name whose listing and crumbs share the identity', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.host.createDirectory(req({ path: '/', name: 'srv' }))
    if (!created.result.ok) throw new Error('create failed')
    expect(created.result.value.path).toBe('/srv')
    /** 中文说明：按序保存的数据集合 listed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const listed = await api.host.listDirectory(req({ path: '/srv' }), new AbortController().signal)
    if (!listed.result.ok) throw new Error('list failed')
    expect(listed.result.value.crumbs).toEqual([
      { name: '/', path: '/', hidden: false },
      { name: 'srv', path: '/srv', hidden: false },
    ])
    /** 中文说明：测试场景的局部值 root，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const root = await api.host.listDirectory(req({ path: '/' }), new AbortController().signal)
    if (!root.result.ok) throw new Error('root list failed')
    expect(root.result.value.entries).toContainEqual({ name: 'srv', path: '/srv', hidden: false })
  })

  it('workspace.list serves the resident account and create reuses on path collision', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：按序保存的数据集合 listed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const listed = await api.workspace.list(req({}))
    if (!listed.result.ok) throw new Error('list failed')
    expect(listed.result.value.items).toEqual([
      expect.objectContaining({
        workspaceId: 'fx-ws-fixture', path: '/tmp/fixture', title: 'fixture',
        sessionIds: ['fx-alpha', 'fx-beta', 'fx-gamma'],
      }),
      expect.objectContaining({
        workspaceId: 'fx-ws-home', path: '/home/fixture/Documents/project', title: 'project',
        sessionIds: [],
      }),
    ])
    // path collision → the existing entity comes back, created:false, no frame.
    /** 中文说明：测试场景的局部值 reused，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const reused = await api.workspace.create(req({ path: '/tmp/fixture' }))
    if (!reused.result.ok) throw new Error('reuse failed')
    expect(reused.result.value).toMatchObject({ created: false, workspace: { workspaceId: 'fx-ws-fixture' } })
  })

  it('workspace.create on a fresh path mints a new entity and pushes host/workspace-changed', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: HostFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.host(req({}), abort.signal)) {
        seen.push(envelope.payload)
        abort.abort()
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.workspace.create(req({ path: '/tmp/fixture-workspaces/nova' }))
    if (!created.result.ok) throw new Error('create failed')
    expect(created.result.value.created).toBe(true)
    expect(created.result.value.workspace).toMatchObject({
      path: '/tmp/fixture-workspaces/nova', title: 'nova', sessionIds: [],
    })
    await consuming
    expect(seen).toEqual([{ type: 'host/workspace-changed', workspace: created.result.value.workspace }])
    // A basename-less path serves as its own title.
    /** 中文说明：测试场景的局部值 rootPath，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const rootPath = await api.workspace.create(req({ path: '/' }))
    if (!rootPath.result.ok) throw new Error('rootPath failed')
    expect(rootPath.result.value.workspace.title).toBe('/')
  })

  it('workspace.rename covers not-found, conflict, no-op, and the changed frame', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: HostFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.host(req({}), abort.signal)) {
        seen.push(envelope.payload)
        if (seen.length >= 2) abort.abort()
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：标识或顺序值 wsid，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const wsid = 'fx-ws-fixture' as WorkspaceId
    /** 中文说明：测试场景的局部值 missing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const missing = await api.workspace.rename(req({ workspaceId: 'fx-ws-void' as WorkspaceId, title: 'x' }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'fx-ws-void' } } })

    await api.workspace.create(req({ path: '/tmp/fixture-workspaces/occupied' }))
    /** 中文说明：测试场景的局部值 conflict，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const conflict = await api.workspace.rename(req({ workspaceId: wsid, title: ' occupied ' }))
    expect(conflict.result).toMatchObject({ ok: false, error: { code: 'workspace-name-conflict', details: { name: 'occupied' } } })

    /** 中文说明：测试场景的局部值 noop，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const noop = await api.workspace.rename(req({ workspaceId: wsid, title: ' fixture ' }))
    if (!noop.result.ok) throw new Error('no-op rename failed')
    expect(noop.result.value.workspace.title).toBe('fixture')

    /** 中文说明：测试场景的局部值 renamed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const renamed = await api.workspace.rename(req({ workspaceId: wsid, title: 'renamed' }))
    if (!renamed.result.ok) throw new Error('rename failed')
    expect(renamed.result.value.workspace.title).toBe('renamed')
    await consuming
    // Only the create and the effective rename emit frames; the no-op stays silent.
    expect(seen.map(f => f.type)).toEqual(['host/workspace-changed', 'host/workspace-changed'])
  })

  it('session.rename covers not-found, blank title, and the accepted append + title frame', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前传输或投影数据 framesPromise，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const framesPromise = (async () => {
      /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const frames: MuxFrame[] = []
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.mux(req({}), abort.signal)) {
        frames.push(envelope.payload)
        if (frames.some(f => f.type === 'session/projection' && f.key === 'title' && f.value === '重命名')) abort.abort()
      }
      return frames
    })()
    await new Promise(resolve => setTimeout(resolve, 10))

    /** 中文说明：测试场景的局部值 missing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const missing = await api.sessions.rename(req({ sessionId: sid('fx-void'), title: 'x' }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'session-not-found', details: { sessionId: 'fx-void' } } })

    /** 中文说明：测试场景的局部值 blank，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const blank = await api.sessions.rename(req({ sessionId: sid('fx-alpha'), title: '   ' }))
    expect(blank.result).toMatchObject({ ok: false, error: { code: 'title-invalid', details: { sessionId: 'fx-alpha' } } })

    /** 中文说明：测试场景的局部值 renamed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const renamed = await api.sessions.rename(req({ sessionId: sid('fx-alpha'), title: '  重命名  ' }))
    if (!renamed.result.ok) throw new Error('rename failed')
    expect(renamed.result.value.title).toBe('重命名')
    /** 中文说明：标识或顺序值 acceptedSeq，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acceptedSeq = renamed.result.value.seq
    // The response seq addresses the appended title event (the client plane
    // has no session/title in its event union — titles ride the projection —
    // so the event is located by seq and its payload checked structurally).
    /** 中文说明：测试场景的局部值 history，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const history = await api.sessions.history(req({ sessionId: sid('fx-alpha'), maxMessages: 100 }))
    if (!history.result.ok) throw new Error('history failed')
    /** 中文说明：测试场景的局部值 appended，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const appended = history.result.value.events.find(entry => entry.event.seq === acceptedSeq)
    expect(appended?.event).toMatchObject({
      type: 'session/title',
      data: { title: '重命名', messageSeqs: [], source: { kind: 'user' } },
    })
    // Beyond the subscribe-time baseline replay, the append emitted exactly
    // one title projection frame carrying the new value at the response seq.
    /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frames = await framesPromise
    /** 中文说明：当前传输或投影数据 titleFrames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const titleFrames = frames.filter(f => f.type === 'session/projection' && f.key === 'title' && f.sessionId === sid('fx-alpha') && f.value === '重命名')
    expect(titleFrames).toHaveLength(1)
    expect(titleFrames[0]).toMatchObject({ seq: acceptedSeq })
  })

  it('workspace.insertSessionBefore moves, appends, no-ops, and rejects invalid ids', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：标识或顺序值 wsid，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const wsid = 'fx-ws-fixture' as WorkspaceId
    /** 中文说明：测试场景的局部值 missing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const missing = await api.workspace.insertSessionBefore(req({ workspaceId: 'fx-ws-void' as WorkspaceId, sessionId: sid('fx-alpha') }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
    /** 中文说明：测试场景的局部值 ghost，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const ghost = await api.workspace.insertSessionBefore(req({ workspaceId: wsid, sessionId: sid('fx-ghost') }))
    expect(ghost.result).toMatchObject({ ok: false, error: { code: 'workspace-move-invalid', details: { sessionId: 'fx-ghost' } } })
    /** 中文说明：测试场景的局部值 badAnchor，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const badAnchor = await api.workspace.insertSessionBefore(req({ workspaceId: wsid, sessionId: sid('fx-alpha'), beforeSessionId: sid('fx-ghost') }))
    expect(badAnchor.result).toMatchObject({ ok: false, error: { code: 'workspace-move-invalid', details: { beforeSessionId: 'fx-ghost' } } })

    /** 中文说明：测试场景的局部值 moved，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const moved = await api.workspace.insertSessionBefore(req({ workspaceId: wsid, sessionId: sid('fx-gamma'), beforeSessionId: sid('fx-beta') }))
    if (!moved.result.ok) throw new Error('move failed')
    expect(moved.result.value.workspace.sessionIds).toEqual(['fx-alpha', 'fx-gamma', 'fx-beta'])
    /** 中文说明：测试场景的局部值 appended，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const appended = await api.workspace.insertSessionBefore(req({ workspaceId: wsid, sessionId: sid('fx-alpha') }))
    if (!appended.result.ok) throw new Error('append failed')
    expect(appended.result.value.workspace.sessionIds).toEqual(['fx-gamma', 'fx-beta', 'fx-alpha'])
    /** 中文说明：测试场景的局部值 before，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const before = appended.result.value.workspace.updatedAt
    /** 中文说明：测试场景的局部值 noop，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const noop = await api.workspace.insertSessionBefore(req({ workspaceId: wsid, sessionId: sid('fx-alpha') }))
    if (!noop.result.ok) throw new Error('no-op move failed')
    expect(noop.result.value.workspace.sessionIds).toEqual(['fx-gamma', 'fx-beta', 'fx-alpha'])
    expect(noop.result.value.workspace.updatedAt).toBe(before)
  })

  it('workspace.delete removes only the Workspace row and emits the removal frame', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: HostFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.host(req({}), abort.signal)) {
        seen.push(envelope.payload)
        abort.abort()
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：测试场景的局部值 missing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const missing = await api.workspace.delete(req({ workspaceId: 'fx-ws-void' as WorkspaceId }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
    /** 中文说明：测试场景的局部值 deleted，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const deleted = await api.workspace.delete(req({ workspaceId: 'fx-ws-fixture' as WorkspaceId }))
    expect(deleted.result).toEqual({ ok: true, value: { deleted: true } })
    await consuming
    expect(seen).toEqual([{ type: 'host/workspace-removed', workspaceId: 'fx-ws-fixture' }])
    /** 中文说明：按序保存的数据集合 list，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const list = await api.workspace.list(req({}))
    if (!list.result.ok) throw new Error('workspace list failed')
    expect(list.result.value.items.some(workspace => workspace.workspaceId === 'fx-ws-fixture')).toBe(false)
    /** 中文说明：测试场景的局部值 sessions，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const sessions = await api.sessions.list(req({}))
    if (!sessions.result.ok) throw new Error('session list failed')
    expect(sessions.result.value.items.map(session => session.sessionId)).toContain('fx-alpha')
  })

  it('session.create({workspaceId}) lands on the account and unknown ids error', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: HostFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.host(req({}), abort.signal)) {
        seen.push(envelope.payload)
        if (seen.length >= 2) abort.abort()
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：测试场景的局部值 missing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const missing = await api.sessions.create(req({ workspaceId: 'fx-ws-void' as WorkspaceId }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'fx-ws-void' } } })
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({ workspaceId: 'fx-ws-fixture' as WorkspaceId }))
    if (!created.result.ok) throw new Error('create failed')
    /** 中文说明：标识或顺序值 id，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const id = created.result.value.sessionId
    await consuming
    // The session lands with the workspace's path as cwd, and the account
    // write pushes the fresh workspace snapshot after session-added.
    /** 中文说明：测试场景的局部值 added，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const added = seen[0]
    if (added?.type !== 'host/session-added') throw new Error('session-added frame missing')
    expect(added).toEqual({
      type: 'host/session-added', sessionId: id, blank: true, cwd: '/tmp/fixture',
    })
    expect(seen[1]).toMatchObject({
      type: 'host/workspace-changed',
      workspace: { workspaceId: 'fx-ws-fixture', sessionIds: [id, 'fx-alpha', 'fx-beta', 'fx-gamma'] },
    })
  })

  it('supports an empty baseline, preallocated ids, workspace-first frames, and idempotent retry', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi({ empty: true, createFrameOrder: 'workspace-first' })
    /** 中文说明：测试场景的局部值 initialSessions，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const initialSessions = await api.sessions.list(req({}))
    /** 中文说明：测试场景的局部值 initialWorkspaces，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const initialWorkspaces = await api.workspace.list(req({}))
    expect(initialSessions.result).toMatchObject({ ok: true, value: { items: [] } })
    expect(initialWorkspaces.result).toMatchObject({ ok: true, value: { items: [] } })

    /** 中文说明：测试场景的局部值 made，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const made = await api.workspace.create(req({ path: '/tmp/fixture-workspaces/nova' }))
    if (!made.result.ok) throw new Error('workspace create failed')
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前传输或投影数据 framesPromise，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const framesPromise = collect(api.events.host(req({}), abort.signal), abort, frames => frames.length === 2)
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：测试场景的局部值 preallocated，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const preallocated = sid('fx-preallocated')
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({
      workspaceId: made.result.value.workspace.workspaceId,
      sessionId: preallocated,
    }))
    expect(created.result).toEqual({ ok: true, value: { sessionId: preallocated } })
    /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frames = await framesPromise
    expect(frames[0]).toMatchObject({
      type: 'host/workspace-changed', workspace: { sessionIds: [preallocated] },
    })
    /** 中文说明：测试场景的局部值 added，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const added = frames[1]
    if (added?.type !== 'host/session-added') throw new Error('session-added frame missing')
    expect(added).toEqual({
      type: 'host/session-added', sessionId: preallocated, blank: true,
      cwd: made.result.value.workspace.path,
    })

    /** 中文说明：测试场景的局部值 retried，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const retried = await api.sessions.create(req({
      workspaceId: made.result.value.workspace.workspaceId,
      sessionId: preallocated,
    }))
    expect(retried.result).toEqual({ ok: true, value: { sessionId: preallocated } })
    /** 中文说明：按序保存的数据集合 listed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const listed = await api.sessions.list(req({}))
    if (!listed.result.ok) throw new Error('session list failed')
    expect(listed.result.value.items.filter(item => item.sessionId === preallocated)).toHaveLength(1)

    /** 中文说明：测试场景的局部值 conflict，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const conflict = await api.sessions.create(req({ sessionId: preallocated, cwd: '/elsewhere' }))
    expect(conflict.result).toMatchObject({
      ok: false,
      error: { code: 'session-conflict', details: { sessionId: preallocated, requestedCwd: '/elsewhere' } },
    })
  })

  it('attaches an existing ungrouped Session to a matching Workspace', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：标识或顺序值 sessionId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const sessionId = sid('fx-existing-ungrouped')
    await expect(api.sessions.create(req({ sessionId, cwd: '/tmp/fixture' }))).resolves.toMatchObject({
      result: { ok: true, value: { sessionId } },
    })

    await expect(api.sessions.create(req({
      sessionId,
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
    }))).resolves.toMatchObject({ result: { ok: true, value: { sessionId } } })

    /** 中文说明：测试场景的局部值 workspaces，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const workspaces = await api.workspace.list(req({}))
    if (!workspaces.result.ok) throw new Error('workspace list failed')
    expect(workspaces.result.value.items[0]?.sessionIds).toContain(sessionId)
  })

  it('reports a conflict without an existing cwd detail for an unrecorded cwd', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：按序保存的数据集合 listed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const listed = await api.sessions.list(req({}))
    if (!listed.result.ok) throw new Error('session list failed')
    /** 中文说明：测试场景的局部值 existing，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const existing = listed.result.value.items.find(item => item.sessionId === sid('fx-alpha'))
    if (existing === undefined) throw new Error('fixture Session missing')
    delete existing.cwd

    /** 中文说明：测试场景的局部值 conflict，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const conflict = await api.sessions.create(req({ sessionId: existing.sessionId }))
    expect(conflict.result).toEqual({
      ok: false,
      error: {
        code: 'session-conflict',
        message: `session ${existing.sessionId} already uses no cwd`,
        details: { sessionId: existing.sessionId, requestedCwd: '/tmp/fixture' },
      },
    })
  })

  it('publishes an ungrouped Session when Workspace attachment fails', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi({ failWorkspaceAttach: true })
    /** 中文说明：标识或顺序值 sessionId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const sessionId = sid('fx-partial')
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await api.sessions.create(req({
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
      sessionId,
    }))
    expect(created.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-attach-failed', details: { sessionId, workspaceId: 'fx-ws-fixture' } },
    })
    /** 中文说明：按序保存的数据集合 listed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const listed = await api.sessions.list(req({}))
    /** 中文说明：测试场景的局部值 workspaces，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const workspaces = await api.workspace.list(req({}))
    if (!listed.result.ok || !workspaces.result.ok) throw new Error('list failed')
    expect(listed.result.value.items.filter(item => item.sessionId === sessionId)).toHaveLength(1)
    expect(workspaces.result.value.items[0]?.sessionIds).not.toContain(sessionId)

    /** 中文说明：测试场景的局部值 retried，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const retried = await api.sessions.create(req({
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
      sessionId,
    }))
    expect(retried.result).toMatchObject({ ok: false, error: { code: 'workspace-attach-failed' } })
    /** 中文说明：测试场景的局部值 afterRetry，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const afterRetry = await api.sessions.list(req({}))
    if (!afterRetry.result.ok) throw new Error('list failed')
    expect(afterRetry.result.value.items.filter(item => item.sessionId === sessionId)).toHaveLength(1)
  })

  it('reconciles a dropped create response and can reject a prompt before acceptance', async () => {
    /** 中文说明：标识或顺序值 sessionId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const sessionId = sid('fx-lost-response')
    /** 中文说明：测试场景的局部值 dropped，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const dropped = createFixtureApi({ dropSessionCreateResponse: true })
    await expect(Promise.resolve().then(() => dropped.sessions.create(req({
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
      sessionId,
    })))).rejects.toThrow(/dropped session\.create response/)
    /** 中文说明：按序保存的数据集合 listed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const listed = await dropped.sessions.list(req({}))
    /** 中文说明：测试场景的局部值 workspaces，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const workspaces = await dropped.workspace.list(req({}))
    if (!listed.result.ok || !workspaces.result.ok) throw new Error('list failed')
    expect(listed.result.value.items.some(item => item.sessionId === sessionId)).toBe(true)
    expect(workspaces.result.value.items[0]?.sessionIds).toContain(sessionId)
    await expect(dropped.sessions.create(req({
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
      sessionId,
    }))).resolves.toMatchObject({ result: { ok: true, value: { sessionId } } })

    /** 中文说明：测试场景的局部值 rejecting，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const rejecting = createFixtureApi({ empty: true, rejectPrompt: true })
    /** 中文说明：测试场景的局部值 real，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const real = await rejecting.sessions.create(req({ sessionId: sid('fx-rejected') }))
    if (!real.result.ok) throw new Error('session create failed')
    /** 中文说明：测试场景的局部值 prompt，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const prompt = await rejecting.sessions.prompt(req({
      sessionId: real.result.value.sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'keep me' }],
    }))
    expect(prompt.result).toMatchObject({ ok: false, error: { code: 'agent-busy' } })
    /** 中文说明：测试场景的局部值 imagePrompt，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const imagePrompt = await rejecting.sessions.prompt(req({
      sessionId: real.result.value.sessionId,
      mode: 'queue' as const,
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' }],
    }))
    expect(imagePrompt.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'IMAGE_DIMENSION_TOO_LARGE' } },
    })
  })

  it('timing hooks: history delay + one-shot failure, silent append, and breakStreams end open generators', async () => {
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 hooks，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const hooks = timing()
    // One-shot transport failure after transit delay.
    hooks.setHistoryDelay(5)
    hooks.failNextHistory()
    await expect(api.sessions.history(req({ sessionId: sid('fx-alpha'), maxMessages: 5 }))).rejects.toThrow(/simulated history transport failure/)
    hooks.setHistoryDelay(0)
    // The failure was one-shot: the next call succeeds.
    /** 中文说明：测试场景的局部值 ok，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const ok = await api.sessions.history(req({ sessionId: sid('fx-alpha'), maxMessages: 5 }))
    expect(ok.result.ok).toBe(true)
    // appendUser emits on the mux stream; appendSilent only lands in the log (lost frame).
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：按序保存的数据集合 seen，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const seen: MuxFrame[] = []
    /** 中文说明：测试场景的局部值 consuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const consuming = (async () => {
      /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const envelope of api.events.mux(req({}), abort.signal)) seen.push(envelope.payload)
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    hooks.appendSilent('fx-alpha', '静默丢帧')
    hooks.appendUser('fx-alpha', '正常直播')
    hooks.appendTitle('fx-alpha', 'Fixture 修订标题')
    hooks.beginModelRetry('fx-alpha')
    hooks.scheduleModelRetry('fx-alpha')
    hooks.completeModelRetry('fx-alpha')
    hooks.beginModelRetry('fx-alpha')
    hooks.cancelModelRetryDuringBackoff('fx-alpha')
    await vi.waitFor(() => {
      expect(seen.some(f => f.type === 'session/event' && JSON.stringify(f.event.data).includes('正常直播'))).toBe(true)
      expect(seen.some(f => f.type === 'session/event' && (f.event as { type: string }).type === 'llm/retry')).toBe(true)
      expect(seen.some(f => f.type === 'session/event' && JSON.stringify(f.event.data).includes('重试后的完整回复'))).toBe(true)
      expect(seen.some(f => f.type === 'session/event'
        && f.event.type === 'turn/end'
        && f.event.data.reason.kind === 'aborted')).toBe(true)
      expect(seen.some(f => f.type === 'session/projection' && f.key === 'title' && f.value === 'Fixture 修订标题')).toBe(true)
    })
    expect(seen.some(f => f.type === 'session/event' && JSON.stringify(f.event.data).includes('静默丢帧'))).toBe(false)
    /** 中文说明：标识或顺序值 rawTitleIndex，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const rawTitleIndex = seen.findIndex(f => f.type === 'session/event' && (f.event as { type: string }).type === 'session/title')
    /** 中文说明：标识或顺序值 titleControlIndex，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const titleControlIndex = seen.findIndex(f => f.type === 'session/projection' && f.key === 'title' && f.value === 'Fixture 修订标题')
    expect(titleControlIndex).toBe(rawTitleIndex + 1)
    // But history serves the silent event (the client's repull finds it).
    /** 中文说明：测试场景的局部值 repull，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const repull = await api.sessions.history(req({ sessionId: sid('fx-alpha'), maxMessages: 5 }))
    if (!repull.result.ok) throw new Error('repull failed')
    expect(JSON.stringify(repull.result.value.events)).toContain('静默丢帧')
    // breakStreams force-ends BOTH stream kinds without the client abort.
    /** 中文说明：异步取消状态 habort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const habort = new AbortController()
    /** 中文说明：测试场景的局部值 hostConsuming，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const hostConsuming = (async () => {
      /** 中文说明：测试场景的局部值 _，取值由紧邻初始化决定，仅在当前作用域使用。 */
      for await (const _ of api.events.host(req({}), habort.signal)) { /* drain */ }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    hooks.breakStreams()
    await consuming // returns because the stream broke, not because we aborted
    await hostConsuming
    expect(abort.signal.aborted).toBe(false)
    expect(habort.signal.aborted).toBe(false)
  })

  it('paces the opt-in reasoning stress hook from an external interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    /** 中文说明：当前服务或测试对象 api，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：测试场景的局部值 hooks，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const hooks = timing()
    expect(hooks.reasoningChunkStormState()).toBeNull()
    expect(() => hooks.startReasoningChunkStorm('fx-alpha', 0, 1, 16)).toThrow(/chunk count/)
    expect(() => hooks.startReasoningChunkStorm('fx-alpha', 1, 0, 16)).toThrow(/chunks per interval/)
    expect(() => hooks.startReasoningChunkStorm('fx-alpha', 1, 1, 0)).toThrow(/reasoning interval/)
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    try {
      /** 中文说明：测试场景的局部值 streamed，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const streamed = collect(api.events.mux(req({}), abort.signal), abort, frames => frames.some(frame => (
        frame.type === 'session/event'
        && frame.event.type === 'assistant/chunk'
        && frame.event.data.chunk.type === 'reasoning-delta'
        && frame.event.data.chunk.text.includes('REASONING_STRESS_COMPLETE')
      )))
      /** 中文说明：测试场景的局部值 marker，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const marker = hooks.startReasoningChunkStorm('fx-alpha', 3, 2, 16)
      expect(() => hooks.startReasoningChunkStorm('fx-alpha', 1, 1, 16)).toThrow(/already running/)
      expect(hooks.reasoningChunkStormState()).toMatchObject({ emitted: 0, emitting: true, marker })

      await vi.advanceTimersByTimeAsync(0)
      expect(hooks.reasoningChunkStormState()).toMatchObject({ emitted: 2, emitting: true })
      await vi.advanceTimersByTimeAsync(16)
      expect(hooks.reasoningChunkStormState()).toEqual({
        sessionId: 'fx-alpha', chunkCount: 3, chunksPerInterval: 2, intervalMs: 16,
        emitted: 3, marker, emitting: false,
      })

      /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const frames = await streamed
      /** 中文说明：测试场景的局部值 deltas，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const deltas = frames.flatMap(frame => (
        frame.type === 'session/event'
        && frame.event.type === 'assistant/chunk'
        && frame.event.data.chunk.type === 'reasoning-delta'
          ? [frame.event.data.chunk.text]
          : []
      ))
      expect(deltas).toEqual(['推理', '推理', `\n${marker}`])
    } finally {
      abort.abort()
      vi.useRealTimers()
    }
  })
})

describe('FixtureApiClient (protocol-level fake carrier)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('doFetch is an unreachable tripwire (all protocol paths overridden)', () => {
    /** 中文说明：当前服务或测试对象 client，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const client = new FixtureApiClient()
    // Protected at compile time only; reach it directly to pin the tripwire message.
    expect(() => (client as unknown as { doFetch(): Promise<Response> }).doFetch()).toThrow(/doFetch must be unreachable/)
  })

  it('mints request ids, taps all four full forms, and never touches doFetch', async () => {
    /** 中文说明：当前服务或测试对象 client，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const client = new FixtureApiClient()
    /** 中文说明：测试场景的局部值 tapped，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tapped: RpcMessage[] = []
    client.subscribeEnvelopes(batch => tapped.push(...batch))
    /** 中文说明：当前传输或投影数据 response，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const response = await client.sessions.list({})
    expect(response.result.ok).toBe(true)
    await client.respond({ type: 'client-response', rpcId: RpcId('r-x'), result: { ok: true, value: {} } })
    await vi.waitFor(() => {
      /** 中文说明：测试场景的局部值 kinds，取值由紧邻初始化决定，仅在当前作用域使用。 */
      const kinds = tapped.map(m => m.type)
      expect(kinds).toContain('client-request')
      expect(kinds).toContain('server-response')
      expect(kinds).toContain('client-response')
    })
    /** 中文说明：当前传输或投影数据 request，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const request = tapped.find(m => m.type === 'client-request')
    /** 中文说明：测试场景的局部值 reply，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const reply = tapped.find(m => m.type === 'server-response')
    expect(request?.rpcId).toBe(reply?.rpcId) // echo discipline holds through the fake carrier
  })

  it('covers the whole unary dispatch table', async () => {
    /** 中文说明：当前服务或测试对象 client，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const client = new FixtureApiClient()
    expect((await client.sessions.search(
      { query: 'fixture' },
      new AbortController().signal,
    )).result.ok).toBe(true)
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await client.sessions.create({})
    if (!created.result.ok) throw new Error('create failed')
    /** 中文说明：标识或顺序值 id，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const id = created.result.value.sessionId
    expect((await client.sessions.history({ sessionId: id })).result.ok).toBe(true)
    expect((await client.sessions.prompt({ sessionId: id, mode: 'queue', content: [{ type: 'text', text: '嗨' }] })).result.ok).toBe(true)
    expect((await client.sessions.cancel({ sessionId: id })).result.ok).toBe(true)
    expect((await client.host.describe({})).result.ok).toBe(true)
    expect((await client.workspace.list({})).result.ok).toBe(true)
    /** 中文说明：测试场景的局部值 workspace，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const workspace = await client.workspace.create({ path: '/tmp/fixture-workspaces/via-client' })
    if (!workspace.result.ok) throw new Error('workspace create failed')
    expect(workspace.result.value.workspace.title).toBe('via-client')
    /** 中文说明：标识或顺序值 wsid，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const wsid = workspace.result.value.workspace.workspaceId
    /** 中文说明：测试场景的局部值 renamed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const renamed = await client.workspace.rename({ workspaceId: wsid, title: 'via-client-2' })
    if (!renamed.result.ok) throw new Error('workspace rename failed')
    expect(renamed.result.value.workspace.title).toBe('via-client-2')
    /** 中文说明：测试场景的局部值 attached，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const attached = await client.sessions.create({ workspaceId: wsid })
    if (!attached.result.ok) throw new Error('attached create failed')
    /** 中文说明：测试场景的局部值 moved，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const moved = await client.workspace.insertSessionBefore({ workspaceId: wsid, sessionId: attached.result.value.sessionId })
    if (!moved.result.ok) throw new Error('workspace move failed')
    expect(moved.result.value.workspace.sessionIds).toEqual([attached.result.value.sessionId])
    // Goal lifecycle over the fixture fold: create → edit → pause → resume → complete → clear;
    // every mutation acknowledges with the NEW CAS ref (state rides the projection frames).
    /** 中文说明：测试场景的局部值 goalCreated，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const goalCreated = await client.goals.create({ sessionId: id, objective: 'ship it' })
    if (!goalCreated.result.ok) throw new Error('goal create failed')
    /** 中文说明：测试场景的局部值 ref，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let ref = goalCreated.result.value.ref
    expect(ref.revision).toBe(1)
    /** 中文说明：测试场景的局部值 edited，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const edited = await client.goals.edit({ sessionId: id, ref, objective: 'ship it v2' })
    if (!edited.result.ok) throw new Error('goal edit failed')
    ref = edited.result.value.ref
    /** 中文说明：测试场景的局部值 paused，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const paused = await client.goals.pause({ sessionId: id, ref })
    if (!paused.result.ok) throw new Error('goal pause failed')
    ref = paused.result.value.ref
    /** 中文说明：测试场景的局部值 resumed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const resumed = await client.goals.resume({ sessionId: id, ref })
    if (!resumed.result.ok) throw new Error('goal resume failed')
    ref = resumed.result.value.ref
    // A stale ref loses the CAS check.
    expect((await client.goals.pause({ sessionId: id, ref: { ...ref, revision: 1 } })).result.ok).toBe(false)
    /** 中文说明：测试场景的局部值 completed，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const completed = await client.goals.complete({ sessionId: id, ref })
    if (!completed.result.ok) throw new Error('goal complete failed')
    ref = completed.result.value.ref
    // complete → complete is an invalid transition.
    expect((await client.goals.complete({ sessionId: id, ref })).result.ok).toBe(false)
    expect((await client.goals.clear({ sessionId: id, ref })).result).toEqual({ ok: true, value: { cleared: true } })

    /** 中文说明：测试场景的局部值 goalHistory，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const goalHistory = await client.sessions.history({ sessionId: id })
    if (!goalHistory.result.ok) throw new Error('goal history failed')
    /** 中文说明：当前传输或投影数据 goalEvents，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const goalEvents = goalHistory.result.value.events.map(entry => entry.event as unknown as {
      type: string
      data: {
        operation?: string
        source?: { kind?: string; round?: number }
      }
    })
    /** 中文说明：测试场景的局部值 goalChanges，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const goalChanges = goalEvents.filter(event => event.type === 'goal/change')
    expect(goalChanges.map(event => event.data.operation))
      .toEqual(['create', 'edit', 'pause', 'resume', 'complete', 'clear'])
    expect(goalEvents.some(event => event.type === 'user/message'
      && event.data.source?.kind === 'goal' && event.data.source.round === 0)).toBe(false)
  })

  it('maps empty, prompt-reject, and workspace-first query scenarios', async () => {
    vi.stubGlobal('location', {
      search: '?fixture=empty&fixturePrompt=reject&fixtureFrames=workspace-first',
    })
    /** 中文说明：当前服务或测试对象 client，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const client = new FixtureApiClient()
    await expect(client.sessions.list({})).resolves.toMatchObject({ result: { ok: true, value: { items: [] } } })
    /** 中文说明：测试场景的局部值 made，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const made = await client.workspace.create({ path: '/tmp/fixture-workspaces/query-workspace' })
    if (!made.result.ok) throw new Error('workspace create failed')
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前传输或投影数据 framesPromise，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const framesPromise = collect(client.events.host({}, abort.signal), abort, frames => frames.length === 2)
    await new Promise(resolve => setTimeout(resolve, 10))
    /** 中文说明：标识或顺序值 sessionId，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const sessionId = sid('fx-query-session')
    /** 中文说明：测试场景的局部值 created，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const created = await client.sessions.create({
      workspaceId: made.result.value.workspace.workspaceId,
      sessionId,
    })
    expect(created.result).toMatchObject({ ok: true, value: { sessionId } })
    /** 中文说明：当前传输或投影数据 frames，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const frames = await framesPromise
    expect(frames.map(frame => frame.type)).toEqual(['host/workspace-changed', 'host/session-added'])
    /** 中文说明：测试场景的局部值 rejected，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const rejected = await client.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'retain' }],
    })
    expect(rejected.result).toMatchObject({ ok: false, error: { code: 'agent-busy' } })
  })

  it('maps attach-failure and dropped-response query scenarios', async () => {
    vi.stubGlobal('location', { search: '?fixture&fixtureAttach=fail' })
    /** 中文说明：测试场景的局部值 partial，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const partial = new FixtureApiClient()
    /** 中文说明：测试场景的局部值 partialResult，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const partialResult = await partial.sessions.create({
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
      sessionId: sid('fx-query-partial'),
    })
    expect(partialResult.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-attach-failed', details: { sessionId: 'fx-query-partial' } },
    })

    vi.stubGlobal('location', { search: '?fixture&fixtureSessionCreate=drop-response' })
    /** 中文说明：测试场景的局部值 dropped，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const dropped = new FixtureApiClient()
    await expect(dropped.sessions.create({
      workspaceId: 'fx-ws-fixture' as WorkspaceId,
      sessionId: sid('fx-query-dropped'),
    })).rejects.toThrow(/dropped session\.create response/)
  })

  it('fires onOpen at stream-iteration start and taps server-request full forms', async () => {
    /** 中文说明：当前服务或测试对象 client，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const client = new FixtureApiClient()
    /** 中文说明：测试场景的局部值 tapped，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tapped: RpcMessage[] = []
    client.subscribeEnvelopes(batch => tapped.push(...batch))
    /** 中文说明：测试场景的局部值 order，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const order: string[] = []
    /** 中文说明：异步取消状态 abort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：测试场景的局部值 envelope，取值由紧邻初始化决定，仅在当前作用域使用。 */
    for await (const envelope of client.events.mux({}, abort.signal, () => order.push('open'))) {
      order.push(envelope.payload.type)
      abort.abort()
    }
    expect(order[0]).toBe('open')
    expect(order[1]).toBe('session/subscribed')
    await vi.waitFor(() => {
      expect(tapped.some(m => m.type === 'server-request')).toBe(true)
    })
    // Host stream side of the pair (same tap path).
    /** 中文说明：异步取消状态 habort，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const habort = new AbortController()
    /** 中文说明：测试场景的局部值 hostOrder，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const hostOrder: string[] = []
    /** 中文说明：测试场景的局部值 hostIterator，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const hostIterator = client.events.host({}, habort.signal, () => hostOrder.push('open'))[Symbol.asyncIterator]()
    /** 中文说明：测试场景的局部值 raced，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const raced = await Promise.race([hostIterator.next(), new Promise<'idle'>(resolve => setTimeout(() => { resolve('idle') }, 50))])
    expect(hostOrder).toEqual(['open']) // established even though the host stream stays silent
    habort.abort()
    if (raced === 'idle') await hostIterator.return?.(undefined)
  })
})
