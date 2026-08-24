/**
 * 文件职责：验证代码运行时的 bootstrap.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止代码运行时协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { LogBuffer, makeBindingErrorClasses, makeConsoleShim, makeNamespaces, captureStreamWrites, prepareCompletion, prepareException, runWorkerMain, wireReplies } from '../src/bootstrap.ts'
import type { BootstrapPort, PatchableStream, PendingCall } from '../src/bootstrap.ts'
import type { ReplyMessage, WorkerToHost } from '../src/protocol.ts'
import { decodeWorkerJson, encodeWorkerJson } from '../src/worker-json.ts'

/**
 * An in-process stand-in for the worker's parentPort: the test plays the
 * HOST side — inspect what the bootstrap posted, feed replies back — so
 * every line of worker-side logic runs under coverage without spawning an
 * isolate (real-worker behavior is pinned by runtime.spec.ts).
 */
/** 中文说明：类型或类 FakePort 约束协议数据或模块职责。 */
class FakePort implements BootstrapPort {
  sent: WorkerToHost[] = []
  private readonly emitter = new EventEmitter()
  /** Host-scripted responder; return undefined to leave the call pending. */
  respond: (message: WorkerToHost) => ReplyMessage | undefined = () => undefined

  postMessage(message: WorkerToHost): void {
    this.sent.push(message)
    /** 中文说明：测试局部值 reply，由紧邻初始化决定。 */
    const reply = this.respond(message)
    if (reply) queueMicrotask(() => this.emitter.emit('message', reply))
  }

  on(event: 'message', listener: (message: ReplyMessage) => void): void {
    this.emitter.on(event, listener)
  }

  deliver(message: ReplyMessage): void {
    this.emitter.emit('message', message)
  }

  logs(): string[] {
    return this.sent.filter(message => message.type === 'log').map(message => message.text)
  }

  done(): WorkerToHost | undefined {
    return this.sent.find(message => message.type === 'done')
  }

  doneValue(): unknown {
    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = this.done()
    return done?.type === 'done' && done.value !== undefined ? decodeWorkerJson(done.value) : undefined
  }
}

/** 中文说明：函数 fakeStreams 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fakeStreams(): { stdout: PatchableStream; stderr: PatchableStream } {
  return { stdout: { write: () => true }, stderr: { write: () => true } }
}

/** Capture one promise rejection without Vitest's intentionally `any` matcher channel. */
/** 中文说明：函数 rejectionOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/** 中文说明：测试局部值 BOOT，由紧邻初始化决定。 */
const BOOT = { maxOutputBytes: 65_536 }
/** 中文说明：测试局部值 TOOL_ERROR_CLASS，由紧邻初始化决定。 */
const TOOL_ERROR_CLASS = { name: 'ToolCallError', memberNameProperty: 'toolName' } as const

/** One worker declaration for the Code Mode tools namespace. */
/** 中文说明：函数 toolNamespace 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function toolNamespace(names: string[]) {
  return { global: 'tools', names, errorClass: TOOL_ERROR_CLASS }
}

describe('LogBuffer', () => {
  it('streams entries to the sink until the byte budget, then emits one fitting prefix and reports the limit once', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    /** 中文说明：测试局部值 limits，由紧邻初始化决定。 */
    let limits = 0
    /** 中文说明：测试局部值 buffer，由紧邻初始化决定。 */
    const buffer = new LogBuffer(15, text => seen.push(text), () => { limits += 1 })
    buffer.push('12345')
    buffer.push('123456')
    buffer.push('dropped')
    expect(seen).toEqual(['12345', '123'])
    expect(limits).toBe(1)
    expect(buffer.remainingOutputBytes()).toBe(0)

    /** 中文说明：测试局部值 exactlyFull，由紧邻初始化决定。 */
    const exactlyFull: string[] = []
    /** 中文说明：测试局部值 fullBuffer，由紧邻初始化决定。 */
    const fullBuffer = new LogBuffer(6, text => exactlyFull.push(text))
    fullBuffer.push('12')
    fullBuffer.push('no-prefix-fits')
    expect(exactlyFull).toEqual(['12'])
  })
})

describe('makeConsoleShim', () => {
  it('captures the five methods and renders non-strings inspect-style', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    /** 中文说明：测试局部值 shim，由紧邻初始化决定。 */
    const shim = makeConsoleShim(new LogBuffer(1_000, text => seen.push(text)))
    shim.log('plain', { a: 1 })
    shim.info('i')
    shim.warn('w')
    shim.error('e')
    shim.debug('d')
    expect(seen).toEqual(['plain { a: 1 }', 'i', 'w', 'e', 'd'])
  })
})

describe('captureStreamWrites', () => {
  it('redirects writes into the buffer and restores on request', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    /** 中文说明：测试局部值 buffer，由紧邻初始化决定。 */
    const buffer = new LogBuffer(1_000, text => seen.push(text))
    /** 中文说明：测试局部值 underlying，由紧邻初始化决定。 */
    let underlying = ''
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream: PatchableStream = { write: (chunk: unknown) => { underlying += String(chunk); return true } }
    /** 中文说明：测试局部值 restore，由紧邻初始化决定。 */
    const restore = captureStreamWrites(buffer, stream)
    stream.write('captured', 'utf8')
    stream.write(Buffer.from('bytes'))
    restore()
    stream.write('after')
    expect(seen).toEqual(['captured', 'bytes'])
    expect(underlying).toBe('after')
  })

  it('invokes the write callback asynchronously, in both optional-encoding shapes', async () => {
    /** 中文说明：测试局部值 buffer，由紧邻初始化决定。 */
    const buffer = new LogBuffer(1_000, () => {})
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream: PatchableStream = { write: () => true }
    captureStreamWrites(buffer, stream)
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: (Error | null | undefined)[] = []
    stream.write('two-arg', (error?: Error | null) => calls.push(error))
    stream.write('three-arg', 'utf8', (error?: Error | null) => calls.push(error))
    // Node's contract: the callback fires after the write call returns.
    expect(calls).toEqual([])
    await new Promise<void>(resolve => stream.write('awaited flush', resolve))
    expect(calls).toEqual([null, null])
  })

  it('still fires the callback for a write the exhausted budget drops', async () => {
    /** 中文说明：测试局部值 buffer，由紧邻初始化决定。 */
    const buffer = new LogBuffer(4, () => {})
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream: PatchableStream = { write: () => true }
    captureStreamWrites(buffer, stream)
    stream.write('this write overflows the budget and is dropped')
    await new Promise<void>(resolve => stream.write('also dropped', resolve))
  })
})

describe('prepareCompletion', () => {
  it('omits undefined and passes lossless JSON values exactly', () => {
    expect(prepareCompletion(undefined, 100)).toEqual({})
    expect(prepareCompletion({ a: [1, 'two'] }, 100)).toEqual({ value: encodeWorkerJson({ a: [1, 'two'] }) })
  })

  it('turns every lossy completion shape into invalid-output', () => {
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    /** 中文说明：测试局部值 sparse，由紧邻初始化决定。 */
    const sparse = Array(2)
    /** 中文说明：类型或类 Exotic 约束协议数据或模块职责。 */
    class Exotic { readonly marker = true }
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [{ fn: () => 1 }, -0, Number.POSITIVE_INFINITY, sparse, cyclic, new Exotic()]) {
      expect(prepareCompletion(value, 1_000)).toEqual({
        error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' },
      })
    }
  })

  it('reports an oversized value instead of substituting rendered text', () => {
    expect(prepareCompletion('x'.repeat(50), 10)).toEqual({
      error: { kind: 'output-limit', message: 'outer output exceeded 10 bytes' },
    })
  })

  it('measures the exact JSON serialization at and over the boundary', () => {
    expect(prepareCompletion('€', 5)).toEqual({ value: encodeWorkerJson('€') })
    expect(prepareCompletion('€', 4)).toEqual({
      error: { kind: 'output-limit', message: 'outer output exceeded 4 bytes' },
    })
  })

  it('contains a getter failure as invalid-output', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('getter exploded') } })
    expect(prepareCompletion(value, 1_000)).toEqual({
      error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' },
    })
  })

  it('uses the remaining combined budget for invalid-output diagnostics', () => {
    expect(prepareCompletion(() => 1, 4, 64)).toEqual({
      error: { kind: 'output-limit', message: 'outer output exceeded 64 bytes' },
    })
  })
})

describe('prepareException', () => {
  it('passes a fitting diagnostic and rejects one byte over without carrying its text', () => {
    expect(prepareException('boom', 6, 64)).toEqual({ error: { kind: 'exception', message: 'boom' } })
    expect(prepareException('boom', 5, 64)).toEqual({
      error: { kind: 'output-limit', message: 'outer output exceeded 64 bytes' },
    })
  })

  it('contains a thrown value whose string conversion fails', () => {
    /** 中文说明：测试局部值 thrown，由紧邻初始化决定。 */
    const thrown = { toString() { throw new Error('cannot render') } }
    expect(prepareException(thrown, 1_000)).toEqual({
      error: { kind: 'exception', message: 'program threw an unrenderable value' },
    })

    /** 中文说明：测试局部值 strangeStack，由紧邻初始化决定。 */
    const strangeStack = Object.defineProperty(new Error('ignored'), 'stack', { value: 42 })
    expect(prepareException(strangeStack, 1_000)).toEqual({
      error: { kind: 'exception', message: '42' },
    })
  })
})

describe('makeNamespaces', () => {
  it('rejects a malformed success reply instead of resolving a lossy binding value', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = new Map<number, PendingCall>()
    wireReplies(port, pending)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = new Promise<unknown>((resolve, reject) => { pending.set(1, { resolve, reject }) })
    port.deliver({ type: 'reply', id: 1, ok: true, value: [undefined] as never })
    await expect(result).rejects.toThrow('binding resolution must be lossless JSON')
  })

  it('exposes prototype-colliding names as ordinary own properties', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    port.respond = message => message.type === 'call'
      ? { type: 'reply', id: message.id, ok: true, value: encodeWorkerJson(`${message.name}-ok`) }
      : undefined
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = new Map<number, PendingCall>()
    wireReplies(port, pending)
    /** 中文说明：测试局部值 [tools]，由紧邻初始化决定。 */
    const [tools] = makeNamespaces({ namespaces: [{ global: 'tools', names: ['__proto__', 'constructor', 'toString'] }] }, port, pending, { value: 1 }) as [Record<string, (args: unknown) => Promise<unknown>>]
    expect(Object.getPrototypeOf(tools)).toBeNull()
    await expect(tools['__proto__']?.({})).resolves.toBe('__proto__-ok')
    await expect(tools['constructor']?.({})).resolves.toBe('constructor-ok')
    await expect(tools['toString']?.({})).resolves.toBe('toString-ok')
  })

  it('rejects a postMessage clone failure without leaking the pending entry', async () => {
    /** 中文说明：测试局部值 firstCall，由紧邻初始化决定。 */
    let firstCall = true
    /** 中文说明：测试局部值 throwingPort，由紧邻初始化决定。 */
    const throwingPort: BootstrapPort = {
      // First call throws an Error (the real DataCloneError shape), the
      // second a bare string — the rejection renders both.
      postMessage: () => {
        if (firstCall) { firstCall = false; throw new Error('DataCloneError-ish') }
        throw 'raw-clone-failure'
      },
      on: () => {},
    }
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = new Map<number, PendingCall>()
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data = { namespaces: [toolNamespace(['x'])] }
    /** 中文说明：测试局部值 errorClasses，由紧邻初始化决定。 */
    const errorClasses = makeBindingErrorClasses(data)
    /** 中文说明：测试局部值 ToolCallError，由紧邻初始化决定。 */
    const ToolCallError = errorClasses.get('tools')
    /** 中文说明：测试局部值 [tools]，由紧邻初始化决定。 */
    const [tools] = makeNamespaces(
      data,
      throwingPort,
      pending,
      { value: 1 },
      errorClasses,
    ) as [Record<string, (args: unknown) => Promise<unknown>>]
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await rejectionOf(tools.x?.({ first: true }) ?? Promise.resolve())
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = await rejectionOf(tools.x?.({ second: true }) ?? Promise.resolve())
    expect(first).toMatchObject({ name: 'ToolCallError', toolName: 'x' })
    expect(second).toMatchObject({ name: 'ToolCallError', toolName: 'x' })
    expect(first).toBeInstanceOf(ToolCallError)
    expect(second).toBeInstanceOf(ToolCallError)
    expect((first as Error).message).toMatch(/DataCloneError-ish/)
    expect((second as Error).message).toMatch(/raw-clone-failure/)
    expect(pending.size).toBe(0)
  })

  it('rejects lossy arguments before posting or allocating a call id', async () => {
    /** 中文说明：测试局部值 posts，由紧邻初始化决定。 */
    let posts = 0
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port: BootstrapPort = { postMessage: () => { posts += 1 }, on: () => {} }
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = new Map<number, PendingCall>()
    /** 中文说明：测试局部值 nextId，由紧邻初始化决定。 */
    const nextId = { value: 1 }
    /** 中文说明：测试局部值 [tools]，由紧邻初始化决定。 */
    const [tools] = makeNamespaces(
      { namespaces: [toolNamespace(['x'])] }, port, pending, nextId,
    ) as [Record<string, (args: unknown) => Promise<unknown>>]
    /** 中文说明：测试局部值 decorated，由紧邻初始化决定。 */
    const decorated = [1]
    Object.defineProperty(decorated, 'extra', { value: true })
    /** 中文说明：测试局部值 throwing，由紧邻初始化决定。 */
    const throwing = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw new Error('getter exploded') },
    })

    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [() => 1, new Date(), decorated, throwing]) {
      /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
      const failure = await rejectionOf(tools.x?.(value) ?? Promise.resolve())
      expect(failure).toMatchObject({
        name: 'ToolCallError', toolName: 'x', message: 'binding arguments must be lossless JSON',
      })
    }
    expect(posts).toBe(0)
    expect(pending.size).toBe(0)
    expect(nextId.value).toBe(1)
  })

  it('uses ordinary Error for non-tools namespace failures', async () => {
    /** 中文说明：测试局部值 deniedPort，由紧邻初始化决定。 */
    const deniedPort = new FakePort()
    deniedPort.respond = message => message.type === 'call'
      ? { type: 'reply', id: message.id, ok: false, message: 'helper denied' }
      : undefined
    /** 中文说明：测试局部值 deniedPending，由紧邻初始化决定。 */
    const deniedPending = new Map<number, PendingCall>()
    wireReplies(deniedPort, deniedPending)
    /** 中文说明：测试局部值 [helpers]，由紧邻初始化决定。 */
    const [helpers] = makeNamespaces({ namespaces: [{ global: 'helpers', names: ['x'] }] }, deniedPort, deniedPending, { value: 1 }) as [Record<string, (args: unknown) => Promise<unknown>>]
    /** 中文说明：测试局部值 denied，由紧邻初始化决定。 */
    const denied = await rejectionOf(helpers.x?.({}) ?? Promise.resolve())
    expect(denied).toBeInstanceOf(Error)
    expect(denied).toMatchObject({ name: 'Error', message: 'helper denied' })
    expect(denied).not.toHaveProperty('toolName')

    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = await rejectionOf(helpers.x?.(() => 1) ?? Promise.resolve())
    expect(invalid).toBeInstanceOf(Error)
    expect((invalid as Error).message).toBe('binding arguments must be lossless JSON')

    /** 中文说明：测试局部值 clonePort，由紧邻初始化决定。 */
    const clonePort: BootstrapPort = { postMessage: () => { throw new Error('clone failed') }, on: () => {} }
    /** 中文说明：测试局部值 [cloneHelpers]，由紧邻初始化决定。 */
    const [cloneHelpers] = makeNamespaces({ namespaces: [{ global: 'helpers', names: ['x'] }] }, clonePort, new Map(), { value: 1 }) as [Record<string, (args: unknown) => Promise<unknown>>]
    /** 中文说明：测试局部值 cloneFailure，由紧邻初始化决定。 */
    const cloneFailure = await rejectionOf(cloneHelpers.x?.({}) ?? Promise.resolve())
    expect(cloneFailure).toBeInstanceOf(Error)
    expect(cloneFailure).not.toHaveProperty('toolName')
  })
})

describe('runWorkerMain', () => {
  it('runs a program end-to-end: bindings, console, return value', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    port.respond = (message) => {
      if (message.type !== 'call') return undefined
      /** 中文说明：测试局部值 args，由紧邻初始化决定。 */
      const args = decodeWorkerJson(message.args) as { n: number }
      return { type: 'reply', id: message.id, ok: true, value: encodeWorkerJson(args.n * 2) }
    }
    await runWorkerMain(port, {
      ...BOOT,
      code: 'const doubled = await tools.double({ n: 21 }); console.log("got", doubled); return { doubled };',
      namespaces: [{ global: 'tools', names: ['double'] }],
    }, fakeStreams())
    expect(port.logs()).toEqual(['got 42'])
    expect(port.doneValue()).toEqual({ doubled: 42 })
  })

  it('reports worker-side log capture overflow before completing', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    await runWorkerMain(port, {
      maxOutputBytes: 4,
      code: 'console.log("12345"); return null',
      namespaces: [],
    }, fakeStreams())
    expect(port.logs()).toEqual([])
    expect(port.sent).toContainEqual({ type: 'output-limit' })
    expect(port.done()).toEqual({
      type: 'done',
      error: { kind: 'output-limit', message: 'outer output exceeded 4 bytes' },
    })
  })

  it('reports a thrown program error on the done message', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    await runWorkerMain(port, { ...BOOT, code: 'throw new Error("boom")', namespaces: [] }, fakeStreams())
    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = port.done()
    expect(done?.type).toBe('done')
    expect(done?.type === 'done' ? done.error?.kind : undefined).toBe('exception')
    expect(done?.type === 'done' ? done.error?.message : undefined).toContain('boom')
    expect(done?.type === 'done' ? done.value : undefined).toBeUndefined()
  })

  it('renders non-Error throws and stack-less Errors on the done message', async () => {
    /** 中文说明：测试局部值 rawPort，由紧邻初始化决定。 */
    const rawPort = new FakePort()
    await runWorkerMain(rawPort, { ...BOOT, code: 'throw "raw-throw"', namespaces: [] }, fakeStreams())
    expect(rawPort.done()).toEqual({ type: 'done', error: { kind: 'exception', message: 'raw-throw' } })

    /** 中文说明：测试局部值 barePort，由紧邻初始化决定。 */
    const barePort = new FakePort()
    await runWorkerMain(barePort, { ...BOOT, code: 'const e = new Error("bare"); e.stack = undefined; throw e', namespaces: [] }, fakeStreams())
    expect(barePort.done()).toEqual({ type: 'done', error: { kind: 'exception', message: 'bare' } })
  })

  it('replaces giant thrown strings and Error stacks before posting the done message', async () => {
    /** 中文说明：测试局部值 rawPort，由紧邻初始化决定。 */
    const rawPort = new FakePort()
    await runWorkerMain(rawPort, {
      maxOutputBytes: 64,
      code: 'throw "x".repeat(1_000_000)',
      namespaces: [],
    }, fakeStreams())
    expect(rawPort.done()).toEqual({
      type: 'done',
      error: { kind: 'output-limit', message: 'outer output exceeded 64 bytes' },
    })

    /** 中文说明：测试局部值 stackPort，由紧邻初始化决定。 */
    const stackPort = new FakePort()
    await runWorkerMain(stackPort, {
      maxOutputBytes: 64,
      code: 'throw new Error("x".repeat(1_000_000))',
      namespaces: [],
    }, fakeStreams())
    expect(stackPort.done()).toEqual({
      type: 'done',
      error: { kind: 'output-limit', message: 'outer output exceeded 64 bytes' },
    })
  })

  it('surfaces a host failure reply as a program-side rejection it can catch', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    port.respond = message => message.type === 'call' ? { type: 'reply', id: message.id, ok: false, message: 'denied by host' } : undefined
    await runWorkerMain(port, {
      ...BOOT,
      code: 'try { await tools.x({}) } catch (error) { return { caught: error instanceof ToolCallError, name: error.name, toolName: error.toolName, message: error.message } }',
      namespaces: [toolNamespace(['x'])],
    }, fakeStreams())
    expect(port.doneValue()).toEqual({ caught: true, name: 'ToolCallError', toolName: 'x', message: 'denied by host' })
  })

  it('materializes a consumer-declared rejection class without knowing the namespace', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    port.respond = message => message.type === 'call'
      ? { type: 'reply', id: message.id, ok: false, message: 'helper denied' }
      : undefined
    await runWorkerMain(port, {
      ...BOOT,
      code: 'try { await helpers.x({}) } catch (error) { return { caught: error instanceof HelperCallError, name: error.name, helperName: error.helperName, message: error.message } }',
      namespaces: [{
        global: 'helpers',
        names: ['x'],
        errorClass: { name: 'HelperCallError', memberNameProperty: 'helperName' },
      }],
    }, fakeStreams())
    expect(port.doneValue()).toEqual({ caught: true, name: 'HelperCallError', helperName: 'x', message: 'helper denied' })
  })

  it('ignores replies for unknown pending ids', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    port.respond = (message) => {
      if (message.type !== 'call') return undefined
      // Deliver a stray reply first; the real one follows.
      port.deliver({ type: 'reply', id: 9_999, ok: true, value: encodeWorkerJson('stray') })
      return { type: 'reply', id: message.id, ok: true, value: encodeWorkerJson('real') }
    }
    await runWorkerMain(port, {
      ...BOOT,
      code: 'return await tools.x({})',
      namespaces: [{ global: 'tools', names: ['x'] }],
    }, fakeStreams())
    expect(port.doneValue()).toBe('real')
  })

  it('captures raw stream writes through the patched process streams', async () => {
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = new FakePort()
    /** 中文说明：测试局部值 streams，由紧邻初始化决定。 */
    const streams = fakeStreams()
    await runWorkerMain(port, { ...BOOT, code: 'return 1', namespaces: [] }, streams)
    streams.stdout.write('never seen — already restored? no: patch persists in worker')
    // The patch stays installed for the worker's lifetime; writes during the
    // program landed in order. Here the program wrote nothing via streams, so
    // only the post-run write above went through the patched slot.
    expect(port.logs().at(-1)).toBe('never seen — already restored? no: patch persists in worker')
  })
})
