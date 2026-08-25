/**
 * 文件职责：管理浏览器API的双事件流连接代际、严格就绪握手、断线检测和指数退避重连。
 * 技术维度：使用AsyncIterable、AbortController、Promise竞态和隔离回调实现不依赖UI状态库的连接控制器。
 * 产品维度：让Web界面在网络中断后自动恢复，并只在一元API和两条流均可用时公布已连接状态。
 * 逻辑维度：启动每代mux/host流，等待stream open与host.describe，分发帧，任一流结束后进入退避并创建下一代。
 * 关键边界：业务sink异常不得杀死连接泵；start/stop幂等；初次连接前不报告reconnecting；退避参数由配置决定。
 * 新手阅读建议：先看ConnectionConfig和Sinks，再看start/stop，随后逐段跟踪loop的一代连接和失败重试。
 */
import type { HostDescription, IApiClient, HostFrame, MuxFrame, RpcRequest } from './api.ts'

/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  /* 第一次重试的退避上限毫秒数，实际随机延迟为一半至全部。 */
  backoffBaseMs?: number
  /** Exponential growth factor per consecutive failed attempt. */
  /* 连续失败次数每增加一次时退避上限的指数倍率。 */
  backoffFactor?: number
  /** Upper bound for the backoff cap in ms. */
  /* 所有重试退避上限的最大毫秒数。 */
  backoffMaxMs?: number
  /** Cap on waiting for both streams' onOpen before onConnected, in ms. The strict handshake
   *  waits for mux+host stream establishment plus describe; a carrier that never
   *  fires onOpen (misbehaving proxy) must not wedge the connection forever — on timeout the
   *  generation proceeds as connected and the live-gap repair path covers stragglers. */
  /* 等待mux和host两条流onOpen的最大毫秒数，防止异常代理永久卡住握手。 */
  streamOpenTimeoutMs?: number
}

// 所有可部署连接调优项的默认值。
const CONNECTION_DEFAULTS: Required<ConnectionConfig> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  streamOpenTimeoutMs: 3_000,
}

/** 等待指定毫秒，信号取消时提前结束但不拒绝。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    // 正常等待完成时调用done的定时器句柄。
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Coarse connection state for the UI: 'connected' after each generation's handshake,
 *  'reconnecting' the moment the generation fails (covers the whole backoff+retry span). */
/* UI观察的粗粒度连接状态：握手完成或整个退避重试区间。 */
export type ConnectionState = 'connected' | 'reconnecting'

/** Frame sink callbacks: the Controller owns the physical streams; business dispatch belongs to
 *  SessionManager. */
export interface ConnectionSinks {
  /** mux流每个业务帧的可选接收回调。 */
  onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
  /** host流每个业务帧的可选接收回调。 */
  onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
  /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
  /* 每个连接代际完成两流和describe握手后的回调。 */
  onConnected?: (description: HostDescription) => void
  /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
   *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
  /* 去重后的粗粒度状态变化回调，初始连接阶段不调用。 */
  onStateChange?: (state: ConnectionState) => void
}

/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
 * never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * The pump body feeds each frame to a sink (sink exceptions must
 * not kill the pump — a broken business layer must not drag down the connection layer).
 */
export class ConnectionController {
  /** 每次尝试连接递增的代际编号，用于拒绝旧代回调。 */
  private generation = 0
  /** 当前连续失败重试次数，成功握手后归零。 */
  private attempt = 0
  /** 当前代际的取消控制器；停止后为空。 */
  private current: AbortController | null = null
  /** 主循环是否应继续创建连接代际。 */
  private running = false
  /** 最近已发送状态，用于消除重复通知。 */
  private lastState: ConnectionState | null = null
  /** 合并默认值后的完整连接配置。 */
  private readonly config: Required<ConnectionConfig>

  /**
   * 创建连接控制器但不立即启动。
   * @param api 提供一元握手和两条事件流的API客户端。
   * @param sinks 业务帧、握手和状态回调。
   * @param config 可选退避与流打开超时配置。
   * @example new ConnectionController(api, sinks, {}).start()
   */
  constructor(
    private readonly api: IApiClient,
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {
    this.config = { ...CONNECTION_DEFAULTS, ...config }
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  /** Stop the loop and abort the current generation's streams. */
  stop(): void {
    this.running = false
    this.current?.abort()
    this.current = null
  }

  private backoffDelay(attempt: number): number {
    // 当前退避计算使用的基础值、倍率和最大值。
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config
    // 当前失败次数对应且不超过最大值的随机退避上限。
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1))
    return cap / 2 + Math.random() * (cap / 2)
  }

  /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
  private isRunning(): boolean {
    return this.running
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController): boolean {
    return this.isRunning() && !controller.signal.aborted
  }

  private async loop(): Promise<void> {
    while (this.running) {
      // 当前新连接代际的唯一编号。
      const gen = ++this.generation
      // 当前代际两条流和握手共享的取消控制器。
      const ac = new AbortController()
      this.current = ac

      /* v8 ignore next -- initializer placeholder: the Promise executor
       * below runs synchronously and replaces it before anyone can call it. */
      let muxOpened = (): void => {}
      /* v8 ignore next -- same placeholder pattern as muxOpened. */
      let hostOpened = (): void => {}
      // 两条物理流都报告onOpen时解决的严格就绪门。
      const streamsOpen = Promise.all([
        new Promise<void>((resolve) => { muxOpened = resolve }),
        new Promise<void>((resolve) => { hostOpened = resolve }),
      ])

      // 任一流结束或失败时解决并中止本代的共享失败门。
      const failed = new Promise<void>((resolve) => {
        /** 收敛两条流结束，只让当前代际执行取消。 */
        const settle = (): void => {
          if (gen === this.generation && !ac.signal.aborted) ac.abort()
          resolve()
        }
        void this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settle)
        void this.pumpStream(this.api.events.host({}, ac.signal, hostOpened), this.sinks.onHostEnvelope, settle)
      })

      try {
        // Strict readiness handshake: describe proves unary reachability, onOpen
        // proves each physical stream is established before any frame —
        // only then may onConnected fire, so the resync it triggers cannot outrun the
        // subscribed baseline. The timeout guards against a carrier that never fires onOpen
        // (see ConnectionConfig.streamOpenTimeoutMs).
        // 严格流打开等待使用的可取消超时控制器。
        const timeout = new AbortController()
        const [description] = await Promise.all([
          this.api.host.describe({}),
          Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)]),
        ])
        timeout.abort()
        // host.describe响应的业务结果槽。
        const descriptionResult = description.result
        if (!descriptionResult.ok) {
          throw new Error(`host.describe failed: ${descriptionResult.error.code}: ${descriptionResult.error.message}`)
        }
        if (ac.signal.aborted) throw new Error('generation aborted during readiness handshake')
        this.attempt = 0
        this.emitState('connected')
        // A state sink may synchronously stop this controller. Do not publish
        // a description for a generation that no longer exists afterward.
        if (this.isGenerationActive(ac)) {
          this.callSink(() => { this.sinks.onConnected?.(descriptionResult.value) })
        }
      } catch {
        // Transport failure: treat as generation failure, fall through to the shared backoff.
        if (!ac.signal.aborted) ac.abort()
      }

      await failed
      if (!this.isRunning()) return
      this.emitState('reconnecting')
      this.attempt += 1
      console.warn(`[web-runtime] connection lost, retry #${this.attempt}`)
      // 当前退避等待的可取消控制器。
      const idle = new AbortController()
      await sleep(this.backoffDelay(this.attempt), idle.signal)
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return
    this.lastState = state
    this.callSink(() => this.sinks.onStateChange?.(state))
  }

  private async pumpStream<F extends { type: string }>(
    stream: AsyncIterable<RpcRequest<F>>,
    sink: ((envelope: RpcRequest<F>) => void) | undefined,
    onEnd: () => void,
  ): Promise<void> {
    try {
      for await (const envelope of stream) {
        if (envelope.payload.type === 'stream/error') break
        if (sink !== undefined) this.callSink(() => { sink(envelope) })
      }
    } catch {
      // Stream loss: converge on onEnd, which triggers the shared reconnect.
    }
    onEnd()
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error('[web-runtime] connection sink threw:', error)
    }
  }
}
