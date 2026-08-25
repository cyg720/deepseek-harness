/**
 * Keyless integration tests for the SDK subagent backend. Each spawns a REAL
 * subprocess — the SDK client package's scripted fake runtime — and drives it
 * through the REAL backend over real stdio JSON-RPC, so the handshake, the
 * turn round-trip, stop-reason mapping, cancellation, env scrubbing, and
 * quiescent disposal are all exercised end to end. No model, no key.
 */
/**
 * 文件职责：验证 subagent-dsh-sdk.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as sdk from '../src/index.ts'
import {
  DEFAULT_DISPOSE_EOF_GRACE_MS,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  sdkStopReason,
  startSdkRun,
  /** 中文说明：type SdkRunSpec 定义本测试所需的数据或行为，用于表达子代理场景。 */
  type SdkRunSpec,
} from '../src/run.ts'

/** 中文说明：变量 fakeRuntime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fakeRuntime = fileURLToPath(new URL('../../../sdk/client/tests/fake-runtime.ts', import.meta.url))

/** A parent Agent stub. The SDK backend reads exactly one thing off it: the session header's cwd (the workspace its child inherits). */
/** 中文说明：变量 fakeParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fakeParent = { id: 'parent', session: { header: { cwd: process.cwd() } } } as unknown as Agent

/** 中文说明：函数 request 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function request(text = 'p', signal = new AbortController().signal) {
  return { label: text, prompt: [{ type: 'text' as const, text }], parent: fakeParent, signal }
}

/** Mount the SDK backend pointed at the fake runtime, scripted by `fakeEnv`. */
/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(fakeEnv: Record<string, string> = {}, config: Partial<sdk.Config> = {}) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  // The Config type models the post-validation shape, so the default registry
  // name is stated here; the Loader-composition fixture omits providerName and
  // exercises the schemastery default end to end.
  await ctx.plugin(sdk, {
    providerName: 'dsh-sdk',
    command: process.execPath,
    args: [fakeRuntime],
    provider: 'fake-provider',
    model: 'fake-model',
    env: fakeEnv,
    ...config,
  })
  return ctx
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(blocks: { type: string; text?: string }[]): string {
  return blocks.filter(b => b.type === 'text').map(b => b.text).join('')
}

/**
 * Poll until `file` exists (the fake touches it once the probed state is
 * reached), so cancel tests wait on a CONDITION rather than an arbitrary
 * timeout. Fails loud if the child never signals readiness.
 */
/** 中文说明：函数 waitForFile 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitForFile(file: string, timeoutMs = 5000): Promise<void> {
  /** 中文说明：变量 deadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = Date.now() + timeoutMs
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`fake runtime never became ready (${file})`)
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('sdkStopReason', () => {
  it('maps each child turn-end reason to the harness vocabulary', () => {
    expect(sdkStopReason({ kind: 'completed' })).toBe('completed')
    expect(sdkStopReason({ kind: 'max-tokens' })).toBe('max-tokens')
    expect(sdkStopReason({ kind: 'aborted', reason: { kind: 'user' } })).toBe('aborted')
    expect(sdkStopReason({ kind: 'error', error: { message: 'x', code: 'UNKNOWN' } })).toBe('error')
    expect(sdkStopReason({ kind: 'interrupted' })).toBe('error')
    expect(sdkStopReason({ kind: 'aborted', reason: { kind: 'disposed' } })).toBe('aborted')
  })

  it('treats an absent or unknown reason as an error', () => {
    expect(sdkStopReason(undefined)).toBe('error')
    expect(sdkStopReason({ kind: 'something-new' } as never)).toBe('error')
  })
})

describe('dsh-subagent-dsh-sdk provider', () => {
  it('runs a child turn end to end with a parent-unique run id', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_TEXT: 'hello from sdk child' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request('do X'))
    expect(run.localAgent).toBeUndefined()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(text(result.output)).toBe('hello from sdk child')
    // dispose is idempotent (one memoized teardown).
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = run.dispose()
    expect(run.dispose()).toBe(disposal)
    await disposal

    /** 中文说明：变量 nextRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nextRun = await ctx.subagents.start('dsh-sdk', request('again'))
    expect(nextRun.id).not.toBe(run.id)
    await nextRun.result
    await nextRun.dispose()
    await ctx.fiber.dispose()
  })

  it('initializes the child with the configured provider/model/maxTokens and the parent cwd', async () => {
    /** 中文说明：变量 tmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tmp = mkdtempSync(join(tmpdir(), 'subagent-dsh-sdk-init-'))
    /** 中文说明：变量 recordFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const recordFile = join(tmp, 'init.jsonl')
    try {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await setup({ FAKE_RECORD_INIT: recordFile }, { maxTokens: 4096 })
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await ctx.subagents.start('dsh-sdk', request())
      await run.result
      await run.dispose()
      const { readFileSync } = await import('node:fs')
      /** 中文说明：函数值 records 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const records = readFileSync(recordFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      expect(records).toEqual([{
        cwd: process.cwd(),
        provider: 'fake-provider',
        model: 'fake-model',
        maxTokens: 4096,
      }])
      await ctx.fiber.dispose()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('scrubs ambient credentials but forwards explicit config env', async () => {
    process.env.DSH_TEST_AMBIENT_SECRET_KEY = 'leak-me-not'
    try {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await setup({
        FAKE_ECHO_ENV: 'DSH_TEST_AMBIENT_SECRET_KEY,DEEPSEEK_API_KEY',
        DEEPSEEK_API_KEY: 'explicit-child-key',
        FAKE_TEXT: 'done',
      })
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await ctx.subagents.start('dsh-sdk', request())
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await run.result
      /** 中文说明：变量 answer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const answer = text(result.output)
      expect(answer).toContain('DSH_TEST_AMBIENT_SECRET_KEY=\n')
      expect(answer).toContain('DEEPSEEK_API_KEY=explicit-child-key')
      await run.dispose()
      await ctx.fiber.dispose()
    } finally {
      delete process.env.DSH_TEST_AMBIENT_SECRET_KEY
    }
  })

  it('maps a max-tokens child turn end', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_REASON_KIND: 'max-tokens', FAKE_STATUS: 'error' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    expect((await run.result).stopReason).toBe('max-tokens')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('flattens a child turn error into stopReason error and keeps partial text', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_REASON_KIND: 'error', FAKE_STATUS: 'error', FAKE_TEXT: 'partial answer' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(text(result.output)).toBe('partial answer')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps streamed text when a malformed final message prevents completion', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_MALFORMED_MESSAGE: '1', FAKE_TEXT: 'stream-only answer' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result

    expect(result.stopReason).toBe('error')
    expect(text(result.output)).toBe('stream-only answer')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps streamed text when the terminal message is an empty usage-only step', async () => {
    // The child streams its answer, then emits an empty-content
    // assistant/message (the harness loop appends one to host usage on a
    // max-tokens step that assembled no text blocks). The empty message is
    // not assistant output and must not erase the streamed answer.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_EMPTY_MESSAGE: '1', FAKE_REASON_KIND: 'max-tokens' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('max-tokens')
    expect(text(result.output)).toBe('hello from fake runtime')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('reports a settled-without-turn child as an error', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_REASON_KIND: 'none', FAKE_STATUS: 'error' })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    expect((await run.result).stopReason).toBe('error')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('aborting the required signal settles a hung child as aborted', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_HANG_PROMPT: '1' }, { disposeEofGraceMs: 200, disposeGraceMs: 200 })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request('p', controller.signal))
    controller.abort('test')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    // The hung child streamed nothing, so the aborted result has no output.
    expect(result.output).toEqual([])
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('cancelling between handshake and publish rejects start after reap', async () => {
    // The abort lands while the child is INSIDE initialize (ready-file
    // handshake window): the fake touches READY, we abort, then GO lets the
    // handshake complete — so the post-race `flags.cancelled` recheck must
    // reject even though the handshake itself succeeded.
    /** 中文说明：变量 tmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tmp = mkdtempSync(join(tmpdir(), 'subagent-dsh-sdk-midcancel-'))
    /** 中文说明：变量 ready 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ready = join(tmp, 'ready')
    /** 中文说明：变量 go 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const go = join(tmp, 'go')
    try {
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()
      /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const spec: SdkRunSpec = {
        command: process.execPath,
        args: [fakeRuntime],
        cwd: process.cwd(),
        provider: 'p',
        model: 'm',
        env: { FAKE_INIT_READY: ready, FAKE_INIT_GO: go },
        shutdownTimeoutMs: 100,
        disposeEofGraceMs: 200,
        disposeGraceMs: 200,
      }
      /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pending = startSdkRun(request('p', controller.signal), spec)
      await waitForFile(ready)
      controller.abort('mid-handshake')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(go, 'go\n')
      await expect(pending).rejects.toThrow('aborted before the SDK child started')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not attribute streamed text when prompt acceptance is malformed', async () => {
    // The fake streams one text-delta chunk but never returns the MessageId
    // needed to establish this run's durable inbox receipt. The text therefore
    // lies outside an owned activity interval and cannot become its output.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_STREAM_THEN_MALFORMED: '1' }, { shutdownTimeoutMs: 100, disposeEofGraceMs: 200, disposeGraceMs: 200 })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([])
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('dispose cancels a hung child locally and reaps it', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_HANG_PROMPT: '1' }, { shutdownTimeoutMs: 100, disposeEofGraceMs: 200, disposeGraceMs: 200 })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    await run.dispose()
    expect((await run.result).stopReason).toBe('aborted')
    await ctx.fiber.dispose()
  })

  it('rejects WITHOUT spawning when the signal is already aborted', async () => {
    /** 中文说明：变量 tmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tmp = mkdtempSync(join(tmpdir(), 'subagent-dsh-sdk-preabort-'))
    /** 中文说明：变量 sentinel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sentinel = join(tmp, 'spawned')
    try {
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()
      controller.abort()
      await expect(startSdkRun(
        request('p', controller.signal),
        // `touch <sentinel>` — runs only if the process is actually spawned.
        {
          command: 'touch',
          args: [sentinel],
          cwd: tmp,
          provider: 'p',
          model: 'm',
          env: {},
          shutdownTimeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
          disposeEofGraceMs: DEFAULT_DISPOSE_EOF_GRACE_MS,
          disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        },
      )).rejects.toThrow('aborted before the SDK child started')
      expect(existsSync(sentinel)).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects after reaping when the child dies before the handshake', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_EXIT_BEFORE_INIT: '1', FAKE_STDERR: 'scripted boot failure' })
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = await ctx.subagents.start('dsh-sdk', request()).then(
      () => { throw new Error('start unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(String(failure)).toContain('exit code: 3')
    expect(String(failure)).toContain('scripted boot failure')
    await ctx.fiber.dispose()
  })

  it('cancelling mid-handshake rejects start after reaping the child', async () => {
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: SdkRunSpec = {
      command: process.execPath,
      args: [fakeRuntime],
      cwd: process.cwd(),
      provider: 'p',
      model: 'm',
      env: { FAKE_HANG_INIT: '1' },
      shutdownTimeoutMs: 100,
      disposeEofGraceMs: 200,
      disposeGraceMs: 200,
    }
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = startSdkRun(request('p', controller.signal), spec)
    controller.abort('now')
    await expect(pending).rejects.toThrow('aborted before the SDK child started')
  })

  it('routes a post-publication child failure through onError and settles error', async () => {
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: string[] = []
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: SdkRunSpec = {
      command: process.execPath,
      args: [fakeRuntime],
      cwd: process.cwd(),
      provider: 'p',
      model: 'm',
      // The fake dies as soon as the prompt arrives: FAKE_HANG_PROMPT plus a
      // short-lived process is simulated by killing via dispose below instead;
      // here use FAKE_MALFORMED to make the prompt reply violate the protocol.
      env: { FAKE_MALFORMED_PROMPT: '1' },
      shutdownTimeoutMs: 100,
      disposeEofGraceMs: 200,
      disposeGraceMs: 200,
      onError: (error) => {
        seen.push(error.message)
        throw new Error('sink failure must be contained')
      },
    }
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await startSdkRun(request(), spec)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(seen).toHaveLength(1)
    await run.dispose()
  })

  it('routes provider-level onError through ctx.logger.warn', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup({ FAKE_MALFORMED_PROMPT: '1' })
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('dsh-sdk', request())
    expect((await run.result).stopReason).toBe('error')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('subagent-dsh-sdk "dsh-sdk": child run failed (error)')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('registers under the configured provider name and unregisters on fiber dispose (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(sdk, {
      providerName: 'sdk-hmr',
      command: process.execPath,
      args: [fakeRuntime],
      provider: 'p',
      model: 'm',
      env: {},
    })
    expect(ctx.subagents.getProvider('sdk-hmr')?.name).toBe('sdk-hmr')
    expect(ctx.subagents.getProvider('sdk-hmr')?.inheritsParentContext).toBe(false)
    expect(ctx.subagents.getProvider('sdk-hmr')?.capabilities).toEqual({
      outputSchema: false,
      depthLimit: false,
      toolFilter: false,
      persona: false,
    })
    await fiber.dispose()
    expect(ctx.subagents.getProvider('sdk-hmr')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects non-positive timing bounds at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = { providerName: 'sdk', command: 'true', args: [], provider: 'p', model: 'm', env: {} }
    await expect(ctx.plugin(sdk, { ...base, shutdownTimeoutMs: 0 })).rejects.toThrow('shutdownTimeoutMs must be a positive finite number')
    await expect(ctx.plugin(sdk, { ...base, disposeEofGraceMs: -1 })).rejects.toThrow('disposeEofGraceMs must be a positive finite number')
    await expect(ctx.plugin(sdk, { ...base, disposeGraceMs: Number.NaN })).rejects.toThrow('disposeGraceMs must be a positive finite number')
    await ctx.fiber.dispose()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxTokens %s at load',
    async (maxTokens) => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      await expect(ctx.plugin(sdk, {
        providerName: 'sdk',
        command: 'true',
        args: [],
        provider: 'p',
        model: 'm',
        maxTokens,
        env: {},
      })).rejects.toThrow('maxTokens')
      await ctx.fiber.dispose()
    },
  )

  it.each([0, 1.5])(
    'defensively rejects invalid maxTokens %s when apply is called directly',
    async (maxTokens) => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SubagentRuntime)
      expect(() => { sdk.apply(ctx, {
        providerName: 'sdk',
        command: 'true',
        args: [],
        provider: 'p',
        model: 'm',
        maxTokens,
        env: {},
        shutdownTimeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
        disposeEofGraceMs: DEFAULT_DISPOSE_EOF_GRACE_MS,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      }) }).toThrow('maxTokens must be a positive safe integer')
      await ctx.fiber.dispose()
    },
  )

  it('rejects an empty config cwd at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await expect(ctx.plugin(sdk, {
      providerName: 'sdk',
      command: 'true',
      args: [],
      cwd: '',
      provider: 'p',
      model: 'm',
      env: {},
    })).rejects.toThrow('config cwd must not be empty')
    await ctx.fiber.dispose()
  })

  it('uses a validated config cwd override instead of the parent session cwd', async () => {
    /** 中文说明：变量 tmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tmp = mkdtempSync(join(tmpdir(), 'subagent-dsh-sdk-cwd-'))
    try {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await setup({ FAKE_ECHO_CWD: '1', FAKE_TEXT: 'done' }, { cwd: tmp })
      /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run = await ctx.subagents.start('dsh-sdk', request())
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await run.result
      const { realpathSync } = await import('node:fs')
      expect(text(result.output)).toContain(`cwd=${realpathSync(tmp)}`)
      await run.dispose()
      await ctx.fiber.dispose()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('fails loud when neither config cwd nor parent session cwd exists', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = { id: 'parent', session: { header: {} } } as unknown as Agent
    await expect(ctx.subagents.start('dsh-sdk', {
      label: 'p', prompt: [{ type: 'text' as const, text: 'p' }], parent, signal: new AbortController().signal,
    }))
      .rejects.toThrow('no working directory for the child')
    await ctx.fiber.dispose()
  })

  it('keeps named plugin exports with no default export (loader shape)', () => {
    expect(sdk.name).toBe('subagent-dsh-sdk')
    expect(sdk.inject).toEqual(['subagents'])
    expect(typeof sdk.apply).toBe('function')
    expect(typeof sdk.Config).toBe('function')
    expect((sdk as Record<string, unknown>).default).toBeUndefined()
  })
})
