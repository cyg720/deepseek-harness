/**
 * ================================ 文件注释 ================================
 * 【文件职责】一个语言服务器实例：连接 + initialize 握手 + 串行可取消查询队列 + 临时 didOpen→查询→didClose 生命周期 + 有界拆卸。一个实例独占一个"(提供者 id, 规范化工作区)"进程。
 * 【技术维度】LspConnection 负责 JSON-RPC 端点；查询通过单一队列串行化避免生命周期交错；取消时先发 $/cancelRequest，宽限内不结束则销毁实例；拆卸分优雅 shutdown/exit 与 SIGTERM→SIGKILL 升级两阶段。
 * 【产品维度】保证多个并发模型查询在同一个服务器进程中安全排队执行：一个查询的取消不会杀死无关工作，而真正卡死的服务器能被清理、不影响其他工作区。
 * 【逻辑维度】InstanceSpec 规格 → LspInstance 类（握手 ready、串行队列 query、runQuery 生命周期、
 *   sendRequest/raceAbort 取消竞速、normalize 结果、server 请求应答、拆卸三方法）→ 常量
 *   （LIFECYCLE_NOOP_METHODS/CLIENT_CAPABILITIES/markSettled）。
 * 【关键边界】握手失败会毒化并拆除实例；不支持的操作或同步方式直接抛 LSP_UNSUPPORTED_OPERATION；didClose 只在"已打开且未死"时发送，避免与拆卸竞态；本宿主永不 applyEdit。
 * 【新手阅读建议】重点读 runQuery 的 try/finally 生命周期与 raceAbort 的取消竞速，它们是并发安全的核心。
 * ==========================================================================
 */
/**
 * One language-server instance: a connection plus the initialize handshake, the serialized abortable
 * query queue, the transient `didOpen`→request→`didClose` lifecycle, and bounded teardown. One
 * instance owns one `(provider id, canonical workspace)` process. Queries serialize through a single
 * queue so a cancellation that fails to stop the server can terminate it without killing unrelated
 * work; distinct instances run in parallel.
 * @module @deepseek-ai/dsh-lsp-stdio/instance
 */

import { LspError } from '@deepseek-ai/dsh-lsp'
import type {
  LspOperation,
  LspProviderQuery,
  LspQueryResult,
} from '@deepseek-ai/dsh-lsp'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { abortable, abortError } from './abort.ts'
import { LspConnection } from './connection.ts'
import type { ConnectionSpawner, ConnectionSpec, ConnectionWriter } from './connection.ts'
import type { HostSource } from './host.ts'
import type { WireInitializeResult, WireServerCapabilities } from './protocol.ts'
import {
  negotiatePositionEncoding,
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
} from './translate.ts'

/** Everything an instance needs beyond the connection spec. */
// 实例在连接规格之外所需的一切参数。
export interface InstanceSpec extends ConnectionSpec {
  /** Canonical workspace file URI supplied by the filesystem provider. */
  // 文件系统提供者给出的规范化工作区 file: URI。
  readonly workspaceUri: string
  /** Static `initialize` options forwarded to the server. */
  // 转发给服务器的静态 initialize 选项。
  readonly initializationOptions: unknown
  /** Graceful `shutdown`/`exit` budget before escalation (ms). */
  // 优雅 shutdown/exit 的预算时间（毫秒），超时后升级为强杀。
  readonly shutdownTimeoutMs: number
}

/**
 * A single initialized server process. Not exported as a provider — the provider single-flights and
 * pools these. `query()` serializes; `dispose()` rejects queued work and tears the process down.
 */
// 一个已初始化的服务器进程实例：不是提供者（提供者负责单飞与池化）；query() 串行执行，dispose() 拒绝排队中的工作并拆卸进程。
export class LspInstance {
  // 底层 JSON-RPC 连接。
  private readonly connection: LspConnection
  // 握手成功后缓存的服务器能力（undefined 表示尚未初始化）。
  private capabilities: WireServerCapabilities | undefined
  /** The serialization tail: each query awaits the prior one, so lifecycles never interleave. */
  // 串行化队列尾：每个查询先等前一个完成，保证文档生命周期永不交错。
  private queue: Promise<unknown> = Promise.resolve()
  // 是否已进入拆卸状态：true 后拒绝新查询。
  private disposed = false
  /** The one teardown transaction shared by abort, failure, and explicit disposal. */
  // 中止、失败与显式 dispose 共享的唯一次拆卸事务（去重保证只拆一次）。
  private teardownPromise: Promise<void> | undefined
  /** Set once the process closes, so the pool can synchronously skip a dead instance. */
  // 进程一旦关闭即置位，让池可以同步跳过已死的实例。
  private processClosed = false
  /** Populated once `initialize` succeeds; a failed handshake rejects every query. */
  // initialize 成功后即 resolve；握手失败会让后续所有查询都被拒绝（该实例被毒化）。
  private readonly ready: Promise<void>

  /**
   * @param spec - the launch, initialize, and teardown parameters.
   * @param spawner - the subprocess seam's spawn function.
   * @param writer - optional connection writer used by transport conformance tests.
   */
  constructor(private readonly spec: InstanceSpec, spawner: ConnectionSpawner, writer?: ConnectionWriter) {
    this.connection = new LspConnection(spec, spawner, (method, params) => this.answerServerRequest(method, params), writer)
    this.ready = this.initialize()
    // A handshake rejection must not surface as an unhandled rejection before the first query awaits
    // it; queries attach the real handler.
    // 握手的拒绝不能成为未处理的拒绝：在第一个查询 await 它之前先挂一个空处理，真实处理由查询方挂载。
    this.ready.catch(() => {})
    // 进程关闭时同步标记，供池查询 dead 状态。
    void this.connection.closed.then(() => { this.processClosed = true })
  }

  /** Synchronous liveness check: true once the process has closed or the instance was disposed. */
  // 同步活性检查：进程已关闭、实例已拆卸或连接已失败时返回 true。
  get dead(): boolean {
    return this.processClosed || this.disposed || this.connection.failed
  }

  /**
   * Test whether a caught query error came from this instance's transport.
   * @param error - error caught by the provider.
   * @returns `true` only for the connection's retained fatal transport cause.
   */
  // 判断捕获的查询错误是否来自本实例的传输层（供提供者决定"替换一次并重试"）。
  isTransportFailure(error: unknown): boolean {
    return this.connection.failedWith(error)
  }

  /**
   * Run one query through the serialized queue.
   * @param request - the resolved provider query.
   * @param source - the pre-validated, already-read host source (the provider reads before spawning).
   * @param signal - optional cancellation for this query's full lifecycle.
   * @returns the normalized result.
   */
  // 经串行队列执行一次查询：排在前一个查询之后，且等待期间也响应取消（避免被共享队列尾无限阻塞）。
  query(request: LspProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspQueryResult> {
    // Serialize behind prior work, but observe abort DURING the queue wait too: if an earlier query
    // hangs (e.g. a signal-less service caller), a later tool's timeout must still be able to give up
    // rather than block on the shared tail forever.
    // 排队等待期间也监听取消：若前一个查询卡住（如无信号的服务调用方），后一个查询的超时仍能放弃等待，而非永久阻塞在共享队列尾。
    const run = abortable(this.queue, signal)
      .then(() => this.runQuery(request, source, signal))
      .catch(async (error: unknown) => {
        // 查询失败且确属传输层故障：启动拆卸，让池能驱逐该实例。
        if (this.isTransportFailure(error)) await this.startTeardown()
        throw error
      })
    // Keep the tail alive regardless of this query's outcome so the next caller still serializes. The
    // tail follows the ACTUAL prior work (this.queue), not the abortable view, so a caller giving up
    // on the wait does not deserialize the queue.
    // 无论本次查询结果如何都保持队列尾存活，下一个调用方仍能串行；队列尾跟随"真实的前序工作"而非可取消视图——放弃等待的调用方不会破坏队列的串行性。
    this.queue = this.queue.then(() => run).then(() => undefined, () => undefined)
    return run
  }

  // 与服务器握手：发送 initialize（processId 传 null，因为子进程提供者可能运行在另一个 PID 命名空间或机器上，宿主 PID 会让服务器监视无关进程），缓存能力，再发 initialized 通知。
  private async initialize(): Promise<void> {
    const initializeResult = await this.connection.request('initialize', {
      // A subprocess provider may run in another PID namespace or machine;
      // the host PID would let the server monitor an unrelated process.
      processId: null,
      rootUri: this.spec.workspaceUri,
      workspaceFolders: [{ uri: this.spec.workspaceUri, name: 'workspace' }],
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions: this.spec.initializationOptions,
    }) as WireInitializeResult
    const capabilities = initializeResult.capabilities
    // An omitted encoding defaults to utf-16; any other value is a protocol error we reject here.
    // 位置编码缺省即 utf-16；其他取值属于协议错误，在此拒绝。
    negotiatePositionEncoding(capabilities.positionEncoding)
    this.capabilities = capabilities
    await this.connection.notify('initialized', {})
  }

  // 执行单次查询的完整生命周期：校验实例状态与能力 → 等待握手 → 临时 didOpen → 发送请求 → didClose。
  private async runQuery(request: LspProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspQueryResult> {
    if (this.disposed) throw new LspError('LSP instance was disposed', 'LSP_DISPOSED')
    /* v8 ignore next -- the abortable queue wait rejects a pre-aborted signal before runQuery; this is a belt-and-suspenders guard. */
    if (signal?.aborted) throw abortError(signal)
    // Observe abort during the handshake wait, and never pool a poisoned instance: if the wait ends
    // in failure — an abort on a still-pending handshake, OR `initialize` rejecting (utf-8
    // negotiation, malformed result) without the process exiting — tear the instance down so a
    // permanently-rejecting/pending `ready` can't make every later query for this workspace fail.
    // 等待握手期间响应取消，且绝不池化"中毒"实例：若等待以失败结束（握手仍挂起时被中止，或 initialize 拒绝而未退出进程），立即拆除实例，避免一个永远拒绝或挂起的 ready 让该工作区的后续查询全部失败。
    try {
      await abortable(this.ready, signal)
    } catch (error) {
      if (!this.dead) {
        await this.startTeardown()
      }
      throw error
    }
    const capabilities = this.capabilities
    /* v8 ignore next -- `ready` resolves only after capabilities are set, else it rejects above; defensive. */
    if (capabilities === undefined) throw new Error('LSP instance is not initialized')
    // 服务器不支持该操作或临时同步方式时，直接拒绝本次查询。
    if (!supportsOperation(capabilities, request.operation)) {
      throw new LspError(`server does not support ${request.operation}`, 'LSP_UNSUPPORTED_OPERATION')
    }
    if (!supportsTransientOpen(capabilities.textDocumentSync)) {
      throw new LspError('server does not support the transient textDocument/didOpen this host requires', 'LSP_UNSUPPORTED_OPERATION')
    }

    const uri = source.fileUrl
    // opened 记录 didOpen 是否已成功发出：只有打开成功才需要（也才允许）发送 didClose。
    let opened = false
    try {
      /* v8 ignore next -- guards an abort landing between the ready wait and didOpen; not deterministically reproducible. */
      if (signal?.aborted) throw abortError(signal)
      try {
        await abortable(this.connection.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: request.languageId, version: 1, text: source.text },
        }), signal)
      } catch (error) {
        // A canceled backpressured write or failed stdin leaves the protocol stream unusable before
        // `opened` can arm the didClose cleanup. Teardown here makes the pool evict the instance.
        // 写入被取消或 stdin 失败会使协议流在 opened 置位前就不可用：此处启动拆卸，让池驱逐该实例。
        await this.startTeardown()
        throw error
      }
      opened = true
      const payload = await this.sendRequest(request.operation, uri, request.position, signal)
      return this.normalize(request.operation, payload)
    } finally {
      // A disposed or closed instance (e.g. an aborted request whose server ignored
      // `$/cancelRequest`) is already tearing down; sending didClose would race that teardown and let
      // the next queued query's document lifecycle overlap the still-active request.
      // 已拆卸或已关闭的实例（如服务器无视 $/cancelRequest 的被中止请求）正在拆卸中：再发 didClose 会与拆卸竞态，且让下一个排队查询的文档生命周期与仍在进行的请求重叠。
      if (opened && !this.dead) {
        try {
          await this.connection.notify('textDocument/didClose', { textDocument: { uri } })
        } catch {
          // A close-write failure does not replace the settled result/error, but the instance can no
          // longer be trusted: invalidate it and await bounded process termination.
          // didClose 写失败不改变已确定的结果或错误，但实例已不可信：使其失效并等待有界的进程终止。
          try {
            await this.startTeardown()
          } catch {
            /* v8 ignore next -- teardown owns all expected process races; this only preserves the
               already-settled query outcome if an unexpected cleanup primitive itself rejects. */
          }
        }
      }
    }
  }

  // 组装查询请求参数并发送：findReferences 总是携带 includeDeclaration: true（调用方无开关，影响分析永不遗漏定义点）；带信号时用取消竞速包装。
  private async sendRequest(
    operation: LspOperation,
    uri: string,
    position: LspProviderQuery['position'],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const params = {
      textDocument: { uri },
      position: { line: position.line, character: position.character },
      // findReferences always includes declarations: the caller gets no flag and impact analysis
      // never omits the defining site.
      ...(operation === 'findReferences' ? { context: { includeDeclaration: true } } : {}),
    }
    // 预先取下一个请求 id，供取消时使用。
    const requestId = this.connection.peekNextId()
    const send = this.connection.request(requestMethod(operation), params)
    if (signal === undefined) return send
    return this.raceAbort(send, requestId, signal)
  }

  /**
   * Race a pending request against abort. On abort, send `$/cancelRequest` and give the server a
   * bounded grace to acknowledge; if it does not settle in time, invalidate and tear down the
   * instance so the still-active request cannot overlap the next queued query's document lifecycle.
   */
  // 让挂起请求与中止赛跑：中止时先发 $/cancelRequest 并给服务器有界宽限；若宽限内未结束，则使实例失效并拆卸，避免仍在进行的请求与下一个排队查询的文档生命周期重叠。
  private async raceAbort(send: Promise<unknown>, requestId: number, signal: AbortSignal): Promise<unknown> {
    try {
      return await abortable(send, signal)
    } catch (error) {
      // 不是中止导致的失败：原样抛出。
      if (!signal.aborted) throw error
      this.connection.cancel(requestId)
      // Wait, bounded, for the server to honor the cancellation. If it does not, the request is still
      // running: terminate the instance (disposal awaits process close) so nothing outlives the query.
      // 有界等待服务器执行取消；若未执行，请求仍在运行：终止实例（拆卸等待进程关闭），确保没有任何东西活得比查询更久。
      const grace = deadline(undefined, this.spec.killGraceMs, 'LSP_CANCEL_GRACE')
      try {
        // `settled` is true if the request finished (either outcome) before the grace elapsed.
        // settled 为 true 表示请求在宽限耗尽前已结束（无论成功还是失败）。
        const settled = await Promise.race([
          send.then(markSettled, markSettled),
          new Promise<boolean>((resolve) => {
            /* v8 ignore next -- the cancel-grace deadline signal is freshly armed and not yet aborted here; defensive. */
            if (grace.signal.aborted) { resolve(false); return }
            grace.signal.addEventListener('abort', () => { resolve(false) }, { once: true })
          }),
        ])
        // 宽限内未结束：拆卸实例（disposal 会等待进程关闭）。
        if (!settled) await this.startTeardown()
      } finally {
        grace[Symbol.dispose]()
      }
      throw error
    }
  }

  // 把原始载荷按操作规范化为缝的结果：hover → hover 结果；导航 → locations（resolvedWorkspaceUri 直接使用执行平台的 workspaceUri，而不在渲染层重解析 spec.cwd）。
  private normalize(operation: LspOperation, payload: unknown): LspQueryResult {
    if (operation === 'hover') {
      return { kind: 'hover', hover: normalizeHover(payload) }
    }
    // The filesystem provider owns URI syntax for the execution platform, which may differ from the
    // harness host. Preserve that coordinate through rendering instead of reparsing `spec.cwd` there.
    return { kind: 'locations', locations: normalizeLocations(payload), resolvedWorkspaceUri: this.spec.workspaceUri }
  }

  // 应答 server→client 请求：workspace/configuration 用静态配置值回答；生命周期记账方法回空结果；workspace/applyEdit 一律拒绝（本宿主不应用编辑或运行命令）；其余不支持的方法报错。
  private answerServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'workspace/configuration') {
      // Answer every requested item with the one static configuration value.
      // 每个请求项都回答同一个静态配置值。
      const record = params as { items?: unknown[] } | null
      /* v8 ignore next -- a configuration request always carries an items array; the empty fallback is defensive. */
      const items = Array.isArray(record?.items) ? record.items : []
      return Promise.resolve(items.map(() => this.spec.configuration))
    }
    if (LIFECYCLE_NOOP_METHODS.has(method)) {
      // Accept lifecycle bookkeeping requests with an empty result; we register nothing dynamic.
      // 用空结果接受生命周期记账请求；本宿主不做动态注册。
      return Promise.resolve(null)
    }
    if (method === 'workspace/applyEdit') {
      // This host never applies edits or runs commands.
      return Promise.reject(new Error('workspace/applyEdit is not permitted by this host'))
    }
    return Promise.reject(new Error(`unsupported server request: ${method}`))
  }

  /**
   * Reject queued work, attempt graceful `shutdown`/`exit`, then escalate SIGTERM→SIGKILL, awaiting
   * process close so nothing outlives disposal.
   */
  // 拆卸入口：拒绝排队工作 → 尝试优雅 shutdown/exit → 升级 SIGTERM→SIGKILL，并等待进程关闭，确保没有任何东西活得比拆卸更久。
  async dispose(): Promise<void> {
    await this.startTeardown()
  }

  /** Publish disposal once and make every caller await the same quiescence boundary. */
  // 发布一次拆卸，并让所有调用方 await 同一个静默边界（重复调用只真正拆卸一次）。
  private startTeardown(): Promise<void> {
    this.disposed = true
    this.teardownPromise ??= this.tearDown()
    return this.teardownPromise
  }

  // 有界拆卸流程：先优雅 shutdown/exit，超时或失败后强制终止进程树。
  private async tearDown(): Promise<void> {
    const shutdownDeadline = deadline(undefined, this.spec.shutdownTimeoutMs, 'LSP_SHUTDOWN')
    try {
      await this.gracefulShutdown(shutdownDeadline.signal)
    } catch {
      // Graceful shutdown failed or timed out; process-tree cleanup below remains authoritative.
      // 优雅关闭失败或超时：下面的进程树清理仍是权威手段。
    } finally {
      shutdownDeadline[Symbol.dispose]()
    }
    await this.forceTerminate()
  }

  /** Best-effort LSP `shutdown`/`exit`, including process close, bounded by `signal`. */
  // 尽力而为的 LSP shutdown/exit（含等待进程关闭），受 signal 限制。
  private async gracefulShutdown(signal: AbortSignal): Promise<void> {
    await abortable(this.connection.request('shutdown', null), signal)
    await this.connection.notify('exit', null)
    await abortable(this.connection.closed, signal)
  }

  /**
   * Terminate the tree (the seam escalates SIGTERM→`killGraceMs`→SIGKILL),
   * then await leader and helper exit. The awaits are unbounded on purpose:
   * the seam's escalation already committed to SIGKILL, so quiescence — not
   * another timer — is the postcondition disposal owes its callers.
   */
  // 强制终止：调用终止（缝升级 SIGTERM→killGraceMs→SIGKILL），然后等待领导者与辅助进程退出。这些 await 刻意不做超时限制：升级已承诺 SIGKILL，因此"达到静默"而非"再设一个定时器"才是拆卸欠调用方的后置条件。
  private async forceTerminate(): Promise<void> {
    this.connection.terminate()
    await Promise.all([
      this.connection.closed,
      this.connection.waitForProcessTreeExit(),
    ])
  }
}

/** Server→client request methods this host acknowledges with an empty result (no dynamic registration). */
// 本宿主以空结果应答的 server→client 请求方法集合（不做动态注册）。
const LIFECYCLE_NOOP_METHODS = new Set([
  'window/workDoneProgress/create',
  'client/registerCapability',
  'client/unregisterCapability',
])

/** Mark a settled request in the cancel-grace race (either outcome means the request finished). */
// 在取消宽限赛跑中标记请求已结束（无论成功失败都视为已结束）。
function markSettled(): boolean {
  return true
}

/**
 * The client capabilities advertised at `initialize`: UTF-16 positions, workspace folders and
 * configuration, markdown/plaintext hover, and link support for definition/implementation. No
 * dynamic registration; the server's returned capabilities are authoritative.
 */
// initialize 时声明的客户端能力：UTF-16 位置、工作区文件夹与配置、markdown/plaintext 悬停、定义与实现的链接支持。不做动态注册，以服务器返回的能力为准。
const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: { workspaceFolders: true, configuration: true },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
  },
} as const
