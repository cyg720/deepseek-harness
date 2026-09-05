#!/usr/bin/env node
/*
 * 文件职责：验证 fake-runtime.ts 覆盖的 SDK 通信行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的 SDK 通信能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */
/**
 * Scripted stand-in for the DeepSeek Harness SDK runtime, driven entirely by
 * env vars — no model, no network, no harness imports. Speaks the runtime's
 * newline-delimited JSON-RPC protocol on stdio: answers `initialize`,
 * `session/prompt` (streaming scripted `session.event` notifications, then
 * `session.finished`, then the response), and `shutdown`.
 *
 * Script vocabulary (all optional):
 * - `FAKE_TEXT`: assistant text for each turn (default `hello from fake runtime`).
 * - `FAKE_STATUS`: the `session.finished` status (default `ok`).
 * - `FAKE_REASON_KIND`: the `session.finished` reason kind (default `completed`; `none` omits the reason).
 * - `FAKE_ABORT_REASON_KIND`: nested cause for an `aborted` turn (default `user`).
 * - `FAKE_SUBAGENT`: also emit a child session (subagent.started + child event + subagent.finished).
 * - `FAKE_ECHO_CWD`: prefix the assistant text with the process cwd.
 * - `FAKE_ECHO_ENV`: comma-separated env names to echo as `name=value` lines in the assistant text.
 * - `FAKE_MALFORMED`: `initialize` returns `{}` (no serverInfo); `prompt` returns `{}` (no accepted).
 * - `FAKE_MALFORMED_PROMPT`: `initialize` is normal; only `prompt` returns `{}` (no accepted).
 * - `FAKE_INIT_ERROR`: `initialize` answers a JSON-RPC error response with code 7.
 * - `FAKE_INIT_ERROR_ONCE_FILE`: fail `initialize` (code 7) only when this
 *   marker file does NOT exist yet, creating it — so the first runtime
 *   process fails the handshake and a respawned one succeeds (retry probe).
 * - `FAKE_ECHO_CWD_IN_INIT`: reply `serverInfo.version` = this process's cwd
 *   (wire-visible spawn-cwd probe).
 * - `FAKE_MALFORMED_EVENT`: the turn's `session.event` carries a number as
 *   the event; `FAKE_MALFORMED_MESSAGE`: assistant/message content is not an
 *   array; `FAKE_MESSAGE_WITHOUT_DATA`: assistant/message with no data
 *   member; `FAKE_MALFORMED_REASON`: the `turn/end` carries a bare reason
 *   (`1`), an aborted reason without its cause (`aborted`), an unknown abort
 *   cause (`abort-unknown`), a hook cause without its reason (`hook`), or no
 *   data member (`no-data`) for wire-validation probes.
 * - `FAKE_EMPTY_MESSAGE`: record an empty assistant/message whose embedded
 *   stream contains only usage and max-tokens settlement.
 * - `FAKE_HANG_INIT`: never answer `initialize` (mid-handshake cancel probe).
 * - `FAKE_INIT_READY` + `FAKE_INIT_GO`: touch the READY file when `initialize`
 *   arrives, then poll for the GO file before answering (deterministic
 *   cancel-during-handshake window).
 * - `FAKE_HANG_PROMPT`: never answer `session/prompt` (for timeout/dispose tests).
 * - `FAKE_EXIT_DURING_PROMPT`: commit one interrupted assistant message, then
 *   exit 17 while the owned session run is waiting for its terminal state.
 * - `FAKE_STREAM_THEN_MALFORMED`: commit a partial assistant attempt for the
 *   prompt, then answer `{}` (no accepted) — same-pipe ordering makes the
 *   attempt arrive before the protocol failure (partial-output retention probe).
 * - `FAKE_IGNORE_EOF` + `FAKE_SIGTERM_FILE`: keep running after stdin EOF; touch the file on SIGTERM (ladder probe).
 * - `FAKE_TRAP_SIGTERM`: with `FAKE_IGNORE_EOF`, survive SIGTERM too (SIGKILL-rung probe).
 * - `FAKE_EXIT_BEFORE_INIT`: exit 3 immediately (spawn-then-die probe).
 * - `FAKE_STDERR`: write this line to stderr at boot (diagnostics-tail probe).
 * - `FAKE_STDERR_NO_NEWLINE`: write this to stderr WITHOUT a newline (buffer-flush probe).
 * - `FAKE_RECORD_INIT`: append each `initialize` params JSON to this file (handshake probe).
 */

import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline'

/** 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const env = process.env

if (env.FAKE_STDERR !== undefined) process.stderr.write(`${env.FAKE_STDERR}\n`)
if (env.FAKE_STDERR_NO_NEWLINE !== undefined) process.stderr.write(env.FAKE_STDERR_NO_NEWLINE)
if (env.FAKE_EXIT_BEFORE_INIT !== undefined) process.exit(3)

if (env.FAKE_IGNORE_EOF !== undefined) {
  // Simulate a runtime that never quiesces from EOF so the dispose ladder
  // must escalate; record which rung fired.
  process.stdin.resume()
  process.stdin.on('end', () => { setInterval(() => {}, 1_000) })
  process.on('SIGTERM', () => {
    if (env.FAKE_SIGTERM_FILE !== undefined) writeFileSync(env.FAKE_SIGTERM_FILE, 'sigterm\n')
    if (env.FAKE_TRAP_SIGTERM === undefined) process.exit(0)
  })
}

/** 中文说明：函数 write 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function write(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

/** 中文说明：函数 notify 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function notify(method: string, params: object): void {
  write({ jsonrpc: '2.0', method, params })
}

/** 中文说明：变量 seq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let seq = 0
/** 中文说明：函数 event 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function event(sessionId: string, type: string, data: object): void {
  notify('session.event', { sessionId, event: { type, seq: seq++, time: 0, data } })
}

/** 中文说明：函数 assistantText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function assistantText(): string {
  /** 中文说明：变量 parts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parts: string[] = []
  if (env.FAKE_ECHO_CWD !== undefined) parts.push(`cwd=${process.cwd()}`)
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const name of (env.FAKE_ECHO_ENV ?? '').split(',').filter(entry => entry.length > 0)) {
    parts.push(`${name}=${env[name] ?? ''}`)
  }
  parts.push(env.FAKE_TEXT ?? 'hello from fake runtime')
  return parts.join('\n')
}

function textStream(text: string): object[] {
  return [
    { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [text] },
    { type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block: { type: 'text', text } } },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
}

function usageOnlyStream(): object[] {
  return [
    {
      type: 'chunk',
      time: 0,
      chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
    },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'max-tokens' } } },
  ]
}

function runTurn(sessionId: string): void {
  /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = assistantText()
  if (env.FAKE_MALFORMED_EVENT !== undefined) {
    notify('session.event', { sessionId, event: 42 })
    return
  }
  event(sessionId, 'turn/start', { turn: 0 })
  if (env.FAKE_MALFORMED_MESSAGE !== undefined) {
    event(sessionId, 'assistant/attempt', {
      turn: 0,
      step: 0,
      stream: textStream(text),
    })
    event(sessionId, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'fake-malformed-message',
        role: 'assistant',
        content: 'not-an-array',
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
      stream: textStream(text),
    })
    return
  }
  if (env.FAKE_MESSAGE_WITHOUT_DATA !== undefined) {
    notify('session.event', { sessionId, event: { type: 'assistant/message', seq: seq++, time: 0 } })
    return
  }
  if (env.FAKE_EMPTY_MESSAGE !== undefined) {
    event(sessionId, 'assistant/attempt', {
      turn: 0,
      step: 0,
      stream: textStream(text),
    })
  }
  event(sessionId, 'assistant/message', {
    turn: 0,
    step: 0,
    message: {
      id: `fake-assistant-${seq}`,
      role: 'assistant',
      // Model the usage-only message recorded after a max-tokens step that
      // assembled no output blocks.
      content: env.FAKE_EMPTY_MESSAGE !== undefined ? [] : [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fake', model: 'fake' },
    },
    stream: env.FAKE_EMPTY_MESSAGE !== undefined ? usageOnlyStream() : textStream(text),
  })
  /** 中文说明：变量 reasonKind 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reasonKind = env.FAKE_REASON_KIND ?? 'completed'
  if (reasonKind !== 'none') {
    if (env.FAKE_MALFORMED_REASON === 'no-data') {
      notify('session.event', { sessionId, event: { type: 'turn/end', seq: seq++, time: 0 } })
      return
    }
    const reason = env.FAKE_MALFORMED_REASON === 'aborted'
      ? { kind: 'aborted' }
      : env.FAKE_MALFORMED_REASON === 'abort-unknown'
        ? { kind: 'aborted', reason: { kind: 'future' } }
        : env.FAKE_MALFORMED_REASON === 'hook'
          ? { kind: 'aborted', reason: { kind: 'hook' } }
          : env.FAKE_MALFORMED_REASON !== undefined
            ? 'not-a-reason-envelope'
            : reasonKind === 'aborted'
              ? {
                kind: 'aborted',
                reason: env.FAKE_ABORT_REASON_KIND === 'hook'
                  ? { kind: 'hook', reason: 'scripted hook abort' }
                  : { kind: env.FAKE_ABORT_REASON_KIND ?? 'user' },
              }
              : reasonKind === 'error'
                ? { kind: 'error', error: { message: 'scripted child error', code: 'UNKNOWN' } }
                : { kind: reasonKind }
    event(sessionId, 'turn/end', { turn: 0, reason })
  }
  if (env.FAKE_SUBAGENT !== undefined) {
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = `${sessionId}-child`
    notify('subagent.started', { parentSessionId: sessionId, childSessionId: childId })
    event(childId, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: `fake-child-${seq}`,
        role: 'assistant',
        content: [{ type: 'text', text: 'child says hi' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
      stream: textStream('child says hi'),
    })
    notify('subagent.finished', {
      provider: 'spawn',
      agentId: childId,
      parentSessionId: sessionId,
      childSessionId: childId,
      status: 'ok',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'child says hi' }],
    })
  }
}

/** 中文说明：函数 sessionIdOf 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sessionIdOf(params: Record<string, unknown> | undefined): string {
  /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = params?.sessionId
  return typeof value === 'string' ? value : ''
}

/** 中文说明：变量 reader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const reader = createInterface({ input: process.stdin })
reader.on('line', (line) => {
  if (line.trim().length === 0) return
  /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const frame = JSON.parse(line) as { id?: string | number; method?: string; params?: Record<string, unknown> }
  if (frame.method === undefined || frame.id === undefined) return
  /** 中文说明：函数值 respond 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const respond = (result: object): void => { write({ jsonrpc: '2.0', id: frame.id, result }) }
  switch (frame.method) {
    case 'initialize':
      if (env.FAKE_RECORD_INIT !== undefined) appendFileSync(env.FAKE_RECORD_INIT, `${JSON.stringify(frame.params)}\n`)
      if (env.FAKE_HANG_INIT !== undefined) return
      if (env.FAKE_INIT_READY !== undefined && env.FAKE_INIT_GO !== undefined) {
        writeFileSync(env.FAKE_INIT_READY, 'ready\n')
        /** 中文说明：变量 go 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const go = env.FAKE_INIT_GO
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = frame.id
        /** 中文说明：函数值 poll 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const poll = setInterval(() => {
          if (!existsSync(go)) return
          clearInterval(poll)
          write({ jsonrpc: '2.0', id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } })
        }, 5)
        return
      }
      if (env.FAKE_INIT_ERROR !== undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted init failure', data: { hint: 'fake' } } })
        return
      }
      if (env.FAKE_INIT_ERROR_ONCE_FILE !== undefined && !existsSync(env.FAKE_INIT_ERROR_ONCE_FILE)) {
        writeFileSync(env.FAKE_INIT_ERROR_ONCE_FILE, 'failed-once\n')
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted first-boot failure' } })
        return
      }
      if (env.FAKE_MALFORMED !== undefined) {
        respond({})
        return
      }
      if (env.FAKE_ECHO_CWD_IN_INIT !== undefined) {
        respond({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: process.cwd() } })
        return
      }
      respond({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })
      return
    case 'session/prompt': {
      /** 中文说明：变量 sessionId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const sessionId = sessionIdOf(frame.params)
      /** 中文说明：变量 messageId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const messageId = `fake-user-${seq}`
      event(sessionId, 'agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [{
          id: messageId,
          role: 'user',
          content: [],
          source: { kind: 'user' },
        }],
      })
      notify('session.status', { sessionId, status: 'running' })
      if (env.FAKE_STREAM_THEN_MALFORMED !== undefined) {
        event(sessionId, 'assistant/attempt', {
          turn: 0,
          step: 0,
          stream: textStream('streamed then cut short'),
        })
        respond({})
        return
      }
      if (env.FAKE_EXIT_DURING_PROMPT !== undefined) {
        const partial = env.FAKE_TEXT ?? 'partial before exit'
        respond({ messageId })
        event(sessionId, 'assistant/message', {
          turn: 0,
          step: 0,
          message: {
            id: `fake-partial-${seq}`,
            role: 'assistant',
            content: [{ type: 'text', text: partial }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          },
          stream: textStream(partial),
          interrupted: true,
        })
        setImmediate(() => { process.exit(17) })
        return
      }
      if (env.FAKE_HANG_PROMPT !== undefined) return
      if (env.FAKE_MALFORMED !== undefined || env.FAKE_MALFORMED_PROMPT !== undefined) {
        respond({})
        return
      }
      runTurn(sessionId)
      notify('session.status', { sessionId, status: 'idle' })
      respond({ messageId })
      return
    }
    case 'shutdown':
      respond({})
      // An EOF-ignoring fake also refuses the protocol exit, so the client's
      // dispose ladder (not this cooperative path) must reap it.
      if (env.FAKE_IGNORE_EOF === undefined) setImmediate(() => process.exit(0))
      return
    default:
      write({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: `unknown method: ${frame.method}` } })
  }
})
