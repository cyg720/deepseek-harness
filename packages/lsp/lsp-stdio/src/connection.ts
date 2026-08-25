/*
 * ================================ 文件注释 ================================
 * 【文件职责】一个 JSON-RPC 端点：绑定到一个经 subprocess 能力拉起的语言服务器子进程，负责 id 关联、
 *   出站请求与通知、入站 server→client 请求应答（静态回答 workspace/configuration、拒绝
 *   workspace/applyEdit），并暴露树级终止句柄。
 * 【技术维度】基于 dsh-subprocess 的 SubprocessHandle（stdin/stdout 管道 + stderr 有界收集尾）；
 *   encodeMessage/MessageDecoder 负责帧；pending Map 做请求 id 关联；关闭事件统一 fail 全部挂起请求。
 * 【产品维度】这是"宿主 ↔ 语言服务器"的通信管道：写配置应答、拒绝对宿主有副作用的编辑请求、收集 stderr 便于诊断失败服务器、支持取消与整树终止。
 * 【逻辑维度】ConnectionSpec/ConnectionWriter/ConnectionSpawner 类型 → LspConnection 类（构造拉起
 *   子进程、request/notify/cancel/peekNextId、onStdout/dispatch 分发、handleServerRequest/
 *   handleResponse、write 失败处理、fail/failAll/exitMessage）→ asError。
 * 【关键边界】帧/JSON 解析失败视为致命并整树终止；stdin 写失败同样致命（进程可能还活着）；stderr 有界收集（maxStderrBytes）；关闭后新请求立即拒绝。
 * 【新手阅读建议】先读 request/write 理解请求生命周期与失败传播，再读 dispatch 理解三类入站帧（请求、通知、响应）的路由。
 * ==========================================================================
 */
/**
 * A JSON-RPC endpoint over one language server spawned through the subprocess
 * capability. Owns id correlation, outbound requests/notifications, and inbound
 * server→client requests: it answers `workspace/configuration` from static
 * config, and rejects `workspace/applyEdit` (this host never applies edits or
 * runs commands). It caps stderr, surfaces framing/decoder failures as a
 * fatal close, and exposes tree-scoped termination through the handle so the
 * instance owns teardown; group/tree mechanics live in the subprocess
 * Service Provider.
 * @module @deepseek-ai/dsh-lsp-stdio/connection
 */

import type { Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { encodeMessage, MessageDecoder } from './framing.ts'

/** How to launch the server and answer its config requests. */
// 拉起语言服务器并应答其配置请求所需的全部参数。
export interface ConnectionSpec {
  /** The resolved absolute executable path (no shell). */
  // 已解析的绝对可执行文件路径（不经 shell 执行）。
  readonly command: string
  /** Arguments passed to the executable. */
  // 传给可执行文件的参数。
  readonly args: readonly string[]
  /** The child's working directory (the canonical workspace). */
  // 子进程工作目录（即规范化后的工作区）。
  readonly cwd: string
  /** Explicit child environment overrides; the subprocess provider owns its ambient scrub. */
  // 显式子进程环境覆盖项；环境擦洗由 subprocess 提供者负责。
  readonly env: Record<string, string>
  /** Largest single framed message accepted from the server. */
  // 从服务器接受的最大单条帧消息字节数。
  readonly maxMessageBytes: number
  /** Largest stderr tail retained for diagnostics. */
  // 为诊断保留的最大 stderr 尾部字节数。
  readonly maxStderrBytes: number
  /**
   * The subprocess spec's `graceMs`: the SIGTERM→SIGKILL window of
   * {@link LspConnection.terminate}'s escalation, and the bound for draining
   * pipes a surviving helper still holds after the server exits.
   */
  // 子进程规格的 graceMs：terminate 升级 SIGTERM→SIGKILL 的窗口，也用于在服务器退出后排空仍被存活的辅助进程持有的管道。
  readonly killGraceMs: number
  /** Static answer to every `workspace/configuration` item. */
  // 对每个 workspace/configuration 项的静态回答。
  readonly configuration: unknown
}

// 一个挂起中请求的解析器：响应到达时 resolve、错误或关闭时 reject。
interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Write one JSON-RPC message to the child stdin.
 * @param stdin - the spawned server stdin.
 * @param message - the unencoded JSON-RPC message.
 * @param done - callback that reports asynchronous stream settlement.
 */
// 写消息函数类型：把未编码的 JSON-RPC 消息写入子进程 stdin，经 done 回调报告异步写入结果（测试可注入回调失败，不依赖操作系统管道竞态）。
export type ConnectionWriter = (
  stdin: Writable,
  message: unknown,
  done: (error?: Error | null) => void,
) => void

/** Spawn one subprocess for this connection (the provider passes `ctx.subprocess.spawn`). */
// 为连接拉起一个子进程（提供者传入 ctx.subprocess.spawn）。
export type ConnectionSpawner = (spec: SubprocessSpawnSpec) => SubprocessHandle

// 默认写实现：编码成帧后写入 stdin，并把结果交给 done。
const writeConnectionMessage: ConnectionWriter = (stdin, message, done) => {
  stdin.write(encodeMessage(message), done)
}

/** A live JSON-RPC endpoint bound to one child process. */
// 绑定到一个子进程的活 JSON-RPC 端点。
export class LspConnection {
  // 子进程句柄：负责进程信号与退出等待。
  private readonly handle: SubprocessHandle
  // 子进程 stdin 可写流（协议出站通道）。
  private readonly stdin: Writable
  // 帧解码器：从 stdout 字节流还原消息体。
  private readonly decoder: MessageDecoder
  // 挂起请求表：请求 id → 解析器。
  private readonly pending = new Map<number, Pending>()
  // 下一个请求 id（自增分配）。
  private nextId = 1
  // 致命关闭原因：一旦设置，连接即视为失败。
  private closeReason: Error | undefined
  /** Set once the process has fully exited; the instance awaits it during teardown. */
  // 进程完全退出后即 resolve；实例在拆卸时 await 它。
  readonly closed: Promise<void>

  /**
   * @param spec - how to launch the server and answer its config requests.
   * @param spawner - the subprocess seam's spawn (the provider passes `ctx.subprocess.spawn`).
   * @param onServerRequest - answers a server→client request; rejects to send an error response.
   * @param writer - message writer; tests inject callback failures without relying on OS pipe races.
   */
  constructor(
    spec: ConnectionSpec,
    spawner: ConnectionSpawner,
    private readonly onServerRequest: (method: string, params: unknown) => Promise<unknown>,
    private readonly writer: ConnectionWriter = writeConnectionMessage,
  ) {
    this.decoder = new MessageDecoder(spec.maxMessageBytes)
    // stdin/stdout are piped protocol streams this endpoint frames itself;
    // stderr is a collected diagnostic tail (no spill — the bounded tail IS
    // the contract). The seam owns detachment and tree-scoped signalling.
    // stdin/stdout 是端点自己组帧的协议管道；stderr 是收集的诊断尾部（有界尾即契约，不溢出）。进程分离与树级信号由 subprocess 缝负责。
    this.handle = spawner({
      argv: [spec.command, ...spec.args],
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: spec.maxStderrBytes },
      },
      graceMs: spec.killGraceMs,
      // The seam merges explicit config entries after its ambient scrub, so a
      // configured credential or DSH_* fact reaches the child deliberately.
      // 缝在环境擦洗之后合并显式配置项，因此配置的凭据或 DSH_* 事实会按预期传给子进程。
      env: spec.env,
    })
    /* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
    if (this.handle.stdin === undefined || this.handle.stdout === undefined) {
      throw new Error('lsp-stdio: subprocess implementation dropped a piped protocol stream')
    }
    /* v8 ignore stop */
    this.stdin = this.handle.stdin
    this.closed = new Promise<void>((resolve) => {
      const close = (): void => {
        const reason = this.closeReason ?? new Error(this.exitMessage())
        // Record the reason so any request issued AFTER close rejects immediately instead of hanging
        // (a closed process sends no further responses).
        // 记录原因：关闭之后发出的任何请求立即拒绝，而不是挂起（已关闭的进程不会再发响应）。
        this.closeReason = reason
        this.failAll(reason)
        resolve()
      }
      this.handle.done.then(close, (error: unknown) => {
        // A spawn-level failure never produces a close event; the rejection is
        // the fatal cause and the close boundary at once.
        // 拉进程级别的失败不会产生 close 事件：该拒绝既是致命原因又是关闭边界。
        this.fail(asError(error))
        close()
      })
    })
    // Child stdin can fail while the process itself remains alive (for example, a server closes fd
    // 0). Treat that as a fatal connection error so pending requests reject immediately instead of
    // waiting for a process-close event that may never arrive.
    // 子进程 stdin 可能在进程仍存活时失败（例如服务器关闭了 fd 0）：视为致命连接错误，让挂起请求立即拒绝，而不是等待可能永不到来的进程关闭事件。
    this.stdin.on('error', (error) => { this.fail(error) })
    this.handle.stdout.on('data', (chunk: Buffer) => { this.onStdout(chunk) })
  }

  /** The child's pid, or `-1` when the spawn produced no pid (so signalling is a no-op). */
  // 子进程 pid；拉进程未产生 pid 时为 -1（信号操作退化为空操作）。
  get pid(): number {
    return this.handle.pid
  }

  /** The retained stderr tail, for diagnostics on a failed server. */
  // 保留的 stderr 尾部：用于诊断失败服务器。
  get stderrTail(): string {
    /* v8 ignore next -- the collect disposition always exposes a stderr reader; defensive. */
    return this.handle.collected.stderr?.readFrom(0).text ?? ''
  }

  /** Whether the transport has failed even if the child close event has not arrived yet. */
  // 传输是否已失败（即使子进程关闭事件尚未到达）。
  get failed(): boolean {
    return this.closeReason !== undefined
  }

  /**
   * Test whether a caught error is this connection's retained fatal transport cause.
   * @param error - error caught by the instance or provider.
   * @returns `true` only when this connection produced that exact failure.
   */
  // 判断捕获的错误是否正是本连接记录的致命传输原因（实例用它识别"需要替换"的故障）。
  failedWith(error: unknown): boolean {
    return this.closeReason === error
  }

  /**
   * Send a request and await its result.
   * @param method - the JSON-RPC method.
   * @param params - the request params.
   * @returns the response result; rejects on an error response, write failure, or close.
   */
  // 发送请求并等待结果：分配自增 id、注册挂起表、写入消息；错误响应、写失败或连接关闭都会拒绝。
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      // 连接已关闭：立即拒绝，不再发消息。
      if (this.closeReason !== undefined) {
        reject(this.closeReason)
        return
      }
      this.pending.set(id, { resolve, reject })
      // `write()` records either synchronous or callback-delivered failures on the connection and
      // rejects every pending request. This handler only consumes the write promise itself.
      // write() 会把同步或回调送达的失败记录到连接并拒绝所有挂起请求；这里只需消费写 Promise 本身。
      void this.write({ jsonrpc: '2.0', id, method, params }).catch(() => {})
    })
    // A caller that stops awaiting (e.g. an aborted query) can leave this promise to reject later
    // when the process closes; a benign no-op handler keeps that from surfacing as an unhandled
    // rejection. The returned promise still delivers the rejection to the caller's own await/catch.
    // 调用方停止等待（如查询被中止）时，该 Promise 可能在进程关闭后才拒绝；挂一个无害空处理避免未处理拒绝，返回的 Promise 仍会把拒绝交给调用方自己的 await/catch。
    promise.catch(() => {})
    return promise
  }

  /**
   * Send a notification (no id, no response).
   * @param method - the JSON-RPC method.
   * @param params - the notification params.
   * @returns a promise that settles when the framed notification has been written.
   */
  // 发送通知（无 id、无响应）：返回的 Promise 在帧写入完成后落定。
  notify(method: string, params: unknown): Promise<void> {
    return this.write({ jsonrpc: '2.0', method, params })
  }

  /**
   * Send a `$/cancelRequest` for an in-flight request id (best-effort; ignores write failure).
   * @param requestId - the numeric id of the request to cancel.
   */
  // 为进行中的请求发送 $/cancelRequest（尽力而为：忽略写失败）。
  cancel(requestId: number): void {
    // The server is already gone or unwritable when this rejects; `write()` has recorded the fatal
    // connection failure and rejected the pending request, so cancellation remains best-effort.
    // 该写被拒绝时服务器可能已消失或不可写；write() 已记录致命连接失败并拒绝挂起请求，因此取消保持尽力而为。
    void this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: requestId } }).catch(() => {})
  }

  /**
   * The id the NEXT `request()` will use, so the instance can pre-arm a cancel.
   * @returns the numeric id the next request will be assigned.
   */
  // 下一次 request() 将使用的 id：让实例可以预先准备取消。
  peekNextId(): number {
    return this.nextId
  }

  /** Terminate the server's process tree (the seam's SIGTERM→grace→SIGKILL escalation; idempotent). */
  // 终止服务器的进程树（缝的 SIGTERM→宽限→SIGKILL 升级；幂等）。
  terminate(): void {
    this.handle.terminate()
  }

  /**
   * Wait until the owned process tree has exited.
   * @param signal - optional bound for the wait.
   * @returns `true` when the tree exited, or `false` when the signal aborted first.
   */
  // 等待所拥有的进程树退出：返回 true 表示已退出，false 表示信号先中止了等待。
  async waitForProcessTreeExit(signal?: AbortSignal): Promise<boolean> {
    return await this.handle.waitForExit(signal)
  }

  // 处理 stdout 数据块：解码出完整消息后逐条分发；帧/JSON 解析失败视为致命并终止整树。
  private onStdout(chunk: Buffer): void {
    let messages: unknown[]
    try {
      messages = this.decoder.push(chunk)
    } catch (error) {
      // A framing/JSON failure corrupts the stream position irrecoverably: fail the instance and
      // terminate the whole group so helper processes don't outlive the leader (SIGTERM first, then
      // the kill grace's SIGKILL — a misbehaving server still gets its bounded flush window).
      // 帧/JSON 失败使流位置不可恢复地损坏：判定实例失败并终止整个进程组（先 SIGTERM，宽限后 SIGKILL——异常服务器仍有有界的刷新窗口），防止辅助进程活得比领导者更久。
      this.fail(asError(error))
      this.handle.terminate()
      return
    }
    for (const message of messages) this.dispatch(message)
  }

  // 分发一条入站帧：带 id 且带 method 的是 server→client 请求；只带 method 的是通知（本 MVP 宿主忽略）；带数字 id 的是响应。
  private dispatch(message: unknown): void {
    if (message === null || typeof message !== 'object') return
    const frame = message as Record<string, unknown>
    const id = frame.id
    const method = frame.method
    if (typeof method === 'string' && (typeof id === 'number' || typeof id === 'string')) {
      // A response-write failure has already invalidated the connection in `write()`.
      /* v8 ignore next -- protocol tests exercise response writes; only a simultaneous connection
         failure makes this consumption handler run. */
      // 应答写失败已由 write() 判定连接失效；这里异步应答并吞掉错误。
      void this.handleServerRequest(id, method, frame.params).catch(() => {})
      return
    }
    if (typeof method === 'string') {
      // A server→client notification (e.g. diagnostics, logs): ignored by this MVP host.
      // server→client 通知（如诊断、日志）：MVP 宿主忽略。
      return
    }
    if (typeof id === 'number') this.handleResponse(id, frame)
  }

  // 应答一条 server→client 请求：成功写 result，失败写 -32601 错误响应。
  private async handleServerRequest(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.onServerRequest(method, params)
      await this.write({ jsonrpc: '2.0', id, result })
    } catch (error) {
      await this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: asError(error).message } })
    }
  }

  // 处理一条响应：找到对应挂起请求并 resolve 或 reject。
  private handleResponse(id: number, frame: Record<string, unknown>): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    // 错误响应：拒绝挂起请求。
    const error = frame.error
    if (error !== null && typeof error === 'object') {
      const record = error as Record<string, unknown>
      pending.reject(new Error(typeof record.message === 'string' ? record.message : 'LSP error response'))
      return
    }
    pending.resolve(frame.result)
  }

  // 写一条消息到 stdin：已关闭则立即拒绝；经 writer 完成异步写入并处理失败。
  private write(message: unknown): Promise<void> {
    if (this.closeReason !== undefined) return Promise.reject(this.closeReason)
    return new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null): void => {
        if (error === undefined || error === null) {
          resolve()
          return
        }
        // 写失败：判定连接失败并拒绝。
        this.fail(error)
        reject(error)
      }
      try {
        // 调用 writer 写入（Node 流写失败通常经回调报告，这里兜底同步抛出的不合规实现）。
        this.writer(this.stdin, message, done)
      /* v8 ignore start -- Node stream write failures are callback-delivered; this guards a
         nonconforming Writable implementation throwing synchronously. */
      } catch (error) {
        const failure = asError(error)
        this.fail(failure)
        reject(failure)
      }
      /* v8 ignore stop */
    })
  }

  /** The exit-close error message, appending the retained stderr tail when the server wrote any. */
  // 退出关闭时的错误消息：服务器写过 stderr 时附加其尾部。
  private exitMessage(): string {
    const tail = this.stderrTail.trim()
    return tail === '' ? 'language server exited' : `language server exited; stderr: ${tail}`
  }

  // 记录致命原因并拒绝全部挂起请求（首个原因保留，后续失败不覆盖）。
  private fail(error: Error): void {
    /* v8 ignore next -- the second arm (closeReason already set) needs two fail() calls before close; defensive. */
    if (this.closeReason === undefined) this.closeReason = error
    this.failAll(error)
  }

  // 拒绝所有挂起请求并清空挂起表。
  private failAll(error: Error): void {
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const pending of waiting) pending.reject(error)
  }
}

/** Coerce an unknown thrown value to an `Error`. */
// 把未知抛出值统一转为 Error 对象。
function asError(value: unknown): Error {
  /* v8 ignore next -- the non-Error branch guards against a non-Error throw, which our paths never produce. */
  return value instanceof Error ? value : new Error(String(value))
}
