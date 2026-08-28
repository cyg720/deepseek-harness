/**
 * Composer editor projections: one EditorState, three pure text views.
 * detectText feeds trigger detection and TokenSpan coordinates (every chip
 * counts as one U+FFFC — the opaque-reference invariant); clipboardText
 * feeds persistence, the InputState draft, and submit-plane decisions
 * (chips expand to their clipboard projection); the model form is not a
 * text view here — submit serializes chip nodes through their owner codec.
 * All $-functions must run inside `editor.read()` / `editor.update()`.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 projection 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ElementNode, LexicalNode, NodeKey, Point } from 'lexical'
import {
  $getRoot, $getSelection, $isElementNode, $isLineBreakNode, $isRangeSelection, $isTextNode,
} from 'lexical'
import type { Occurrence } from '../../contract/input.ts'
import { $isReferenceChipNode } from './chip-node.tsx'

/** The detect-projection stand-in for one chip (object replacement character).
 * @remarks 中文说明：常量说明：ATOMIC_CHAR 用于处理 ATOMIC_CHAR 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const ATOMIC_CHAR = '￼'

/** One leaf (or gap) of the composer document in projection coordinates. */
export interface ComposerSegment {
  /** text/linebreak carry a node; chip is atomic; gap is the newline between block elements. */
  readonly kind: 'text' | 'chip' | 'linebreak' | 'gap'
  /** The backing node; null only for gap. */
  readonly node: LexicalNode | null
  readonly detectStart: number
  readonly detectLength: number
  readonly clipboardStart: number
  readonly clipboardLength: number
  /** gap only: the block elements this newline separates. */
  readonly gapBetween?: { readonly before: NodeKey; readonly after: NodeKey }
}

/** One walk's product: segments plus the indexes point mapping needs. */
export interface ComposerLayout {
  readonly segments: readonly ComposerSegment[]
  readonly detectLength: number
  readonly detectText: string
  readonly clipboardText: string
  /** Leaf node key → its segment (text/chip/linebreak). */
  readonly byKey: ReadonlyMap<NodeKey, ComposerSegment>
  /** Element key → ordered child keys (root and every block element). */
  readonly children: ReadonlyMap<NodeKey, readonly NodeKey[]>
  /** Element key → detect bounds of its content (gaps excluded). */
  readonly bounds: ReadonlyMap<NodeKey, { readonly start: number; readonly end: number }>
}

/**
 * Walk the composer document once, producing every projection segment in
 * document order. Blocks (paragraphs) contribute a one-newline gap between
 * one another in both text projections.
 * @returns the layout for this EditorState.
 * @remarks 中文说明：功能说明：处理 $composerLayout 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：ComposerLayout；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * $composerLayout()，并按返回类型处理结果。
 */
export function $composerLayout(): ComposerLayout {
  /**
   * 常量说明：segments 用于处理 segments 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const segments: ComposerSegment[] = []
  /**
   * 常量说明：byKey 用于处理 byKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const byKey = new Map<NodeKey, ComposerSegment>()
  /**
   * 常量说明：children 用于处理 children 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const children = new Map<NodeKey, readonly NodeKey[]>()
  /**
   * 常量说明：bounds 用于处理 bounds 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bounds = new Map<NodeKey, { start: number; end: number }>()
  /**
   * 变量说明：detect 用于处理 detect 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let detect = ''
  /**
   * 变量说明：clipboard 用于处理 clipboard 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let clipboard = ''

  /**
   * 常量说明：pushLeaf 用于处理 pushLeaf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 pushLeaf 相关流程；使用场景由所在模块及调用位置决定。
   * @param kind （'text' | 'chip' | 'linebreak'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param node （LexicalNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param detectPiece （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param clipboardPiece （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pushLeaf(kind, node, detectPiece, clipboardPiece)，
   * 并按返回类型处理结果。
   */
  const pushLeaf = (kind: 'text' | 'chip' | 'linebreak', node: LexicalNode, detectPiece: string, clipboardPiece: string): void => {
    /**
     * 常量说明：segment 用于处理 segment 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const segment: ComposerSegment = {
      kind,
      node,
      detectStart: detect.length,
      detectLength: detectPiece.length,
      clipboardStart: clipboard.length,
      clipboardLength: clipboardPiece.length,
    }
    segments.push(segment)
    byKey.set(node.getKey(), segment)
    detect += detectPiece
    clipboard += clipboardPiece
  }

  /**
   * 常量说明：walkElement 用于处理 walkElement 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 walkElement 相关流程；使用场景由所在模块及调用位置决定。
   * @param element （ElementNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 walkElement(element)，并按返回类型处理结果。
   */
  const walkElement = (element: ElementNode): void => {
    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start = detect.length
    /**
     * 常量说明：kids 用于处理 kids 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const kids = element.getChildren()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：kid（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(kid)，并按返回类型处理结果。
     */
    children.set(element.getKey(), kids.map(kid => kid.getKey()))
    /**
     * 变量说明：kid 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const kid of kids) {
      if ($isReferenceChipNode(kid)) {
        pushLeaf('chip', kid, ATOMIC_CHAR, kid.getTextContent())
      } else if ($isTextNode(kid)) {
        /**
         * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const text = kid.getTextContent()
        pushLeaf('text', kid, text, text)
      } else if ($isLineBreakNode(kid)) {
        pushLeaf('linebreak', kid, '\n', '\n')
      } else if ($isElementNode(kid)) {
        /* v8 ignore next 4 -- plain-text composition nests no block elements today; the walk stays total for imported states. */
        walkElement(kid)
      }
      // Unknown inline decorators contribute nothing: this composer registers
      // no other decorator type, so the arm is unreachable by construction.
    }
    bounds.set(element.getKey(), { start, end: detect.length })
  }

  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = $getRoot()
  /**
   * 常量说明：blocks 用于处理 blocks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const blocks = root.getChildren()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  children.set(root.getKey(), blocks.map(block => block.getKey()))
  /**
   * 常量说明：rootStart 用于处理 rootStart 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rootStart = detect.length
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block, index)，并按返回类型处理结果。
   */
  blocks.forEach((block, index) => {
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = blocks[index - 1]
    if (index > 0 && previous !== undefined) {
      segments.push({
        kind: 'gap',
        node: null,
        detectStart: detect.length,
        detectLength: 1,
        clipboardStart: clipboard.length,
        clipboardLength: 1,
        gapBetween: { before: previous.getKey(), after: block.getKey() },
      })
      detect += '\n'
      clipboard += '\n'
    }
    if ($isElementNode(block)) walkElement(block)
  })
  bounds.set(root.getKey(), { start: rootStart, end: detect.length })

  return {
    segments,
    detectLength: detect.length,
    detectText: detect,
    clipboardText: clipboard,
    byKey,
    children,
    bounds,
  }
}

/**
 * Fold one clipboard-projection offset to its detect-projection twin.
 * Offsets inside a chip's clipboard expansion snap to the chip's trailing
 * edge; callers only pass boundaries that were once a document end (submit
 * snapshots), which never split a chip.
 * @param layout - the current walk product.
 * @param clipboardOffset - offset into the clipboard projection.
 * @returns the detect offset covering the same document position.
 * @remarks 中文说明：功能说明：处理 detectOffsetOfClipboardOffset 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：layout（ComposerLayout）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：clipboardOffset（number）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 detectOffsetOfClipboardOffset(layout,
 * clipboardOffset)，并按返回类型处理结果。
 */
export function detectOffsetOfClipboardOffset(layout: ComposerLayout, clipboardOffset: number): number {
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of layout.segments) {
    /**
     * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const end = segment.clipboardStart + segment.clipboardLength
    if (clipboardOffset > end) continue
    if (clipboardOffset === end) return segment.detectStart + segment.detectLength
    if (segment.kind === 'chip') return segment.detectStart + segment.detectLength
    return segment.detectStart + (clipboardOffset - segment.clipboardStart)
  }
  return layout.detectLength
}

/** The published projection product consumed by the shell every update. */
export interface EditorProjection {
  /** Trigger/TokenSpan coordinate text (chip = one U+FFFC). */
  readonly detectText: string
  /** Persistence/InputState draft text (chip = clipboardText). */
  readonly clipboardText: string
  /** InputState-compatible occurrence view (clipboardText coordinates). */
  readonly occurrences: readonly Occurrence[]
  /** Range selection in detect coordinates (ordered); null while absent or non-range. */
  readonly selection: { readonly start: number; readonly end: number } | null
  /** Collapsed caret in detect coordinates; null while the selection is absent or ranged. */
  readonly caret: number | null
}

/**
 * Fold one selection point to a detect offset.
 * @param layout - the current walk product.
 * @param point - selection anchor/focus point.
 * @returns detect offset, or null when the point references an unknown node.
 * @remarks 中文说明：功能说明：处理 $detectOffsetOfPoint 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：layout（ComposerLayout）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：point（Point）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number | null；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * $detectOffsetOfPoint(layout, point)，并按返回类型处理结果。
 */
export function $detectOffsetOfPoint(layout: ComposerLayout, point: Point): number | null {
  if (point.type === 'text') {
    /**
     * 常量说明：segment 用于处理 segment 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const segment = layout.byKey.get(point.key)
    return segment === undefined ? null : segment.detectStart + Math.min(point.offset, segment.detectLength)
  }
  /**
   * 常量说明：kids 用于处理 kids 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const kids = layout.children.get(point.key)
  /**
   * 常量说明：elementBounds 用于处理 elementBounds 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const elementBounds = layout.bounds.get(point.key)
  if (kids === undefined || elementBounds === undefined) return null
  if (point.offset >= kids.length) return elementBounds.end
  /**
   * 常量说明：childKey 用于处理 childKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const childKey = kids[point.offset]
  if (childKey === undefined) return elementBounds.end
  /**
   * 常量说明：childSegment 用于处理 childSegment 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const childSegment = layout.byKey.get(childKey)
  if (childSegment !== undefined) return childSegment.detectStart
  /**
   * 常量说明：childBounds 用于处理 childBounds 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const childBounds = layout.bounds.get(childKey)
  return childBounds === undefined ? null : childBounds.start
}

/**
 * Project the composer document and its caret.
 * @param idOf - stable occurrence-id assignment per chip NodeKey (the shell
 * owns the map so ids survive across projections of the same node).
 * @returns the three-view projection product.
 * @remarks 中文说明：功能说明：处理 $projectComposer 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：idOf（(key: NodeKey) => number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：EditorProjection；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * $projectComposer(idOf)，并按返回类型处理结果。
 */
export function $projectComposer(idOf: (key: NodeKey) => number): EditorProjection {
  /**
   * 常量说明：layout 用于处理 layout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const layout = $composerLayout()
  /**
   * 常量说明：occurrences 用于处理 occurrences 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const occurrences: Occurrence[] = []
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of layout.segments) {
    if (segment.kind !== 'chip' || !$isReferenceChipNode(segment.node)) continue
    /**
     * 常量说明：chip 用于处理 chip 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chip = segment.node
    occurrences.push({
      occurrenceId: idOf(chip.getKey()),
      source: chip.getSource(),
      ref: chip.getReference(),
      offset: segment.clipboardStart,
      length: segment.clipboardLength,
      label: chip.getLabel(),
      ...(chip.getAppearance() === undefined ? {} : { appearance: chip.getAppearance() }),
      clipboardText: chip.getTextContent(),
      ...(chip.isInvalid() ? { invalid: true } : {}),
    })
  }
  /**
   * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selection = $getSelection()
  /**
   * 变量说明：range 用于处理 range 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let range: { start: number; end: number } | null = null
  if ($isRangeSelection(selection)) {
    /**
     * 常量说明：anchor 用于处理 anchor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const anchor = $detectOffsetOfPoint(layout, selection.anchor)
    /**
     * 常量说明：focus 用于处理 focus 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const focus = $detectOffsetOfPoint(layout, selection.focus)
    if (anchor !== null && focus !== null) {
      range = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
    }
  }
  return {
    detectText: layout.detectText,
    clipboardText: layout.clipboardText,
    occurrences,
    selection: range,
    caret: range !== null && range.start === range.end ? range.start : null,
  }
}
