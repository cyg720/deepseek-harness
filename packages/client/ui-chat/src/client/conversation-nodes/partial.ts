/*
 * 【文件职责】累积实时助手片段并维护块级不可变数据；
 * 仅在片段会影响显示时发布新快照。
 */

import type { StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantBlock, PartialAssistant,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { emptyAssistantBlock, toAssistantBlock } from './event-projection.ts'

/**
 * Whether a stream chunk changes the partial assistant projection shown by the UI.
 * @param type - Stream chunk discriminant.
 * @returns Whether publishing the accumulated partial can change the visible snapshot.
 */
/*
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

/** Live Assistant-frame accumulator: folds StreamChunks into AssistantBlock[] with block-level immutability. */
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
  /*
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
  /*
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
  /*
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
