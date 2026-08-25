/**
 * 文件职责：验证Host API Proxy的 api-proxy-subagents.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { RpcId } from '../src/api/rpc.ts'
import type { RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (value: string): SessionId => value as SessionId
/** 中文说明：测试局部值 PARENT，由紧邻初始化决定。 */
const PARENT = sid('parent')
/** 中文说明：测试局部值 CHILD，由紧邻初始化决定。 */
const CHILD = sid('child')

/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('subagent-rpc'), payload }
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function bench(options: {
  parentLive?: boolean
  childStatus?: 'idle' | 'running'
  entries?: object[]
  followupError?: Error
  interruptError?: Error
  listError?: Error
  /** Persistence forgets the child entirely (the vanished-mid-read race). */
  storedChild?: false
  /** Attach the child to the live session store instead of persistence only. */
  liveChild?: true
  /** Every registered projection unit throws on this child's payloads. */
  projectionsThrow?: true
  historyParent?: SessionId
} = {}) {
  /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
  const parent = { id: PARENT }
  /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
  const child = options.childStatus === undefined
    ? undefined
    : { id: CHILD, status: options.childStatus }
  /** 中文说明：测试局部值 getAgent，由紧邻初始化决定。 */
  const getAgent = vi.fn((id: SessionId) => {
    if (options.parentLive !== false && id === PARENT) return parent
    if (id === CHILD) return child
    return undefined
  })
  /** 中文说明：测试局部值 listChildren，由紧邻初始化决定。 */
  const listChildren = vi.fn(() => options.listError === undefined
    ? Promise.resolve(options.entries ?? [
      {
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'inactive', hasChildren: false,
      },
    ])
    : Promise.reject(options.listError))
  /** 中文说明：测试局部值 followup，由紧邻初始化决定。 */
  const followup = vi.fn((
    _parent: unknown,
    _childId: SessionId,
    _content: unknown,
    _delivery: {
      source: { kind: string; rpcId: RpcId; clientTimeZone?: string }
      signal: AbortSignal
    },
  ) => options.followupError === undefined
    ? Promise.resolve('message-1')
    : Promise.reject(options.followupError))
  /** 中文说明：测试局部值 interrupt，由紧邻初始化决定。 */
  const interrupt = vi.fn((
    _targetSessionId: SessionId,
    _authority: { kind: 'user'; parentSessionId: SessionId },
  ) => {
    if (options.interruptError !== undefined) throw options.interruptError
  })
  /** 中文说明：测试局部值 childHeader，由紧邻初始化决定。 */
  const childHeader = {
    version: 0, id: CHILD, createdAt: 1, cwd: '/proj', parentSession: options.historyParent ?? PARENT,
  } satisfies SessionHeader
  /** 中文说明：测试局部值 childEvents，由紧邻初始化决定。 */
  const childEvents = [
    { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } } },
  ] as unknown as SessionEvent[]
  /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
  const inspect = vi.fn(() => Promise.resolve({ meta: childHeader, events: childEvents }))
  /** 中文说明：测试局部值 liveBlock，由紧邻初始化决定。 */
  const liveBlock = { values: {}, asOfSeq: 3 }
  /** 中文说明：测试局部值 coldBlock，由紧邻初始化决定。 */
  const coldBlock = { values: {}, asOfSeq: 0 }
  /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
  const snapshot = vi.fn(() => {
    if (options.projectionsThrow === true) throw new Error('hostile unit')
    return liveBlock
  })
  /** 中文说明：测试局部值 restore，由紧邻初始化决定。 */
  const restore = vi.fn(() => {
    if (options.projectionsThrow === true) throw new Error('hostile unit')
    return { snapshot: coldBlock }
  })
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  ctx.provide('agents', { get: getAgent })
  ctx.provide('subagents', { listChildren, followup, interrupt })
  ctx.provide('sessions', {
    get: (id: SessionId) => options.liveChild === true && id === CHILD
      ? { id: CHILD, header: childHeader, events: childEvents }
      : undefined,
  })
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve(options.storedChild === false ? [] : [childHeader]),
    inspect,
    locate: () => undefined,
  })
  // The gateway's own projection push feed subscribes at construction; the
  // no-op disposer keeps that feed quiet while these tests pin history reads.
  ctx.provide('sessionProjections', {
    snapshot,
    restore,
    onChanged: () => () => {},
    register: () => () => {},
  })
  ctx.provide('userQuestions', { registerProvider: () => () => {} })
  /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
  })
  return { api, getAgent, listChildren, inspect, snapshot, restore, followup, interrupt, parent }
}

describe('subagent gateway', () => {
  it('lists the complete catalog and reports exact live-parent availability', async () => {
    /** 中文说明：测试局部值 { api, listChildren }，由紧邻初始化决定。 */
    const { api, listChildren } = bench({ parentLive: false, entries: [
      {
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'inactive', hasChildren: true,
      },
      {
        kind: 'child', id: sid('one-shot'), mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      },
      { kind: 'diagnostic', id: sid('bad'), reason: 'corrupt' },
    ] })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.list(request({ parentSessionId: PARENT }))
    expect(response.rpcId).toBe('subagent-rpc')
    expect(response.result).toMatchObject({
      ok: true,
      value: {
        parentAvailable: false,
        entries: [
          { kind: 'child', mode: 'continuable' },
          { kind: 'child', mode: 'one-shot' },
          { kind: 'diagnostic' },
        ],
      },
    })
    expect(listChildren).toHaveBeenCalledWith(PARENT, undefined)
  })

  it('derives catalog activity from the live child Agent rather than Session residency', async () => {
    /** 中文说明：测试局部值 residentIdle，由紧邻初始化决定。 */
    const residentIdle = bench({ childStatus: 'idle', entries: [{
      kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
      activity: 'running', hasChildren: false,
    }] })
    expect((await residentIdle.api.subagents.list(request({ parentSessionId: PARENT }))).result)
      .toMatchObject({ ok: true, value: { entries: [{ activity: 'inactive' }] } })

    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = bench({ childStatus: 'running' })
    expect((await running.api.subagents.list(request({ parentSessionId: PARENT }))).result)
      .toMatchObject({ ok: true, value: { entries: [{ activity: 'running' }] } })
  })

  it('reads a healthy direct child without looking up or activating any Agent', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { api, getAgent, inspect, restore } = bench()
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', maxMessages: 10,
    }))
    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: false, events: [{ event: { type: 'user/message', seq: 0 } }] },
    })
    expect(inspect).toHaveBeenCalledWith(CHILD)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(getAgent).not.toHaveBeenCalled()
  })

  it('serves a live child from the in-memory snapshot and the watermark projections', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { api, inspect, snapshot, restore } = bench({ liveChild: true })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: false, projections: { asOfSeq: 3 } },
    })
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(restore).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('serves the page without projections when a hostile unit breaks the fold', async () => {
    /** 中文说明：测试局部值 cold，由紧邻初始化决定。 */
    const cold = bench({ projectionsThrow: true })
    /** 中文说明：测试局部值 coldResponse，由紧邻初始化决定。 */
    const coldResponse = await cold.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(coldResponse.result).toMatchObject({
      ok: true,
      value: { hasMore: false, events: [{ event: { type: 'user/message', seq: 0 } }] },
    })
    if (coldResponse.result.ok) expect('projections' in coldResponse.result.value).toBe(false)

    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = bench({ projectionsThrow: true, liveChild: true })
    /** 中文说明：测试局部值 liveResponse，由紧邻初始化决定。 */
    const liveResponse = await live.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(liveResponse.result).toMatchObject({
      ok: true,
      value: { hasMore: false, events: [{ event: { type: 'user/message', seq: 0 } }] },
    })
    if (liveResponse.result.ok) expect('projections' in liveResponse.result.value).toBe(false)
    expect(live.snapshot).toHaveBeenCalledTimes(1)
  })

  it('reads one-shot history and rejects an address with the wrong mode', async () => {
    /** 中文说明：测试局部值 oneShot，由紧邻初始化决定。 */
    const oneShot = {
      kind: 'child', id: CHILD, mode: 'one-shot', label: 'batch',
      activity: 'inactive', hasChildren: false,
    }
    /** 中文说明：测试局部值 { api, inspect }，由紧邻初始化决定。 */
    const { api, inspect } = bench({ entries: [oneShot] })
    expect((await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'one-shot',
    }))).result).toMatchObject({ ok: true })
    expect((await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))).result).toMatchObject({ ok: false, error: { code: 'subagent-not-found' } })
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('rejects a diagnostic address before reading history', async () => {
    /** 中文说明：测试局部值 { api, inspect }，由紧邻初始化决定。 */
    const { api, inspect } = bench({ entries: [
      { kind: 'diagnostic', id: CHILD, reason: 'unsupported' },
    ] })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: {
        code: 'subagent-catalog-diagnostic',
        details: { parentSessionId: PARENT, childSessionId: CHILD, reason: 'unsupported' },
      },
    })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('maps the missing projections capability to one wire face on list, history, and prompt', async () => {
    /** 中文说明：测试局部值 listError，由紧邻初始化决定。 */
    const listError = () => new SubagentError(
      'listing subagents requires the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
      'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    )
    /** 中文说明：测试局部值 expected，由紧邻初始化决定。 */
    const expected = {
      code: 'internal',
      message: 'subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
    }

    /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
    const list = bench({ listError: listError() })
    expect((await list.api.subagents.list(request({ parentSessionId: PARENT }))).result)
      .toMatchObject({ ok: false, error: expected })

    /** 中文说明：测试局部值 history，由紧邻初始化决定。 */
    const history = bench({ listError: listError() })
    expect((await history.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))).result).toMatchObject({ ok: false, error: expected })
    expect(history.inspect).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = bench({ listError: listError() })
    expect((await prompt.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({ ok: false, error: expected })
    expect(prompt.followup).not.toHaveBeenCalled()
  })

  it('routes human content through the exact live parent with rpc attribution', async () => {
    /** 中文说明：测试局部值 { api, parent, followup }，由紧邻初始化决定。 */
    const { api, parent, followup } = bench()
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = [{ type: 'text' as const, text: '继续' }]
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content,
    }), signal)
    expect(response.result).toMatchObject({
      ok: true, value: { messageId: 'message-1' },
    })
    expect(followup).toHaveBeenCalledWith(
      parent,
      CHILD,
      content,
      { source: { kind: 'user', rpcId: RpcId('subagent-rpc') }, signal },
    )
  })

  it('canonicalizes browser-zone provenance before delivering a child prompt', async () => {
    /** 中文说明：测试局部值 { api, parent, followup }，由紧邻初始化决定。 */
    const { api, parent, followup } = bench()
    /** 中文说明：测试局部值 alias，由紧邻初始化决定。 */
    const alias = 'US/Pacific'
    /** 中文说明：测试局部值 canonical，由紧邻初始化决定。 */
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: alias })
      .resolvedOptions().timeZone
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = [{ type: 'text' as const, text: 'continue locally' }]
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal
    await expect(api.subagents.prompt(request({
      parentSessionId: PARENT,
      childSessionId: CHILD,
      mode: 'continuable',
      content,
      clientTimeZone: alias,
    }), signal)).resolves.toMatchObject({ result: { ok: true } })
    expect(followup).toHaveBeenCalledWith(parent, CHILD, content, {
      source: { kind: 'user', rpcId: RpcId('subagent-rpc'), clientTimeZone: canonical },
      signal,
    })

    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = await api.subagents.prompt(request({
      parentSessionId: PARENT,
      childSessionId: CHILD,
      mode: 'continuable',
      content,
      clientTimeZone: 'Not/A_Real_Zone',
    }), signal)
    expect(invalid.result).toEqual({
      ok: false,
      error: {
        code: 'invalid-time-zone',
        message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
        details: { value: 'Not/A_Real_Zone' },
      },
    })
    expect(followup).toHaveBeenCalledOnce()
  })

  it('fails before delivery when the parent is absent and maps continuation failures', async () => {
    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = bench({ parentLive: false })
    expect((await absent.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'subagent-parent-unavailable' },
    })
    expect(absent.listChildren).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = bench({ followupError: new SubagentError('draining', 'DRAINING') })
    expect((await failed.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'subagent-delivery-unavailable' },
    })
  })

  it('maps history disappearance and hides unexpected backend details', async () => {
    /** 中文说明：测试局部值 disappeared，由紧邻初始化决定。 */
    const disappeared = bench({ storedChild: false })
    expect((await disappeared.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))).result).toMatchObject({
      ok: false,
      error: {
        code: 'subagent-not-found',
        message: 'subagent disappeared during history read',
        details: { parentSessionId: PARENT, childSessionId: CHILD },
      },
    })

    /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
    const catalog = bench({ listError: new Error('secret descriptor') })
    expect((await catalog.api.subagents.list(request({
      parentSessionId: PARENT,
    }))).result).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'subagent catalog read failed' },
    })

    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = bench({ followupError: new Error('secret provider') })
    expect((await prompt.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'subagent prompt failed' },
    })
  })

  it('interrupts through the core primitive alone while the parent Agent is offline', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { api, interrupt, getAgent, listChildren, inspect } = bench({ parentLive: false })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.interrupt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const,
    }))
    expect(response.rpcId).toBe('subagent-rpc')
    expect(response.result).toEqual({ ok: true, value: { accepted: true } })
    expect(interrupt).toHaveBeenCalledExactlyOnceWith(CHILD, { kind: 'user', parentSessionId: PARENT })
    // No parent-registry, catalog, or history dependency: this is what keeps a
    // live child interruptible after its parent Agent went offline.
    expect(getAgent).not.toHaveBeenCalled()
    expect(listChildren).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('maps interrupt authorization rejection without touching other services', async () => {
    /** 中文说明：测试局部值 { api, listChildren }，由紧邻初始化决定。 */
    const { api, listChildren } = bench({
      interruptError: new SubagentError('secret lineage', 'UNAUTHORIZED'),
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.interrupt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const,
    }))
    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'subagent-unauthorized',
        message: 'subagent does not belong to this parent',
        details: { childSessionId: CHILD },
      },
    })
    expect(listChildren).not.toHaveBeenCalled()
  })

  it('hides unexpected interrupt failures behind the internal code', async () => {
    /** 中文说明：测试局部值 { api }，由紧邻初始化决定。 */
    const { api } = bench({ interruptError: new Error('secret activation state') })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.subagents.interrupt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const,
    }))
    expect(response.result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'subagent interrupt failed', details: {} },
    })
  })
})
