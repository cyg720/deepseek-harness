/**
 * Tests for the mcp-client plugin's `apply` lifecycle entry point.
 * Isolated file so vi.mock of the MCP SDK doesn't pollute other test suites.
 */
/*
 * 文件职责：验证 apply.spec.ts 覆盖的MCP 客户端行为与异常场景。
 * 技术维度：使用 TypeScript、Vitest、异步协议连接和可控测试替身。
 * 产品维度：保障 Agent 能稳定使用MCP 客户端提供的外部能力。
 * 逻辑维度：准备上下文与协议数据，触发被测流程，再核对结果、呈现和资源清理。
 * 关键边界：远端消息不可信；连接可能中断；异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数和夹具，再按 describe/it 阅读正常、失败与重连场景。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

// ---- Mock MCP SDK ----

// vi.mock factories are hoisted above every import/const, so the mock fns and
// class must be created inside vi.hoisted to exist when the factories run.
const { mockConnect, mockClose, mockListTools, mockCallTool, mockSetNotificationHandler, MockClient } = vi.hoisted(() => {
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
  /** 中文说明：class MockClient 定义本测试所需的数据或行为，用于表达当前协议场景。 */
  class MockClient {
    connect = mockConnect
    close = mockClose
    listTools = mockListTools
    callTool = mockCallTool
    request = mockRequest
    setNotificationHandler = mockSetNotificationHandler
  }
  return { mockConnect, mockClose, mockListTools, mockCallTool, mockSetNotificationHandler, MockClient }
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

// vi.mock is hoisted above static imports, so the module under test sees the
// mocked SDK even through a static import.
import { apply, name, inject, Config as ConfigSchema } from '@deepseek-ai/dsh-mcp-client/src/index.ts'

// ---- Helpers ----

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

/** 中文说明：变量 stdioConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const stdioConfig: Config = {
  transport: 'stdio',
  serverName: 'srv',
  command: 'echo',
  args: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
}

// ---- Tests ----

describe('mcp-client plugin module exports', () => {
  it('exports name, inject, and Config', () => {
    expect(name).toBe('mcp-client')
    expect(inject).toEqual(['tools'])
    expect(ConfigSchema).toBeDefined()
  })

  it('Config schema rejects a missing serverName', () => {
    expect(() => ConfigSchema({
      transport: 'stdio',
      command: 'echo',
    } as never)).toThrow()
  })

  it('Config schema rejects an invalid serverName', () => {
    // schemastery unions wrap branch errors in a generic "expected ... but got"
    // message, so assert the throw, not the inner pattern text.
    expect(() => ConfigSchema({
      transport: 'stdio',
      serverName: 'bad name!',
      command: 'echo',
    } as never)).toThrow()
    expect(() => ConfigSchema({
      transport: 'stdio',
      serverName: 'x'.repeat(33),
      command: 'echo',
    } as never)).toThrow()
  })

  it('Config schema accepts a valid serverName', () => {
    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = ConfigSchema({
      transport: 'stdio',
      serverName: 'github-prod_1',
      command: 'echo',
    } as never)
    expect(resolved.serverName).toBe('github-prod_1')
  })

  it('Config schema materializes reconnect defaults and merges partial overrides', () => {
    /** 中文说明：变量 omitted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const omitted = ConfigSchema({
      transport: 'stdio',
      serverName: 'srv',
      command: 'echo',
    } as never)
    expect(omitted.reconnect).toEqual({ enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 })

    /** 中文说明：变量 partial 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const partial = ConfigSchema({
      transport: 'stdio',
      serverName: 'srv',
      command: 'echo',
      reconnect: { initialDelayMs: 100 },
    } as never)
    expect(partial.reconnect).toEqual({ enabled: true, initialDelayMs: 100, maxDelayMs: 30_000, maxAttempts: 10 })
  })

  it('Config schema rejects an invalid reconnect block', () => {
    // schemastery unions wrap branch errors, so assert the throw only.
    expect(() => ConfigSchema({
      transport: 'stdio',
      serverName: 'srv',
      command: 'echo',
      reconnect: { maxAttempts: 0 },
    } as never)).toThrow()
  })
})

describe('apply (plugin lifecycle)', () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue({
      tools: [{ name: 'remote', description: 'A remote tool', inputSchema: { type: 'object' } }],
      nextCursor: undefined,
    })
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    ctx = await mountRegistry()
  })

  it('connects, syncs tools under the namespace, and registers a notification handler', async () => {
    await apply(ctx, stdioConfig)

    expect(mockConnect).toHaveBeenCalled()
    expect(mockListTools).toHaveBeenCalled()
    expect(mockSetNotificationHandler).toHaveBeenCalled()
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    expect(ctx.tools.get('remote')).toBeUndefined()
  })

  it('keeps the Cordis plugin loading until initial discovery publishes its tools', async () => {
    /** 中文说明：变量 connection 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const connection: PromiseWithResolvers<void> = Promise.withResolvers()
    mockConnect.mockImplementation(async () => {
      await connection.promise
    })
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin({ name: 'mcp-client-lifecycle', inject, apply }, stdioConfig)
    /** 中文说明：变量 activated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let activated = false
    /** 中文说明：函数值 activation 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const activation = Promise.resolve(fiber).then(() => { activated = true })

    await vi.waitFor(() => { expect(mockConnect).toHaveBeenCalled() })
    expect(activated).toBe(false)
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()

    connection.resolve()
    await activation
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    await fiber.dispose()
  })

  it('rejects a duplicate serverName at load and leaves the first instance intact', async () => {
    await apply(ctx, stdioConfig)
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()

    await expect(apply(ctx, stdioConfig)).rejects.toThrow(/serverName "srv" is already in use/)
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
  })

  it('allows one serverName in each independent registration scope', async () => {
    const first = createScope(ctx, {})
    const second = createScope(ctx, {})

    await Promise.all([apply(first.ctx, stdioConfig), apply(second.ctx, stdioConfig)])

    expect(mockConnect).toHaveBeenCalledTimes(2)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('releases the serverName reservation on dispose', async () => {
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new Context()
    await first.plugin(SystemPrompt)
    await first.plugin(ToolRuntime)
    await apply(first, stdioConfig)

    await first.fiber.dispose()
    await sleep(50)

    // Same root would conflict; a fresh app root reuses the name freely,
    // and the disposed instance no longer holds the reservation on its root.
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new Context()
    await second.plugin(SystemPrompt)
    await second.plugin(ToolRuntime)
    await expect(apply(second, stdioConfig)).resolves.toBeUndefined()
    await second.fiber.dispose()
  })

  it('scopes serverName reservations per app root', async () => {
    /** 中文说明：变量 other 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const other = await mountRegistry()

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = apply(ctx, stdioConfig)
    // Same serverName on a DIFFERENT root is fine.
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = apply(other, stdioConfig)
    await Promise.all([first, second])

    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    expect(other.tools.get('mcp__srv__remote')).toBeDefined()
  })

  it('logs error and registers no tools when connect fails; dispose closes the client', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'))

    await apply(ctx, stdioConfig)

    expect(mockListTools).not.toHaveBeenCalled()
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()

    // Disposal cancels the scheduled reconnect attempt: nothing to
    // unregister, close already attempted by the failed attempt, no throw.
    await ctx.fiber.dispose()
    await sleep(50)
    expect(mockClose).toHaveBeenCalled()
  })

  it('rejects activation and still closes the client when startup failure is configured as fatal', async () => {
    /** 中文说明：变量 cause 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cause = new Error('connection refused')
    mockConnect.mockRejectedValue(cause)
    await expect(apply(ctx, {
      ...stdioConfig,
      failOnStartupError: true,
    })).rejects.toMatchObject({
      message: 'mcp-client(srv): initial connection or tool synchronization failed',
      cause,
    })

    expect(mockListTools).not.toHaveBeenCalled()
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    await ctx.fiber.dispose()
    expect(mockClose).toHaveBeenCalled()
  })

  it('rejects strict startup when the initial tool generation cannot be registered', async () => {
    ctx.tools.register({
      name: 'mcp__srv__remote',
      description: 'Foreign squatter',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value as string }],
      },
      execute: async () => 'foreign',
    })

    await expect(apply(ctx, {
      ...stdioConfig,
      failOnStartupError: true,
    })).rejects.toThrow('initial connection or tool synchronization failed')

    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
    await ctx.fiber.dispose()
    expect(mockClose).toHaveBeenCalled()
  })

  it('preserves strict startup registration when list_changed arrives before connect resolves', async () => {
    ctx.tools.register({
      name: 'mcp__srv__remote',
      description: 'Foreign squatter',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value as string }],
      },
      execute: async () => 'foreign',
    })
    mockConnect.mockImplementation(async () => {
      /** 中文说明：函数值 handler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const handler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
      await handler()
    })

    await expect(apply(ctx, {
      ...stdioConfig,
      failOnStartupError: true,
    })).rejects.toThrow('initial connection or tool synchronization failed')

    expect(mockListTools).toHaveBeenCalledTimes(2)
    expect(ctx.tools.get('mcp__srv__remote')?.description).toBe('Foreign squatter')
    await ctx.fiber.dispose()
  })

  it('re-syncs tools on ToolListChanged notification', async () => {
    await apply(ctx, stdioConfig)

    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()

    mockListTools.mockResolvedValue({
      tools: [{ name: 'updated', inputSchema: { type: 'object' } }],
      nextCursor: undefined,
    })

    /** 中文说明：函数值 handler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const handler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
    await handler()

    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__updated')).toBeDefined()
  })

  it('keeps the previous generation when a re-sync fails', async () => {
    await apply(ctx, stdioConfig)
    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()

    mockListTools.mockRejectedValue(new Error('flaky server'))
    /** 中文说明：函数值 handler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const handler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
    // Must not reject (contained), and must keep the last good generation.
    await handler()

    expect(ctx.tools.get('mcp__srv__remote')).toBeDefined()
  })

  it('effect disposer unregisters the CURRENT generation and closes client', async () => {
    // Load through ctx.plugin so ONLY the plugin's fiber is disposed — the
    // registry must survive to observe the unregistration.
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin({ name: 'mcp-client', inject: ['tools'], apply }, stdioConfig)
    await fiber

    // Advance to a second generation first.
    mockListTools.mockResolvedValue({
      tools: [{ name: 'updated', inputSchema: { type: 'object' } }],
      nextCursor: undefined,
    })
    /** 中文说明：函数值 handler 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const handler = mockSetNotificationHandler.mock.calls[0]![1] as () => Promise<void>
    await handler()
    expect(ctx.tools.get('mcp__srv__updated')).toBeDefined()

    await fiber.dispose()
    await sleep(50)

    expect(mockClose).toHaveBeenCalled()
    // The live (second) generation was unregistered, not just the first.
    expect(ctx.tools.get('mcp__srv__updated')).toBeUndefined()
  })

  it('effect disposer handles client.close failure gracefully', async () => {
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.reject(new Error('already closed'))
    })

    await apply(ctx, stdioConfig)

    // Should not throw when dispose is triggered.
    await ctx.fiber.dispose()
    await sleep(50)

    expect(mockClose).toHaveBeenCalled()
  })

  it('uses streamable-http config path', async () => {
    /** 中文说明：变量 httpConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const httpConfig: Config = {
      transport: 'streamable-http',
      serverName: 'web',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer x' },
      toolCallTimeoutMs: 30_000,
      failOnStartupError: false,
    }

    await apply(ctx, httpConfig)

    expect(mockConnect).toHaveBeenCalled()
    expect(ctx.tools.get('mcp__web__remote')).toBeDefined()
  })
})
