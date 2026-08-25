/**
 * 文件职责：验证 plugin-apply.spec.ts 覆盖的SDK 通信行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的SDK 通信能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as agentCore from '@deepseek-ai/dsh-agent-spine-demo'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as jsonrpc from '../src/index.ts'

/**
 * Mount the real namespace plugin with in-memory stdio and exit hooks. Covers
 * the full transport/server path, response-before-exit shutdown exactly once,
 * and bare-fiber disposal without process exit.
 */

/** One ordered frame, write completion, or exit observation. */
/* 中文说明：type WireEvent 定义本测试所需的数据或行为，用于表达SDK 通信场景。 */
type WireEvent =
  | { kind: 'frame'; frame: Record<string, unknown> }
  | { kind: 'write-complete'; ids: (string | number)[] }
  | { kind: 'root-disposed' }
  | { kind: 'exit'; code: number }

/** 中文说明：interface ApplyHarness 定义本测试所需的数据或行为，用于表达SDK 通信场景。 */
interface ApplyHarness {
  ctx: Context
  /** The plugin fiber used by the bare-dispose case. */
  fiber: Awaited<ReturnType<Context['plugin']>>
  /** Frames, write completions, and exits in observation order. */
  events: WireEvent[]
  outputErrors: Error[]
  send(frame: Record<string, unknown>): void
  sendRaw(text: string): void
  frames(): Record<string, unknown>[]
  exits(): number[]
  waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, description: string): Promise<Record<string, unknown>>
  dispose(): Promise<void>
}

/** Poll asynchronous output for up to five seconds. */
/* 中文说明：函数 waitFor 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitFor<T>(get: () => T | undefined, description: string): Promise<T> {
  /** 中文说明：变量 deadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = Date.now() + 5000
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (;;) {
    /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = get()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Drain asynchronous work before a negative assertion. */
/* 中文说明：函数 settle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

/** Mount the real plugin on a minimal harness with in-memory stdio and exit. */
/* 中文说明：函数 mountPlugin 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountPlugin(
  storageDir: string,
  options: {
    writeDelayMs?: number
    failFlush?: boolean
    beforeServer?: (ctx: Context) => Promise<void> | void
  } = {},
): Promise<ApplyHarness> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(agentCore, { workspaceContext: false })
  await ctx.plugin(JsonlSessionPersistence, { root: storageDir })
  await new Promise(resolve => setTimeout(resolve, 50))
  await options.beforeServer?.(ctx)

  /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const input = new PassThrough()
  /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const events: WireEvent[] = []
  /** 中文说明：变量 outputErrors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const outputErrors: Error[] = []
  /** 中文说明：变量 pendingOutput 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let pendingOutput = ''
  // Record frame admission separately from write completion so delayed output
  // tests the flush barrier.
  /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      /** 中文说明：变量 ids 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ids: (string | number)[] = []
      pendingOutput += chunk.toString('utf8')
      /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
      for (;;) {
        /** 中文说明：变量 newline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const newline = pendingOutput.indexOf('\n')
        if (newline < 0) break
        /** 中文说明：变量 line 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const line = pendingOutput.slice(0, newline).trim()
        pendingOutput = pendingOutput.slice(newline + 1)
        if (line) {
          /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const frame = JSON.parse(line) as Record<string, unknown>
          events.push({ kind: 'frame', frame })
          if (typeof frame.id === 'string' || typeof frame.id === 'number') ids.push(frame.id)
        }
      }
      /** 中文说明：函数值 complete 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const complete = (): void => {
        if (options.failFlush === true && chunk.length === 0) {
          callback(new Error('flush callback failed'))
          return
        }
        events.push({ kind: 'write-complete', ids })
        callback()
      }
      if ((options.writeDelayMs ?? 0) > 0) setTimeout(complete, options.writeDelayMs)
      else complete()
    },
  })
  output.on('error', (error: Error) => { outputErrors.push(error) })
  /** 中文说明：函数值 exit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const exit = (code: number): void => { events.push({ kind: 'exit', code }) }

  ctx.effect(() => () => { events.push({ kind: 'root-disposed' }) }, 'jsonrpc test root-disposal witness')
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(jsonrpc, { input, output, exit })

  /** 中文说明：函数值 frames 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const frames = (): Record<string, unknown>[] =>
    events.flatMap(event => event.kind === 'frame' ? [event.frame] : [])
  return {
    ctx,
    fiber,
    events,
    outputErrors,
    send: (frame) => { input.write(`${JSON.stringify(frame)}\n`) },
    sendRaw: (text) => { input.write(text) },
    frames,
    exits: () => events.flatMap(event => event.kind === 'exit' ? [event.code] : []),
    waitForFrame: (predicate, description) => waitFor(() => frames().find(predicate), description),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

/** 中文说明：变量 servers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.unstubAllEnvs()
})

/** Keyless SSE endpoint for completing a prompt turn. */
/* 中文说明：函数 mockCompletionServer 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mockCompletionServer(): Promise<{ url: string; requests: unknown[] }> {
  /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requests: unknown[] = []
  /** 中文说明：函数值 server 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests }
}

describe('dsh-sdk-jsonrpc-server plugin apply', () => {
  it('serves initialize over the injected stdio pair', async () => {
    /** 中文说明：变量 storageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-init-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({ jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'apply-model' } })

      /** 中文说明：函数值 response 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const response = await harness.waitForFrame(frame => frame.id === 'init-1', 'initialize response')
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 'init-1',
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } },
      })
      expect(harness.exits()).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not answer initialize until async sibling Loader entries settle', async () => {
    /** 中文说明：变量 storageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-readiness-'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted!: () => void
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: () => void
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    /** 中文说明：函数值 ready 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ready = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：变量 delayedEntry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let delayedEntry: Promise<string> | undefined
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = await mountPlugin(storageDir, {
      beforeServer: async (ctx) => {
        await ctx.plugin(Loader)
        ctx.loader.builtins['delayed-readiness'] = {
          async apply() {
            markStarted()
            await ready
          },
        }
        delayedEntry = ctx.loader.create({ name: 'cordis:delayed-readiness' })
        await started
      },
    })
    try {
      /** 中文说明：变量 initialize 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const initialize = {
        jsonrpc: '2.0',
        id: 'init-delayed',
        method: 'initialize',
        params: { cwd: storageDir, provider: 'deepseek-official', model: 'apply-model' },
      }
      /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const probe = { jsonrpc: '2.0', id: 'probe-during-delay', method: 'nope/unknown' }
      harness.sendRaw(`${JSON.stringify(initialize)}\n${JSON.stringify(probe)}\n`)

      // The transport processes independent requests concurrently. Receiving
      // this later probe proves the preceding initialize handler has reached
      // its Loader wait, without relying on a scheduler delay.
      await harness.waitForFrame(frame => frame.id === 'probe-during-delay', 'probe while initialize waits')
      expect(harness.frames().some(frame => frame.id === 'init-delayed')).toBe(false)

      release()
      await delayedEntry
      /** 中文说明：函数值 response 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const response = await harness.waitForFrame(frame => frame.id === 'init-delayed', 'initialize response after Loader settlement')
      expect(response).toMatchObject({
        id: 'init-delayed',
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
      })
    } finally {
      release()
      await Promise.allSettled(delayedEntry === undefined ? [] : [delayedEntry])
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('drives a session/prompt turn end-to-end and forwards session notifications as output frames', async () => {
    /** 中文说明：变量 storageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-prompt-'))
    /** 中文说明：变量 llmServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'dsagent-model' } })
      await harness.waitForFrame(frame => frame.id === 1, 'initialize response')

      harness.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId: 'main', contentBlocks: [{ type: 'text', text: 'fix it' }] },
      })
      /** 中文说明：函数值 response 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const response = await harness.waitForFrame(frame => frame.id === 2, 'prompt response')
      expect((response.result as { messageId?: unknown }).messageId).toBeTypeOf('string')
      await harness.waitForFrame(
        frame => frame.method === 'session.status'
          && (frame.params as { status?: string } | undefined)?.status === 'idle',
        'idle session status',
      )

      expect(llmServer.requests).toHaveLength(1)
      /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const body = llmServer.requests[0] as { model: string; messages: { role: string }[] }
      expect(body.model).toBe('dsagent-model')
      expect(body.messages.at(-1)?.role).toBe('user')

      // Notifications use the same transport and arrive as id-less frames.
      /** 中文说明：函数值 notifications 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const notifications = harness.frames().filter(frame => frame.id === undefined)
      expect(notifications.some(frame => frame.method === 'session.event')).toBe(true)
      expect(notifications.findLast(frame => frame.method === 'session.status')).toMatchObject({
        jsonrpc: '2.0',
        params: { sessionId: 'main', status: 'idle' },
      })
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('answers shutdown before exiting 0 exactly once, even against a racing second shutdown', async () => {
    /** 中文说明：变量 storageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-shutdown-'))
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = await mountPlugin(storageDir, { writeDelayMs: 10 })
    try {
      // One chunk makes the two deferred exit callbacks race.
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = { jsonrpc: '2.0', id: 'sd-1', method: 'shutdown' }
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = { jsonrpc: '2.0', id: 'sd-2', method: 'shutdown' }
      harness.sendRaw(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`)

      await waitFor(() => harness.exits().length > 0 ? true : undefined, 'exit recorder call')
      expect(harness.exits()).toEqual([0])

      // Both response writes and the flush barrier complete before exit.
      /** 中文说明：函数值 exitIndex 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const exitIndex = harness.events.findIndex(event => event.kind === 'exit')
      /** 中文说明：函数值 firstResponse 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const firstResponse = harness.events.findIndex(event => event.kind === 'frame' && event.frame.id === 'sd-1')
      /** 中文说明：函数值 secondResponse 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const secondResponse = harness.events.findIndex(event => event.kind === 'frame' && event.frame.id === 'sd-2')
      /** 中文说明：函数值 firstComplete 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const firstComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.includes('sd-1'))
      /** 中文说明：函数值 secondComplete 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const secondComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.includes('sd-2'))
      /** 中文说明：函数值 flushComplete 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const flushComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.length === 0)
      /** 中文说明：函数值 rootDisposed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const rootDisposed = harness.events.findIndex(event => event.kind === 'root-disposed')
      expect(firstResponse).toBeGreaterThanOrEqual(0)
      expect(secondResponse).toBeGreaterThanOrEqual(0)
      expect(firstComplete).toBeGreaterThan(firstResponse)
      expect(secondComplete).toBeGreaterThan(secondResponse)
      expect(flushComplete).toBeGreaterThan(firstComplete)
      expect(flushComplete).toBeGreaterThan(secondComplete)
      expect(rootDisposed).toBeGreaterThan(flushComplete)
      expect(exitIndex).toBeGreaterThan(rootDisposed)

      await settle()
      expect(harness.exits()).toEqual([0])
      expect(harness.events.filter(event => event.kind === 'root-disposed')).toHaveLength(1)

      /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'after-exit', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('still disposes and exits once when the flush callback fails', async () => {
    /** 中文说明：变量 storageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-flush-failure-'))
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = await mountPlugin(storageDir, { failFlush: true })
    try {
      harness.send({ jsonrpc: '2.0', id: 'sd-fail', method: 'shutdown' })

      await waitFor(() => harness.exits().length > 0 ? true : undefined, 'exit after flush failure')
      await settle()
      expect(harness.exits()).toEqual([0])
      expect(harness.events.filter(event => event.kind === 'root-disposed')).toHaveLength(1)
      expect(harness.outputErrors.map(error => error.message)).toEqual(['flush callback failed'])

      /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'after-flush-failure', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('stops serving on a bare fiber dispose (HMR-style unload) without calling exit', async () => {
    /** 中文说明：变量 storageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-apply-dispose-'))
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = await mountPlugin(storageDir)
    try {
      // Prove the handler-rejection path is live before disposal.
      harness.send({ jsonrpc: '2.0', id: 'probe-1', method: 'nope/unknown' })
      /** 中文说明：函数值 error 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const error = await harness.waitForFrame(frame => frame.id === 'probe-1', 'error response for unknown method')
      expect(error.error).toMatchObject({
        code: -32603,
        message: 'unknown DeepSeek Harness SDK runtime method: nope/unknown',
      })

      await harness.fiber.dispose()
      expect(harness.events.some(event => event.kind === 'root-disposed')).toBe(false)

      /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'probe-2', method: 'initialize', params: { cwd: storageDir, provider: 'deepseek-official', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
      expect(harness.exits()).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
