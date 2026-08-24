/**
 * Tool-pairing balance over a session surface. Compaction changes surface
 * positions, so safe cuts are derived from tool-call/result content in current
 * surface order rather than step markers.
 * @module @deepseek-ai/dsh-compaction/tool-pairing
 */
/**
 * 文件职责：实现上下文压缩的 tool-pairing.ts 模块。
 * 技术维度：TypeScript、Cordis 插件、会话事件和严格判别联合。
 * 产品维度：控制模型请求中的上下文压缩信息。
 * 逻辑维度：读取日志或文件状态，计算投影并记录/注入结果。
 * 关键边界：不能静默丢失必需事件；裁剪和替换必须保持日志可重放。
 * 新手阅读建议：先读导出类型与配置，再跟踪事件和投影流程。
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Incremental balance state for one session surface generation. */
/** 中文说明：类型或类 BalanceCache 约束上下文或压缩数据职责。 */
interface BalanceCache {
  /** Surface rewrite generation this state describes. */
  generation: number
  /**
   * Balance of every surface cut in current order: a surface of N sequences has
   * N + 1 cuts, entry `i` being the cut before sequence `i` and the final entry
   * the cut after the surface tail.
   */
  cutBalanced: readonly boolean[]
  /** Current surface position of each event seq, indexing {@link cutBalanced}. */
  indexBySeq: Map<number, number>
  /** In-progress tool-call count after the processed surface tail. */
  inProgressToolCalls: number
}

/** 中文说明：上下文局部值 balanceCacheBySession，由紧邻初始化决定。 */
const balanceCacheBySession = new WeakMap<Session, BalanceCache>()

/** Return how one surface event changes the in-progress tool-call count. */
/** 中文说明：函数 eventDelta 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function eventDelta(event: SessionEvent): number {
  switch (event.type) {
    case 'assistant/message':
      return event.data.message.content.filter(block => block.type === 'tool-call').length
    case 'tool/result':
      return -1
    default:
      return 0
  }
}

/** Read and validate the event named by a surface sequence. */
/** 中文说明：函数 eventForSeq 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function eventForSeq(events: readonly SessionEvent[], seq: number): SessionEvent {
  /** 中文说明：上下文局部值 event，由紧邻初始化决定。 */
  const event = events[seq]
  if (event === undefined || event.seq !== seq) {
    throw new Error(`tool-pairing balance: surface seq ${seq} has no matching session event (corrupt surface)`)
  }
  return event
}

/** Fold surface sequences not yet in the cache into its balance state. */
/** 中文说明：函数 extendCache 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function extendCache(
  session: Session,
  cache: BalanceCache,
  seqs: readonly number[],
): BalanceCache {
  /** 中文说明：上下文局部值 processed，由紧邻初始化决定。 */
  const processed = cache.cutBalanced.length - 1
  /** 中文说明：上下文局部值 tail，由紧邻初始化决定。 */
  const tail = seqs.slice(processed)
  // Validate the unseen tail before mutating the live cache, so a corrupt
  // append cannot leave a partially advanced state behind.
  /** 中文说明：上下文局部值 events，由紧邻初始化决定。 */
  const events = session.events
  /** 中文说明：上下文局部值 pendingCuts，由紧邻初始化决定。 */
  const pendingCuts: boolean[] = []
  /** 中文说明：上下文局部值 inProgressToolCalls，由紧邻初始化决定。 */
  let inProgressToolCalls = cache.inProgressToolCalls
  /** 中文说明：上下文局部值 seq，由紧邻初始化决定。 */
  for (const seq of tail) {
    inProgressToolCalls += eventDelta(eventForSeq(events, seq))
    if (inProgressToolCalls < 0) {
      throw new Error(`tool-pairing balance: tool/result at surface seq ${seq} has no matching tool-call (corrupt surface)`)
    }
    pendingCuts.push(inProgressToolCalls === 0)
  }

  tail.forEach((seq, offset) => cache.indexBySeq.set(seq, processed + offset))
  cache.cutBalanced = cache.cutBalanced.concat(pendingCuts)
  cache.inProgressToolCalls = inProgressToolCalls
  return cache
}

/** Return balance state synchronized with the current session surface. */
/** 中文说明：函数 balanceCache 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function balanceCache(session: Session): BalanceCache {
  /** 中文说明：上下文局部值 surface，由紧邻初始化决定。 */
  const surface = session.surface
  /** 中文说明：上下文局部值 seqs，由紧邻初始化决定。 */
  const seqs = surface.nodes
  /** 中文说明：上下文局部值 generation，由紧邻初始化决定。 */
  const generation = surface.replaceGeneration
  /** 中文说明：上下文局部值 cached，由紧邻初始化决定。 */
  const cached = balanceCacheBySession.get(session)

  if (cached === undefined || cached.generation !== generation || cached.cutBalanced.length - 1 > seqs.length) {
    // A rebuild is the same fold started from the empty-surface state, whose
    // single leading cut is trivially balanced.
    /** 中文说明：上下文局部值 rebuilt，由紧邻初始化决定。 */
    const rebuilt = extendCache(session, {
      generation,
      cutBalanced: [true],
      indexBySeq: new Map(),
      inProgressToolCalls: 0,
    }, seqs)
    balanceCacheBySession.set(session, rebuilt)
    return rebuilt
  }
  if (cached.cutBalanced.length - 1 < seqs.length) return extendCache(session, cached, seqs)
  return cached
}

/** Balance of the cut at a sequence's position plus offset, rejecting seqs outside current membership. */
/** 中文说明：函数 cutBalance 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function cutBalance(cache: BalanceCache, seq: number, offset: 0 | 1): boolean {
  /** 中文说明：上下文局部值 index，由紧邻初始化决定。 */
  const index = cache.indexBySeq.get(seq)
  /** 中文说明：上下文局部值 balanced，由紧邻初始化决定。 */
  const balanced = index === undefined ? undefined : cache.cutBalanced[index + offset]
  if (balanced === undefined) {
    throw new Error(`tool-pairing balance: surface seq ${seq} not found`)
  }
  return balanced
}

/**
 * Whether the cut immediately before a current surface sequence is tool-pairing balanced.
 * @param session - session whose surface is checked.
 * @param seq - event sequence whose leading cut is checked.
 * @returns true when no unanswered tool call crosses the cut.
 * @throws when the seq is absent from the current surface, a surface sequence has no
 * matching log event, or a tool result has no preceding open call.
 */
/** 中文说明：函数 toolPairingBalancedBefore 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function toolPairingBalancedBefore(session: Session, seq: number): boolean {
  return cutBalance(balanceCache(session), seq, 0)
}

/**
 * Whether the cut immediately after a current surface sequence is tool-pairing balanced.
 * @param session - session whose surface is checked.
 * @param seq - event sequence whose trailing cut is checked.
 * @returns true when no unanswered tool call crosses the cut.
 * @throws when the seq is absent from the current surface, a surface sequence has no
 * matching log event, or a tool result has no preceding open call.
 */
/** 中文说明：函数 toolPairingBalancedAfter 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function toolPairingBalancedAfter(session: Session, seq: number): boolean {
  return cutBalance(balanceCache(session), seq, 1)
}
