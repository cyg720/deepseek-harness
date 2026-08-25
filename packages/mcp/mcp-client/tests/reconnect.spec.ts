/**
 * Tests for the mcp-client connection supervisor: crash-driven reconnection
 * with bounded backoff, generation-safe tool re-registration, the failure
 * cap, the stability-window budget reset, and disposal stopping reconnection.
 * Isolated file so vi.mock of the MCP SDK doesn't pollute other test suites.
 */
/**
 * 文件职责：验证 reconnect.spec.ts 覆盖的MCP 客户端行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身。
 * 产品维度：保障 Agent 使用MCP 客户端时得到稳定且可重放的结果。
 * 逻辑维度：准备上下文与事件，触发被测流程，再核对状态、输出和资源清理。
 * 关键边界：持久化事件必须可重放；连接和异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数，再按 describe/it 阅读正常、恢复与失败场景。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

// ---- Mock MCP SDK ----

// vi.mock factories are hoisted above every import/const, so the mock fns and
// class must be created inside vi.hoisted to exist when the factories run.
const { mockConnect, mockClose, mockListTools, mockCallTool, mockSetNotificationHandler, MockClient, instances } = vi.hoisted(() => {
  /** 中文说明：函数值 mockConnect 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const mockConnect = vi.fn<() => Promise<void>>()
  /** 中文说明：函数值 mockClose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const mockClose = vi.fn<() => Promise<void>>()
  /** 中文说明：函数值 mockListTools 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  /** 中文说明：变量 mockCallTool 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mockCallTool = vi.fn<(
    _params?: Record<string, unknown>, _compatibilitySchema?: unknown, _options?: unknown,
  ) => Promise<unknown>>()
  /** 中文说明：变量 mockSetNotificationHandler 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mockSetNotificationHandler = vi.fn()
  /** 中文说明：变量 mockRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mockRequest = vi.fn(async (
    request: { method: string; params?: Record<string, unknown> },
    _schema: unknown,
    options?: unknown,
  ): Promise<unknown> => {
    if (request.method === 'tools/list') return await mockListTools(request.params)
    if (request.method === 'tools/call') return await mockCallTool(request.params, undefined, options)
    throw new Error(`unexpected MCP request: ${request.method}`)
  })
  /** 中文说明：class MockClient 定义本测试所需的数据或行为，用于表达当前功能场景。 */
  class MockClient {
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    request = mockRequest
    setNotificationHandler = mockSetNotificationHandler
    constructor() { instances.push(this) }
  }
  /** 中文说明：变量 instances 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instances: MockClient[] = []
  return { mockConnect, mockClose, mockListTools, mockCallTool, mockSetNotificationHandler, MockClient, instances }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}))

// vi.mock is hoisted above static imports, so the modules under test see the
// mocked SDK even through a static import.
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'

// ---- Helpers ----

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：函数 mountRegistry 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountRegistry(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** 中文说明：函数 sleep 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sleep(ms: number): Promise<void> {
  // Annotated binding (not withResolvers<void>()): the tests lint layer runs
  // no-invalid-void-type with default options, which rejects the explicit
  // type argument in call position but accepts the inferred form.
  /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

/** Capture the supervisor's logger lines by level on one context. */
/** 中文说明：函数 captureLogs 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function captureLogs(ctx: Context): { warns: string[]; errors: string[]; infos: string[] } {
  /** 中文说明：变量 warns 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const warns: string[] = []
  /** 中文说明：变量 errors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  /** 中文说明：变量 infos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const infos: string[] = []
  ctx.logger.warn = ((message: unknown) => { warns.push(String(message)) }) as typeof ctx.logger.warn
  ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
  ctx.logger.info = ((message: unknown) => { infos.push(String(message)) }) as typeof ctx.logger.info
  return { warns, errors, infos }
}

/** 中文说明：函数 stdioConfig 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stdioConfig(reconnect?: Config['reconnect']): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    ...reconnect === undefined ? {} : { reconnect },
  }
}

/** The tool list the mock server advertises after a successful (re)connect. */
/** 中文说明：函数 listing 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return {
    tools: names.map(name => ({ name, inputSchema: { type: 'object' } })),
    nextCursor: undefined,
  }
}

/** 中文说明：变量 callSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let callSeq = 0
/** 中文说明：函数 nextCallId 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function nextCallId(): CallId {
  return CallId(`reconnect-${++callSeq}`)
}

// ---- Tests ----

describe('reconnect supervisor', () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue(listing('remote'))
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    ctx = await mountRegistry()
  })

  it('reconnects after a transport close, re-syncs tools through the new generation, and serves calls', async () => {
    const { warns, infos } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ initialDelayMs: 5, maxDelayMs: 40, maxAttempts: 5 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    expect(instances).toHaveLength(1)

    // The recovered server advertises a different list: the swap must neither
    // duplicate nor leak the pre-crash generation.
    mockListTools.mockResolvedValue(listing('revived'))
    instances[0]!.onclose?.()

    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__revived')).toBeDefined() })
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    expect(instances).toHaveLength(2)
    expect(mockConnect).toHaveBeenCalledTimes(2)

    // Post-recovery calls execute through the re-registered definition.
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__srv__revived', arguments: {},
    })
    expect(result.isError).toBe(false)

    // User-visible state: reconnecting and recovered are distinct lines.
    expect(warns.some(line => line.includes('reconnecting in 5ms (attempt 1/5)'))).toBe(true)
    expect(infos.some(line => line.includes('reconnected and re-synced tools'))).toBe(true)

    // A late close signal from the replaced generation is ignored.
    instances[0]!.onclose?.()
    await sleep(30)
    expect(instances).toHaveLength(2)
  })

  it('stops at the failure cap, unregisters the tools, and reports final failure', async () => {
    const { warns, errors } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 2 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    mockConnect.mockRejectedValue(new Error('server gone'))
    // A failing close on the failed attempt's cleanup must not break the loop.
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.reject(new Error('already closed'))
    })
    instances[0]!.onclose?.()

    await vi.waitFor(() => {
      expect(errors.some(line => line.includes('giving up after 2 consecutive failed reconnect attempts'))).toBe(true)
    })
    // Stale tools do not leak past final failure.
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    // Initial connect + exactly maxAttempts reconnect attempts.
    expect(mockConnect).toHaveBeenCalledTimes(3)
    expect(warns.some(line => line.includes('connection attempt failed: Error: server gone'))).toBe(true)
    expect(warns.some(line => line.includes('connection failed; retrying in 4ms (attempt 2/2)'))).toBe(true)
    await sleep(30)
    expect(mockConnect).toHaveBeenCalledTimes(3)
  })

  it('gives up behind an in-flight re-sync and removes the generation it publishes', async () => {
    const { errors } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 1 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mockListTools.mockImplementation(() => gate.promise)
    /** 中文说明：函数值 handler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const handler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
    /** 中文说明：变量 resync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resync = handler()
    await vi.waitFor(() => { expect(mockListTools).toHaveBeenCalledTimes(2) })

    mockConnect.mockRejectedValue(new Error('server gone'))
    instances[0]!.onclose?.()
    await vi.waitFor(() => {
      expect(errors.some(line => line.includes('giving up after 1 consecutive failed reconnect attempts'))).toBe(true)
    })

    gate.resolve(listing('late'))
    await resync
    await vi.waitFor(() => {
      expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
      expect(ctx.tools.get('mcp__srv__late')).toBeUndefined()
    })
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('does not start a replacement until a failed generation reports that it closed', async () => {
    const { warns } = captureLogs(ctx)
    mockConnect.mockRejectedValueOnce(new Error('initialize failed'))
    // Model the SDK's fire-and-forget close after initialize fails: the
    // harness's second close call returns, but the child has not exited yet.
    mockClose.mockResolvedValue(undefined)

    /** 中文说明：变量 applying 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const applying = apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 2 }))
    await vi.waitFor(() => { expect(mockClose).toHaveBeenCalled() })
    await sleep(30)
    expect(instances).toHaveLength(1)

    instances[0]!.onclose?.()
    await applying
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    expect(warns.some(line => line.includes('connection failed; retrying in 2ms (attempt 1/2)'))).toBe(true)
  })

  it('stops reconnecting when a failed generation never reports that it closed', async () => {
    vi.useFakeTimers()
    try {
      const { errors } = captureLogs(ctx)
      mockConnect.mockRejectedValue(new Error('initialize failed'))
      mockClose.mockResolvedValue(undefined)

      /** 中文说明：变量 applying 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const applying = apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 2 }))
      await vi.advanceTimersByTimeAsync(5_000)
      await applying

      expect(instances).toHaveLength(1)
      expect(errors.some(line => line.includes('reconnect stopped to avoid overlapping server processes'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses retry reporting when disposal owns a pending connect rejection', async () => {
    const { warns } = captureLogs(ctx)
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    mockConnect.mockImplementation(() => gate.promise)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 'reconnect'))
    await vi.waitFor(() => { expect(instances).toHaveLength(1) })

    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = handle.dispose()
    gate.reject(new Error('disposed connect'))
    await disposing
    await handle.ready

    expect(warns.some(line => line.includes('connection attempt failed'))).toBe(false)
    expect(instances).toHaveLength(1)
  })

  it('bounds disposal while a resolving generation never reports that it closed', async () => {
    vi.useFakeTimers()
    try {
      const { errors } = captureLogs(ctx)
      /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const gate: PromiseWithResolvers<void> = Promise.withResolvers()
      mockConnect.mockImplementation(() => gate.promise)
      mockClose.mockResolvedValue(undefined)
      /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 'reconnect'))
      await vi.advanceTimersByTimeAsync(0)

      /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const disposing = handle.dispose()
      await vi.advanceTimersByTimeAsync(5_000)
      gate.resolve()
      await disposing

      expect(mockListTools).not.toHaveBeenCalled()
      expect(errors.some(line => line.includes('server shutdown may be incomplete'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose during the backoff wait cancels the pending reconnect', async () => {
    await apply(ctx, stdioConfig({ initialDelayMs: 60_000, maxDelayMs: 60_000, maxAttempts: 5 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    instances[0]!.onclose?.()
    // Now waiting out a 60s backoff; disposal must return promptly anyway.
    await ctx.fiber.dispose()
    await sleep(30)
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(instances).toHaveLength(1)
  })

  it('a transport close after dispose schedules nothing', async () => {
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin({ name: 'mcp-client', inject: ['tools'], apply }, stdioConfig())
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    await fiber.dispose()
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()

    // The disposer's client.close() fires onclose in the real SDK.
    instances[0]!.onclose?.()
    await sleep(30)
    expect(instances).toHaveLength(1)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('reconnect disabled keeps the registered tools and reports manual recovery', async () => {
    const { errors } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ enabled: false }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    instances[0]!.onclose?.()
    await sleep(30)
    expect(mockConnect).toHaveBeenCalledTimes(1)
    // Pre-reconnect contract: the generation stays registered until disposal.
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    expect(errors.some(line => line.includes('connection lost and reconnect is disabled'))).toBe(true)
  })
  it('reconnect disabled after a failed initial connect reports no registered tools', async () => {
    const { errors } = captureLogs(ctx)
    mockConnect.mockRejectedValue(new Error('refused'))
    await apply(ctx, stdioConfig({ enabled: false }))
    await sleep(30)
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    expect(errors.some(line => line.includes('connection failed and reconnect is disabled'))).toBe(true)
    expect(errors.some(line => line.includes('no tools were registered'))).toBe(true)
  })

  it('an uptime past the stability window resets the attempt budget', async () => {
    const { errors } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 30, maxAttempts: 1 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    // Outlive the stability window (= maxDelayMs), then crash again: the
    // budget restarts at attempt 1 instead of exceeding maxAttempts.
    await sleep(40)
    instances[1]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(3) })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    expect(errors).toHaveLength(0)
  })

  it('a crash loop with briefly successful connects still exhausts the cap', async () => {
    const { errors } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 10_000, maxAttempts: 1 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    // Crash, recover (attempt 1 of 1), crash again well inside the stability
    // window: the successful connect must not launder the budget.
    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    instances[1]!.onclose?.()

    await vi.waitFor(() => {
      expect(errors.some(line => line.includes('giving up after 1 consecutive failed reconnect attempts'))).toBe(true)
    })
    expect(instances).toHaveLength(2)
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
  })

  it('a connect rejection racing its own transport close schedules exactly one retry per attempt', async () => {
    const { errors } = captureLogs(ctx)
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 3 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    // Each reconnect attempt sees the stdio transport die (onclose) AND its
    // connect() reject — the real SDK emits both for a spawn failure.
    mockConnect.mockImplementation(async () => {
      instances.at(-1)!.onclose?.()
      throw new Error('spawn failed')
    })
    instances[0]!.onclose?.()

    await vi.waitFor(() => {
      expect(errors.some(line => line.includes('giving up after 3 consecutive failed reconnect attempts'))).toBe(true)
    })
    // Initial generation + exactly one generation per budgeted attempt: a
    // double-scheduled retry would create more.
    expect(instances).toHaveLength(4)
    expect(errors.filter(line => line.includes('giving up')).length).toBe(1)
  })

  it('a transport that closes during a resolving connect registers nothing from the dead generation', async () => {
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 2 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    expect(mockListTools).toHaveBeenCalledTimes(1)

    mockConnect.mockImplementation(async () => {
      instances.at(-1)!.onclose?.()
    })
    instances[0]!.onclose?.()

    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined() })
    // The dead generations never reached tool discovery.
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it('dispose during an in-flight initial sync quiesces without leaking tools', async () => {
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin({ name: 'mcp-client', inject: ['tools'], apply }, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 5 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    // Block the reconnect attempt's tool discovery until after dispose starts.
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mockListTools.mockImplementation(() => gate.promise)
    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(mockListTools).toHaveBeenCalledTimes(2) })

    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = fiber.dispose()
    await sleep(10)
    gate.resolve(listing('late'))
    await disposing

    // The late sync's swap ran, then disposal unregistered its result: no
    // generation survives the plugin.
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__late')).toBeUndefined()
  })

  it('a re-sync failing because dispose closed the transport stays silent', async () => {
    const { errors } = captureLogs(ctx)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin({ name: 'mcp-client', inject: ['tools'], apply }, stdioConfig())
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mockListTools.mockImplementation(() => gate.promise)
    /** 中文说明：函数值 handler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const handler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
    /** 中文说明：变量 resync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resync = handler()
    await vi.waitFor(() => { expect(mockListTools).toHaveBeenCalledTimes(2) })

    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = fiber.dispose()
    await sleep(10)
    gate.reject(new Error('Connection closed'))
    await disposing
    await resync

    expect(errors.some(line => line.includes('tool re-sync failed'))).toBe(false)
  })

  it('a stale notification handler from a replaced generation is ignored', async () => {
    await apply(ctx, stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 5 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })

    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    /** 中文说明：变量 listCalls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listCalls = mockListTools.mock.calls.length

    /** 中文说明：函数值 staleHandler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const staleHandler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
    await staleHandler()
    expect(mockListTools).toHaveBeenCalledTimes(listCalls)
  })
})

// ---- Policy resolution ----

describe('resolveReconnectPolicy', () => {
  /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = 'mcp-client(srv): reconnect'

  it('resolves omission to the defaults, frozen', () => {
    /** 中文说明：变量 policy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const policy = resolveReconnectPolicy(undefined, path)
    expect(policy).toEqual(RECONNECT_DEFAULTS)
    expect(Object.isFrozen(policy)).toBe(true)
  })

  it('keeps explicit values', () => {
    expect(resolveReconnectPolicy(
      { enabled: false, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 7 },
      path,
    )).toEqual({ enabled: false, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 7 })
  })

  it('rejects unknown keys', () => {
    expect(() => resolveReconnectPolicy({ jitterRatio: 0.5 } as never, path))
      .toThrow(/reconnect\.jitterRatio is not a reconnect option/)
  })

  it('rejects out-of-range delays', () => {
    expect(() => resolveReconnectPolicy({ initialDelayMs: 0 }, path)).toThrow(/initialDelayMs must be a positive finite number/)
    expect(() => resolveReconnectPolicy({ initialDelayMs: Number.POSITIVE_INFINITY }, path)).toThrow(/initialDelayMs/)
    expect(() => resolveReconnectPolicy({ maxDelayMs: -1 }, path)).toThrow(/maxDelayMs must be a positive finite number/)
  })

  it('rejects an initial delay above the ceiling', () => {
    expect(() => resolveReconnectPolicy({ initialDelayMs: 100, maxDelayMs: 5 }, path))
      .toThrow(/initialDelayMs must be less than or equal to maxDelayMs/)
  })

  it('rejects non-positive-integer attempt caps', () => {
    expect(() => resolveReconnectPolicy({ maxAttempts: 0 }, path)).toThrow(/maxAttempts must be a positive integer/)
    expect(() => resolveReconnectPolicy({ maxAttempts: 1.5 }, path)).toThrow(/maxAttempts must be a positive integer/)
  })

  it('apply fails loud at load on a misconfigured reconnect', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mountRegistry()
    await expect(apply(ctx, stdioConfig({ initialDelayMs: 100, maxDelayMs: 5 })))
      .rejects.toThrow(/initialDelayMs must be less than or equal to maxDelayMs/)
  })
})
