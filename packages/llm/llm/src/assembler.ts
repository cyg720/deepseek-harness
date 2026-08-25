/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现"增量块组装器"BlockAssembler：把原始 StreamChunk 流逐步
 * 组装成完整内容块与最终的助手消息，是 agent loop 构建助手消息的唯一规范
 * 算法（同时以原始 chunk 记日志保证回放保真）。
 * 【技术维度】用 Map<index, PartialBlock> 维护各块索引的"未完成部分"，用
 * order 数组记录首次出现顺序；兼容纯 delta 协议（无 block-start/end）；对
 * block-end 已关闭的索引再来的 delta 直接忽略（畸形流防御，防止内存膨胀或
 * 破坏已完成块）。
 * 【产品维度】流式输出的每个增量都要被正确拼装、支持中断时的安全收尾
 * （interruptedBlocks），并保证 max-token 截断时"工具调用不可安全执行"的
 * 丢弃决策在内容与回放元数据间一致。
 * 【逻辑维度】PartialBlock 内部结构 → push 按 chunk 类型分发 → ensure/assemble/
 * mustGet 三个私有辅助 → assembled 统一"保留/丢弃"决策 → 五个对外访问器。
 * 【关键边界】同一个索引先到先关闭（First close wins）；max-tokens 结束时
 * 丢弃所有 tool-call 块；未知块类型且从未被 block-end 关闭时抛错。
 * 【新手阅读建议】先看 PartialBlock 字段与 push 的 switch，再读 assembled
 * 理解 keep/drop 决策如何同时驱动 blocks 与 replayState。
 * ==========================================================================
 */

/**
 * Incremental chunk-to-message assembler. This is the single canonical assembly
 * algorithm used by the agent loop to build an assistant message from a chunk
 * stream while logging the raw chunks for replay fidelity.
 *
 * @module @deepseek-ai/dsh-llm/assembler
 */

import { CallId } from './brand.ts'
import { assertNever } from './never.ts'
import { createMessage } from './message.ts'
import type { Message, MessageSource } from './message.ts'
import type { ContentBlock, FinishReason, ReplayEnvelope, StreamChunk, TokenUsage } from './types.ts'

// 中文：某个块索引的组装中间态：记录块类型、已累积的文本/工具参数，block-end
// 到达后 block 字段被设为权威值并"冻结"该 partial。
interface PartialBlock {
  blockType: string
  text: string
  toolCallId?: CallId
  toolCallName?: string
  toolCallArguments: string
  /** Set by `block-end` — authoritative, and freezes the partial. */
  block?: ContentBlock
}

/*
 * （中文）把原始 StreamChunk 增量组装成完整 ContentBlock 与最终助手消息。
 * agent loop 在把原始 chunk 记入日志（保回放保真）的同时喂给它，流结束后读
 * blocks()/message()/usage/finish；流被取消截断时读 interruptedBlocks()。
 * 容忍纯 delta 协议（无 block-start/end）；对已被 block-end 关闭索引再到的
 * delta 直接忽略（畸形流），防止异常适配器撑大内存或破坏已完成块。
 */
/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends,
 * or `interruptedBlocks()` when cancellation cut the stream short.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
export class BlockAssembler {
  // 中文：块索引 → 组装中间态。
  private partials = new Map<number, PartialBlock>()
  // 中文：块索引的首次出现顺序，保证输出稳定有序。
  private order: number[] = []
  // 中文：最近一次 usage 块携带的用量（undefined 表示还没收到）。
  private _usage: TokenUsage | undefined
  // 中文：最近一次 finish 块的结束原因（undefined 表示还没收到）。
  private _finish: FinishReason | undefined
  // 中文：finish 块携带的回放元数据（可选）。
  private _replayState: ReplayEnvelope | undefined

  /*
   * （中文）喂入一个按流顺序排列的原始块，更新组装状态。
   * @param chunk 下一个原始流块。
   */
  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'block-start': {
        // 中文：块开始：索引未见过才登记（重复 block-start 幂等忽略）。
        if (!this.partials.has(chunk.index)) {
          this.order.push(chunk.index)
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: '',
            toolCallArguments: '',
          })
        }
        return
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.text += chunk.text
        return
      }
      case 'tool-call-delta': {
        const partial = this.ensure(chunk.index, 'tool-call')
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.toolCallId = chunk.id
        if (chunk.name) partial.toolCallName = chunk.name
        partial.toolCallArguments += chunk.argumentsDelta
        return
      }
      case 'block-end': {
        const partial = this.ensure(chunk.index, chunk.block.type)
        // First close wins; ignoring re-close stragglers keeps streamed output
        // and the final assembled block in agreement.
        // 中文：先到先关闭：忽略重复的关闭块，保证流式输出与最终组装块一致。
        if (partial.block) return
        partial.block = chunk.block
        return
      }
      case 'usage': {
        this._usage = chunk.usage
        return
      }
      case 'finish': {
        this._finish = chunk.reason
        this._replayState = chunk.replayState
        return
      }
      default: return assertNever(chunk, 'BlockAssembler.push')
    }
  }

  // 中文：确保索引存在对应的 partial（delta 协议没有 block-start 时按需创建），
  // 并记录其首次出现顺序。
  private ensure(index: number, blockType: string): PartialBlock {
    let partial = this.partials.get(index)
    if (!partial) {
      partial = { blockType, text: '', toolCallArguments: '' }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  // 中文：把某个 partial 组装成内容块：已关闭（block-end 到达）直接用权威值；
  // 未关闭则按累积文本/参数合成；未知块类型且未关闭时抛错。
  private assemble(partial: PartialBlock, index: number): ContentBlock {
    if (partial.block) return partial.block
    switch (partial.blockType) {
      case 'text': return { type: 'text', text: partial.text }
      case 'reasoning': return { type: 'reasoning', text: partial.text }
      case 'tool-call': return {
        type: 'tool-call',
        id: partial.toolCallId ?? CallId(`call-${index}`),
        name: partial.toolCallName ?? '',
        arguments: partial.toolCallArguments,
      }
      default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`)
    }
  }

  /** Invariant accessor: every index in `order` has a partial. */
  // 中文：不变量访问器：order 里的每个索引都必须有 partial，否则是内部不变量
  // 被破坏（抛错暴露 bug）。
  private mustGet(index: number): PartialBlock {
    const partial = this.partials.get(index)
    if (!partial) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`)
    return partial
  }

  /*
   * （中文）对所有见过的块做统一的保留/丢弃决策：max-token 截断时丢弃"无法
   * 安全执行"的工具调用。产物块与回放元数据都由这一处决策派生，两者不会
   * 相互矛盾。
   */
  /**
   * The one shared keep/drop decision over all seen blocks: max-token
   * truncation drops tool calls that cannot be executed safely. Emitted blocks
   * and replay metadata both derive from this result, so they cannot disagree.
   */
  private assembled(): { blocks: ContentBlock[]; replay: ReplayEnvelope | undefined } {
    const all = this.order.map(index => this.assemble(this.mustGet(index), index))
    // 中文：max-tokens 结束时标记每个位置的保留与否（tool-call 一律丢弃）。
    const kept = this.finish.kind === 'max-tokens'
      ? all.map(block => block.type !== 'tool-call')
      : undefined
    const blocks = kept === undefined ? all : all.filter((_, position) => kept[position])
    const envelope = this._replayState
    if (envelope?.blocks === undefined) return { blocks, replay: envelope }
    // 中文：回放元数据的块数与实际块数对不上时整体丢弃元数据，避免错位。
    if (envelope.blocks.length !== all.length) return { blocks, replay: undefined }
    return {
      blocks,
      replay: kept === undefined || blocks.length === all.length
        ? envelope
        : { response: envelope.response, blocks: envelope.blocks.filter((_, position) => kept[position]) },
    }
  }

  /*
   * （中文）按流顺序组装所有已见块。
   * @returns 每个已见索引对应一个块；max-token 截断时丢弃无法安全执行的
   * 工具调用；未关闭块按累积 delta 组装（从未被 block-end 关闭的未知块类型抛错）。
   */
  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): ContentBlock[] {
    return this.assembled().blocks
  }

  /*
   * （中文）组装中断流可以安全收尾的前缀：已关闭/未关闭的、含非空白内容的
   * text/reasoning 块，按流顺序排列。工具调用被省略——中断发生在分发之前，
   * 保留一个工具调用就需要伪造其结果；未关闭的未知块也被省略。
   * @returns 保留的块；中断前没有任何流内容时返回空数组。
   */
  /**
   * Assemble the prefix an interrupted stream can safely finalize: closed and
   * open text/reasoning blocks with non-whitespace content, in stream order.
   * Tool calls are omitted because interruption precedes dispatch; retaining
   * one would require a fabricated result. Open unknown blocks are also omitted.
   * @returns the kept blocks; empty when nothing streamed before the interruption.
   */
  interruptedBlocks(): ContentBlock[] {
    return this.order
      .map((index) => {
        const partial = this.mustGet(index)
        const type = partial.block?.type ?? partial.blockType
        if (type !== 'text' && type !== 'reasoning') return undefined
        return this.assemble(partial, index)
      })
      .filter((block): block is ContentBlock =>
        (block?.type === 'text' || block?.type === 'reasoning') && block.text.trim() !== '')
  }

  /** Usage from the `usage` chunk; undefined until one arrives. */
  // 中文：usage 访问器：来自 usage 块；收到之前为 undefined。
  get usage(): TokenUsage | undefined {
    return this._usage
  }

  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  // 中文：finish 访问器：来自 finish 块；流未带 finish 结束时回退为正常停止。
  get finish(): FinishReason {
    return this._finish ?? { kind: 'stop' }
  }

  /*
   * （中文）终结 finish 块携带的回放元数据（若有），逐块条目与 blocks() 同步
   * 裁剪；条目数与发出的块对不上时返回 undefined。
   */
  /**
   * Replay metadata from the terminal finish chunk, if any, with per-block
   * entries pruned in step with {@link blocks}. Undefined when the envelope's
   * entries do not align with the emitted blocks.
   */
  get replayState(): ReplayEnvelope | undefined {
    return this.assembled().replay
  }

  /*
   * （中文）组装好的助手消息。
   * @param source 组装消息的生产者归属；缺省标记为 dsh-llm/assembler 插件。
   * @returns 基于 blocks() 的冻结助手角色消息（同一套开放块组装规则）。
   */
  /**
   * The assembled assistant message.
   * @param source - producer attribution for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source: MessageSource = { kind: 'plugin', plugin: 'dsh-llm/assembler' }): Message {
    return createMessage({ role: 'assistant', content: this.blocks(), source })
  }
}
