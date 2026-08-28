/**
 * A scriptable fake LSP server over stdio for lsp-stdio tests. It speaks the real
 * `Content-Length`-framed base protocol so it exercises the client's framing, initialize handshake,
 * transient open/close, request mapping, and teardown — without a real language server.
 *
 * Behavior is driven by env vars so one file backs many scenarios:
 * - LSP_FAKE_ENCODING: advertised positionEncoding (default utf-16; "utf-8" forces a mismatch).
 * - LSP_FAKE_SYNC: textDocumentSync value as JSON (default 1/Full).
 * - LSP_FAKE_CAPS: JSON of extra capability flags merged into the defaults.
 * - LSP_FAKE_DEF / LSP_FAKE_REFS / LSP_FAKE_IMPL / LSP_FAKE_HOVER: JSON result per request.
 * - LSP_FAKE_HANG: "1" makes textDocument/* requests never respond (for abort/timeout tests).
 * - LSP_FAKE_CRASH_ON_OPEN: "1" exits the process when a didOpen arrives (crash test).
 * - LSP_FAKE_EXIT_AFTER_REPLY: "1" exits the process right after answering a textDocument/* request,
 *   simulating a server that dies while idle so the pool holds a dead instance (eviction test).
 * - LSP_FAKE_REPLY_DELAY_MS: delays each textDocument/* response by this many milliseconds.
 * - LSP_FAKE_OPEN_MARKER: appends each didOpen document text as one JSON line to this path.
 * - LSP_FAKE_INITIALIZED_MARKER: records when the initialized notification is received.
 * - LSP_FAKE_PAUSE_STDIN_AFTER_INITIALIZED: "1" stops consuming stdin after initialized.
 * - LSP_FAKE_EXIT_DELAY_MS / LSP_FAKE_EXIT_MARKER: delay protocol exit and record exit/termination.
 * - LSP_FAKE_NO_SHUTDOWN: "1" ignores the shutdown request (forces kill escalation).
 * - LSP_FAKE_ON_OPEN: server→client request to emit when a didOpen arrives, one of
 *   "configuration" | "applyEdit" | "notification" | "unknown"; the reply is logged to stderr.
 * - LSP_FAKE_ERROR: "1" answers textDocument/* requests with a JSON-RPC error response.
 * - LSP_FAKE_GARBAGE: "1" emits an unframed garbage byte before the initialize reply.
 *
 * Run: node fixture-server.ts (Node's erasable TypeScript syntax support).
 */
/*
 * 文件职责：验证 fixture-server.ts 覆盖的 LSP 标准输入输出连接、消息分帧与进程协作行为。
 * 技术维度：使用 TypeScript、Vitest、JSON-RPC/LSP 帧协议、Node.js 流和可控子进程测试。
 * 产品维度：保障语言服务器能够稳定启动、收发消息，并为 Agent 提供代码理解能力。
 * 逻辑维度：准备流或测试服务器，建立连接，发送协议消息，再核对响应、错误与资源清理。
 * 关键边界：帧长度必须与字节一致；进程和流可能提前结束；测试完成后必须释放所有句柄。
 * 新手阅读建议：先理解 Content-Length 分帧，再看连接生命周期，最后阅读异常与构建产物测试。
 */

import { appendFileSync } from 'node:fs'

/** 中文说明：变量 enc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const enc = process.env.LSP_FAKE_ENCODING ?? 'utf-16'
/** 中文说明：变量 sync 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const sync: unknown = process.env.LSP_FAKE_SYNC !== undefined ? JSON.parse(process.env.LSP_FAKE_SYNC) : 1
/** 中文说明：变量 extraCaps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const extraCaps: unknown = process.env.LSP_FAKE_CAPS !== undefined ? JSON.parse(process.env.LSP_FAKE_CAPS) : {}
/** 中文说明：变量 hang 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hang = process.env.LSP_FAKE_HANG === '1'
/** 中文说明：变量 crashOnOpen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const crashOnOpen = process.env.LSP_FAKE_CRASH_ON_OPEN === '1'
/** 中文说明：变量 exitAfterReply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const exitAfterReply = process.env.LSP_FAKE_EXIT_AFTER_REPLY === '1'
/** 中文说明：变量 replyDelayMs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const replyDelayMs = Number(process.env.LSP_FAKE_REPLY_DELAY_MS ?? 0)
/** 中文说明：变量 openMarker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const openMarker = process.env.LSP_FAKE_OPEN_MARKER
/** 中文说明：变量 initializedMarker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const initializedMarker = process.env.LSP_FAKE_INITIALIZED_MARKER
/** 中文说明：变量 pauseStdinAfterInitialized 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const pauseStdinAfterInitialized = process.env.LSP_FAKE_PAUSE_STDIN_AFTER_INITIALIZED === '1'
/** 中文说明：变量 exitDelayMs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const exitDelayMs = Number(process.env.LSP_FAKE_EXIT_DELAY_MS ?? 0)
/** 中文说明：变量 exitMarker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const exitMarker = process.env.LSP_FAKE_EXIT_MARKER
/** 中文说明：变量 noShutdown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const noShutdown = process.env.LSP_FAKE_NO_SHUTDOWN === '1'
/** 中文说明：变量 onOpen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const onOpen = process.env.LSP_FAKE_ON_OPEN
/** 中文说明：变量 errorReply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const errorReply = process.env.LSP_FAKE_ERROR === '1'
/** 中文说明：变量 garbage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const garbage = process.env.LSP_FAKE_GARBAGE === '1'

/** 中文说明：变量 serverRequestId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let serverRequestId = 10_000
/** 中文说明：变量 pendingServerRequests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const pendingServerRequests = new Map<number, string>()

process.on('SIGTERM', () => {
  markExit('TERM')
  process.exit(0)
})

/** 中文说明：函数 resultFor 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function resultFor(method: string): unknown {
  switch (method) {
    case 'textDocument/definition': return envJson('LSP_FAKE_DEF', null)
    case 'textDocument/references': return envJson('LSP_FAKE_REFS', null)
    case 'textDocument/implementation': return envJson('LSP_FAKE_IMPL', null)
    case 'textDocument/hover': {
      // LSP_FAKE_ECHO_ENV names a variable whose VALUE becomes the hover
      // contents — a test can assert exactly what env reached this process.
      /** 中文说明：变量 echoName 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const echoName = process.env.LSP_FAKE_ECHO_ENV
      if (echoName !== undefined) return { contents: process.env[echoName] ?? `<${echoName} unset>` }
      return envJson('LSP_FAKE_HOVER', null)
    }
    default: return null
  }
}

/** 中文说明：函数 envJson 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function envJson(name: string, fallback: unknown): unknown {
  /** 中文说明：变量 raw 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env[name]
  return raw === undefined ? fallback : JSON.parse(raw)
}

/** 中文说明：变量 buffer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
  for (;;) {
    /** 中文说明：变量 sep 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sep = buffer.indexOf('\r\n\r\n')
    if (sep < 0) break
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = buffer.toString('ascii', 0, sep)
    /** 中文说明：变量 match 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (!match) { buffer = buffer.subarray(sep + 4); continue }
    /** 中文说明：变量 length 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const length = Number(match[1])
    /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const start = sep + 4
    if (buffer.length < start + length) break
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = buffer.toString('utf8', start, start + length)
    buffer = buffer.subarray(start + length)
    handle(JSON.parse(body) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown })
  }
})

/** 中文说明：函数 handle 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function handle(message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }): void {
  const { id, method } = message
  // A frame with an id but no method is the client's REPLY to a server→client request; log it.
  if (method === undefined && id !== undefined && pendingServerRequests.has(id)) {
    /** 中文说明：变量 kind 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const kind = pendingServerRequests.get(id)
    pendingServerRequests.delete(id)
    process.stderr.write(`REPLY ${kind} ${JSON.stringify({ result: message.result, error: message.error })}\n`)
    return
  }
  if (method === 'initialize') {
    if (garbage) process.stdout.write('this is not a framed message\r\n')
    send({
      id,
      result: {
        capabilities: {
          positionEncoding: enc,
          textDocumentSync: sync,
          definitionProvider: true,
          referencesProvider: true,
          implementationProvider: true,
          hoverProvider: true,
          ...(extraCaps as Record<string, unknown>),
        },
      },
    })
    return
  }
  if (method === 'shutdown') {
    if (noShutdown) return
    send({ id, result: null })
    return
  }
  if (method === 'exit') {
    markExit('EXIT')
    if (exitDelayMs > 0) {
      setTimeout(() => {
        markExit('CLEAN')
        process.exit(0)
      }, exitDelayMs)
      return
    }
    markExit('CLEAN')
    process.exit(0)
  }
  if (method === 'textDocument/didOpen') {
    if (crashOnOpen) process.exit(1)
    if (openMarker !== undefined) {
      /** 中文说明：变量 params 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const params = message.params as { textDocument?: { text?: unknown } } | undefined
      appendFileSync(openMarker, `${JSON.stringify(params?.textDocument?.text)}\n`)
    }
    if (onOpen !== undefined) emitServerRequest(onOpen)
    return
  }
  if (method === 'initialized') {
    if (initializedMarker !== undefined) appendFileSync(initializedMarker, 'INITIALIZED\n')
    if (pauseStdinAfterInitialized) process.stdin.pause()
    return
  }
  if (method === 'textDocument/didClose') return
  if (method?.startsWith('textDocument/')) {
    if (hang) return
    /** 中文说明：函数值 reply 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reply = (): void => {
      if (errorReply) {
        send({ id, error: { code: -32000, message: 'server refused the request' } })
      } else {
        send({ id, result: resultFor(method) })
      }
      // Simulate an idle death: answer this request, then exit before the next one arrives so the
      // pool is left holding a dead instance.
      if (exitAfterReply) setTimeout(() => process.exit(0), 20)
    }
    if (replyDelayMs > 0) setTimeout(reply, replyDelayMs)
    else reply()
    return
  }
  // Unknown request with an id: answer null so the client never stalls.
  if (id !== undefined) send({ id, result: null })
}

/** Append one teardown event when the fixture is configured to expose process ordering. */
/* 中文说明：函数 markExit 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function markExit(event: string): void {
  if (exitMarker !== undefined) appendFileSync(exitMarker, `${event}\n`)
}

/** Emit a server→client request and log the client's reply to stderr for the test to assert. */
/* 中文说明：函数 emitServerRequest 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function emitServerRequest(kind: string): void {
  if (kind === 'notification') {
    send({ method: 'window/logMessage', params: { type: 3, message: 'hello' } })
    return
  }
  /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = serverRequestId++
  /** 中文说明：变量 method 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const method = kind === 'configuration'
    ? 'workspace/configuration'
    : kind === 'applyEdit'
      ? 'workspace/applyEdit'
      : kind === 'lifecycle'
        ? 'client/registerCapability'
        : 'window/showMessageRequest'
  /** 中文说明：变量 params 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const params = kind === 'configuration' ? { items: [{ section: 'a' }, { section: 'b' }] } : {}
  pendingServerRequests.set(id, method)
  send({ id, method, params })
}

/** 中文说明：函数 send 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function send(message: Record<string, unknown>): void {
  /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8')
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]))
}

process.stdin.resume()
if (pauseStdinAfterInitialized) {
  setInterval(() => {}, 1000)
}
