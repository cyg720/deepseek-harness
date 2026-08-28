/*
 * 文件职责：验证浏览器端连接插件装载、状态订阅、HTTP RPC 和 WebSocket 事件流行为。
 * 技术维度：Cordis 测试 Context、Vitest、FakeWebSocket、Fetch 模拟和异步迭代器。
 * 产品维度：保证浏览器启动、重连、取消和目标管理调用在真实组装入口下可用。
 * 逻辑维度：挂载插件，替换浏览器全局对象，驱动模拟响应或事件，再断言状态与清理结果。
 * 关键边界：全局 Fetch 与 WebSocket 必须在用例后恢复；异步流要显式关闭，避免测试泄漏。
 * 新手阅读建议：先读 FakeWebSocket 和 mount，再按连接生命周期、传输、RPC 三组场景阅读。
 */
/**
 * Connection plugin browser-half apply: ctx.connection handle mounting, mode
 * selection off the page URL, and single-consumer connection-loop ownership.
 */
// oxlint-disable-next-line @stylistic/max-len -- 中文文件说明需要在英文说明下方完整保留六个部分。
/** 文件职责：验证浏览器连接插件装载与传输。技术维度：Cordis、Fetch 和 WebSocket。产品维度：保证浏览器可靠连接宿主。逻辑维度：挂载后驱动模拟事件并断言状态。关键边界：全局替身和异步流必须清理。新手阅读建议：先读 FakeWebSocket 与 mount。 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  type ClientTransportHooks,
  type ConnectionGenerationSource,
  type ConnectionHandle,
} from '../src/client/index.ts'

type Win = {
  location?: { hostname: string; search: string; origin?: string }
  __DSH_TRANSPORT__?: ClientTransportHooks
}

afterEach(() => {
  delete (globalThis as Win).location
  delete (globalThis as Win).__DSH_TRANSPORT__
})

class GenerationProbe {
  private readonly active = new Set<() => void>()

  readonly source: ConnectionGenerationSource = (signal, ready) => new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', finish)
      this.active.delete(finish)
      resolve()
    }
    this.active.add(finish)
    signal.addEventListener('abort', finish, { once: true })
    ready({ home: '/h' })
    if (signal.aborted) finish()
  })

  end(): void {
    for (const finish of [...this.active]) finish()
  }
}

function installGeneration(handle: ConnectionHandle): GenerationProbe {
  const probe = new GenerationProbe()
  handle.registerGenerationSource(probe.source)
  return probe
}

async function mount(): Promise<ConnectionHandle> {
  /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  await ctx.plugin({ apply, inject: [] })
  /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) throw new Error('ctx.connection not provided')
  return handle
}

describe('connection client apply', () => {
  it('treats a runtime without browser location as local', async () => {
    delete (globalThis as Win).location
    expect((await mount()).isLoopback).toBe(true)
  })

  it('mounts ctx.connection and identifies a loopback page', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    expect(handle.isLoopback).toBe(true)
  })

  it('selects the fixture RPC transport under ?fixture', async () => {
    ;(globalThis as Win).location = { hostname: '127.0.0.1', search: '?fixture' }
    const handle = await mount()
    await expect(handle.rpc.call('/api', 'settings/describe', { args: {} }))
      .resolves.toMatchObject({ ok: true })
  })

  it('reports non-loopback page authority through the connection handle', async () => {
    ;(globalThis as Win).location = { hostname: '192.0.2.20', search: '' }
    expect((await mount()).isLoopback).toBe(false)
  })

  it('requires one generation source and ignores a stale source disposer', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    const first = new GenerationProbe()
    const second = new GenerationProbe()

    expect(() => handle.start({})).toThrow('no generation source is registered')
    const unregisterFirst = handle.registerGenerationSource(first.source)
    expect(() => { handle.registerGenerationSource(second.source) })
      .toThrow('a generation source is already registered')
    unregisterFirst()
    const unregisterSecond = handle.registerGenerationSource(second.source)
    unregisterFirst()

    const loop = handle.start({})
    await vi.waitFor(() => {
      expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
    })
    unregisterSecond()
    expect(handle.generation.getSnapshot()).toBeUndefined()
    loop.stop()
  })

  it('start() hands out one loop, rejects a second consumer, and stop() aborts the generation', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    const handle = await mount()
    installGeneration(handle)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const generations: Array<string | undefined> = []
    const stopThrowing = handle.generation.subscribe(() => { throw new Error('subscriber bug') })
    const stopGeneration = handle.generation.subscribe(() => {
      generations.push(handle.generation.getSnapshot()?.host.home)
    })
    expect(handle.generation.getSnapshot()).toBeUndefined()
    // config omitted: the `config ?? {}` default arm is part of the surface.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loop` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loop = handle.start({ onConnected: () => { connected++ } })
    expect(() => handle.start({})).toThrow(/already owned by another consumer/)
    await vi.waitFor(() => {
      expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
    })
    loop.stop() // teardown must not throw; the fixture streams abort quietly
    expect(handle.generation.getSnapshot()).toBeUndefined()
    expect(generations).toEqual(['/h', undefined])
    expect(connected).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(2)
    stopThrowing()
    stopGeneration()
    errorSpy.mockRestore()
  })

  it('allows a replacement owner and ignores the previous owner handle', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    const generation = installGeneration(handle)

    const first = handle.start({})
    await vi.waitFor(() => {
      expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
    })
    first.stop()
    expect(handle.generation.getSnapshot()).toBeUndefined()

    const second = handle.start({})
    await vi.waitFor(() => {
      expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
    })
    first.stop()
    expect(handle.generation.getSnapshot()?.host.home).toBe('/h')

    second.stop()
    generation.end()
  })

  it('does not announce a generation synchronously stopped by a generation subscriber', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    const handle = await mount()
    installGeneration(handle)
    const owner: { loop?: ReturnType<ConnectionHandle['start']> } = {}
    let sawGeneration = false
    const stopGeneration = handle.generation.subscribe(() => {
      if (handle.generation.getSnapshot() === undefined) return
      sawGeneration = true
      owner.loop?.stop()
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const connected = vi.fn()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loop` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loop = handle.start({ onConnected: connected })
    owner.loop = loop
    try {
      await vi.waitFor(() => { expect(sawGeneration).toBe(true) })
      expect(handle.generation.getSnapshot()).toBeUndefined()
      expect(connected).not.toHaveBeenCalled()
    } finally {
      stopGeneration()
      loop.stop()
    }
  })

  it('retracts the generation while reconnecting and publishes the next generation', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    const generation = installGeneration(handle)
    const generations: Array<string | undefined> = []
    const reconnectSnapshots: Array<string | undefined> = []
    const stopGeneration = handle.generation.subscribe(() => {
      generations.push(handle.generation.getSnapshot()?.host.home)
    })
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loop` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loop = handle.start({
      onStateChange: (state) => {
        if (state === 'reconnecting') {
          reconnectSnapshots.push(handle.generation.getSnapshot()?.host.home)
        }
      },
    }, { backoffBaseMs: 10, backoffFactor: 1, backoffMaxMs: 10, generationReadyTimeoutMs: 500 })
    try {
      await vi.waitFor(() => {
        expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
      })
      generation.end()

      await vi.waitFor(() => { expect(reconnectSnapshots).toEqual([undefined]) })
      await vi.waitFor(() => { expect(generations).toEqual(['/h', undefined, '/h']) })
      expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
    } finally {
      stopGeneration()
      loop.stop()
      warnSpy.mockRestore()
    }
  })

  it('does not announce reconnecting after a generation subscriber stops the loop', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    const handle = await mount()
    const generation = installGeneration(handle)
    const owner: { loop?: ReturnType<ConnectionHandle['start']> } = {}
    let stoppedOnRetraction = false
    const stopGeneration = handle.generation.subscribe(() => {
      if (handle.generation.getSnapshot() !== undefined || owner.loop === undefined) return
      stoppedOnRetraction = true
      owner.loop.stop()
    })
    const states: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const loop = handle.start({
      onStateChange: (state) => { states.push(state) },
    }, { backoffBaseMs: 10, backoffFactor: 1, backoffMaxMs: 10, generationReadyTimeoutMs: 500 })
    owner.loop = loop
    try {
      await vi.waitFor(() => {
        expect(handle.generation.getSnapshot()?.host.home).toBe('/h')
      })
      generation.end()

      await vi.waitFor(() => { expect(stoppedOnRetraction).toBe(true) })
      expect(handle.generation.getSnapshot()).toBeUndefined()
      expect(states).toEqual(['connected'])
    } finally {
      stopGeneration()
      loop.stop()
      warnSpy.mockRestore()
    }
  })

  it('carries RPC calls without requiring secure-context randomUUID', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '' }
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        return bytes.fill(0)
      },
    })
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：测试前保存的原始全局值，用于结束后恢复；变量 `original` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const original = globalThis.fetch
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `seen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const seen: { url: string; body: unknown }[] = []
    globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      /** 中文说明：当前请求或临时服务使用的地址信息；变量 `url` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body')
      /** 中文说明：当前场景输入、传输或校验的数据；变量 `body` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const body = JSON.parse(init.body) as { rpcId: string }
      seen.push({ url, body })
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { ref: 'goal-1' } },
      })
    }
    try {
      await expect(handle.rpc.call('/api', 'goals/create', { args: { agentId: 'agent-1' } }))
        .resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })
    } finally {
      globalThis.fetch = original
      vi.unstubAllGlobals()
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('http://dsh.internal/api/goals/create')
    expect(seen[0]?.body).toMatchObject({
      type: 'client-request',
      rpcId: '00000000-0000-4000-8000-000000000000',
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    })
  })

  it('exposes a worker-local Gateway stream through connection.rpc.open', async () => {
    ;(globalThis as Win).location = { hostname: 'preview.example', search: '' }
    const openStream = vi.fn<NonNullable<ClientTransportHooks['openStream']>>(
      (endpoint, payload, signal) => (async function *(): AsyncGenerator {
        signal.throwIfAborted()
        yield { endpoint, payload }
      })(),
    )
    ;(globalThis as Win).__DSH_TRANSPORT__ = {
      fetch: vi.fn<ClientTransportHooks['fetch']>(),
      openStream,
      ownsHost: true,
    }
    const handle = await mount()
    const abort = new AbortController()
    const open = handle.rpc.open
    if (open === undefined) throw new Error('worker-local stream carrier was not installed')

    const values = []
    for await (const value of open('/api', 'session/follow', { args: { sessionId: 'session-1' } }, abort.signal)) {
      values.push(value)
    }
    expect(values).toEqual([{
      endpoint: 'session/follow', payload: { args: { sessionId: 'session-1' } },
    }])
    expect(openStream).toHaveBeenCalledWith(
      'session/follow',
      { args: { sessionId: 'session-1' } },
      abort.signal,
    )
    expect(handle.isLoopback).toBe(true)
    expect(() => open('/rpc', 'session/follow', {}, abort.signal))
      .toThrow('worker-local streams require the /api channel')
    expect(() => open('/api/path', 'session/follow', {}, abort.signal))
      .toThrow('invalid RPC target')
  })

  it('validates generic RPC transport failures, correlation, and targets', async () => {
    ;(globalThis as Win).location = {
      hostname: 'harness.example', search: '', origin: 'https://harness.example',
    }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：测试前保存的原始全局值，用于结束后恢复；变量 `original` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const original = globalThis.fetch
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `abort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    try {
      await expect(handle.rpc.call('/api', 'goals/create', {}, abort.signal))
        .rejects.toThrow('HTTP 503')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        new URL('https://harness.example/api/goals/create'),
        expect.objectContaining({ signal: abort.signal }),
      )

      ;(globalThis as Win).location = { hostname: 'localhost', search: '', origin: 'null' }
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json({
        type: 'server-response',
        rpcId: 'different-rpc',
        result: { ok: true, value: null },
      }))
      await expect(handle.rpc.call('/api', 'goals/create', {})).rejects.toThrow('rpcId mismatch')
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fetch` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const fetch = vi.mocked(globalThis.fetch)
      expect(fetch.mock.calls[0]?.[0]).toEqual(new URL('http://dsh.internal/api/goals/create'))
      expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('signal')

      const respond = (result: unknown): void => {
        globalThis.fetch = async (_input: URL | RequestInfo, init?: RequestInit) => {
          if (typeof init?.body !== 'string') throw new TypeError('expected a JSON request body')
          const request = JSON.parse(init.body) as { rpcId: string }
          return Response.json({ type: 'server-response', rpcId: request.rpcId, result })
        }
      }
      for (const envelope of [
        null,
        { type: 'other', rpcId: 'rpc', result: { ok: true } },
        { type: 'server-response', rpcId: 1, result: { ok: true } },
      ]) {
        globalThis.fetch = vi.fn().mockResolvedValue(Response.json(envelope))
        await expect(handle.rpc.call('/api', 'goals/create', {}))
          .rejects.toThrow('invalid server-response envelope')
      }

      respond(null)
      await expect(handle.rpc.call('/api', 'goals/create', {}))
        .rejects.toThrow('invalid server-response result')
      respond({ ok: 'yes' })
      await expect(handle.rpc.call('/api', 'goals/create', {}))
        .rejects.toThrow('invalid server-response result')
      respond({ ok: false, error: null })
      await expect(handle.rpc.call('/api', 'goals/create', {}))
        .rejects.toThrow('invalid server-response result')

      for (const error of [
        { code: 1, message: 'failed', details: {} },
        { code: 'failed', message: 1, details: {} },
        { code: 'failed', message: 'failed', details: [] },
      ]) {
        respond({ ok: false, error })
        await expect(handle.rpc.call('/api', 'goals/create', {}))
          .rejects.toThrow('invalid server-response failure')
      }
      respond({
        ok: false,
        error: { code: 'fixture-failed', message: 'fixture rejected the call', details: { retry: false } },
      })
      await expect(handle.rpc.call('/api', 'goals/create', {})).resolves.toEqual({
        ok: false,
        error: { code: 'fixture-failed', message: 'fixture rejected the call', details: { retry: false } },
      })
    } finally {
      globalThis.fetch = original
    }

    /** 中文说明：当前请求或临时服务使用的地址信息；变量 `[channel` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [channel, endpoint] of [
      ['api2', 'goals/create'],
      ['/api/path', 'goals/create'],
      ['/api', ''],
      ['/api', '.'],
      ['/api', '..'],
      ['/api', 'goals//create'],
      ['/api', 'goals/create?unsafe'],
    ] as const) {
      await expect(handle.rpc.call(channel, endpoint, {})).rejects.toThrow('invalid RPC target')
    }
  })

  it('carries Goal Remotes over the client-only fixture state', async () => {
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture' }
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `handle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const handle = await mount()
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `created` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const created = await handle.rpc.call('/api', 'goals/create', {
      args: { agentId: 'fx-alpha', request: { objective: 'fixture remote' } },
    })
    expect(created).toMatchObject({ ok: true, value: { ref: { revision: 1 } } })
    if (!created.ok) throw new Error('fixture Goal create failed')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `ref` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ref = (created.value as { ref: { id: string; revision: number } }).ref
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `edited` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const edited = await handle.rpc.call('/api', 'goals/edit', {
      args: { agentId: 'fx-alpha', ref, request: { objective: 'edited fixture remote' } },
    })
    expect(edited).toMatchObject({ ok: true, value: { objective: 'edited fixture remote', revision: 2 } })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `editedRef` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const editedRef = { id: ref.id, revision: 2 }
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `paused` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const paused = await handle.rpc.call('/api', 'goals/pause', {
      args: { agentId: 'fx-alpha', ref: editedRef },
    })
    expect(paused).toMatchObject({ ok: true, value: { phase: 'paused', activation: 'disarmed', revision: 3 } })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `resumed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const resumed = await handle.rpc.call('/api', 'goals/resume', {
      args: { agentId: 'fx-alpha', ref: { id: ref.id, revision: 3 } },
    })
    expect(resumed).toMatchObject({ ok: true, value: { phase: 'active', activation: 'armed', revision: 4 } })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `completed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const completed = await handle.rpc.call('/api', 'goals/complete', {
      args: { agentId: 'fx-alpha', ref: { id: ref.id, revision: 4 } },
    })
    expect(completed).toMatchObject({ ok: true, value: { phase: 'complete', activation: 'disarmed', revision: 5 } })
    await expect(handle.rpc.call('/api', 'goals/clear', {
      args: { agentId: 'fx-alpha', ref: { id: ref.id, revision: 5 } },
    })).resolves.toEqual({ ok: true, value: { id: ref.id, revision: 6 } })
    await expect(handle.rpc.call('/other', 'goals/create', {})).rejects.toThrow(/channel.*unavailable/)
    await expect(handle.rpc.call('/api', 'unknown/read', { args: { agentId: 'fx-alpha' } }))
      .rejects.toThrow(/endpoint.*unavailable/)
  })
})
