/**
 * Detect-coordinate span application: the one place that maps a TokenSpan's
 * numeric [start, end) back onto Lexical points and applies an edit there.
 * Every slash/input-* event (begin-command, insert-reference, insert-text,
 * consume-token) lands through here; revision CAS stays with the caller —
 * this module only maps and edits. All functions
 * must run inside `editor.update()`.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 span map 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { LexicalNode, RangeSelection } from 'lexical'
import { $createRangeSelection, $getRoot, $setSelection } from 'lexical'
import type { ComposerLayout } from './projection.ts'
import { $composerLayout } from './projection.ts'

/** Half-open [start, end) range in detect coordinates (TokenSpan's plane). */
export interface DetectSpan {
  readonly start: number
  readonly end: number
}

/** One resolved selection point (set() argument triple). */
interface ResolvedPoint {
  readonly key: string
  readonly offset: number
  readonly type: 'text' | 'element'
}

/**
 * Resolve one detect offset to a selection point. Ownership rule: the first
 * segment whose half-open [start, end) contains the offset resolves it; the
 * document end falls to the last block. Atomic segments (chip, linebreak)
 * resolve to element points beside them, so a span can only ever address a
 * chip as a whole; a gap offset is the end of the block before it.
 * @param layout - current walk product.
 * @param offset - detect offset in [0, detectLength].
 * @returns the point, or null when the offset is out of bounds.
 * @remarks 中文说明：功能说明：解析 Point 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：layout（ComposerLayout）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：offset（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ResolvedPoint |
 * null；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolvePoint(layout,
 * offset)，并按返回类型处理结果。
 */
function resolvePoint(layout: ComposerLayout, offset: number): ResolvedPoint | null {
  if (offset < 0 || offset > layout.detectLength) return null
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of layout.segments) {
    if (offset >= segment.detectStart + segment.detectLength) continue
    if (segment.kind === 'text' && segment.node !== null) {
      return { key: segment.node.getKey(), offset: offset - segment.detectStart, type: 'text' }
    }
    if (segment.kind === 'gap' && segment.gapBetween !== undefined) {
      /**
       * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const before = segment.gapBetween.before
      return { key: before, offset: layout.children.get(before)?.length ?? 0, type: 'element' }
    }
    // Atomic leaf (chip / linebreak): the element point on its leading side.
    /* v8 ignore next -- non-gap segments always carry their node. */
    if (segment.node === null) return null
    /**
     * 常量说明：element 用于处理 element 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const element = segment.node.getParent()
    /* v8 ignore next -- a walked leaf always has a parent element. */
    if (element === null) return null
    return { key: element.getKey(), offset: segment.node.getIndexWithinParent(), type: 'element' }
  }
  // offset === detectLength: the end of the last block (or the empty root).
  /**
   * 常量说明：blocks 用于处理 blocks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const blocks = $getRoot().getChildren()
  /**
   * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const last = blocks[blocks.length - 1]
  if (last === undefined) return { key: $getRoot().getKey(), offset: 0, type: 'element' }
  return { key: last.getKey(), offset: layout.children.get(last.getKey())?.length ?? 0, type: 'element' }
}

/**
 * Build and apply a live RangeSelection over one detect span.
 * @param layout - current walk product.
 * @param span - detect span.
 * @returns the applied selection, or null when either endpoint fails to map.
 * @remarks 中文说明：功能说明：处理 selectSpan 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：layout（ComposerLayout）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：span（DetectSpan）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RangeSelection |
 * null；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 selectSpan(layout,
 * span)，并按返回类型处理结果。
 */
function selectSpan(layout: ComposerLayout, span: DetectSpan): RangeSelection | null {
  if (span.start < 0 || span.start > span.end || span.end > layout.detectLength) return null
  /**
   * 常量说明：anchor 用于处理 anchor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const anchor = resolvePoint(layout, span.start)
  /**
   * 常量说明：focus 用于处理 focus 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const focus = resolvePoint(layout, span.end)
  /* v8 ignore next -- bounds were checked above; resolvePoint only fails out of bounds. */
  if (anchor === null || focus === null) return null
  /**
   * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selection = $createRangeSelection()
  selection.anchor.set(anchor.key, anchor.offset, anchor.type)
  selection.focus.set(focus.key, focus.offset, focus.type)
  $setSelection(selection)
  return selection
}

/**
 * Select one detect span (collapsed spans place the caret). Exposed for the
 * shell's caret placement and tests; the replace helpers below build on it.
 * @param span - detect span to select.
 * @returns whether both endpoints mapped.
 * @remarks 中文说明：功能说明：处理 $selectDetectSpan 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：span（DetectSpan）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 $selectDetectSpan(span)，
 * 并按返回类型处理结果。
 */
export function $selectDetectSpan(span: DetectSpan): boolean {
  return selectSpan($composerLayout(), span) !== null
}

/**
 * Replace one detect span with plain text (empty text deletes the span).
 * The caret lands after the insertion.
 * @param span - detect span to replace.
 * @param text - replacement text.
 * @returns whether the span mapped and the edit applied.
 * @remarks 中文说明：功能说明：处理 $replaceDetectSpanWithText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：span（DetectSpan）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 $replaceDetectSpanWithText(span,
 * text)，并按返回类型处理结果。
 */
export function $replaceDetectSpanWithText(span: DetectSpan, text: string): boolean {
  /**
   * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selection = selectSpan($composerLayout(), span)
  if (selection === null) return false
  if (text === '' && !selection.isCollapsed()) selection.removeText()
  else selection.insertText(text)
  return true
}

/**
 * Replace one detect span with nodes (chip insertion path). The caret lands
 * after the last inserted node.
 * @param span - detect span to replace.
 * @param nodes - replacement nodes in order.
 * @returns whether the span mapped and the edit applied.
 * @remarks 中文说明：功能说明：处理 $replaceDetectSpanWithNodes 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：span（DetectSpan）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：nodes（readonly
 * LexicalNode[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 $replaceDetectSpanWithNodes(span,
 * nodes)，并按返回类型处理结果。
 */
export function $replaceDetectSpanWithNodes(span: DetectSpan, nodes: readonly LexicalNode[]): boolean {
  /**
   * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selection = selectSpan($composerLayout(), span)
  if (selection === null) return false
  selection.insertNodes([...nodes])
  return true
}
