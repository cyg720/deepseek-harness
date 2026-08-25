/**
 * 文件职责：验证 transport.spec.ts 覆盖的SDK 传输行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的SDK 传输能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { once } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { JsonRpcLineTransport, JsonRpcResponseError } from '../src/index.ts'

/** 中文说明：函数 transportPair 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function transportPair() {
  /** 中文说明：变量 aToB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const aToB = new PassThrough()
  /** 中文说明：变量 bToA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bToA = new PassThrough()
  /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const a = new JsonRpcLineTransport(bToA, aToB)
  /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const b = new JsonRpcLineTransport(aToB, bToA)
  return { a, b, aToB, bToA }
}

describe('JsonRpcLineTransport', () => {
  it('supports bidirectional requests and notifications over newline-delimited JSON-RPC', async () => {
    const { a, b } = transportPair()
    /** 中文说明：变量 notifications 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notifications: Record<string, unknown>[] = []

    a.onRequest(async (method, params) => {
      expect(method).toBe('echo')
      return { echoed: params }
    })
    b.onNotification((method, params) => {
      notifications.push({ method, params })
    })
    a.start()
    b.start()

    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = await b.request('echo', { value: 42 })
    expect(response).toEqual({ echoed: { value: 42 } })

    a.notify('session.status', { sessionId: 'main', status: 'idle' })
    a.notify('heartbeat')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notifications).toEqual([
      { method: 'session.status', params: { sessionId: 'main', status: 'idle' } },
      { method: 'heartbeat', params: {} },
    ])

    a.close()
    b.close()
  })

  it('reports JSON-RPC request errors from the remote peer with their wire code', async () => {
    const { a, b } = transportPair()
    a.onRequest(async () => {
      throw new Error('handler boom')
    })
    a.start()
    b.start()

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = await b.request('explode', {}).then(
      () => { throw new Error('request unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(JsonRpcResponseError)
    expect(failure).toMatchObject({ message: 'handler boom', code: -32603, data: undefined })

    a.close()
    b.close()
  })

  it('rejects immediately on a pre-aborted signal without registering pending state', async () => {
    const { b } = transportPair()
    b.start()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort(new Error('already gone'))
    await expect(b.request('never-sent', {}, controller.signal)).rejects.toThrow('already gone')
    expect((b as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0)
    b.close()
  })

  it('abandons a pending request on abort, stringifying a non-Error reason', async () => {
    const { b } = transportPair()
    b.start()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = b.request('never-answered', {}, controller.signal)
    controller.abort('plain-string-reason')
    await expect(pending).rejects.toThrow('JSON-RPC request aborted: plain-string-reason')
    // The abandonment removed the pending entry — nothing is retained for a
    // response that may never come.
    expect((b as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0)
    b.close()
  })

  it('preserves structured error data from an error response frame', async () => {
    const { aToB, bToA, b } = transportPair()
    b.start()

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = b.request('remote-error-data', {})
    /** 中文说明：变量 requestChunk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requestChunk = (await once(bToA, 'data'))[0] as Buffer | string
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request = JSON.parse(String(requestChunk)) as { id: string }
    aToB.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: 7, message: 'structured', data: { detail: 'x' } } })}\n`)

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = await pending.then(
      () => { throw new Error('request unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(JsonRpcResponseError)
    expect(failure).toMatchObject({ code: 7, message: 'structured', data: { detail: 'x' } })

    b.close()
  })

  it('stringifies non-Error request handler failures', async () => {
    const { a, b } = transportPair()
    a.onRequest(async () => {
      throw 'string boom'
    })
    a.start()
    b.start()

    await expect(b.request('explode-string', {})).rejects.toThrow('string boom')

    a.close()
    b.close()
  })

  it('reports method-not-found when no request handler is installed', async () => {
    const { a, b } = transportPair()
    a.start()
    b.start()

    await expect(b.request('missing', {})).rejects.toThrow('method not found: missing')

    a.close()
    b.close()
  })

  it('normalizes non-object request params and ignores notifications without a handler', async () => {
    const { aToB, bToA, b } = transportPair()
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: Record<string, unknown>[] = []
    b.onRequest(async (method, params) => {
      seen.push({ method, params })
      return { ok: true }
    })
    b.start()

    aToB.write('{"jsonrpc":"2.0","method":"ignored"}\n')
    aToB.write('{"jsonrpc":"2.0","id":7,"method":"array-params","params":[]}\n')
    /** 中文说明：变量 chunk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunk = (await once(bToA, 'data'))[0] as Buffer | string

    expect(seen).toEqual([{ method: 'array-params', params: {} }])
    expect(JSON.parse(String(chunk))).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } })
    b.close()
  })

  it('ignores malformed frames and accepts notifications without params', async () => {
    const { aToB, b } = transportPair()
    /** 中文说明：变量 notifications 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notifications: Record<string, unknown>[] = []
    b.onNotification((method, params) => {
      notifications.push({ method, params })
    })
    b.start()
    b.start()

    aToB.write('not json\n')
    aToB.write('\n')
    aToB.write('null\n')
    aToB.write('{"jsonrpc":"2.0","params":{}}\n')
    aToB.write('{"jsonrpc":"2.0","method":"tick"}\n')
    aToB.emit('data', '{"jsonrpc":"2.0","method":"string-chunk"}\n')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(notifications).toEqual([
      { method: 'tick', params: {} },
      { method: 'string-chunk', params: {} },
    ])
    b.close()
  })

  it('preserves multibyte UTF-8 characters split across Buffer chunks', async () => {
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = new PassThrough()
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = new PassThrough()
    /** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transport = new JsonRpcLineTransport(input, output)
    /** 中文说明：变量 notifications 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notifications: Record<string, unknown>[] = []
    transport.onNotification((method, params) => { notifications.push({ method, params }) })
    transport.start()

    /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frame = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'message', params: { text: '你好' } })}\n`)
    /** 中文说明：变量 character 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const character = Buffer.from('你')
    /** 中文说明：变量 characterStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const characterStart = frame.indexOf(character)
    expect(characterStart).toBeGreaterThanOrEqual(0)
    input.write(frame.subarray(0, characterStart + 1))
    input.write(frame.subarray(characterStart + 1))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(notifications).toEqual([{ method: 'message', params: { text: '你好' } }])
    transport.close()
  })

  it('flush waits for all earlier output writes', async () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: string[] = []
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        /** 中文说明：变量 label 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const label = chunk.length === 0 ? 'barrier' : 'frame'
        events.push(`start:${label}`)
        setTimeout(() => {
          events.push(`finish:${label}`)
          callback()
        }, 5)
      },
    })
    /** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transport = new JsonRpcLineTransport(new PassThrough(), output)

    transport.notify('tick')
    await transport.flush()

    expect(events).toEqual([
      'start:frame',
      'finish:frame',
      'start:barrier',
      'finish:barrier',
    ])
    transport.close()
  })

  it('reports an output callback failure from flush', async () => {
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = {
      write(_chunk: string, callback?: (error?: Error) => void) {
        callback?.(new Error('flush failed'))
        return true
      },
    }
    /** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transport = new JsonRpcLineTransport(new PassThrough(), output as never)

    await expect(transport.flush()).rejects.toThrow('flush failed')
  })

  it('rejects pending requests when the input closes', async () => {
    const { aToB, b } = transportPair()
    b.start()

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = b.request('never-replies', {})
    aToB.end()

    await expect(pending).rejects.toThrow('JSON-RPC input closed')
    b.close()
  })

  it('rejects pending requests when the input errors', async () => {
    const { aToB, b } = transportPair()
    b.start()

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = b.request('never-replies', {})
    aToB.emit('error', new Error('input broke'))

    await expect(pending).rejects.toThrow('input broke')
    b.close()
  })

  it('rejects pending requests when the transport closes', async () => {
    const { b } = transportPair()

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = b.request('never-replies', {})
    b.close()

    await expect(pending).rejects.toThrow('JSON-RPC transport closed')
  })

  it('rejects a request when writing the frame throws', async () => {
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = new PassThrough()
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = {
      write() {
        throw new Error('write exploded')
      },
    }
    /** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transport = new JsonRpcLineTransport(input, output as never)

    await expect(transport.request('write-fails', {})).rejects.toThrow('write exploded')
  })

  it('stringifies non-Error write failures', async () => {
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = new PassThrough()
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = {
      write() {
        throw 'write string'
      },
    }
    /** 中文说明：变量 transport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transport = new JsonRpcLineTransport(input, output as never)

    await expect(transport.request('write-fails', {})).rejects.toThrow('write string')
  })

  it('uses a fallback message for malformed JSON-RPC error responses', async () => {
    const { aToB, bToA, b } = transportPair()
    b.start()

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = b.request('remote-error', {})
    /** 中文说明：变量 requestChunk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requestChunk = (await once(bToA, 'data'))[0] as Buffer | string
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request = JSON.parse(String(requestChunk)) as { id: string }
    aToB.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: {} })}\n`)

    await expect(pending).rejects.toThrow('JSON-RPC error')
    b.close()
  })

  it('ignores responses that do not match a pending request', async () => {
    const { aToB, b } = transportPair()
    b.start()

    aToB.write('{"jsonrpc":"2.0","id":"unknown","result":{"ignored":true}}\n')
    await new Promise(resolve => setTimeout(resolve, 10))

    b.close()
  })
})
