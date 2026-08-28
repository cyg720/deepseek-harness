/**
 * End-to-end tests for dsh-mcp-client. Exercises the REAL MCP protocol against:
 * 1. A self-written fixture server over stdio (controlled edge cases)
 * 2. @modelcontextprotocol/server-everything (official integration test server)
 * 3. @modelcontextprotocol/server-filesystem (real filesystem operations)
 * 4. An in-process StreamableHTTPServerTransport server over Streamable HTTP
 *
 * No API key needed — all servers are local/keyless.
 */
/*
 * 文件职责：验证 mcp-client.e2e.ts 覆盖的MCP 客户端行为与异常场景。
 * 技术维度：使用 TypeScript、Vitest、异步协议连接和可控测试替身。
 * 产品维度：保障 Agent 能稳定使用MCP 客户端提供的外部能力。
 * 逻辑维度：准备上下文与协议数据，触发被测流程，再核对结果、呈现和资源清理。
 * 关键边界：远端消息不可信；连接可能中断；异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数和夹具，再按 describe/it 阅读正常、失败与重连场景。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { publicToolName } from '@deepseek-ai/dsh-mcp-client/src/tools.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：变量 fixtureServerPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureServerPath = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

// Resolve package-local .bin for pnpm-hoisted MCP server binaries.
/** 中文说明：变量 packageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageDir = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 localBin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const localBin = join(packageDir, 'node_modules', '.bin')

// ---- Helpers ----

/** 中文说明：函数 mountRegistry 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountRegistry(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Exact-route adapter used to prove real MCP image admission without an API key. */
/* 中文说明：class ImageAdapter 定义本测试所需的数据或行为，用于表达当前协议场景。 */
class ImageAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('MCP image e2e never streams')
  }
}

/** 中文说明：函数 mountImageRegistry 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountImageRegistry(dshHome: string): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = await mountRegistry()
  await ctx.plugin(LocalAttachmentStore, { dshHome })
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['visual'], new ImageAdapter())
  return ctx
}

/** Calling-agent stand-in pinned to the keyless image-capable route. */
/* 中文说明：函数 imageAgent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function imageAgent(): object {
  return {
    options: { provider: 'visual', model: 'vision' },
    session: { requestHeader: () => undefined },
  }
}

/** 中文说明：函数 sleep 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sleep(ms: number): Promise<void> {
  /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

/** Narrow a result content block to its text, failing the test on any other shape. */
/* 中文说明：函数 textOf 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function textOf(block: unknown): string {
  if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
    return block.text
  }
  throw new Error(`expected a text content block, got ${JSON.stringify(block)}`)
}

/** 中文说明：变量 callSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let callSeq = 0
function nextCallId(): ToolCallId {
  return ToolCallId(`e2e-${++callSeq}`)
}

// ---- Fixture server tests ----

describe('fixture server — controlled scenarios', () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ctx: Context
  /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let home: string

  /** 中文说明：变量 fixtureConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fixtureConfig: Config = {
    transport: 'stdio',
    serverName: 'fixture',
    command: process.execPath,
    args: [fixtureServerPath],
    env: {},
    cwd: packageDir,
    toolCallTimeoutMs: 15_000,
    failOnStartupError: false,
  }

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'mcp-image-e2e-'))
    ctx = await mountImageRegistry(home)
    await apply(ctx, fixtureConfig)
  }, 30_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(200)
    await rm(home, { recursive: true, force: true })
  })

  it('discovers all fixture tools under the server namespace', () => {
    /** 中文说明：变量 schemas 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schemas = ctx.tools.schemas()
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = schemas.map(s => s.name)
    expect(names).toContain('mcp__fixture__add')
    expect(names).toContain('mcp__fixture__greet')
    expect(names).toContain('mcp__fixture__fail')
    expect(names).toContain('mcp__fixture__image')
    // Raw names are not registered.
    expect(names).not.toContain('add')
  })

  it('normalizes the dotted tool name with a deterministic hash suffix', () => {
    /** 中文说明：变量 publicName 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const publicName = publicToolName('fixture', 'admin.reset')
    expect(publicName).toMatch(/^mcp__fixture__admin_reset_[0-9a-f]{12}$/)
    expect(ctx.tools.get(publicName)).toBeDefined()
  })

  it('executes the dotted tool via its normalized public name', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: publicToolName('fixture', 'admin.reset'), arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'reset done' })
  })

  it('executes add(2, 3) → "5"', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__add', arguments: { a: 2, b: 3 },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: '5' })
  })

  it('executes greet("World") → "Hello, World!"', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__greet', arguments: { name: 'World' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello, World!' })
  })

  it('executes fail() → isError result', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__fixture__fail', arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('executes image() → ordered durable image content', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal, agent: imageAgent() as never,
      callId: nextCallId(), name: 'mcp__fixture__image', arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content).toHaveLength(3)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Here is an image:' })
    expect(result.content[2]).toEqual({ type: 'text', text: 'End of image.' })
    /** 中文说明：变量 image 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const image = result.content[1]
    if (image?.type !== 'image') throw new Error(`expected an image block, got ${JSON.stringify(image)}`)
    expect(image.attachment).toMatchObject({ mediaType: 'image/png', width: 1, height: 1 })
    /** 中文说明：变量 stored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stored = await ctx.attachments.readImage(image.attachment)
    expect(stored.data.byteLength).toBe(image.attachment.bytes)
    if (result.isError) throw new Error('expected MCP image success')
    expect(JSON.stringify(result.value)).toContain('iVBORw0KGgo')
    expect(JSON.stringify(result.content)).not.toContain('iVBORw0KGgo')
  })
})

describe('fixture server — duplicate serverName', () => {
  it('rejects a second instance with the same serverName on one root', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mountRegistry()
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config: Config = {
      transport: 'stdio',
      serverName: 'dup',
      command: process.execPath,
      args: [fixtureServerPath],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)

    await expect(apply(ctx, config)).rejects.toThrow(/serverName "dup" is already in use/)

    await ctx.fiber.dispose()
    await sleep(200)
  }, 30_000)
})

describe('fixture server — disposal', () => {
  it('disposes cleanly without error', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mountRegistry()
    await apply(ctx, {
      transport: 'stdio',
      serverName: 'fixture',
      command: process.execPath,
      args: [fixtureServerPath],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    })

    // Tools are registered before dispose.
    expect(ctx.tools.get('mcp__fixture__add')).toBeDefined()
    expect(ctx.tools.schemas().length).toBeGreaterThanOrEqual(4)

    // Dispose should complete without throwing.
    await ctx.fiber.dispose()
    await sleep(200)
  }, 30_000)
})

describe('fixture server — crash recovery', () => {
  /** 中文说明：函数 crashConfig 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  function crashConfig(serverName: string, reconnect: NonNullable<Config['reconnect']>): Config {
    return {
      transport: 'stdio',
      serverName,
      command: process.execPath,
      args: [fixtureServerPath],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
      reconnect,
    }
  }

  it('auto-reconnects after a stdio crash and serves tool calls again', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mountRegistry()
    await apply(ctx, crashConfig('crashy', { initialDelayMs: 50, maxDelayMs: 500, maxAttempts: 40 }))

    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__crashy__add', arguments: { a: 2, b: 3 },
    })
    expect(textOf(before.content[0])).toBe('5')

    // The crash tool replies, then kills the real child process.
    /** 中文说明：变量 crash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const crash = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__crashy__crash', arguments: {},
    })
    expect(crash.isError).toBe(false)

    // Recovery is proven by the world: a post-crash call round-trips through
    // the respawned server process.
    await vi.waitFor(async () => {
      /** 中文说明：变量 after 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const after = await ctx.tools.execute({
        signal: testToolSignal,
        callId: nextCallId(), name: 'mcp__crashy__add', arguments: { a: 20, b: 22 },
      })
      expect(after.isError).toBe(false)
      expect(textOf(after.content[0])).toBe('42')
    }, { timeout: 15_000, interval: 250 })

    // The recovered generation replaced the dead one: no duplicates, no leak.
    /** 中文说明：函数值 addEntries 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const addEntries = ctx.tools.schemas().map(s => s.name).filter(name => name === 'mcp__crashy__add')
    expect(addEntries).toHaveLength(1)

    await ctx.fiber.dispose()
    await sleep(200)
  }, 30_000)

  it('plugin unload during an outage stops reconnection and unregisters tools', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mountRegistry()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin(
      { name: 'mcp-client', inject: ['tools'], apply },
      crashConfig('ephemeral', { initialDelayMs: 8_000, maxDelayMs: 8_000, maxAttempts: 5 }),
    )
    // Cordis awaits async apply() as startup work; wait for it.
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__ephemeral__add')).toBeDefined() }, { timeout: 20_000 })

    /** 中文说明：变量 crash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const crash = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__ephemeral__crash', arguments: {},
    })
    expect(crash.isError).toBe(false)

    // Give the transport close a moment to land the supervisor in its 8s
    // backoff wait, then unload: disposal must not sit out the backoff.
    await sleep(300)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Date.now()
    await fiber.dispose()
    expect(Date.now() - started).toBeLessThan(4_000)

    expect(ctx.tools.get('mcp__ephemeral__add')).toBeUndefined()
    await sleep(200)
    expect(ctx.tools.get('mcp__ephemeral__add')).toBeUndefined()

    await ctx.fiber.dispose()
  }, 30_000)
})

// ---- @modelcontextprotocol/server-everything ----

describe('server-everything — official test server', () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ctx: Context

  /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const config: Config = {
    transport: 'stdio',
    serverName: 'everything',
    command: join(localBin, 'mcp-server-everything'),
    args: ['stdio'],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 30_000,
    failOnStartupError: false,
  }

  beforeAll(async () => {
    ctx = await mountRegistry()
    await apply(ctx, config)
  }, 60_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(500)
  })

  it('discovers tools from server-everything', () => {
    /** 中文说明：变量 schemas 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schemas = ctx.tools.schemas()
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = schemas.map(s => s.name)
    expect(names).toContain('mcp__everything__echo')
    expect(names).toContain('mcp__everything__get-sum')
    expect(names).toContain('mcp__everything__get-tiny-image')
    expect(names.length).toBeGreaterThanOrEqual(8)
  })

  it('executes echo({ message: "hello" }) → "Echo: hello"', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__everything__echo', arguments: { message: 'hello' },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toBe('Echo: hello')
  })

  it('executes get-sum({ a: 3, b: 7 }) → contains "10"', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__everything__get-sum', arguments: { a: 3, b: 7 },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toContain('10')
  })

  it('executes get-tiny-image → explicit refusal without a durable route', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__everything__get-tiny-image', arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('[image unavailable: image/png; no attachment store is mounted;')
  })
})

// ---- @modelcontextprotocol/server-filesystem ----

describe('server-filesystem — real filesystem operations', () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ctx: Context
  /** 中文说明：变量 tempDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let tempDir: string

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-fs-e2e-'))

    ctx = await mountRegistry()
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config: Config = {
      transport: 'stdio',
      serverName: 'filesystem',
      command: join(localBin, 'mcp-server-filesystem'),
      args: [tempDir],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 30_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)
  }, 60_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(500)
    await rm(tempDir, { recursive: true, force: true })
  })

  it('discovers filesystem tools', () => {
    /** 中文说明：变量 schemas 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schemas = ctx.tools.schemas()
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = schemas.map(s => s.name)
    expect(names).toContain('mcp__filesystem__read_file')
    expect(names).toContain('mcp__filesystem__write_file')
    expect(names).toContain('mcp__filesystem__list_directory')
  })

  it('write_file + read_file round-trip', async () => {
    /** 中文说明：变量 filePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const filePath = join(tempDir, 'test.txt')
    /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = 'Hello from MCP e2e test!'

    /** 中文说明：变量 writeResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writeResult = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__filesystem__write_file', arguments: { path: filePath, content },
    })
    expect(writeResult.isError).toBe(false)

    // Assert the filesystem effect independently of the tool result.
    /** 中文说明：变量 onDisk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const onDisk = await readFile(filePath, 'utf8')
    expect(onDisk).toBe(content)

    /** 中文说明：变量 readResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const readResult = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__filesystem__read_file', arguments: { path: filePath },
    })
    expect(readResult.isError).toBe(false)
    expect(textOf(readResult.content[0])).toContain(content)
  })

  it('list_directory shows written file', async () => {
    await writeFile(join(tempDir, 'listed.txt'), 'listed')

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__filesystem__list_directory', arguments: { path: tempDir },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result.content[0])).toContain('listed.txt')
  })
})

// ---- Streamable HTTP transport ----

describe('streamable-http — in-process MCP server', () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ctx: Context
  /** 中文说明：变量 httpServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let httpServer: Server
  /** 中文说明：变量 baseUrl 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let baseUrl: string
  /** Authorization header values observed by the HTTP server, in arrival order. */
  /* 中文说明：变量 seenAuth 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seenAuth: Array<string | undefined> = []

  /**
   * Stateless Streamable HTTP endpoint: a fresh McpServer + server transport
   * per request (the SDK's documented stateless pattern — no session id, no
   * SSE stream to keep). The tool set mirrors a minimal fixture server.
   */
  /* 中文说明：函数 handleMcpRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    seenAuth.push(req.headers.authorization)
    /** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const server = new McpServer(
      { name: 'http-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    server.registerTool('ping', {
      description: 'Replies pong.',
      inputSchema: {},
    }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    server.registerTool('shout', {
      description: 'Upper-cases a message.',
      inputSchema: { message: z.string().describe('Message to upper-case') },
    }, async args => ({
      content: [{ type: 'text', text: args.message.toUpperCase() }],
    }))
    // Stateless mode: sessionIdGenerator ABSENT (the runtime treats absent and
    // explicit-undefined identically; exactOptionalPropertyTypes forbids the
    // SDK-documented explicit `sessionIdGenerator: undefined` spelling).
    /** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => { void transport.close(); void server.close() })
    // Same exactOptionalPropertyTypes mismatch the client transport factory
    // documents (src/transport.ts): the SDK types optional callbacks without
    // `| undefined`. The SDK constructed the object; the cast is safe.
    await server.connect(transport as Transport)
    await transport.handleRequest(req, res)
  }

  beforeAll(async () => {
    httpServer = createServer((req, res) => {
      handleMcpRequest(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error))
      })
    })
    /** 中文说明：变量 listening 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listening: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const address = httpServer.address()
    if (address === null || typeof address === 'string') throw new Error(`expected a TCP AddressInfo, got ${String(address)}`)
    baseUrl = `http://127.0.0.1:${address.port}/mcp`

    ctx = await mountRegistry()
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config: Config = {
      transport: 'streamable-http',
      serverName: 'web',
      url: baseUrl,
      headers: { Authorization: 'Bearer e2e-test-token' },
      toolCallTimeoutMs: 15_000,
      failOnStartupError: false,
    }
    await apply(ctx, config)
  }, 30_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await sleep(200)
    /** 中文说明：变量 closed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.close(() => { closed.resolve() })
    await closed.promise
  })

  it('discovers tools under the server namespace over HTTP', () => {
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('mcp__web__ping')
    expect(names).toContain('mcp__web__shout')
  })

  it('executes ping() → "pong" over HTTP', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__web__ping', arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'pong' })
  })

  it('executes shout({ message }) with args over HTTP', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: nextCallId(), name: 'mcp__web__shout', arguments: { message: 'quiet' },
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'QUIET' })
  })

  it('sends configured headers on every HTTP request', () => {
    expect(seenAuth.length).toBeGreaterThan(0)
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const auth of seenAuth) expect(auth).toBe('Bearer e2e-test-token')
  })
})
