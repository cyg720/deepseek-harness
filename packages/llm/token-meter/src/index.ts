/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现"单一、回放感知"的 token 计量服务 TokenMeter：测量请求
 * 压力与表面（surface）占用。
 * 【技术维度】继承 Cordis Service；按会话惰性维护回放状态（WeakMap），事件
 * 追加时增量折叠（_foldEvent）：记录请求头/步骤边界/表面折叠/用量锚点。用量
 * 锚点（baseline）优先用 provider 实测（usage），仅当"最新成功调用的规范
 * 请求包络匹配且总额不低于启发式锚点"时复用；否则整包络+表面启发式重估。
 * 可选注册三个投影单元（用量/压力/构成）到会话投影注册表。
 * 【产品维度】上下文预算与占用展示的权威来源：measure() 返回剥离、深冻结的
 * 只读快照；estimateMessage() 供上层对单条消息估价。
 * 【逻辑维度】内部状态类型 → 辅助（用量求和/包络比较/配置校验）→ TokenMeter
 * 类（构造/measure/_sync/_foldEvent/_estimateProviderAssistant）。
 * 【关键边界】测量 O(surface)（克隆位置节点）；畸形事件 fail loud 且不部分
 * 应用；provider 输出从精确引用的 chunk seq 重装（缺失旧 seq 时保守按持久
 * 输出定价）。
 * 【新手阅读建议】先读 measure() 的三分支基线选择，再读 _foldEvent 的
 * assistant/message 分支理解锚点如何建立。
 * ==========================================================================
 */

/**
 * Single replay-aware token-meter service for request and surface pressure.
 *
 * @module @deepseek-ai/dsh-token-meter
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { LlmImageRequestPricing, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { EpochHeader, Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { canonicalHeader, headerEquals, isSurfaceEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves the optional projection registry Context declaration.
// 中文：仅类型导入：解析可选的投影注册表 Context 声明。
import type {} from '@deepseek-ai/dsh-session-projection'
import type {
  TokenMeasurement,
  TokenMeasurementBaseline,
  TokenMeterConfig,
} from './types.ts'
import { contextBreakdownProjectionDefinition } from './breakdown-projection.ts'
import { contextPressureProjectionDefinition, tokenUsageProjectionDefinition } from './usage-projection.ts'
import { estimateContent, estimateHeader, estimateMessage, ROLE_OVERHEAD } from './estimate.ts'
import { commitSurfaceTokens, planSurfaceTokens } from './surface-fold.ts'
import type { MeterSurfaceNode } from './surface-fold.ts'
import { priceSurface } from './route-pricing.ts'

export type * from './types.ts'

/**
 * Raw anchor facts captured at the latest successful call; the baseline is
 * derived per measurement so the anchored surface reprices under the same
 * route pricing as the current surface it is compared with.
 */
interface MeasurementAnchor {
  readonly header: EpochHeader | undefined
  /** Surface snapshot the anchored request was derived from. */
  readonly nodes: readonly MeterSurfaceNode[]
  /** Fixed-heuristic price of the call's provider output. */
  readonly assistantTokens: number
  /** Provider usage of the call, when it reported one under a known header. */
  readonly usage: TokenUsage | undefined
}

// 中文：每个会话的回放状态：已消费事件数、当前请求头、当前表面节点与总量、
// 打开的步骤、最近锚点。
interface ReplayState {
  consumedEvents: number
  header: EpochHeader | undefined
  surface: MeterSurfaceNode[]
  stepStart: { turn: number; step: number; nodes: readonly MeterSurfaceNode[] } | undefined
  anchor: MeasurementAnchor | undefined
}

/** Sum disjoint provider usage buckets without double-counting reasoning output. */
// 中文：把互斥的 provider 用量桶相加（推理 token 已含在 outputTokens 内，
// 不重复计算）。
function usageTokens(usage: TokenUsage): number {
  return usage.inputTokens
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
    + usage.outputTokens
}

/** Compare optional envelopes so a headerless estimate can track later surface deltas. */
// 中文：比较可选包络：两者都存在时用 headerEquals，否则按"同为 undefined"
// 判定（这样无头的估计也能追踪后续表面增量）。
function optionalHeaderEquals(
  left: EpochHeader | undefined,
  right: EpochHeader | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return headerEquals(left, right)
}

/** Reject stale or misspelled keys before defaults can hide them. */
// 中文：在默认值掩盖它们之前拒绝过时或拼错的配置键（本插件没有任何设置项）。
function validateConfigKeys(config: TokenMeterConfig): void {
  for (const key of Object.keys(config)) {
    throw new Error(`TokenMeterConfig: unknown key "${key}" (no settings are supported)`)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenMeter: TokenMeter
  }
}

/** Replay owner for one service-wide estimator and isolated per-session folds. */
/*
 * （中文）一个服务级估计器 + 各会话独立折叠的回放所有者。
 */
export class TokenMeter extends Service {
  // Schemastery preserves untrusted loader keys on an empty object schema;
  // the public type excludes settings while validateConfigKeys rejects them.
  // 中文：Schemastery 会在空对象 schema 上保留不可信加载键；公共类型排除
  // 设置项，而 validateConfigKeys 在运行时拒绝它们。
  static Config: z<TokenMeterConfig> = z.object({}) as unknown as z<TokenMeterConfig>

  // 中文：会话 → 回放状态（弱引用，会话销毁即回收）。
  private readonly states = new WeakMap<Session, ReplayState>()

  constructor(ctx: Context, config: TokenMeterConfig = {}) {
    super(ctx, 'tokenMeter')
    validateConfigKeys(config)

    // Projection registration is an optional child: compositions without the
    // generic registry keep the meter's standalone read shape.
    // 中文：投影注册是可选的子能力：没有通用注册表的组合仍保留 meter 的独立
    // 读取形态。
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition)
      projectionCtx.sessionProjections.register(contextPressureProjectionDefinition)
      projectionCtx.sessionProjections.register(contextBreakdownProjectionDefinition)
    })

    // Readers catch up independently, while eager observation bounds ordinary
    // read latency without creating state for sessions no consumer has read.
    // 中文：读者各自追赶；而主动观察把常规读延迟限制在有界范围，又不会为
    // 无人读取的会话创建状态。
    ctx.on('session/event', (session) => {
      if (this.states.has(session)) this._sync(session)
    })
  }

  /*
   * （中文）测量当前请求压力与表面（读至当前持久尾巴）。
   * provider 用量只在"最新成功调用的规范请求包络匹配 requestHeader、且其总额
   * 不低于该调用完整启发式锚点"时复用；否则整份包络与表面重新启发式定价。
   * requestHeader 只影响请求压力；表面字段总是描述当前会话表面。每次调用都
   * 克隆位置节点，因此测量复杂度为 O(surface)。
   * @param session 要回放到当前持久尾巴的会话。
   * @param requestHeader 可选的"有效请求包络"，覆盖最新已记录请求头。
   * @returns 剥离、深不可变的压力与表面测量快照。
   */
  /**
   * Measure current request pressure and surface through the durable tail.
   *
   * The effective envelope's routed provider/model selects the request-image
   * pricing every node is priced under: a route whose adapter declares image
   * pricing charges each retained image its visual tokens plus its
   * model-visible text, while other routes keep the fixed heuristic. Provider
   * usage is reused only when the latest successful call's canonical request
   * envelope matches `requestHeader` and its total is no lower than that
   * call's full route-priced anchor; otherwise the complete envelope and
   * surface are repriced.
   *
   * `requestHeader` replaces the latest logged envelope for pressure and node
   * pricing; the node set always describes the current session surface. Every
   * call clones those positional nodes, so measurement is O(surface).
   *
   * @param session - session to replay through its current durable tail.
   * @param requestHeader - optional effective request envelope replacing the latest logged header.
   * @returns a detached deeply immutable pressure and surface measurement.
   */
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement {
    const state = this._sync(session)
    const header = requestHeader === undefined
      ? state.header
      : canonicalHeader(requestHeader)
    const pricing = this._routeImagePricing(header)
    const surface = priceSurface(state.surface, pricing)
    const anchor = state.anchor

    let baseline: TokenMeasurementBaseline
    let surfaceDeltaTokens: number
    if (anchor !== undefined && optionalHeaderEquals(anchor.header, header)) {
      // Matching headers share one route, so the anchored snapshot reprices
      // under the same pricing as the current surface and the signed delta
      // compares like with like.
      const anchorSurfaceTokens = priceSurface(anchor.nodes, pricing).surfaceTokens
        + anchor.assistantTokens
      const estimatedAnchorTokens = estimateHeader(header) + anchorSurfaceTokens
      const usage = anchor.usage
      // Signed heuristic deltas remain conservative only from an anchor
      // that is at least as large as the matching full heuristic price.
      baseline = usage !== undefined && usageTokens(usage) >= estimatedAnchorTokens
        ? { kind: 'usage', tokens: usageTokens(usage), usage }
        : { kind: 'estimated', tokens: estimatedAnchorTokens }
      surfaceDeltaTokens = surface.surfaceTokens - anchorSurfaceTokens
    } else if (header === undefined && surface.surfaceTokens === 0) {
      baseline = { kind: 'none', tokens: 0 }
      surfaceDeltaTokens = 0
    } else {
      // 中文：无法复用锚点：整包络 + 当前表面重新启发式定价。
      baseline = {
        kind: 'estimated',
        tokens: estimateHeader(header) + surface.surfaceTokens,
      }
      surfaceDeltaTokens = 0
    }

    return deepFreeze(structuredClone({
      logRevision: state.consumedEvents,
      baseline,
      surfaceDeltaTokens,
      totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens),
      surfaceTokens: surface.surfaceTokens,
      nodes: surface.nodes,
    }))
  }

  /** Resolve the routed model's image pricing, when the llm service and route declare one. */
  private _routeImagePricing(header: EpochHeader | undefined): LlmImageRequestPricing | undefined {
    const config = header?.config
    if (config === undefined) return undefined
    return this.ctx.get('llm')?.imageRequestPricing(config.provider, config.model)
  }

  /**
   * Heuristically price one model-visible message (instance face of the pure
   * `estimateMessage` export from `estimate.ts`).
   * @param message - message to price without mutation.
   * @returns content and role-framing tokens under the fixed service heuristic.
   */
  estimateMessage(message: Message): number {
    return estimateMessage(message)
  }

  /** Catch one session's fold up to the current durable tail. */
  // 中文：把某个会话的折叠推进到当前持久尾巴：首次接触时建状态，然后逐事件
  // 折叠直到追上事件数组长度。
  private _sync(session: Session): ReplayState {
    let state = this.states.get(session)
    if (state === undefined) {
      state = {
        consumedEvents: 0,
        header: undefined,
        surface: [],
        stepStart: undefined,
        anchor: undefined,
      }
      this.states.set(session, state)
    }

    while (state.consumedEvents < session.events.length) {
      // 中文：连续会话 seq 索引持久日志，因此该读取必然存在（oxlint 豁免）。
      // oxlint-disable-next-line typescript/no-non-null-assertion -- contiguous session seqs index the durable log
      const event = session.events[state.consumedEvents]!
      this._foldEvent(session, state, event)
      state.consumedEvents += 1
    }
    return state
  }

  /*
   * （中文）在改动回放状态之前校验并预备每个"可能失败"的部分。畸形事件在
   * 每次重试时保持未读，而不是把同一改动部分应用多次。
   */
  /**
   * Run every fallible step — surface plan and anchor validation — before
   * mutating replay state, so a malformed event remains unread on every
   * retry instead of half-applying.
   */
  private _foldEvent(session: Session, state: ReplayState, event: SessionEvent): void {
    // 中文：先计算"下一步"值（校验全部通过才提交），保证失败不污染状态。
    let nextHeader = state.header
    let nextStepStart = state.stepStart
    let nextAnchor = state.anchor

    switch (event.type) {
      case 'request/header':
        nextHeader = canonicalHeader(event.data.header)
        break
      case 'step/start':
        // 中文：步骤必须配平：新的 step/start 到来时旧步骤必须已结束。
        if (state.stepStart !== undefined) {
          throw new Error(
            `token meter: step/start at seq ${event.seq} arrived before turn ${state.stepStart.turn}/step ${state.stepStart.step} ended`,
          )
        }
        nextStepStart = { ...event.data, nodes: [...state.surface] }
        break
      case 'step/end':
        // 中文：step/end 必须匹配打开的 step/start。
        if (state.stepStart === undefined
          || state.stepStart.turn !== event.data.turn
          || state.stepStart.step !== event.data.step) {
          throw new Error(`token meter: step/end at seq ${event.seq} has no matching step/start event`)
        }
        nextStepStart = undefined
        break
      default:
        break
    }

    const plan = isSurfaceEvent(event)
      ? planSurfaceTokens(state.surface, event)
      : undefined

    if (event.type === 'assistant/message') {
      const stepStart = state.stepStart
      // 中文：assistant/message 必须落在打开的步骤里。
      if (stepStart === undefined
        || stepStart.turn !== event.data.turn
        || stepStart.step !== event.data.step) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} has no matching step/start event`)
      }

      // assistant/message is surface-mandatory at every append/seed boundary.
      // 中文：assistant/message 在每个追加/播种边界都是必带表面的。
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const eventTokens = plan!.tokens
      if (event.data.usage !== undefined && nextHeader !== undefined) {
        nextAnchor = {
          header: nextHeader,
          nodes: stepStart.nodes,
          assistantTokens: this._estimateProviderAssistant(session, event, eventTokens),
          usage: event.data.usage,
        }
      } else {
        nextAnchor = {
          header: nextHeader,
          nodes: stepStart.nodes,
          assistantTokens: eventTokens,
          usage: undefined,
        }
      }
    }

    // 中文：全部校验通过后一次性提交。
    state.header = nextHeader
    state.stepStart = nextStepStart
    if (plan !== undefined) {
      commitSurfaceTokens(state.surface, plan)
    }
    state.anchor = nextAnchor
  }

  /*
   * （中文）从 assistant/message 精确引用的 chunk seq 重装 provider 输出，
   * 用于用量锚点。缺失旧版源 seq 时保守地把持久输出当作 provider 输出；显式
   * 空列表为已知空流定价 0。
   */
  /**
   * Reassemble provider output from the exact cited chunk seqs for a usage anchor.
   * Missing legacy source seqs conservatively treat the durable output as the
   * provider output; an explicit empty list prices a known empty stream.
   */
  private _estimateProviderAssistant(
    session: Session,
    event: SessionEvent<'assistant/message'>,
    durableEventTokens: number,
  ): number {
    const sourceSeqs = event.sourceEventSeqs
    // 中文：旧版日志没有源 seq 列表 → 保守地用持久输出定价。
    if (sourceSeqs === undefined) return durableEventTokens

    const assembler = new BlockAssembler()
    const seen = new Set<number>()
    for (const seq of sourceSeqs) {
      // 中文：源 seq 必须早于本消息且不重复。
      if (seq >= event.seq) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} is not earlier`)
      }
      if (seen.has(seq)) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} repeats source seq ${seq}`)
      }
      seen.add(seq)
      // Session construction validates contiguous seqs, and the explicit
      // earlier-than-assistant check above therefore guarantees existence.
      // 中文：会话构造校验了连续 seq，上面"早于 assistant"的检查因此保证
      // 该索引必然存在。
      const source = session.events[seq]
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const sourceEvent = source!
      // 中文：源事件必须是同 turn/step 的 assistant/chunk。
      if (sourceEvent.type !== 'assistant/chunk') {
        throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} is not assistant/chunk`)
      }
      if (sourceEvent.data.turn !== event.data.turn || sourceEvent.data.step !== event.data.step) {
        throw new Error(`token meter: assistant/message at seq ${event.seq} source seq ${seq} belongs to another step`)
      }
      assembler.push(sourceEvent.data.chunk)
    }
    const providerContent = assembler.blocks()
    return providerContent.length === 0 ? 0 : estimateContent(providerContent) + ROLE_OVERHEAD
  }
}

export default TokenMeter
