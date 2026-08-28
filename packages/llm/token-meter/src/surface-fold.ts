/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现测量服务的"位置化表面折叠"：measure() 服务的、压缩规划
 * 依据的逐节点定价表面。
 * 【技术维度】投影单元刻意不共享本折叠——它们的持久化检查点状态必须保持
 * O(1)，因此走 surface-projection.ts 的"影子价格协议"；而本折叠保留每个
 * 节点（seq → 定价），用于 measure() 的精确表面快照。两者通过 estimate.ts
 * 与"replace 生产者由本折叠节点派生影子价格"在构造上保持一致。
 * 【产品维度】上下文压缩（compaction）需要知道"每条消息值多少 token"来规划
 * 遮蔽；measure() 需要精确的当前表面；本折叠是这两者的权威定价来源。
 * 【逻辑维度】折叠结果类型 → foldSurfaceTokens：append 直接追加；replace
 * 按 seq 区间删除并替换。
 * 【关键边界】本折叠是"总数 + 分配都新鲜"（不就地改输入，抛错不污染状态）；
 * 替换区间必须在现有节点里可解析，否则视为日志损坏、fail loud。
 * 【新手阅读建议】先读英文模块注释理解"两个折叠为何分开"，再看
 * foldSurfaceTokens 的 append/replace 两个分支。
 * ==========================================================================
 */

/**
 * The measurement service's positional surface fold: the per-node priced
 * surface `measure()` serves and compaction plans against. The projection
 * units do NOT share this fold — their state must stay O(1) for the
 * persisted checkpoint, so they ride `surface-projection.ts`'s shadow-price
 * protocol; the two agree because both price through `estimate.ts` and every
 * logged shadow price derives from this fold's fixed-heuristic node prices.
 *
 * The fold is a plan/commit pair: {@link planSurfaceTokens} runs every
 * fallible step read-only and {@link commitSurfaceTokens} mutates in place,
 * so a throw leaves the caller's state untouched and the same malformed
 * event fails identically on every retry.
 * Nodes also carry their durable image occurrences and image-free heuristic
 * price, so `measure()` can reprice image content for the routed model.
 *
 * @module @deepseek-ai/dsh-token-meter/surface-fold
 */

import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { SurfaceEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { estimateMessage, estimateStructuralBlock } from './estimate.ts'

/** One priced surface node with the image occurrences route pricing replaces. */
export interface MeterSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Fixed-heuristic price of the node's exact message. */
  readonly heuristicTokens: number
  /** Fixed-heuristic price with every image occurrence's structural price removed. */
  readonly imageFreeTokens: number
  /** Durable image occurrences in message order; empty for image-free nodes. */
  readonly images: readonly ImageAttachmentRef[]
}

/** One validated surface transition that has not mutated the priced surface yet. */
export interface SurfaceTokenPlan {
  /** Heuristic price of the event's own message; 0 when it derives none. */
  // 中文：事件自身消息的启发式价格；无可派生消息时为 0。
  readonly tokens: number
  /** Signed change in the surface total: `tokens` minus anything shadowed. */
  // 中文：表面总量的有符号变化：tokens 减去被遮蔽的部分。
  readonly deltaTokens: number
  /** The priced node the commit inserts for this event. */
  readonly node: MeterSurfaceNode
  /** Commit position: `append`, or the inclusive replaced index range. */
  readonly target: 'append' | { readonly startIdx: number; readonly endIdx: number }
}

/** Collect image occurrences recursively and total their structural prices. */
function collectImages(blocks: readonly ContentBlock[], images: ImageAttachmentRef[]): number {
  let structuralTokens = 0
  for (const block of blocks) {
    if (block.type === 'image') {
      images.push(block.attachment)
      structuralTokens += estimateStructuralBlock(block)
    } else if (block.type === 'tool-result') {
      structuralTokens += collectImages(block.content, images)
    }
  }
  return structuralTokens
}

/** Build one priced node from a surface event's derived message. */
function analyzeNode(seq: number, message: Message | null): MeterSurfaceNode {
  if (message === null) return { seq, heuristicTokens: 0, imageFreeTokens: 0, images: [] }
  const heuristicTokens = estimateMessage(message)
  const images: ImageAttachmentRef[] = []
  const imageStructuralTokens = collectImages(message.content, images)
  return {
    seq,
    heuristicTokens,
    imageFreeTokens: heuristicTokens - imageStructuralTokens,
    images,
  }
}

/*
 * （中文）把一个表面事件折叠到已定价表面上。
 * 总量与分配都"新鲜"：调用方赋值结果而非就地修改，因此这里抛错会留下调用方
 * 状态原封不动，同一个畸形事件在每次重试中都以同样方式失败。
 * @param nodes 该事件之前的已定价表面，按模型可见顺序。
 * @param event 要放置的表面事件。
 * @returns 事件的价格、下一个表面与有符号总量增量。
 * @throws 当替换命名的区间在 nodes 中不存在时——已提交日志在追加时就做过
 *   表面校验，无法解析的区间即日志损坏，必须 fail loud 而非跳过该事件。
 */
/**
 * Validate and price one surface event without mutating the surface.
 * @param nodes - the priced surface preceding this event, in model-visible order.
 * @param event - the surface event to place.
 * @returns the plan for {@link commitSurfaceTokens}.
 * @throws when a replacement names a range absent from `nodes` — committed
 *   logs are surface-validated at append time, so an unresolvable range is log
 *   corruption and must fail loud rather than skip the event.
 */
export function planSurfaceTokens(
  nodes: readonly MeterSurfaceNode[],
  event: SurfaceEvent,
): SurfaceTokenPlan {
  const node = analyzeNode(event.seq, deriveEventMessage(event))
  const tokens = node.heuristicTokens
  const op = event.surfaceOp
  if (op === 'append') {
    return { tokens, deltaTokens: tokens, node, target: 'append' }
  }
  const startIdx = nodes.findIndex(candidate => candidate.seq === op.start)
  const endIdx = nodes.findIndex(candidate => candidate.seq === op.end)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error(
      `token surface: replace at seq ${event.seq} has invalid current range ${op.start}-${op.end}`,
    )
  }
  const removed = nodes
    .slice(startIdx, endIdx + 1)
    .reduce((total, candidate) => total + candidate.heuristicTokens, 0)
  return { tokens, deltaTokens: tokens - removed, node, target: { startIdx, endIdx } }
}

/**
 * Apply one validated plan to the priced surface in place; infallible, so it
 * cannot leave a half-applied surface behind.
 * @param nodes - the exact priced surface the plan was built against.
 * @param plan - the transition returned by {@link planSurfaceTokens}.
 */
export function commitSurfaceTokens(nodes: MeterSurfaceNode[], plan: SurfaceTokenPlan): void {
  if (plan.target === 'append') {
    nodes.push(plan.node)
    return
  }
  nodes.splice(plan.target.startIdx, plan.target.endIdx - plan.target.startIdx + 1, plan.node)
}
