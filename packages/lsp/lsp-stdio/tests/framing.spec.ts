/**
 * 文件职责：验证 framing.spec.ts 覆盖的 LSP 标准输入输出连接、消息分帧与进程协作行为。
 * 技术维度：使用 TypeScript、Vitest、JSON-RPC/LSP 帧协议、Node.js 流和可控子进程测试。
 * 产品维度：保障语言服务器能够稳定启动、收发消息，并为 Agent 提供代码理解能力。
 * 逻辑维度：准备流或测试服务器，建立连接，发送协议消息，再核对响应、错误与资源清理。
 * 关键边界：帧长度必须与字节一致；进程和流可能提前结束；测试完成后必须释放所有句柄。
 * 新手阅读建议：先理解 Content-Length 分帧，再看连接生命周期，最后阅读异常与构建产物测试。
 */
import { describe, expect, it } from 'vitest'
import { encodeMessage, MessageDecoder } from '@deepseek-ai/dsh-lsp-stdio'

/** Frame a message the way a server would, for decoder round-trips. */
/* 中文说明：函数 frame 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function frame(body: string): Buffer {
  return Buffer.concat([Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`, 'ascii'), Buffer.from(body, 'utf8')])
}

describe('encodeMessage', () => {
  it('prefixes a Content-Length header with the utf-8 byte length', () => {
    /** 中文说明：变量 buffer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const buffer = encodeMessage({ jsonrpc: '2.0', method: 'x', params: { s: 'é' } })
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = buffer.toString('utf8')
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = '{"jsonrpc":"2.0","method":"x","params":{"s":"é"}}'
    expect(text).toBe(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  })
})

describe('MessageDecoder', () => {
  it('decodes a single framed message', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    expect(decoder.push(frame('{"id":1,"result":42}'))).toEqual([{ id: 1, result: 42 }])
  })

  it('decodes multiple messages arriving in one chunk', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    /** 中文说明：变量 chunk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunk = Buffer.concat([frame('{"a":1}'), frame('{"b":2}')])
    expect(decoder.push(chunk)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('reassembles a message split across chunks', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    /** 中文说明：变量 full 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const full = frame('{"hello":"world"}')
    expect(decoder.push(full.subarray(0, 10))).toEqual([])
    expect(decoder.push(full.subarray(10))).toEqual([{ hello: 'world' }])
  })

  it('handles a header split from its body', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = '{"x":1}'
    expect(decoder.push(Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'))).toEqual([])
    expect(decoder.push(Buffer.from(body, 'utf8'))).toEqual([{ x: 1 }])
  })

  it('reads a case-insensitive header and ignores other headers', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = '{"ok":true}'
    /** 中文说明：变量 chunk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunk = Buffer.from(`content-length: ${body.length}\r\nContent-Type: x\r\n\r\n${body}`, 'utf8')
    expect(decoder.push(chunk)).toEqual([{ ok: true }])
  })

  it('rejects a body over the size limit', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(4)
    expect(() => decoder.push(frame('{"big":true}'))).toThrow(/exceeds the 4-byte limit/)
  })

  it('rejects a missing Content-Length header', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    expect(() => decoder.push(Buffer.from('X: 1\r\n\r\n{}', 'utf8'))).toThrow(/missing Content-Length/)
  })

  it('rejects a non-numeric Content-Length', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    expect(() => decoder.push(Buffer.from('Content-Length: abc\r\n\r\n{}', 'utf8'))).toThrow(/invalid Content-Length/)
  })

  it('rejects a header block that never terminates', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    /** 中文说明：变量 huge 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const huge = Buffer.alloc((1 << 16) + 1, 0x41)
    expect(() => decoder.push(huge)).toThrow(/exceeded .* bytes without a terminator/)
  })

  it('rejects an oversized header block that includes its terminator', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    /** 中文说明：变量 huge 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const huge = Buffer.from(`Content-Length: 2\r\nX-Fill: ${'a'.repeat(70_000)}\r\n\r\n{}`, 'ascii')
    expect(() => decoder.push(huge)).toThrow(/header exceeded .* bytes/)
  })

  it('rejects a non-JSON body', () => {
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = new MessageDecoder(1_000)
    expect(() => decoder.push(frame('not json'))).toThrow(/not valid JSON/)
  })
})
