/**
 * ================================ 文件注释 ================================
 * 【文件职责】PartialAccumulator：助手消息流分块（assistant/chunk）累加器，
 *   把六种 StreamChunk 折叠成按块索引键控的 AssistantBlock[]。
 * 【技术维度】块级不可变：增量只替换对应索引块的引用；稀疏数组有意为之
 *   （block-start 可能乱序到达，压实推迟到投影时）。
 * 【产品维度】流式回复期间 UI 需要逐 token 更新"部分助手消息"：文本、
 *   推理、工具调用参数都在增长，但只有可见变化才触发通知。
 * 【逻辑维度】isVisibleAssistantChunk 判定可见变化；push 按类型折叠各增量；
 *   toPartial 返回缓存快照（变了才重建）；emptyAssistantBlock 建空块。
 * 【关键边界】usage/finish 及未知变体返回 false（不通知）；finish 之后
 *   紧接的 assistant/message 会取代 partial。
 * 【新手阅读建议】对照 StreamChunk 六种类型逐一理解 push 的分支。
 * ==========================================================================
 */
// PartialAccumulator: assistant/chunk accumulator.
// Folds the six StreamChunk variants into AssistantBlock[] keyed by block index;
// block-level immutability (a delta only swaps that block's reference).
// PartialAccumulator：assistant/chunk 累加器。
// 把六种 StreamChunk 变体折叠成按块索引键控的 AssistantBlock[]；
// 块级不可变（一次增量只替换该块的引用）。

import type { StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock, PartialAssistant } from './conversation.ts'
import { toAssistantBlock } from './conversation.ts'

/**
 * Whether a stream chunk changes the partial assistant projection shown by the UI.
 * @param type - Stream chunk discriminant.
 * @returns Whether publishing the accumulated partial can change the visible snapshot.
 */
/**
 * 一个流分块是否会改变 UI 展示的部分助手投影。
 * @param type 流分块的判别类型。
 * @returns 发布累加结果是否可能改变可见快照。
 */
export function isVisibleAssistantChunk(type: string): boolean {
  return type === 'block-start'
    || type === 'text-delta'
    || type === 'reasoning-delta'
    || type === 'tool-call-delta'
    || type === 'block-end'
}

/** assistant/chunk accumulator: folds StreamChunks into AssistantBlock[] with block-level immutability. */
/** assistant/chunk 累加器：把 StreamChunk 折叠成 AssistantBlock[]，块级不可变。 */
export class PartialAccumulator {
  // Sparse on purpose: block-start may arrive out of order, leaving holes until compaction.
  // 有意稀疏：block-start 可能乱序到达，压实前会留下空洞。
  private blocks: (AssistantBlock | undefined)[] = []
  private changed = true // 上次投影后是否有新增量
  private snapshot: PartialAssistant

  /**
   * @param turn - Owning agent turn.
   * @param step - Owning model step.
   * @param initialBlocks - Materialized prefix when accumulation begins after history replay.
   */
  /**
   * @param turn 属主 agent 轮次。
   * @param step 属主模型步骤。
   * @param initialBlocks 历史重放后才开始累加时已物化的前缀块。
   */
  constructor(
    readonly turn: number,
    readonly step: number,
    initialBlocks: readonly AssistantBlock[] = [],
  ) {
    this.blocks = [...initialBlocks]
    this.snapshot = { turn, step, blocks: initialBlocks }
  }

  /**
   * Fold one chunk.
   * @param chunk - the stream chunk.
   * @returns whether it caused a visible change (usage/finish return false, skipping notification).
   */
  /**
   * 折叠一个分块。
   * @param chunk 流分块。
   * @returns 是否造成可见变化（usage/finish 返回 false，跳过通知）。
   */
  push(chunk: StreamChunk): boolean {
    switch (chunk.type) {
      case 'block-start': {
        this.blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
        this.changed = true
        return true
      }
      case 'text-delta': {
        const prev = this.blocks[chunk.index]
        this.blocks[chunk.index] = { kind: 'text', text: (prev?.kind === 'text' ? prev.text : '') + chunk.text }
        this.changed = true
        return true
      }
      case 'reasoning-delta': {
        const prev = this.blocks[chunk.index]
        this.blocks[chunk.index] = { kind: 'reasoning', text: (prev?.kind === 'reasoning' ? prev.text : '') + chunk.text }
        this.changed = true
        return true
      }
      case 'tool-call-delta': {
        const prev = this.blocks[chunk.index]
        const base = prev?.kind === 'tool-call' ? prev : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
        this.blocks[chunk.index] = {
          kind: 'tool-call',
          callId: base.callId || String(chunk.id),
          name: chunk.name ?? base.name,
          argsRaw: base.argsRaw + chunk.argumentsDelta,
        }
        this.changed = true
        return true
      }
      case 'block-end': {
        this.blocks[chunk.index] = toAssistantBlock(chunk.block)
        this.changed = true
        return true
      }
      default:
        // usage / finish / merge-extensible unknown variants: no visible block change
        // (finish is immediately followed by the assistant/message that supersedes the partial).
        // usage / finish / 合并可扩展的未知变体：没有可见的块变化
        // （finish 之后紧接着的 assistant/message 会取代 partial）。
        return false
    }
  }

  /**
   * Current partial projection.
   * @returns the cached snapshot (the blocks array reference only changes after a mutation).
   */
  /**
   * 当前的部分投影。
   * @returns 缓存快照（blocks 数组引用只在变更后变化）。
   */
  toPartial(): PartialAssistant {
    if (this.changed) {
      // Compact sparse indexes (out-of-order block-start) into render order.
      // 把稀疏索引（乱序的 block-start）压实为渲染顺序。
      this.snapshot = { turn: this.turn, step: this.step, blocks: this.blocks.filter((b): b is AssistantBlock => b !== undefined) }
      this.changed = false
    }
    return this.snapshot
  }
}

/**
 * Create the empty client projection for one streamed Assistant block kind.
 * @param blockType - wire block kind.
 * @returns empty projected block ready to receive deltas.
 */
/**
 * 为一种流式助手块类型创建空的客户端投影。
 * @param blockType 线上的块类型。
 * @returns 准备好接收增量的空投影块。
 */
export function emptyAssistantBlock(blockType: string): AssistantBlock {
  switch (blockType) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'tool-call': return { kind: 'tool-call', callId: '', name: '', argsRaw: '' }
    default: return { kind: 'other', block: null }
  }
}
