/*
 * ================================ 文件注释 ================================
 * 【文件职责】LSP 基础协议的帧（framing）编解码：把 JSON-RPC 消息编码为 Content-Length 定界的字节流，并把服务器 stdout 的字节流解码回完整消息。
 * 【技术维度】LSP 基础协议采用"Content-Length: N\r\n\r\n + UTF-8 JSON 体"的帧格式；MessageDecoder
 *   内部用 Buffer 累积不完整数据，只解析 Content-Length 头并忽略其他头；头与消息体都有大小上限，
 *   防止恶意或损坏的服务器耗尽内存。
 * 【产品维度】语言服务器通过 stdin/stdout 与宿主通信：本文件是双方对话的"线路层"，保证消息不粘连、不截断、大小可控。
 * 【逻辑维度】encodeMessage（消息 → 帧缓冲）→ MessageDecoder 类（push 累积 → next 逐条解析）→ parseContentLength（解析头值）。
 * 【关键边界】只认 Content-Length 头；消息体超过 maxMessageBytes 直接报错；头区上限 64 KiB；所有解析失败抛 Error，由连接层转为致命关闭。
 * 【新手阅读建议】先看 encodeMessage 理解"一帧"的字节结构，再看 MessageDecoder.push/next 理解流式解析如何用状态机处理半包。
 * ==========================================================================
 */
/**
 * LSP base-protocol framing: `Content-Length`-delimited JSON-RPC over a byte stream. The encoder
 * produces one framed buffer; the decoder buffers incoming bytes and yields complete message bodies,
 * bounding the header and total message size so a hostile or broken server cannot exhaust memory.
 * @module @deepseek-ai/dsh-lsp-stdio/framing
 */

/** The header/body separator in the LSP base protocol. */
// 头与体的分隔符：LSP 基础协议用 CRLF CRLF（回车换行两次）分隔头部区与 JSON 消息体。
const HEADER_SEPARATOR = '\r\n\r\n'

/** Cap on the header section so a server that never sends the separator cannot grow the buffer forever. */
// 头部区字节上限（64 KiB）：防止服务器永远不发分隔符导致缓冲区无限增长。
const MAX_HEADER_BYTES = 1 << 16

/**
 * Encode one JSON-RPC message as a framed LSP buffer (`Content-Length: N\r\n\r\n<utf-8 json>`).
 * @param message - the JSON-RPC message object to serialize.
 * @returns the framed bytes ready to write to the server's stdin.
 */
// 把一个 JSON-RPC 消息编码为带 Content-Length 头的帧缓冲，可直接写入服务器 stdin。
export function encodeMessage(message: unknown): Buffer {
  // 消息体：JSON 序列化后的 UTF-8 字节。
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  // 头部：以字节数（而非字符数）声明消息体长度。
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, body])
}

/**
 * A streaming decoder for `Content-Length`-framed JSON-RPC. Feed it stdout chunks; it returns any
 * whole message bodies that completed. It parses only the `Content-Length` header and ignores other
 * headers (e.g. `Content-Type`), matching the base protocol.
 */
// 流式解码器：喂入 stdout 字节块，返回所有已完整到达的消息体。只解析 Content-Length 头，忽略其他头（如 Content-Type），与基础协议一致。
export class MessageDecoder {
  // 尚未解析完的累积字节（半包或跨块消息的中间态）。
  private buffer: Buffer = Buffer.alloc(0)
  // 单条消息体大小上限：超限直接抛错（内存防护）。
  private readonly maxMessageBytes: number

  /**
   * @param maxMessageBytes - reject any single framed body larger than this (guards memory).
   */
  constructor(maxMessageBytes: number) {
    this.maxMessageBytes = maxMessageBytes
  }

  /**
   * Append a chunk and return every message body that is now complete.
   * @param chunk - raw bytes from the server's stdout.
   * @returns the parsed JSON bodies, in arrival order (possibly empty).
   * @throws Error when a header is malformed or a body exceeds `maxMessageBytes`.
   */
  push(chunk: Buffer): unknown[] {
    // 累积到缓冲区（首块直接引用，后续拼接）。
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []
    // 循环解析，直到缓冲区里没有完整消息。
    for (;;) {
      const step = this.next()
      if (!step.ready) break
      messages.push(step.message)
    }
    return messages
  }

  /** Parse and consume the next complete message, or report that more bytes are needed. */
  // 解析并消费下一条完整消息；字节不足时报告"尚未就绪"。
  private next(): { ready: false } | { ready: true; message: unknown } {
    // 找头/体分隔符；找不到则可能还需更多字节，或头部区已超限。
    const separator = this.buffer.indexOf(HEADER_SEPARATOR)
    if (separator < 0) {
      if (this.buffer.length > MAX_HEADER_BYTES) {
        throw new Error(`LSP header exceeded ${MAX_HEADER_BYTES} bytes without a terminator`)
      }
      return { ready: false }
    }
    if (separator > MAX_HEADER_BYTES) {
      throw new Error(`LSP header exceeded ${MAX_HEADER_BYTES} bytes`)
    }
    // 解析头部区文本（ascii）中的 Content-Length 值。
    const headerText = this.buffer.toString('ascii', 0, separator)
    const contentLength = parseContentLength(headerText)
    // 超过上限直接拒绝，防止超大消息撑爆内存。
    if (contentLength > this.maxMessageBytes) {
      throw new Error(`LSP message length ${contentLength} exceeds the ${this.maxMessageBytes}-byte limit`)
    }
    const bodyStart = separator + HEADER_SEPARATOR.length
    const bodyEnd = bodyStart + contentLength
    // 消息体还没到齐：保留缓冲区等待后续块。
    if (this.buffer.length < bodyEnd) return { ready: false }
    // 取消息体并从缓冲区消费掉整帧。
    const body = this.buffer.toString('utf8', bodyStart, bodyEnd)
    this.buffer = this.buffer.subarray(bodyEnd)
    try {
      return { ready: true, message: JSON.parse(body) }
    } catch (error) {
      /* v8 ignore next -- JSON.parse throws a SyntaxError (an Error); the String() fallback is defensive. */
      throw new Error(`LSP message body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Read the `Content-Length` header value (case-insensitive), rejecting a missing or non-numeric one. */
// 读取 Content-Length 头值（大小写不敏感）；缺失或非数字时抛错。
function parseContentLength(headerText: string): number {
  // 按行扫描头部区，找到 Content-Length 行。
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue
    // 校验值必须是非负整数。
    const value = Number(line.slice(colon + 1).trim())
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid Content-Length header: ${JSON.stringify(line)}`)
    }
    return value
  }
  throw new Error(`LSP header block missing Content-Length: ${JSON.stringify(headerText)}`)
}
