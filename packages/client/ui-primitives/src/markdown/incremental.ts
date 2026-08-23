/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现增量式"块级" markdown 解析器 IncrementalMarkdownParser：面向只追加的
 *             流式文本。每次新内容到达时不重新解析整个文档，而是冻结大部分旧块、只重解析
 *             尾部少数块，把总开销从"块数 × 更新次数"降为近线性。
 * 【技术维度】基于 mdast（Root / RootContent）与调用方提供的 parse 语法；利用 micromark 的
 *             position 偏移决定冻结边界；key 取块的绝对起始偏移，保证 React 跨更新稳定复用。
 * 【产品维度】AI 回复流式输出时每来一个 chunk 都要更新界面；若每次都全量重解析，长回复下
 *             界面会越来越卡。增量解析让滚动中的长对话保持流畅。
 * 【逻辑维度】1) UNSTABLE_TAIL_BLOCKS 保留不稳定尾部块数；2) PositionedBlock /
 *             IncrementalBlocks 数据结构；3) blockKey 计算稳定 key；4) update()：同文本
 *             去重 → 非追加输入重置 → 只解析尾部 → 冻结除最后两块外的块 → 推进 tailStart。
 * 【关键边界】冻结边界取自 parser 的 position 偏移（取前一块的 end 而非下一块的 start，
 *             以便把块间空行留在尾部，切片源码保持逐字不变）；已知偏差：引用式链接/脚注
 *             是文档级解析，定义跨冻结边界时会以字面量显示，直到完整解析自愈。
 * 【新手阅读建议】先理解"为什么可以只重解析尾部"（CommonMark 块解析是逐行的，追加内容
 *             只能重塑解析前沿），再读 update() 的冻结逻辑。
 * ==========================================================================
 */
/**
 * Incremental block-level markdown parsing for an append-only text stream.
 *
 * Re-parsing the whole accumulated document on every streaming chunk is
 * quadratic in the final reply length. CommonMark block parsing is line-based
 * and appended text can only reshape the parse frontier — the last top-level
 * block (a paragraph becoming a setext heading or a table, a list continuing
 * after a blank line, an unclosed fence swallowing lines) — so earlier blocks
 * are final. This parser therefore freezes all but the trailing
 * {@link UNSTABLE_TAIL_BLOCKS} blocks and re-parses only the source tail
 * behind them: each source region is parsed O(1) times over the stream
 * instead of once per chunk.
 *
 * The freeze boundary comes from the parser's own `position` offsets, never
 * from custom source scanning. The cut sits at the *end offset* of the last
 * frozen block (not the next block's start): a following block's start offset
 * excludes up to three spaces of insignificant leading indentation, which is
 * harmless to drop, but cutting at the previous end also keeps the
 * inter-block blank lines in the tail so the sliced source stays verbatim.
 *
 * Known deviation, shared with any prefix-freeze scheme: micromark resolves
 * reference-style links and footnotes document-wide at parse time, so a
 * reference whose definition lands on the other side of the freeze boundary
 * renders literally until the settled full parse self-heals it.
 */
/**
 * 本文件实现只追加文本流的增量块级 markdown 解析：每次只重解析尾部少量块，
 * 之前的块一旦越过冻结边界就不会再变。
 */

import type { Root, RootContent } from 'mdast'

/**
 * Trailing blocks kept unstable. Appended text reshapes at most the last
 * block; the second-to-last is retained as safety margin so a freeze decision
 * never has to reason about the parse frontier.
 */
// 保留的不稳定尾部块数：追加文本最多重塑最后一个块，倒数第二个是安全余量，
// 让"冻结决策"永远不需要推理解析前沿本身。
const UNSTABLE_TAIL_BLOCKS = 2

/** A top-level mdast block plus a render key that is stable across chunks. */
/**
 * 一个顶层 mdast 块 + 跨更新稳定的渲染 key。
 */
export interface PositionedBlock {
  /** The parsed block. Positions inside it are relative to its parse slice. */
  // 解析出的块；其内部 position 相对于本次解析的切片。
  readonly node: RootContent
  /**
   * The block's start offset in the full source text. Stable from the frame
   * a block first appears through freezing, so React reconciles rather than
   * remounts when a block crosses the freeze boundary.
   */
  // 块在整个源码中的起始偏移。从块首次出现到被冻结都保持不变，
  // 因此块跨冻结边界时 React 是"协调复用"而不是"重挂载"。
  readonly key: number
}

/** One {@link IncrementalMarkdownParser.update} result. */
/**
 * update() 的一次返回值：冻结块 + 尾部块 + 代数。
 */
export interface IncrementalBlocks {
  /** Blocks that can no longer change; grows monotonically per generation. */
  // 不会再变化的块，随更新代数单调增长。
  readonly frozen: readonly PositionedBlock[]
  /** The re-parsed unstable tail (at most {@link UNSTABLE_TAIL_BLOCKS} blocks plus growth). */
  // 重新解析的不稳定尾部（最多 UNSTABLE_TAIL_BLOCKS 块再加增长）。
  readonly tail: readonly PositionedBlock[]
  /** Bumped whenever non-append input discards the frozen prefix; callers drop caches keyed on it. */
  // 非追加输入清空冻结前缀时自增；调用方据此丢弃以它为键的缓存。
  readonly generation: number
}

/**
 * A block's render key: its absolute source start offset. A position-less
 * node (a grammar is free to omit positions) falls back to a negative
 * list-index key — unique within one update's tail, which is the only place
 * the fallback can occur: freezing requires the cut block's position, so a
 * position-less parse keeps every block in the tail (real grammars always
 * stamp positions and never take this path).
 */
/**
 * 块的渲染 key：绝对起始偏移。没有 position 的节点回退为负数下标 key——该回退只可能
 * 发生在尾部：冻结需要被切块的 position，故无 position 时整棵解析都在尾部。
 * @param node - 待取 key 的块。
 * @param base - 本次解析切片的起始偏移（加回后才能得到绝对偏移）。
 * @param index - 块在切片内的下标（回退 key 用）。
 * @returns 稳定的渲染 key。
 */
function blockKey(node: RootContent, base: number, index: number): number {
  const offset = node.position?.start.offset
  return offset === undefined ? -(index + 1) : base + offset
}

/**
 * Append-only incremental parser over a caller-supplied grammar. One instance
 * accumulates one streaming document; non-append input resets it.
 */
/**
 * 基于调用方语法的只追加增量解析器。一个实例累积一份流式文档；非追加输入会重置它。
 * 使用示例：const parser = new IncrementalMarkdownParser(parseGfm)；每收到一个 chunk 调用
 *   update(accumulatedText)，把返回的 frozen 与 tail 交给渲染层。
 */
export class IncrementalMarkdownParser {
  // 上次 update 的完整文本，用于快速判断"新文本是否仍是追加"。
  private prevText = ''
  // 尾部切片在完整源码中的起始偏移；冻结推进时前移。
  private tailStart = 0
  // 已冻结的块（不会再变化），用于拼接最终结果。
  private frozen: PositionedBlock[] = []
  // 代数：非追加输入时自增，供调用方作缓存失效信号。
  private generation = 0
  // 上次结果缓存：输入未变时直接复用，让调用方可在渲染路径中安全重入。
  private cached: IncrementalBlocks | null = null

  /** @param parse - Grammar shared with whatever renders the blocks, so boundaries agree. */
  /**
   * @param parse - 与块渲染方共享的语法（如 parseGfm），保证块边界判定一致。
   */
  constructor(private readonly parse: (text: string) => Root) {}

  /**
   * Fold the current accumulated text and return the frozen/tail split.
   * Idempotent for identical input (the previous result is returned as-is),
   * so callers may invoke it from render paths that re-execute.
   * @param text - The full accumulated markdown source.
   * @returns Frozen and tail blocks with stream-stable render keys.
   */
  /**
   * 归并当前累积文本并返回 frozen / tail 划分。对相同输入是幂等的（直接返回上次结果），
   * 因此渲染路径中重复调用也安全。
   * 使用示例：const { frozen, tail } = parser.update(text)；渲染层拼 frozen + tail。
   * @param text - 累积到当前的完整 markdown 源码。
   * @returns 带稳定渲染 key 的 frozen 与 tail 块。
   */
  update(text: string): IncrementalBlocks {
    if (this.cached !== null && text === this.prevText) return this.cached
    // Deliberate O(prefix) memcmp per update: sound divergence detection has
    // to verify the whole retained prefix, and startsWith compares bytes two
    // orders of magnitude faster than parsing them — the cost this class
    // exists to remove. Passing append/reset deltas instead would push
    // append bookkeeping across the session-projection update boundary for a check
    // that stays sub-millisecond at realistic reply sizes.
    // 刻意选择 O(前缀) 的字节比较：要可靠检测"是否仍是追加"必须核对整个保留前缀，
    // 而 startsWith 比解析快两个数量级——这正是本类要消除的成本；把追加记账推给上游
    // 反而得不偿失。
    if (!text.startsWith(this.prevText)) {
      // 不是追加（文本被改写/截断）：整体重置，代数 +1 通知调用方丢弃缓存。
      this.prevText = ''
      this.tailStart = 0
      this.frozen = []
      this.generation += 1
    }
    this.prevText = text
    // base 是本次解析切片在完整源码中的起点：只解析 tailStart 之后的部分。
    const base = this.tailStart
    const blocks = this.parse(text.slice(base)).children
    // 不稳定起点：默认保留最后 UNSTABLE_TAIL_BLOCKS 块；切不出边界时整棵都在尾部。
    let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS)
    if (firstUnstable > 0) {
      const cutEnd = blocks[firstUnstable - 1]?.position?.end.offset
      if (cutEnd === undefined) {
        // A grammar that omits positions leaves nothing to cut at; keep the
        // whole parse in the tail rather than guessing a boundary.
        // 语法省略 position 时没有可切的边界：把整棵解析留在尾部，而不是猜一个边界。
        firstUnstable = 0
      } else {
        // 把切点之前的块推入 frozen；tailStart 前移到切点（前一块的 end 偏移），
        // 下次解析只覆盖尾部，且块间空行留在尾部保持源码逐字不变。
        for (const node of blocks.slice(0, firstUnstable)) {
          this.frozen.push({ node, key: blockKey(node, base, this.frozen.length) })
        }
        this.tailStart = base + cutEnd
      }
    }
    // 尾部块重解析并取 key；key 使用绝对偏移，跨更新稳定。
    const tail = blocks.slice(firstUnstable).map((node, index) => ({
      node,
      key: blockKey(node, base, index),
    }))
    this.cached = { frozen: [...this.frozen], tail, generation: this.generation }
    return this.cached
  }
}
