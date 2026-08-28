/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-llm 包的入口与核心：实现 LLM 服务（LlmRuntime）——适配器
 * 注册表 + 可被瀑布流拦截的流式调用 API，并导出抽象适配器基类 LlmAdapter、
 * 块组装器 BlockAssembler 及全部公共类型。
 * 【技术维度】基于 vendored Cordis：LlmRuntime 继承 Service，注册通过
 * ctx.effect 登记（disposer 机制）；llm/stream 是 waterfall（瀑布流）事件，
 * 监听器可短路或拦截每个流式调用；注册表变更发布 llm/adapters-updated 事件。
 * 【产品维度】这是 harness 与所有 LLM provider 打交道的唯一入口：上层（agent
 * loop）只需调用 ctx.llm.stream/prepareCall，插件可在瀑布流上做重试、回放、
 * 路由等横切；对 provider 的自定义支持通过注册新适配器实现。
 * 【逻辑维度】错误与凭据 → 预备调用类型 → LlmAdapter 抽象 → 注册句柄 →
 * LlmRuntime（注册/替换/发现/解析/分发/流式）→ 结尾辅助与内部注册结构。
 * 【关键边界】"模型可见 ⟺ 已记录"：loop 构建的请求深冻结、只读；适配器边界
 * 的失败被规范化为终结性 finish 块；回放状态只在同一适配器实例同时拥有历史
 * 与目标 provider 时保留；prepareCall 的一次性分发音同一次适配器世代。
 * 【新手阅读建议】建议顺序：LlmRuntime 类（registerAdapter → stream →
 * adapterStream）→ LlmAdapter 抽象类 → PreparedLlmCall → 事件声明。
 * ==========================================================================
 */

/**
 * LLM service: adapter registry with a waterfall-interceptable streaming call
 * API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
 * provider backends, and `BlockAssembler` for chunk assembly.
 *
 * @module @deepseek-ai/dsh-llm
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GenerateOptions,
  LlmConfigurableProvider,
  LlmDiscoveredModel,
  LlmFailure,
  LlmImageRequestPricing,
  LlmModelContext,
  LlmModelDiscoveryRequest,
  LlmModelInfo,
  LlmResolvedModelInfo,
  LlmProviderInfo,
  ModelModality,
  StreamChunk,
} from './types.ts'
import { freezeMessage, type Message } from './message.ts'
import { resolveRetryPolicy } from './retry-policy.ts'
import type { ResolvedRetryPolicy } from './retry-policy.ts'
import type { ProviderRequestId } from './brand.ts'
import { callConfigEquals, deepFreeze } from './call-config.ts'
import type { LlmCallConfig, LlmCallConfigAdapterDefaults } from './call-config.ts'
import { HarnessError, INVALID_CREDENTIAL_CODE } from './error.ts'
import { normalizeLlmFailure } from './adapter-failure.ts'
import { normalizeApiKey } from './api-key.ts'
import { contentHasImage, projectImagesForTextModel } from './content.ts'

export * from './attribution.ts'
export * from './brand.ts'
export * from './never.ts'
export * from './error.ts'
export * from './api-key.ts'
export * from './types.ts'
export * from './content.ts'
export * from './message.ts'
export * from './retry-policy.ts'
export { BlockAssembler } from './assembler.ts'
export { callConfigEquals, deepFreeze, isAgentLoopRequest, markAgentLoopRequest } from './call-config.ts'
export type { LlmCallConfig, LlmCallConfigAdapterDefaults } from './call-config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmRuntime
  }

  interface Events {
    /**
     * Waterfall around every streaming model call (retry, replay, routing).
     * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
     * adapter's stream, or yield your own chunks to short-circuit.
     * @param options - the full request. A LOOP-built request carries the
     *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
     *   (mutation throws): its content is a pure function of the session log (the
     *   reconstructability Agent Note), so listeners read it, never rewrite it.
     *   Hand-built calls do not carry that marker; their messages already obey
     *   the immutable creation contract.
     * @mode waterfall
     */
    'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>

  }
}

/** Structured provider facts and cause accepted by {@link LlmError}. */
/*
 * （中文）LlmError 接受的结构化 provider 事实与 cause（ErrorOptions 的扩展）。
 */
export interface LlmErrorOptions extends ErrorOptions {
  /** Valid HTTP status observed at the provider boundary. */
  // 中文：在 provider 边界观察到的合法 HTTP 状态码。
  status?: number
  /** Positive finite provider-requested delay in milliseconds. */
  // 中文：provider 请求的正有限延迟毫秒数。
  providerRetryAfterMs?: number
  /** Non-empty opaque provider request id. */
  // 中文：非空的不透明 provider 请求 id。
  requestId?: ProviderRequestId
}

/*
 * （中文）LLM 相关失败的强类型错误。继承 HarnessError，因此 code 字符串
 * （如 AUTH、RATE_LIMIT、NO_ADAPTER）共享同一套分类法。
 */
/**
 * Typed error for LLM-related failures. Extends {@link HarnessError}, so the
 * `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
 */
export class LlmError extends HarnessError {
  /** Serializable facts retained beside this live Error. */
  // 中文：保存在这个活 Error 旁边的可序列化事实（冻结副本）。
  readonly failure: LlmFailure

  /*
   * （中文）构造 LlmError：先校验参数（message/code 非空字符串、status 为
   * 100~599 整数、延迟为正有限数、requestId 非空），再冻结 failure 快照。
   * @param message 非空的人类可读失败摘要。
   * @param code 非空的稳定、provider 无关的机器码。
   * @param options 可选的 cause 与已校验的可序列化 provider 事实。
   */
  /**
   * @param message - non-empty human-readable failure summary.
   * @param code - non-empty stable provider-neutral machine code.
   * @param options - optional cause and validated serializable provider facts.
   */
  constructor(message: string, code: string, options?: LlmErrorOptions) {
    if (typeof message !== 'string' || message.length === 0) throw new Error('LlmError message must be a non-empty string')
    if (typeof code !== 'string' || code.length === 0) throw new Error('LlmError code must be a non-empty string')
    if (options?.status !== undefined
      && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) {
      throw new Error('LlmError status must be an integer from 100 through 599')
    }
    if (options?.providerRetryAfterMs !== undefined
      && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) {
      throw new Error('LlmError providerRetryAfterMs must be a positive finite number')
    }
    if (options?.requestId !== undefined
      && (typeof options.requestId !== 'string' || options.requestId.length === 0)) {
      throw new Error('LlmError requestId must be a non-empty string')
    }
    super(message, code, options)
    this.name = 'LlmError'
    // 中文：只把提供了的字段写进失败快照，快照整体冻结，防止后续被改写。
    this.failure = Object.freeze({
      message,
      code,
      ...options?.status === undefined ? {} : { status: options.status },
      ...options?.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
      ...options?.requestId === undefined ? {} : { requestId: options.requestId },
    })
  }
}

/*
 * （中文）接受一个提供的凭据，或者把它判为不可用并拒绝。
 * 已存 key 可能来自凭据缝合层、.env 行或 shell 导出，都可能带周围空白，所以
 * 静默 trim；其他任何问题都失败在这里而非 fetch 内部（后者只报 UTF-16 码点
 * 位置，无法指出该改哪个配置）。key 本身绝不进入报错信息：ref 指名修哪里，
 * 把密钥的任何片段回显进日志或 UI 正是本诊断要避免的失败。
 * 放在 LlmError 旁边而非 ./api-key.ts，是为了让判定模块保持零依赖；两个适配器
 * 共享这一处诊断，而不各自维护近乎相同的本地副本。
 * @param raw 原样提供的凭据。
 * @param pkg 拒绝方包名，前缀进诊断信息。
 * @param ref 该值解析所经过的凭据引用。
 * @returns trim 后的可用 key。
 */
/**
 * Accept one supplied credential, or refuse it as unusable.
 *
 * A stored key arrives from the credentials seam, a `.env` line, or a shell
 * export, all of which pick up surrounding whitespace, so trimming is silent.
 * Anything else fails here rather than inside `fetch`, whose ByteString
 * refusal names a UTF-16 code point instead of the setting to change. The key
 * never enters the message: `ref` names where to fix it, and echoing any part
 * of a secret into a log or a UI is the failure this diagnosis avoids.
 *
 * Lives beside {@link LlmError} rather than in `./api-key.ts` so the predicate
 * module stays dependency-free; both adapters share this one diagnosis instead
 * of keeping near-identical local copies.
 * @param raw - the credential exactly as supplied.
 * @param pkg - the refusing package name, prefixed to the diagnostic.
 * @param ref - the credential reference the value resolved through.
 * @returns the trimmed, usable key.
 */
export function assertUsableApiKey(raw: string, pkg: string, ref: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  // The Models page is named as the writer it usually is, not as the only one:
  // the same value can arrive from a hand-edited .env or a shell export in a
  // composition that mounts no credentials seam at all, where directing the
  // user to a page that deployment does not serve would be a dead end.
  // 中文：把 Models 页面称为"通常的写入者"而非唯一来源：同样的值可能来自手工
  // 编辑的 .env 或 shell 导出（在完全没有挂载凭据缝合层的组合里），此时把用户
  // 指向部署并不提供的页面会是个死胡同。
  throw new LlmError(
    checked.reason === 'empty'
      ? `${pkg}: the API key resolved from ${ref} is blank; set ${ref} to the raw key`
        + ' (the web Models page writes it) or export it in the launching environment'
      : `${pkg}: the API key resolved from ${ref} contains characters no HTTP header can carry;`
        + ` set ${ref} to the raw key alone (the web Models page writes it)`,
    INVALID_CREDENTIAL_CODE,
  )
}

/** One model call whose config and adapter registration were resolved together. */
/*
 * （中文）一次"配置与适配器注册一起被解析好"的模型调用预备体。
 */
export interface PreparedLlmCall {
  /** Detached, deep-frozen config with any adapter-owned default materialized. */
  // 中文：已剥离并深冻结的配置，适配器自有默认值已物化。
  readonly config: LlmCallConfig
  /** Immutable retry policy captured with the adapter registration. */
  // 中文：随适配器注册捕获的不可变重试策略。
  readonly retryPolicy: ResolvedRetryPolicy
  /** Detached context metadata resolved with the registration-bound call. */
  // 中文：随注册绑定的调用解析出的剥离上下文元数据。
  readonly context?: LlmModelContext
  /** Exact model modalities captured with the adapter dispatch generation. */
  // 中文：随适配器分发世代捕获的精确模型模态。
  readonly inputModalities?: readonly ModelModality[]
  /** Config fields materialized by the captured adapter rather than proposed by the caller. */
  // 中文：由捕获的适配器（而非调用方提议）物化的配置字段标记。
  readonly adapterDefaults: LlmCallConfigAdapterDefaults
  /*
   * （中文）通过预备时捕获的注册，一次性分发这次调用。请求的 call-config 字段
   * 必须与 config 一致；复用或错配会以 INVALID_PREPARED_CALL 失败。
   * @param options 携带预备配置的完整组装请求。
   * @returns chunk 流（包含 llm/stream 瀑布流）。
   */
  /**
   * Dispatch this call once through the registration captured during
   * preparation. The request's call-config fields must match {@link config};
   * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
   * @param options - fully assembled request carrying the prepared config.
   * @returns the chunk stream, including the `llm/stream` waterfall.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** One adapter-owned model-resolution generation bound to its eventual stream call. */
/*
 * （中文）一次"适配器自有的模型解析世代"与其最终流式调用的绑定。
 */
export interface PreparedAdapterCall {
  /** Exact model metadata from the same adapter generation as {@link stream}. */
  // 中文：与 stream 同属一次适配器世代的精确模型元数据。
  readonly model: LlmResolvedModelInfo
  /** Dispatch through that generation without re-reading dynamic connection facts. */
  // 中文：直接通过该世代分发，不再重读动态连接事实。
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/*
 * （中文）面向 harness 消息与流词汇的 provider 线上适配器。用
 * ctx.llm.registerAdapter(providers, adapter) 注册实现。每个 provider HTTP
 * 请求都必须包含 attributionHeaders()；须证明头已加进线上请求或库头钩子。
 * 直连 fetch 的 DeepSeek 适配器与库驱动的 pi-ai 适配器以不同内部实现满足
 * 该约定。
 */
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
export abstract class LlmAdapter {
  /*
   * （中文）描述本适配器拥有的一个 provider 路由。
   * @param provider 传给本实例 registerAdapter() 的路由。
   * @returns 剥离的展示元数据，其 id 必须等于 provider。
   */
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: provider }
  }

  /**
   * （中文）返回随此路由捕获的 provider 自有重试策略。
   * @param _provider 传给本实例 registerAdapter() 的路由。
   * @returns 已解析的策略；返回 undefined 则使用正常默认值。
   */
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined {
    return undefined
  }

  /**
   * Resolve provider-side request-image pricing for one exact model route.
   * The default declares none, so consumers fall back to their own neutral
   * estimate. Implementations must answer synchronously without I/O; the
   * token meter resolves this per measurement.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @param _model - exact model id passed to {@link GenerateOptions.model}.
   * @returns route-owned image pricing, or `undefined` when the route declares none.
   */
  imageRequestPricing(_provider: string, _model: string): LlmImageRequestPricing | undefined {
    return undefined
  }

  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([])
  }

  /**
   * （中文）解析某个精确模型可获得的全部元数据。该查询独立于建议性目录，也
   * 不校验请求路由。
   * @param provider 本适配器拥有的一条 provider 路由。
   * @param model 传给 GenerateOptions.model 的精确模型 id。
   * @param _signal 本次精确模型查询的取消信号；异步实现必须在其 abort 后
   *   迅速收敛。
   * @returns provider/模型身份，加上可用的上下文、调用默认与推理元数据。
   */
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  /**
   * （中文）把精确模型元数据与最终的请求分发绑定到一次适配器世代。动态适配器
   * 会覆写它，使"预备与分发之间"的设置变化无法把某一世代的能力与另一世代的
   * 端点混在一起。
   * @param provider 已注册的 provider 路由。
   * @param model 精确模型 id。
   * @param signal 模型解析的取消信号。
   * @returns 模型元数据与一个单世代流入口。
   */
  /**
   * Bind exact model metadata and the eventual request dispatch to one adapter generation.
   * Dynamic adapters override this so settings changes between preparation and
   * dispatch cannot combine one generation's capabilities with another's endpoint.
   * @param provider - registered provider route.
   * @param model - exact model id.
   * @param signal - cancellation for model resolution.
   * @returns model metadata and a one-generation stream entry point.
   */
  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.stream(options),
    }
  }

  /**
   * （中文）把一次模型调用流式输出为原始 chunk。唯一必须实现的方法。
   * @param options 完整组装好的请求；实现必须遵守 options.signal。
   * @returns chunk 流，遵循 StreamChunk 上记载的适配器约定。
   */
  /**
   * Stream one model call as raw chunks. The only required method.
   * @param options - the fully-assembled request; implementations must honor `options.signal`.
   * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/**
 * （中文）LlmRuntime.registerAdapter 的返回值：disposer（释放函数），外加
 * 针对同一适配器实例的原子路由替换能力。
 */
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
export interface AdapterRegistrationHandle {
  /** Release every route this registration currently holds. */
  // 中文：释放本注册当前持有的全部路由。
  (): void
  /*
   * （中文）用 providers 替换本注册的路由，保持同一适配器实例。候选集先整体
   * 校验——与其他适配器冲突、名称非法或 provider 元数据错误都会抛错并保持
   * 现有路由不变——而交换本身是一个同步区段，没有任何请求能观察到空档。
   * 空数组在此合法（设置段清空后注册仍然存在但持有零路由），与"初始注册不
   * 能为空"不同。
   * 注册一旦被释放再调用会抛 code 为 REGISTRATION_DISPOSED 的 LlmError：
   * 路由已消失、disposer 已运行，之后注册的任何东西都没有持有者来释放它。
   * @param providers 本注册完整的下一组路由。
   */
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. The candidate set is validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap itself is
   * one synchronous section, so no request can observe a gap. An empty array
   * is legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been released: its routes are gone and its disposer has already run,
   * so anything registered afterwards would have no owner left to release it.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}

/**
 * （中文）一个活跃的"可配置 provider"注册，可释放、可原子替换——是
 * AdapterRegistrationHandle 在目录（directory）侧的对应物。
 */
/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable — the directory counterpart of {@link AdapterRegistrationHandle}.
 */
export interface DirectoryRegistrationHandle {
  /** Withdraw every entry this registration currently holds. */
  // 中文：撤回本注册当前持有的全部条目。
  (): void
  /**
   * （中文）用 entries 替换本注册的条目。候选集先整体校验——已被其他注册声明
   * 的条目、集合内重复或元数据非法都会抛错并保持现有条目不变——交换是单个
   * 同步区段，任何读取方都观察不到空档。空数组在此合法，与初始注册不能为空
   * 不同。
   * 注册被释放后再调用会抛 code 为 REGISTRATION_DISPOSED 的 LlmError。
   */
  /**
   * Replace this registration's entries with `entries`. The candidate set is
   * validated in full first — an entry another registration already declares,
   * a duplicate within the set, or invalid metadata throws and leaves the
   * current entries untouched — and the swap is one synchronous section, so no
   * reader observes a gap. An empty array is legal here, unlike an empty
   * initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been disposed.
   */
  replace(entries: readonly LlmConfigurableProvider[]): void
}

/**
 * （中文）抽象的 llm 服务：适配器注册表 + 流式模型调用 API，可通过
 * llm/stream 瀑布流拦截。
 */
/**
 * The abstract `llm` service: an adapter registry plus a streaming model-call
 * API, interceptable via the `llm/stream` waterfall.
 */
export class LlmRuntime extends TypertRemoteService {
  private adapters = new Map<string, AdapterRegistration>()
  // 中文：provider 路由 → 可配置 provider 条目（目录）。
  private directory = new Map<string, LlmConfigurableProvider>()
  // 中文：settings 命名空间 → 模型发现回调。
  private discoveries = new Map<
    string,
    (request: LlmModelDiscoveryRequest, signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>
  >()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /** Notify topology observers without letting one broken listener veto the commit. */
  // 中文：通知拓扑观察者，且不让一个损坏的监听器否决注册表提交。
  private emitAdaptersUpdated(): void {
    // Cordis emit uses Array.map: one synchronous throw starves later
    // listeners. Registry notifications are non-vetoing, so contain each
    // callback independently; INVARIANT-coded failures still surface.
    // 中文：Cordis 的 emit 用 Array.map 实现：一个同步抛错会饿死后续监听器。
    // 注册表通知不可否决，所以逐个隔离回调；INVARIANT 码的失败仍然上浮。
    let invariantFailure: unknown
    for (const listener of this.ctx.events.dispatch('emit', ['llm/adapters-updated']) as Array<() => unknown>) {
      try {
        const returned = listener()
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          // An emit listener may still be an async function; its rejection
          // cannot reach the synchronous INVARIANT rethrow below, so it is
          // contained here instead of becoming an unhandled rejection.
          // 中文：emit 监听器仍可能是 async 函数；其 rejection 到不了下面同步
          // 的 INVARIANT 重抛，所以在这里隔离，避免变成未处理的 rejection。
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnAdaptersListenerFailure(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnAdaptersListenerFailure(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }

  /** Contained-listener diagnostic shared by the sync and async failure paths. */
  // 中文：同步与异步失败路径共用的"被隔离监听器"诊断日志。
  private warnAdaptersListenerFailure(error: unknown): void {
    this.ctx.logger.warn('llm: an llm/adapters-updated listener failed')
    this.ctx.logger.warn(error)
  }

  /**
   * （中文）为给定 provider 路由注册一个适配器。任何 provider 已有适配器时抛
   * code 为 DUPLICATE_ADAPTER 的 LlmError（全有或全无）。随 fiber 一起销毁。
   * @param providers 该适配器服务的所有 provider 路由。
   * @param adapter 为这些 provider 流式处理调用的适配器。
   * @returns disposer，携带 AdapterRegistrationHandle.replace。
   */
  /**
   * Register an adapter for the given provider routes. Throws `LlmError` with code
   * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
   * Disposed with the fiber.
   * @param providers - every provider route this adapter should serve.
   * @param adapter - the adapter that streams calls for those providers.
   * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
   */
  registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle {
    // The routes this registration currently holds; `replace` rewrites it, and
    // the disposer releases whatever it holds at disposal time.
    // 中文：本注册当前持有的路由；replace 重写它，disposer 在释放时释放它
    // 当时持有的所有路由。
    const owned = new Set<string>()
    // The disposer has run: `owned` being empty cannot say so on its own,
    // because `replace([])` legally leaves a live registration holding none.
    // 中文：disposer 是否已运行：owned 为空本身不能说明这一点，因为
    // replace([]) 合法地让一个存活注册持有零路由。
    let released = false
    const dispose = this.ctx.effect(function* (this: LlmRuntime) {
      if (providers.length === 0) throw new LlmError('an adapter must register at least one provider', 'INVALID_ADAPTER')
      this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned))
      yield () => {
        released = true
        for (const provider of owned) this.adapters.delete(provider)
        owned.clear()
        this.emitAdaptersUpdated()
      }
    }.bind(this), 'llm.registerAdapter()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    // 中文：ctx.effect 的 disposer 返回 Promise<void>；我们的 disposer API 是
    // 同步即发即忘——丢弃这个（总是已 resolve 的）promise。
    const handle = (() => void dispose()) as AdapterRegistrationHandle
    handle.replace = (next: string[]): void => {
      // Registering here would leak: the effect's disposer already ran, so
      // nothing remains to release whatever this call would put in the map.
      // 中文：在这里注册会泄漏：effect 的 disposer 已运行，这次调用放进 map
      // 的任何东西都不会再有持有者释放。
      if (released) {
        throw new LlmError('a disposed adapter registration cannot replace its routes', 'REGISTRATION_DISPOSED')
      }
      this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned))
    }
    return handle
  }

  /**
   * （中文）为 adapter 校验一组候选路由，把本注册已持有的路由视为可用。
   * 不做任何变更：被拒绝的候选会原封不动留下注册表。
   */
  /**
   * Validate one candidate route set for `adapter`, treating routes this
   * registration already holds as available. Nothing is mutated: a rejected
   * candidate leaves the registry exactly as it was.
   */
  private prepareRoutes(providers: string[], adapter: LlmAdapter, owned: ReadonlySet<string>): AdapterRegistration[] {
    const unique = new Set<string>()
    const registrations: AdapterRegistration[] = []
    for (const provider of providers) {
      // 中文：逐路由校验：非空名、不与他人冲突、元数据必须保留 id 且 name 非空。
      if (provider.length === 0) throw new LlmError('adapter provider names must be non-empty', 'INVALID_ADAPTER')
      if (unique.has(provider) || (this.adapters.has(provider) && !owned.has(provider))) {
        throw new LlmError(`an adapter for provider "${provider}" is already registered`, 'DUPLICATE_ADAPTER')
      }
      const info = adapter.providerInfo(provider)
      if (typeof info.id !== 'string' || info.id !== provider || typeof info.name !== 'string' || info.name.length === 0) {
        throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, 'INVALID_ADAPTER')
      }
      unique.add(provider)
      // 中文：重试策略取适配器自有的；缺省时解析成正常默认值。
      const retryPolicy = adapter.providerRetryPolicy(provider)
        ?? resolveRetryPolicy(undefined, `llm: provider "${provider}" retryPolicy`)
      registrations.push({
        adapter,
        provider: { id: info.id, name: info.name },
        retryPolicy,
      })
    }
    return registrations
  }

  /**
   * （中文）在一个同步区段内把本注册的路由换成已预备的路由，任何观察者都
   * 看不到"先释放再注册"之间的空档。这个唯一变更点也正是发布
   * llm/adapters-updated 的地方，因此一次 replace 与首次注册一样会自我宣告。
   */
  /**
   * Swap this registration's routes for the prepared ones in one synchronous
   * section, so no observer can see the registry between the release and the
   * re-registration. The route set's one mutation point is also where
   * `llm/adapters-updated` is published, so a `replace` announces itself
   * exactly like a first registration.
   */
  private commitRoutes(owned: Set<string>, registrations: readonly AdapterRegistration[]): void {
    for (const provider of owned) this.adapters.delete(provider)
    owned.clear()
    for (const registration of registrations) {
      this.adapters.set(registration.provider.id, registration)
      owned.add(registration.provider.id)
    }
    this.emitAdaptersUpdated()
  }

  /**
   * （中文）描述注册了适配器的 provider 路由。
   * @returns 按注册顺序排列的剥离 provider 元数据。
   */
  /**
   * Describe provider routes with a registered adapter.
   * @returns detached provider metadata in registration order.
   */
  @Remote
  listProviders(): LlmProviderInfo[] {
    return [...this.adapters.values()].map(({ provider }) => ({ ...provider }))
  }

  /**
   * （中文）声明适配器插件可通过配置激活的 provider 路由。注册全有或全无：
   * 空列表、非法条目或任何注册已声明的 provider 都会抛 LlmError 而不注册
   * 其余部分。随 fiber 一起销毁。
   * @param entries 该插件拥有的每个可配置 provider。
   * @returns 一个可撤回全部条目、且能原子替换它们的句柄。
   */
  /**
   * Declare provider routes an adapter plugin can activate through
   * configuration. Registration is all-or-nothing: an empty list, invalid
   * entry, or a provider already declared by any registration throws
   * `LlmError` without registering the rest. Disposed with the fiber.
   * @param entries - every configurable provider this plugin owns.
   * @returns a handle that withdraws all of them, and can atomically replace them.
   */
  registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle {
    // 中文：本注册当前持有的条目；替换/释放时更新。
    let held: LlmConfigurableProvider[] = []
    // 中文：disposer 是否已运行（与 held 为空无关，因为 replace([]) 合法）。
    let disposed = false
    /**
     * （中文）对候选集整体做校验（针对本注册尚未持有的部分），再发布它。
     * 整个集合通过前不写任何东西，因此被拒绝的候选会原样保留现有条目——
     * 这正是 replace 成为"交换"而非"先删后加（可能把目录清空）"的性质。
     */
    /**
     * Validate a candidate set in full against everything this registration
     * does not already hold, then publish it. Nothing is written until the
     * whole set passes, so a refused candidate leaves the current entries in
     * place — the property that makes `replace` a swap rather than a
     * delete-then-add that can strand the directory empty.
     */
    const commit = (candidates: readonly LlmConfigurableProvider[]): void => {
      const detached: LlmConfigurableProvider[] = []
      // 中文：本注册已持有（可被替换）的 provider 集合，用于冲突判定。
      const own = new Set(held.map(entry => entry.provider))
      for (const entry of candidates) {
        if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) {
          throw new LlmError('configurable providers need a non-empty provider, displayName, and settingsNs', 'INVALID_DIRECTORY')
        }
        if (entry.settingsPath.some(segment => segment.length === 0)) {
          throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, 'INVALID_DIRECTORY')
        }
        if ((this.directory.has(entry.provider) && !own.has(entry.provider))
          || detached.some(seen => seen.provider === entry.provider)) {
          throw new LlmError(`configurable provider "${entry.provider}" is already declared`, 'DUPLICATE_DIRECTORY')
        }
        // 中文：剥离（深拷贝 settingsPath 数组），防止外部改动污染目录。
        detached.push({ ...entry, settingsPath: [...entry.settingsPath] })
      }
      for (const entry of held) this.directory.delete(entry.provider)
      for (const entry of detached) this.directory.set(entry.provider, entry)
      held = detached
      this.emitAdaptersUpdated()
    }

    const dispose = this.ctx.effect(function* (this: LlmRuntime) {
      if (entries.length === 0) {
        throw new LlmError('a configurable-provider registration must declare at least one provider', 'INVALID_DIRECTORY')
      }
      commit(entries)
      yield () => {
        disposed = true
        for (const entry of held) this.directory.delete(entry.provider)
        held = []
        this.emitAdaptersUpdated()
      }
    }.bind(this), 'llm.registerConfigurableProviders()')

    const handle = ((): void => void dispose()) as DirectoryRegistrationHandle
    handle.replace = (next: readonly LlmConfigurableProvider[]): void => {
      if (disposed) {
        throw new LlmError('this configurable-provider registration was disposed', 'REGISTRATION_DISPOSED')
      }
      commit(next)
    }
    return handle
  }

  /**
   * （中文）列出每个已声明的可配置 provider（已注册或休眠）。
   * @returns 按声明顺序排列的剥离目录条目。
   */
  /**
   * List every declared configurable provider, registered or dormant.
   * @returns detached directory entries in declaration order.
   */
  @Remote
  listConfigurableProviders(): LlmConfigurableProvider[] {
    return [...this.directory.values()].map(entry => ({ ...entry, settingsPath: [...entry.settingsPath] }))
  }

  /**
   * （中文）代表本插件拥有的 settings 命名空间，主动提供"探询 provider 端点"
   * 的能力。以命名空间为键，是因为配置界面从可配置 provider 目录已持有的
   * 就是命名空间，而且一个正在被添加的 provider 还没有可命名的路由。
   * 随 fiber 一起销毁。
   * @param settingsNs 本发现服务所服务的命名空间。
   * @param discover 探询一个端点；必须遵守 request.signal。
   * @returns 撤回该提议的 disposer。
   */
  /**
   * Offer to interrogate provider endpoints on behalf of the settings
   * namespace this plugin owns. The namespace is the key because that is what
   * a configuration surface already holds from the configurable-provider
   * directory, and because a provider being *added* has no route to name yet.
   * Disposed with the fiber.
   * @param settingsNs - the namespace whose profiles this discovery serves.
   * @param discover - interrogates one endpoint and must honor the supplied signal.
   * @returns the disposer that withdraws the offer.
   */
  registerModelDiscovery(
    settingsNs: string,
    discover: (
      request: LlmModelDiscoveryRequest,
      signal?: AbortSignal,
    ) => Promise<readonly LlmDiscoveredModel[]>,
  ): () => void {
    const dispose = this.ctx.effect(function* (this: LlmRuntime) {
      if (settingsNs.length === 0) {
        throw new LlmError('model discovery needs a non-empty settings namespace', 'INVALID_DISCOVERY')
      }
      if (this.discoveries.has(settingsNs)) {
        throw new LlmError(`model discovery for "${settingsNs}" is already registered`, 'DUPLICATE_DISCOVERY')
      }
      this.discoveries.set(settingsNs, discover)
      yield () => {
        this.discoveries.delete(settingsNs)
      }
    }.bind(this), 'llm.registerModelDiscovery()')
    return () => void dispose()
  }

  /**
   * （中文）探询一个 provider 端点以获取其宣传的模型。请求描述的是"草稿"而非
   * 已存路由，因此这里不读写任何设置或凭据——两者都由调用方持有——回复只是
   * 界面可能采纳的候选元数据。
   * @param settingsNs 服务该草稿的已注册发现所属命名空间。
   * @param request 要使用的端点、协议与一次性凭据。
   * @returns 按端点顺序去重后的宣传模型。
   */
  /**
   * Interrogate one provider endpoint for the models it advertises. The
   * request describes a draft, not a stored route, so nothing here reads or
   * writes settings or credentials — the caller owns both, and the reply is
   * candidate metadata a surface may offer for adoption.
   * @param settingsNs - namespace whose registered discovery serves this draft.
   * @param request - the endpoint, protocol, and one-shot credential to use.
   * @param signal - caller cancellation.
   * @returns the advertised models, deduplicated in endpoint order.
   */
  async discoverModels(
    settingsNs: string,
    request: LlmModelDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<LlmDiscoveredModel[]> {
    const discover = this.discoveries.get(settingsNs)
    if (discover === undefined) {
      throw new LlmError(`no model discovery is registered for "${settingsNs}"`, 'NO_DISCOVERY')
    }
    // One of the two identifies what to describe: a route the adapter knows, or
    // an endpoint to ask. Neither leaves nothing to answer about.
    // 中文：两者之一必须能指明"描述什么"：适配器认识的路由，或要去问的端点。
    // 两者皆无就无从回答。
    if ((request.provider ?? '').length === 0 && (request.baseURL ?? '').length === 0) {
      throw new LlmError('model discovery needs a provider route or a baseURL', 'INVALID_DISCOVERY')
    }
    const discovered = signal === undefined
      ? await discover(request)
      : await discover(request, signal)
    const seen = new Set<string>()
    const models: LlmDiscoveredModel[] = []
    for (const model of discovered) {
      if (typeof model.id !== 'string' || model.id.length === 0 || seen.has(model.id)) continue
      seen.add(model.id)
      models.push({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      })
    }
    return models
  }

  /**
   * Remote adapter for one draft provider interrogation.
   * @param settingsNs - namespace whose registered discovery serves this draft.
   * @param request - endpoint, protocol, and one-shot credential to use.
   * @param signal - caller cancellation supplied by the Remote carrier.
   * @returns advertised models in endpoint order.
   * @throws TypertRemoteFailure with `model-discovery-failed` when discovery refuses or fails.
   */
  @Remote('discoverModels')
  async remoteDiscoverModels(
    settingsNs: string,
    request: LlmModelDiscoveryRequest,
    signal: AbortSignal,
  ): Promise<LlmDiscoveredModel[]> {
    try {
      return await this.discoverModels(settingsNs, request, signal)
    } catch (error: unknown) {
      throw new TypertRemoteFailure({
        code: 'model-discovery-failed',
        message: error instanceof Error ? error.message : String(error),
        details: {
          settingsNs,
          ...request.baseURL === undefined ? {} : { baseURL: request.baseURL },
        },
      })
    }
  }

  /**
   * Resolve the retry policy captured when one provider route was registered.
   * @param provider - registered provider route to inspect.
   * @returns the provider-owned policy, with normal defaults already resolved.
   */
  providerRetryPolicy(provider: string): ResolvedRetryPolicy {
    return this.registration(provider).retryPolicy
  }

  /**
   * Resolve provider-side request-image pricing for one exact route, or
   * `undefined` when the provider is unregistered or declares none. Unknown
   * providers degrade to `undefined` rather than throwing because callers
   * price durable history whose route may no longer be mounted.
   * @param provider - provider route named by a request header.
   * @param model - exact model id named by the same header.
   * @returns the owning adapter's image pricing for the route, when declared.
   */
  imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined {
    return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model)
  }

  /** Detach typed adapter-owned modality metadata. */
  // 中文：剥离（复制数组）类型化的适配器自有模态元数据；未定义则返回 undefined。
  private detachedModalities(modalities: readonly ModelModality[] | undefined): ModelModality[] | undefined {
    return modalities === undefined ? undefined : [...modalities]
  }

  /**
   * （中文）发现某个已注册 provider 宣传的模型。目录成员资格只是建议性，
   * 永不改变路由或请求校验。
   * @param provider 要检查的已注册 provider 路由。
   * @returns 按适配器偏好顺序排列的剥离模型元数据。
   */
  /**
   * Discover models advertised by one registered provider. Catalog membership
   * is advisory and never changes routing or request validation.
   * @param provider - registered provider route to inspect.
   * @returns detached model metadata in adapter-preferred order.
   */
  async listModels(provider: string): Promise<LlmModelInfo[]> {
    const adapter = this.registration(provider).adapter
    const models = await adapter.listModels(provider)
    const seen = new Set<string>()
    return models.map((model) => {
      // 中文：逐条校验元数据合法性并去重，非法即抛错（INVALID_CATALOG）。
      if (
        typeof model.provider !== 'string'
        || model.provider !== provider
        || typeof model.id !== 'string'
        || model.id.length === 0
        || typeof model.name !== 'string'
        || model.name.length === 0
        || (model.description !== undefined && typeof model.description !== 'string')
        || seen.has(model.id)
      ) {
        throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, 'INVALID_CATALOG')
      }
      seen.add(model.id)
      const inputModalities = this.detachedModalities(model.inputModalities)
      return {
        provider: model.provider,
        id: model.id,
        name: model.name,
        ...model.description === undefined ? {} : { description: model.description },
        ...inputModalities === undefined ? {} : { inputModalities },
      }
    })
  }

  /**
   * （中文）从拥有该精确路由的适配器解析并校验全部元数据。结果与适配器自有
   * 对象脱离；目录成员资格仍只是建议性，不控制请求路由。
   * @param provider 要检查的已注册 provider 路由。
   * @param model 传给适配器的精确模型 id。
   * @param signal 可选的适配器自有异步查询取消信号。
   * @returns 精确模型身份，加可用的上下文与推理元数据。
   */
  /**
   * Resolve and validate all metadata from the adapter that owns one exact
   * route. The result is detached from adapter-owned objects; catalog
   * membership remains advisory and does not control request routing.
   * @param provider - registered provider route to inspect.
   * @param model - exact model id passed to the adapter.
   * @param signal - optional cancellation for adapter-owned asynchronous lookup.
   * @returns exact model identity plus available context and reasoning metadata.
   */
  async resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return this.resolveModelInfoFor(this.registration(provider), model, signal)
  }

  // 中文：按已解析的注册执行精确模型解析，并规范化为剥离结果。
  private async resolveModelInfoFor(
    registration: AdapterRegistration,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal)
    return this.normalizeModelInfo(registration, model, resolved)
  }

  /** Validate and detach one adapter-returned exact model result. */
  // 中文：校验并剥离一条适配器返回的精确模型结果（字段合法性、能力元数据、
  // 推理强度去重与默认值指向检查）。
  private normalizeModelInfo(
    registration: AdapterRegistration,
    model: string,
    resolved: LlmResolvedModelInfo,
  ): LlmResolvedModelInfo {
    const provider = registration.provider.id
    if (
      typeof resolved.provider !== 'string'
      || resolved.provider !== provider
      || typeof resolved.id !== 'string'
      || resolved.id !== model
      || typeof resolved.name !== 'string'
      || resolved.name.length === 0
      || (resolved.description !== undefined && typeof resolved.description !== 'string')
    ) {
      throw new LlmError(
        `adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`,
        'INVALID_MODEL_INFO',
      )
    }
    const context = resolved.context
    if (context !== undefined && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) {
      throw new LlmError(
        `adapter returned invalid context metadata for provider "${provider}" model "${model}"`,
        'INVALID_MODEL_CONTEXT',
      )
    }
    // Capability metadata rides through: an explicit modality omission is
    // negative capability downstream preflights act on (image admission).
    // 中文：能力元数据原样携带：显式省略某种模态就是"负能力"，下游预检
    // （如图片准入）会据此处理。
    const inputModalities = this.detachedModalities(resolved.inputModalities)
    const defaultMaxTokens = resolved.defaultMaxTokens
    if (defaultMaxTokens !== undefined
      && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) {
      throw new LlmError(
        `adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`,
        'INVALID_MODEL_MAX_TOKENS',
      )
    }
    const info: LlmResolvedModelInfo = {
      provider,
      id: model,
      name: resolved.name,
      ...resolved.description === undefined ? {} : { description: resolved.description },
      ...inputModalities === undefined ? {} : { inputModalities },
      ...context === undefined ? {} : { context: { contextWindow: context.contextWindow } },
      ...defaultMaxTokens === undefined ? {} : { defaultMaxTokens },
    }
    const reasoning = resolved.reasoning
    if (reasoning === undefined) return info
    // 中文：推理强度列表校验：非空、逐项合法、id 去重，defaultEffort 必须
    // 指向列表内已有的 id。
    if (reasoning.efforts.length === 0) {
      throw new LlmError(
        `adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`,
        'INVALID_MODEL_REASONING',
      )
    }
    const seen = new Set<string>()
    const efforts = reasoning.efforts.map((effort) => {
      if (
        typeof effort.id !== 'string'
        || effort.id.length === 0
        || typeof effort.name !== 'string'
        || effort.name.length === 0
        || (effort.description !== undefined && typeof effort.description !== 'string')
        || seen.has(effort.id)
      ) {
        throw new LlmError(
          `adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`,
          'INVALID_MODEL_REASONING',
        )
      }
      seen.add(effort.id)
      return {
        id: effort.id,
        name: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      }
    })
    if (reasoning.defaultEffort !== undefined && !seen.has(reasoning.defaultEffort)) {
      throw new LlmError(
        `adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`,
        'INVALID_MODEL_REASONING',
      )
    }
    return {
      ...info,
      reasoning: {
        efforts,
        ...reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort },
      },
    }
  }

  /**
   * （中文）对照精确模型能力校验对话调用配置，并物化适配器配置的默认值。
   * 明确不支持的努力级别在 provider I/O 之前即被拒绝；不做任何钳制或别名化。
   * 该独立查询不绑定后续分发；需要日志与流式共享同一适配器注册时用
   * prepareCall。
   * @param config provider/model 路由与可选请求控制。
   * @param signal 可选的适配器自有能力查询取消信号。
   * @returns 仅在必须物化某个默认值时才返回一份剥离配置。
   */
  /**
   * Validate a conversation call config against its exact model capability and
   * materialize adapter-configured defaults. Unsupported explicit efforts
   * reject before provider I/O; no clamping or aliasing is performed. This
   * standalone query does not bind a later dispatch; use {@link prepareCall}
   * when logging and streaming must share one adapter registration.
   * @param config - provider/model route and optional request controls.
   * @param signal - optional cancellation for adapter-owned capability lookup.
   * @returns a detached config only when a default must be materialized.
   */
  async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig> {
    return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config
  }

  // 中文：按注册解析调用：先解析精确模型信息，再基于其校验请求控制。
  private async resolveCallFor(
    registration: AdapterRegistration,
    config: LlmCallConfig,
    signal?: AbortSignal,
  ): Promise<{ config: LlmCallConfig; context?: LlmModelContext; modelInfo: LlmResolvedModelInfo }> {
    const info = await this.resolveModelInfoFor(registration, config.model, signal)
    return this.resolveCallWithInfo(config, info)
  }

  /** Validate request controls against one already-bound exact model result. */
  // 中文：对照一个已绑定的精确模型结果校验请求控制：物化 maxTokens 默认、
  // 校验推理强度（模型不支持或明确指定未知强度时抛错）。
  private resolveCallWithInfo(
    config: LlmCallConfig,
    info: LlmResolvedModelInfo,
  ): { config: LlmCallConfig; context?: LlmModelContext; modelInfo: LlmResolvedModelInfo } {
    const defaulted = config.maxTokens === undefined && info.defaultMaxTokens !== undefined
      ? { ...config, maxTokens: info.defaultMaxTokens }
      : config
    const reasoning = info.reasoning
    const requested = defaulted.reasoningEffort
    let resolvedConfig = defaulted
    if (reasoning === undefined) {
      if (requested !== undefined) {
        throw new LlmError(
          `provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`,
          'UNSUPPORTED_REASONING_EFFORT',
        )
      }
    } else {
      const effective = requested ?? reasoning.defaultEffort
      if (effective !== undefined) {
        if (!reasoning.efforts.some(effort => effort.id === effective)) {
          throw new LlmError(
            `provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`,
            'UNSUPPORTED_REASONING_EFFORT',
          )
        }
        // 中文：调用方没指定而模型有默认时，把默认值物化进配置，保证后续
        // 请求头与日志一致。
        if (requested !== effective) resolvedConfig = { ...defaulted, reasoningEffort: effective }
      }
    }
    return {
      config: resolvedConfig,
      ...info.context === undefined ? {} : { context: info.context },
      modelInfo: info,
    }
  }

  /**
   * （中文）在其当前适配器注册下解析一次调用。返回的一次性句柄让该注册贯穿
   * 头日志与分发，因此 HMR 无法把一个适配器的能力结果与另一个适配器组合。
   * @param config provider/model 路由与可选请求控制。
   * @param signal 可选的适配器自有能力查询取消信号。
   * @returns 预备好的配置与其注册绑定的流入口。
   */
  /**
   * Resolve one call under its current adapter registration. The returned
   * one-shot handle keeps that registration across header logging and dispatch,
   * so HMR cannot combine one adapter's capability result with another adapter.
   * @param config - provider/model route and optional request controls.
   * @param signal - optional cancellation for adapter-owned capability lookup.
   * @returns a prepared config and its registration-bound stream entry point.
   */
  async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall> {
    const registration = this.registration(config.provider)
    const adapterCall = await registration.adapter.prepareCall(config.provider, config.model, signal)
    const modelInfo = this.normalizeModelInfo(registration, config.model, adapterCall.model)
    const resolved = this.resolveCallWithInfo(config, modelInfo)
    // 中文：深冻结配置与上下文（structuredClone 剥离外部引用），防止分发前
    // 被改写。
    const resolvedConfig = deepFreeze(structuredClone(resolved.config))
    const context = resolved.context === undefined
      ? undefined
      : deepFreeze(structuredClone(resolved.context))
    // 中文：记录哪些字段是适配器默认物化的（而非调用方提议），供上层展示/日志。
    const adapterDefaults = deepFreeze<LlmCallConfigAdapterDefaults>({
      ...config.reasoningEffort === undefined && resolvedConfig.reasoningEffort !== undefined
        ? { reasoningEffort: true }
        : {},
      ...config.maxTokens === undefined && resolvedConfig.maxTokens !== undefined
        ? { maxTokens: true }
        : {},
    })
    // 中文：一次性分发保护：stream 只能调用一次，且请求配置必须与预备配置一致。
    let dispatched = false
    return Object.freeze({
      config: resolvedConfig,
      retryPolicy: registration.retryPolicy,
      adapterDefaults,
      ...context === undefined ? {} : { context },
      ...modelInfo.inputModalities === undefined
        ? {}
        : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
      stream: (options: GenerateOptions): AsyncIterable<StreamChunk> => {
        if (dispatched) {
          throw new LlmError('a prepared LLM call can only be dispatched once', 'INVALID_PREPARED_CALL')
        }
        if (!callConfigEquals(options, resolvedConfig)) {
          throw new LlmError(
            'prepared LLM call config changed before adapter dispatch',
            'INVALID_PREPARED_CALL',
          )
        }
        dispatched = true
        return this.streamWithRegistration(options, {
          registration,
          config: resolvedConfig,
          modelInfo,
          dispatch: options => adapterCall.stream(options),
        })
      },
    })
  }

  // 中文：按 provider 路由取注册；无适配器时抛 NO_ADAPTER。
  private registration(provider: string): AdapterRegistration {
    const registration = this.adapters.get(provider)
    if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, 'NO_ADAPTER')
    return registration
  }

  /** Remove replay state whose historical route is owned by another adapter. */
  // 中文：去掉"历史路由由别的适配器拥有"的回放状态：只有当同一适配器实例
  // 同时拥有历史 provider 与目标 provider 时才保留 replayState。
  private forAdapter(options: GenerateOptions, adapter: LlmAdapter): GenerateOptions {
    const messages: Message[] = options.messages.map((message) => {
      const source = message.source
      if (message.role !== 'assistant' || source.kind !== 'model' || source.replayState === undefined) return message
      if (this.adapters.get(source.provider)?.adapter === adapter) return message
      return freezeMessage({
        ...message,
        source: { kind: 'model', provider: source.provider, model: source.model },
      })
    })
    if (messages.every((message, index) => message === options.messages[index])) return options
    const filtered = { ...options, messages }
    return Object.isFrozen(options) ? deepFreeze(filtered) : filtered
  }

  /**
   * （中文）最终适配器边界。适配器选择、分发、迭代器构造与迭代失败统一变成
   * 一个终结性失败块；中间件与下游消费方失败仍是抛出的插件/消费方错误。
   */
  /**
   * Final adapter boundary. Adapter selection, dispatch, iterator construction,
   * and iteration failures become one terminal failure chunk. Middleware and
   * downstream consumer failures remain thrown plugin or consumer errors.
   */
  private async * adapterStream(
    options: GenerateOptions,
    prepared?: PreparedDispatch,
  ): AsyncGenerator<StreamChunk> {
    let iterator: AsyncIterator<StreamChunk>
    try {
      const registration = prepared?.registration ?? this.registration(options.provider)
      const adapter = registration.adapter
      let modelInfo: LlmResolvedModelInfo
      let resolvedConfig: LlmCallConfig
      let dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>
      if (prepared === undefined) {
        // 中文：非预备路径：现场解析模型信息并绑定分发。
        const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal)
        modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model)
        resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config
        dispatch = options => adapterCall.stream(options)
      } else {
        // 中文：预备路径：直接复用预备时的世代信息。
        modelInfo = prepared.modelInfo
        resolvedConfig = prepared.config
        dispatch = prepared.dispatch
      }
      if (prepared !== undefined && !callConfigEquals(options, resolvedConfig)) {
        throw new LlmError(
          'prepared LLM call config changed before adapter dispatch',
          'INVALID_PREPARED_CALL',
        )
      }
      // 中文：把请求与解析后的配置对齐（必要时浅拷贝/深冻结合并），确保
      // 适配器收到的采样参数等与能力校验一致。
      const resolvedOptions = callConfigEquals(options, resolvedConfig)
        ? options
        : Object.isFrozen(options)
          ? deepFreeze({ ...options, ...resolvedConfig })
          : { ...options, ...resolvedConfig }
      // 中文：文本模型但请求含图片时，把图片投射为确定性文本占位再分发。
      const projectedOptions = modelInfo.inputModalities !== undefined
        && !modelInfo.inputModalities.includes('image')
        && resolvedOptions.messages.some(message => contentHasImage(message.content))
        ? Object.isFrozen(resolvedOptions)
          ? deepFreeze({ ...resolvedOptions, messages: projectImagesForTextModel(resolvedOptions.messages) as Message[] })
          : { ...resolvedOptions, messages: projectImagesForTextModel(resolvedOptions.messages) as Message[] }
        : resolvedOptions
      const stream = dispatch(this.forAdapter(projectedOptions, adapter))
      iterator = stream[Symbol.asyncIterator]()
    } catch (error: unknown) {
      // 中文：预备/构造阶段的失败也规范化为终结性失败块。
      yield adapterFailureChunk(error, options.signal)
      return
    }

    let completed = false
    try {
      while (true) {
        let item: { done: true } | { done: false; value: StreamChunk }
        try {
          const next = await iterator.next()
          item = next.done
            ? { done: true }
            : { done: false, value: next.value }
        } catch (error: unknown) {
          // 中文：迭代抛错 → 终结性失败块并停止。
          completed = true
          yield adapterFailureChunk(error, options.signal)
          return
        }
        if (item.done) {
          completed = true
          return
        }
        // End the adapter-owned try before yielding: consumer/middleware
        // failures resumed into this generator must remain thrown.
        // 中文：在 yield 前结束适配器自有的 try：消费方/中间件失败被恢复进本
        // 生成器时必须以抛错形式保留（不吞掉）。
        yield item.value
      }
    } finally {
      // 中文：流未正常完成时（消费方提前退出）调用迭代器的 return 做清理。
      if (!completed) {
        const close = iterator.return?.bind(iterator)
        if (close) await close()
      }
    }
  }

  /**
   * （中文）把一次模型调用流式输出为原始 chunk（token 级增量）。只有同一
   * 适配器实例同时拥有历史 provider 与目标 provider 时才保留回放状态；最终
   * 适配器选择在异步精确模型解析与分发期间保持不变。适配器选择、分发与迭代
   * 失败变成终结性的 error 或 aborted finish 块；中间件、嵌套调用、清理与
   * 消费方失败仍然以抛错形式保留。
   * @param options 完整请求；options.provider 选择适配器。
   * @returns chunk 流，可能被 llm/stream 监听器包裹。
   */
  /**
   * Stream one model call as raw chunks (token-level deltas). Replay state is
   * retained only when the same adapter instance owns its historical provider
   * and the target provider. Final adapter selection remains fixed through
   * asynchronous exact-model resolution and dispatch. Adapter selection,
   * dispatch, and iteration failures become terminal `error` or `aborted`
   * finish chunks; middleware, nested-call, cleanup, and consumer failures
   * remain thrown.
   * @param options - the full request; `options.provider` selects the adapter.
   * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithRegistration(options)
  }

  // 中文：真正的分发入口：把 adapterStream 包进 llm/stream 瀑布流，让插件
  // 可以重试/回放/路由。
  private streamWithRegistration(
    options: GenerateOptions,
    prepared?: PreparedDispatch,
  ): AsyncIterable<StreamChunk> {
    return this.ctx.waterfall(
      this,
      'llm/stream',
      options,
      () => this.adapterStream(options, prepared),
    )
  }
}

/** Convert one adapter throw into the stream protocol's terminal outcome. */
// 中文：把一次适配器抛错转成流协议的终结性结果块（aborted 或 error finish）。
function adapterFailureChunk(error: unknown, signal?: AbortSignal): StreamChunk {
  const failure = normalizeLlmFailure(error)
  return {
    type: 'finish',
    reason: signal?.aborted || failure.code === 'ABORTED'
      ? { kind: 'aborted', failure }
      : { kind: 'error', failure },
  }
}

// 中文：注册表内部结构：适配器实例 + provider 展示元数据 + 已解析的重试策略。
interface AdapterRegistration {
  readonly adapter: LlmAdapter
  readonly provider: LlmProviderInfo
  readonly retryPolicy: ResolvedRetryPolicy
}

// 中文：预备分发内部结构：预备时捕获的注册、配置、模型信息与分发入口。
interface PreparedDispatch {
  readonly registration: AdapterRegistration
  readonly config: LlmCallConfig
  readonly modelInfo: LlmResolvedModelInfo
  readonly dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>
}

export default LlmRuntime
