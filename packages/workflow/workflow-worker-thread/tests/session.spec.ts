/**
 * 文件职责：验证 session.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import type { MessagePort } from 'node:worker_threads'
import { HostToWorkerType, WorkerToHostType } from '../src/protocol.ts'
import type { HostToWorkerMessage, WorkerToHostMessage } from '../src/protocol.ts'
import { requireParentPort, runWorkerSession } from '../src/session.ts'
import type { ChildResult, WorkerInit } from '../src/types.ts'

/** Default limits for in-process sessions (concurrency pinned; auto is machine-derived). */
/* 中文说明：函数 limits 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function limits(overrides?: Partial<WorkerInit['limits']>): WorkerInit['limits'] {
  return { maxConcurrentAgents: 8, maxTotalAgents: 1000, maxItemsPerCall: 4096, syncTimeoutMs: 5000, ...overrides }
}

/** Wrap a body in the minimal valid meta header (the session receives it pre-extracted). */
/* 中文说明：函数 init 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function init(body: string, args?: unknown, limitOverrides?: Partial<WorkerInit['limits']>): WorkerInit {
  return {
    meta: { name: 'test-flow', description: 'a test workflow' },
    body,
    ...args !== undefined ? { args } : {},
    limits: limits(limitOverrides),
  }
}

/** One scripted host over the other end of a MessageChannel. */
/* 中文说明：interface FakeHost 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
interface FakeHost {
  port: MessagePort
  messages: WorkerToHostMessage[]
  /** Messages of one type, as they arrive. */
  ofType<T extends WorkerToHostMessage['type']>(type: T): Extract<WorkerToHostMessage, { type: T }>[]
  send(message: HostToWorkerMessage): void
  /** Resolves with the terminal result message. */
  result(): Promise<Extract<WorkerToHostMessage, { type: 'result' }>['result']>
  close(): void
}

/** 中文说明：interface FakeHostOptions 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
interface FakeHostOptions {
  /** Auto-respond to child-start: reply started + settled per child index. Omit a reply to leave the child pending. */
  reply?: (request: { prompt: string; schema?: unknown; provider?: string; model?: string }, index: number) => ChildResult | undefined
  /** Reject the start instead (child-start-error) when returning a string. */
  refuse?: (index: number) => string | undefined
  /** Auto-send `go` on `ready` (default true). */
  go?: boolean
  /** Manual mode: do NOT auto-answer child-start at all (the test scripts the replies). */
  manual?: boolean
}

/**
 * Drive runWorkerSession IN-PROCESS over a MessageChannel: this is where the
 * worker-side files earn their coverage — code inside a real Worker is
 * invisible to main-process coverage. The fake host mirrors the real host's
 * protocol discipline (one started/start-error per start; settled/disposed
 * follow).
 */
/* 中文说明：函数 fakeHost 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeHost(options?: FakeHostOptions): FakeHost {
  /** 中文说明：变量 channel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const channel = new MessageChannel()
  /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const messages: WorkerToHostMessage[] = []
  /** 中文说明：变量 resultGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resultGate = Promise.withResolvers<Extract<WorkerToHostMessage, { type: 'result' }>['result']>()
  /** 中文说明：变量 childIndex 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let childIndex = 0
  channel.port1.on('message', (message: WorkerToHostMessage) => {
    messages.push(message)
    switch (message.type) {
      case WorkerToHostType.Ready:
        if (options?.go !== false) channel.port1.postMessage({ type: HostToWorkerType.Go } satisfies HostToWorkerMessage)
        break
      case WorkerToHostType.ChildStart: {
        if (options?.manual) break
        /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const index = childIndex
        childIndex += 1
        /** 中文说明：变量 refusal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const refusal = options?.refuse?.(index)
        if (refusal !== undefined) {
          channel.port1.postMessage(
            { type: HostToWorkerType.ChildStartError, callId: message.callId, rendered: refusal } satisfies HostToWorkerMessage,
          )
          break
        }
        channel.port1.postMessage({ type: HostToWorkerType.ChildStarted, callId: message.callId, childId: `child-${index}` } satisfies HostToWorkerMessage)
        /** 中文说明：变量 reply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const reply = options?.reply?.(message.request, index)
        if (reply !== undefined) {
          channel.port1.postMessage(
            { type: HostToWorkerType.ChildSettled, callId: message.callId, result: reply } satisfies HostToWorkerMessage,
          )
        }
        break
      }
      case WorkerToHostType.ChildDispose:
        channel.port1.postMessage({ type: HostToWorkerType.ChildDisposed, callId: message.callId } satisfies HostToWorkerMessage)
        break
      case WorkerToHostType.Result:
        resultGate.resolve(message.result)
        break
      default:
        break
    }
  })
  return {
    port: channel.port2,
    messages,
    ofType: type => messages.filter((message): message is never => message.type === type),
    send: (message) => { channel.port1.postMessage(message) },
    result: () => resultGate.promise,
    close: () => { channel.port1.close() },
  }
}

/** A completed text child result. */
/* 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(reply: string): ChildResult {
  return { output: [{ type: 'text', text: reply }], stopReason: 'completed' }
}

describe('runWorkerSession over an in-process MessageChannel', () => {
  it('runs a script end to end: ready/go handshake, phases, log, agents, result', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: (_request, index) => text(`answer-${index}`) })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = runWorkerSession(host.port, init(`
      phase('Scan')
      log('starting with ' + args.files.length + ' files')
      const answers = await pipeline(args.files, (prev, item) => agent('read ' + item))
      return { answers }
    `, { files: ['a.ts', 'b.ts'] }))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    await session
    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(2)
    expect(result.value).toEqual({ answers: ['answer-0', 'answer-1'] })
    expect(host.messages[0]!.type).toBe('ready')
    expect(host.ofType(WorkerToHostType.Phase).map(m => m.title)).toEqual(['Scan'])
    expect(host.ofType(WorkerToHostType.Log).map(m => m.message)).toEqual(['starting with 2 files'])
    expect(host.ofType(WorkerToHostType.AgentStart).map(m => m.info.childId)).toEqual(['child-0', 'child-1'])
    expect(host.ofType(WorkerToHostType.AgentEnd).every(m => m.info.outcome === 'completed')).toBe(true)
    host.close()
  })

  it('agent({schema}) forwards the schema on the start request and returns the structured value', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => ({ output: [], structured: { files: ['x.ts'] }, stopReason: 'completed' }) })
    void runWorkerSession(host.port, init(`
      const found = await agent('list files', { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } } }, model: 'deepseek-v4-pro' })
      return { first: found.files[0] }
    `))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toEqual({ first: 'x.ts' })
    /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const start = host.ofType(WorkerToHostType.ChildStart)[0]!
    expect(start.request.schema).toEqual({ type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } } })
    expect(start.request.model).toBe('deepseek-v4-pro')
    host.close()
  })

  it('agent({provider}) forwards a provider without inventing a model', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('ok') })
    void runWorkerSession(host.port, init("return await agent('route me', { provider: 'openai' })"))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toBe('ok')
    /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const start = host.ofType(WorkerToHostType.ChildStart)[0]!
    expect(start.request.provider).toBe('openai')
    expect(start.request.model).toBeUndefined()
    host.close()
  })

  it('a schema child completing WITHOUT a structured value resolves null with a failed outcome', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('prose, no structure') })
    void runWorkerSession(host.port, init("return await agent('p', { schema: { type: 'object' } })"))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toBeNull()
    expect(host.ofType(WorkerToHostType.AgentEnd)[0]!.info.outcome).toBe('failed')
    host.close()
  })

  it('a child settling non-completed resolves null (scripts filter), never throwing into the script', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: (_request, index) => index === 0 ? { output: [], stopReason: 'error' } : text('ok') })
    void runWorkerSession(host.port, init("return await parallel([() => agent('one'), () => agent('two')])"))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toEqual([null, 'ok'])
    expect(host.ofType(WorkerToHostType.AgentEnd).map(m => m.info.outcome)).toEqual(expect.arrayContaining(['failed', 'completed']))
    host.close()
  })

  it('a start refusal (child-start-error) is a fatal AGENT_START that kills the script through a combinator', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ refuse: () => 'no provider here' })
    void runWorkerSession(host.port, init("return await pipeline([1], () => agent('p'))"))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('error')
    expect(result.error).toContain('agent() could not start a child')
    expect(result.error).toContain('no provider here')
    host.close()
  })

  it('a child-failed message (infrastructure rejection) is fatal AGENT_RESULT with the paired failed outcome', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost()
    void runWorkerSession(host.port, init(`
      try { await agent('p'); return 'unreachable' } catch (e) { return { name: e.name, code: e.code, fatal: e.fatal } }
    `))
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
    /** 中文说明：变量 callId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callId = host.ofType(WorkerToHostType.ChildStart)[0]!.callId
    host.send({ type: HostToWorkerType.ChildStarted, callId, childId: 'child-0' })
    host.send({ type: HostToWorkerType.ChildFailed, callId, rendered: 'backend exploded' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toMatchObject({ name: 'WorkflowError', code: 'AGENT_RESULT', fatal: true })
    expect(host.ofType(WorkerToHostType.AgentEnd)[0]!.info.outcome).toBe('failed')
    host.close()
  })

  it('cancel before go: the body never runs at all and the result is cancelled (a second cancel is a no-op)', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost({ go: false })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = runWorkerSession(host.port, init("log('ran')\nreturn 123"))
    await vi.waitFor(() => { expect(host.messages.some(m => m.type === WorkerToHostType.Ready)).toBe(true) })
    host.send({ type: HostToWorkerType.Cancel, reason: 'aborted before start' })
    // Idempotence: the first reason wins; a duplicate cancel changes nothing.
    host.send({ type: HostToWorkerType.Cancel, reason: 'a later reason that must lose' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    await session
    expect(result.stopReason).toBe('cancelled')
    expect(result.error).toContain('aborted before start')
    expect(result.error).not.toContain('must lose')
    expect(result.value).toBeNull()
    expect(host.ofType(WorkerToHostType.Log)).toEqual([])
    host.close()
  })

  it('a script with no return value resolves value: null', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('ok') })
    void runWorkerSession(host.port, init("await agent('p')"))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('completed')
    expect(result.value).toBeNull()
    host.close()
  })

  it('cancel mid-run: hooks throw at entry and the run reports cancelled', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost()
    void runWorkerSession(host.port, init(`
      phase('before')
      try { await agent('x') } catch (e) {}
      try { phase('after') } catch (e) {}
      try { log('after') } catch (e) {}
      try { await parallel([() => 'ran']) } catch (e) {}
      try { await pipeline(['item'], p => p) } catch (e) {}
      return 'survived by catching'
    `))
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
    /** 中文说明：变量 callId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callId = host.ofType(WorkerToHostType.ChildStart)[0]!.callId
    host.send({ type: HostToWorkerType.ChildStarted, callId, childId: 'child-0' })
    host.send({ type: HostToWorkerType.Cancel, reason: 'stop everything' })
    // The real host settles the aborted child; mirror it.
    host.send({ type: HostToWorkerType.ChildSettled, callId, result: { output: [], stopReason: 'aborted' } })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('cancelled')
    expect(result.error).toContain('stop everything')
    expect(host.ofType(WorkerToHostType.AgentEnd)[0]!.info.outcome).toBe('cancelled')
    // No post-cancel narration left the runtime (the hooks threw at entry).
    expect(host.ofType(WorkerToHostType.Phase).map(m => m.title)).toEqual(['before'])
    expect(host.ofType(WorkerToHostType.Log)).toEqual([])
    host.close()
  })

  it('cancellation between a queued waiter and its slot: the waiter rejects without a child-start', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost({ go: true })
    void runWorkerSession(host.port, init(
      "return await parallel([() => agent('a'), () => agent('b')])",
      undefined,
      { maxConcurrentAgents: 1 },
    ))
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
    host.send({ type: HostToWorkerType.Cancel, reason: 'raced' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('cancelled')
    // Only the first agent ever reached the host.
    expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1)
    host.close()
  })

  it('a stray (never-awaited) agent is reaped after settlement: cancel + dispose RPCs flow, no unhandled rejection', async () => {
    /** 中文说明：变量 unhandled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unhandled: unknown[] = []
    /** 中文说明：函数值 onUnhandled 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const host = fakeHost()
      void runWorkerSession(host.port, init(`
        agent('stray, never awaited')
        return 'done without awaiting'
      `))
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await host.result()
      expect(result.stopReason).toBe('completed')
      await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
      /** 中文说明：变量 callId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const callId = host.ofType(WorkerToHostType.ChildStart)[0]!.callId
      host.send({ type: HostToWorkerType.ChildStarted, callId, childId: 'child-0' })
      host.send({ type: HostToWorkerType.ChildSettled, callId, result: { output: [], stopReason: 'aborted' } })
      await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildDispose).map(m => m.callId)).toContain(callId) })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
      host.close()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('an unparseable body settles an error result instead of dying without one (host pre-parse skew guard)', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost()
    await runWorkerSession(host.port, init('return ((('))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('error')
    expect(result.error).toContain('does not parse')
    expect(result.agentsStarted).toBe(0)
    host.close()
  })

  it('a synchronous spin in the initial slice dies by the in-worker vm timeout', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost()
    void runWorkerSession(host.port, init('while (true) {}', undefined, { syncTimeoutMs: 50 }))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('error')
    expect(result.error?.toLowerCase()).toContain('timed out')
    host.close()
  })

  it('a non-JSON return value fails loud as RESULT_UNSERIALIZABLE', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost()
    void runWorkerSession(host.port, init('return { when: new Date(0) }'))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('error')
    expect(result.error).toContain('not plain JSON data')
    host.close()
  })

  it('tolerates replies for unknown callIds (a teardown race): nothing crashes, the run completes', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('fine') })
    void runWorkerSession(host.port, init("return await agent('p')"))
    host.send({ type: HostToWorkerType.ChildStarted, callId: 999, childId: 'ghost' })
    host.send({ type: HostToWorkerType.ChildStartError, callId: 999, rendered: 'ghost' })
    host.send({ type: HostToWorkerType.ChildSettled, callId: 999, result: text('ghost') })
    host.send({ type: HostToWorkerType.ChildFailed, callId: 999, rendered: 'ghost' })
    host.send({ type: HostToWorkerType.ChildDisposed, callId: 999 })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('completed')
    expect(result.value).toBe('fine')
    host.close()
  })

  it('caps and malformed hook arguments reject loud (the runtime runs unchanged inside the session)', async () => {
    /** 中文说明：变量 cases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cases: [string, string][] = [
      ['return await agent(42)', 'non-empty prompt string'],
      ["return await agent('')", 'non-empty prompt string'],
      ["return await agent('p', 'opts')", 'options must be an object'],
      ["return await agent('p', { label: 3 })", '"label" must be a string'],
      ["return await agent('p', { get label() { throw new Error('read failed') } })", 'options must be plain JSON data'],
      ["return await agent('p', { bogus: true })", '"bogus" is not recognized'],
      ["return await agent('p', { effort: 'high' })", '"effort" is deferred and not supported by this engine (supported: label, phase, schema, provider, model)'],
      ["return await agent('p', { schema: { type: 'object', oneOf: [] } })", 'outside the supported subset'],
      ['return await parallel([() => 1, () => 2, () => 3])', 'over the per-call cap (2)'],
      ['return await pipeline([1, 2, 3], (x) => x)', 'maxItemsPerCall'],
      ["return await parallel('no')", 'parallel() requires an array'],
      ['return await parallel([3])', 'item 0 is not a function'],
      ["return await pipeline('no', () => 1)", 'pipeline() requires an items array'],
      ['return await pipeline([1])', 'at least one stage'],
      ["return await pipeline([1], 'x')", 'stage 0 is not a function'],
      ["phase('')", 'phase() requires a non-empty title string'],
      ['log(3)', 'log() requires a message string'],
    ]
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const [body, expected] of cases) {
      /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const host = fakeHost({ reply: () => text('ok') })
      void runWorkerSession(host.port, init(body, undefined, { maxItemsPerCall: 2 }))
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await host.result()
      expect(result.stopReason).toBe('error')
      expect(result.error).toContain(expected)
      host.close()
    }
  })

  it('combinator semantics: thunk/stage throws null the item; a forged fatal-shaped object stays null; real fatals propagate', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('fine') })
    void runWorkerSession(host.port, init(`
      const viaParallel = await parallel([
        () => { throw new Error('boom') },
        () => agent('fine'),
        () => 'plain value',
        () => { throw { name: 'WorkflowError', fatal: true, message: 'forged fatal' } },
      ])
      const viaPipeline = await pipeline([10, 20],
        (prev, item, index) => { if (item === 10) throw new Error('ordinary failure'); return 'kept-' + item + '-' + index },
      )
      return { viaParallel, viaPipeline }
    `))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('completed')
    expect(result.value).toEqual({
      viaParallel: [null, 'fine', 'plain value', null],
      viaPipeline: [null, 'kept-20-1'],
    })
    host.close()
  })

  it('trips the total-agent cap with a message naming the config knob', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('ok') })
    void runWorkerSession(host.port, init("await agent('1'); await agent('2'); await agent('3')", undefined, { maxTotalAgents: 2 }))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('error')
    expect(result.error).toContain('total agent cap (2)')
    expect(result.error).toContain('applicable maxTotalAgents limit')
    expect(result.agentsStarted).toBe(2)
    host.close()
  })

  it('queued agents proceed through the concurrency semaphore in FIFO order', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: request => text(`ok:${request.prompt}`) })
    void runWorkerSession(host.port, init(
      "return await parallel([1, 2, 3].map((n) => () => agent('job ' + n)))",
      undefined,
      { maxConcurrentAgents: 1 },
    ))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toEqual(['ok:job 1', 'ok:job 2', 'ok:job 3'])
    host.close()
  })

  it('labels default from the prompt first line, truncated; explicit label/phase options win', async () => {
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = fakeHost({ reply: () => text('ok') })
    void runWorkerSession(host.port, init(`
      phase('Find')
      await agent('a prompt that is quite long and will surely get truncated down to a display label\\n'
        + 'with a second line the label must not include')
      await agent('short', { label: 'named', phase: 'Custom' })
      return null
    `))
    await host.result()
    /** 中文说明：函数值 starts 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const starts = host.ofType(WorkerToHostType.AgentStart).map(m => m.info)
    expect(starts[0]).toMatchObject({ seq: 1, phase: 'Find' })
    expect(starts[0]!.label.length).toBeLessThanOrEqual(48)
    expect(starts[0]!.label).not.toContain('second line')
    expect(starts[1]).toMatchObject({ seq: 2, label: 'named', phase: 'Custom' })
    host.close()
  })

  it('non-text output blocks are filtered out of the text result', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost({
      reply: () => ({
        output: [
          { type: 'text', text: 'first ' },
          { type: 'tool_call', id: 'c1', name: 'x', arguments: {} } as never,
          { type: 'text', text: 'second' },
        ],
        stopReason: 'completed',
      }),
    })
    void runWorkerSession(host.port, init("return await agent('p')"))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.value).toBe('first second')
    host.close()
  })

  it('a cancel landing DURING the start round-trip disposes the fresh child and dies cancelled', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost({ manual: true })
    void runWorkerSession(host.port, init("return await agent('p')"))
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
    /** 中文说明：变量 callId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callId = host.ofType(WorkerToHostType.ChildStart)[0]!.callId
    // Simulate a teardown race by delivering cancellation before a stale start reply.
    host.send({ type: HostToWorkerType.Cancel, reason: 'raced the start' })
    host.send({ type: HostToWorkerType.ChildStarted, callId, childId: 'child-0' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('cancelled')
    await vi.waitFor(() => {
      expect(host.ofType(WorkerToHostType.ChildDispose).map(m => m.callId)).toContain(callId)
    })
    // The unpublished child is disposed without a lifecycle announcement.
    expect(host.ofType(WorkerToHostType.AgentStart)).toEqual([])
    host.close()
  })

  it('a start refusal arriving after a cancel reads as the cancellation, not a broken seam', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost({ manual: true })
    void runWorkerSession(host.port, init(`
      try { await agent('p'); return 'unreachable' } catch (e) { return { code: e.code } }
    `))
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
    /** 中文说明：变量 callId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callId = host.ofType(WorkerToHostType.ChildStart)[0]!.callId
    host.send({ type: HostToWorkerType.Cancel, reason: 'stopping' })
    host.send({ type: HostToWorkerType.ChildStartError, callId, rendered: 'workflow run cancelled: stopping' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    // The run reports cancelled (the script died of CANCELLED, not AGENT_START).
    expect(result.stopReason).toBe('cancelled')
    host.close()
  })

  it('a child result rejection while cancelled pairs a cancelled agent-end, and the run reports cancelled', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = fakeHost({ manual: true })
    void runWorkerSession(host.port, init("return await agent('doomed')"))
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.ChildStart).length).toBe(1) })
    /** 中文说明：变量 callId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callId = host.ofType(WorkerToHostType.ChildStart)[0]!.callId
    host.send({ type: HostToWorkerType.ChildStarted, callId, childId: 'child-0' })
    await vi.waitFor(() => { expect(host.ofType(WorkerToHostType.AgentStart).length).toBe(1) })
    host.send({ type: HostToWorkerType.Cancel, reason: 'user aborted' })
    host.send({ type: HostToWorkerType.ChildFailed, callId, rendered: 'backend crashed on abort' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await host.result()
    expect(result.stopReason).toBe('cancelled')
    expect(host.ofType(WorkerToHostType.AgentEnd)[0]!.info.outcome).toBe('cancelled')
    host.close()
  })

})

describe('the worker bootstrap', () => {
  it('requireParentPort narrows a real port and throws on the main thread', () => {
    /** 中文说明：变量 channel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const channel = new MessageChannel()
    expect(requireParentPort(channel.port1)).toBe(channel.port1)
    channel.port1.close()
    expect(() => requireParentPort(null)).toThrow(/inside a worker thread/)
  })

  it('the entry module itself throws when loaded on the main thread (no parentPort)', async () => {
    // This import EXECUTES ../src/worker.ts on the main thread, which is what
    // covers the bootstrap file: requireParentPort throws before
    // runWorkerSession is reached.
    await expect(import('../src/worker.ts')).rejects.toThrow(/inside a worker thread/)
  })
})
