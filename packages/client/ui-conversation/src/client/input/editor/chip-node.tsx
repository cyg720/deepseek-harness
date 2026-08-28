/**
 * ReferenceChipNode: one inline reference as an atomic Lexical decorator.
 * The node IS the occurrence — NodeKey carries identity, the node carries
 * the owner's insert-time projections (label/appearance/clipboardText), and
 * `getTextContent()` answers the clipboard/persistence projection so native
 * copy and the draft mirror stay correct without expansion code. The detect
 * projection (trigger scanning and TokenSpan coordinates) counts every chip
 * as one U+FFFC instead; see projection.ts.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 chip node 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { JSX } from 'react'
import type {
  EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread,
} from 'lexical'
import { DecoratorNode } from 'lexical'
import type { ReferenceInsert } from '../../contract/input.ts'
import { ReferenceChip } from './ReferenceChip.tsx'

/** JSON form of one chip (Lexical node serialization contract). */
export type SerializedReferenceChipNode = Spread<{
  source: string
  ref: string
  label: string
  appearance?: ReferenceInsert['appearance']
  clipboardText: string
  invalid: boolean
}, SerializedLexicalNode>

/** One inline reference occurrence as an atomic decorator node.
 * @remarks 中文说明：类说明：ReferenceChipNode 用于集中封装 处理 ReferenceChipNode 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-conversation
 * 在对应插件或业务生命周期内创建和调用。 */
export class ReferenceChipNode extends DecoratorNode<JSX.Element> {
  /** Owning source name (serializer routing key).
   * @remarks 中文说明：变量说明：__source 用于处理 __source 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  __source: string
  /** Owner-scoped reference id.
   * @remarks 中文说明：变量说明：__ref 用于处理 __ref 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  __ref: string
  /** Inline display label (insert-time cache).
   * @remarks 中文说明：变量说明：__label 用于处理 __label 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  __label: string
  /** Optional domain glyph (insert-time cache).
   * @remarks 中文说明：变量说明：__appearance 用于处理 __appearance 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  __appearance: ReferenceInsert['appearance']
  /** Clipboard / persistence projection, e.g. `/name` (never the model form).
   * @remarks 中文说明：变量说明：__clipboardText 用于处理 __clipboardText 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  __clipboardText: string
  /** Owner-resolution failure flag: chip renders invalid; serialization must fail.
   * @remarks 中文说明：变量说明：__invalid 用于处理 __invalid 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。 */
  __invalid: boolean

  /** Lexical node registry type tag.
   * @remarks 中文说明：功能说明：获取 Type 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getType()，并按返回类型处理结果。 */
  static override getType(): string {
    return 'reference-chip'
  }

  /**
   * Clone with identity (Lexical writable-copy contract).
   * @param node - node to clone.
   * @returns a copy carrying the same NodeKey.
   * @remarks 中文说明：功能说明：处理 clone 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（ReferenceChipNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ReferenceChipNode；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * clone(node)，并按返回类型处理结果。
   */
  static override clone(node: ReferenceChipNode): ReferenceChipNode {
    return new ReferenceChipNode(
      {
        source: node.__source,
        ref: node.__ref,
        label: node.__label,
        appearance: node.__appearance,
        clipboardText: node.__clipboardText,
      },
      node.__invalid,
      node.__key,
    )
  }

  /**
   * Rebuild one chip from its JSON form.
   * @param json - serialized chip.
   * @returns a fresh node (new key).
   * @remarks 中文说明：功能说明：处理 importJSON 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：json（SerializedReferenceChipNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ReferenceChipNode；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * importJSON(json)，并按返回类型处理结果。
   */
  static override importJSON(json: SerializedReferenceChipNode): ReferenceChipNode {
    return new ReferenceChipNode(
      {
        source: json.source,
        ref: json.ref,
        label: json.label,
        appearance: json.appearance,
        clipboardText: json.clipboardText,
      },
      json.invalid,
    )
  }

  /**
   * @param insert - the owner's reference insertion (display projections included).
   * @param invalid - owner-resolution failure bit (defaults valid).
   * @param key - Lexical clone-path key; absent for fresh nodes.
   * @remarks 中文说明：功能说明：处理 ReferenceChipNode 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：insert（Omit<ReferenceInsert, 'appearance'> & { appearance?:
   * Refere…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：invalid（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：key（NodeKey）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * ReferenceChipNode(insert, invalid, key) 创建实例，并在所属生命周期内使用。
   */
  constructor(insert: Omit<ReferenceInsert, 'appearance'> & { appearance?: ReferenceInsert['appearance'] }, invalid = false, key?: NodeKey) {
    super(key)
    this.__source = insert.source
    this.__ref = insert.ref
    this.__label = insert.label
    this.__appearance = insert.appearance
    this.__clipboardText = insert.clipboardText
    this.__invalid = invalid
  }

  /** Serialize to the JSON node form.
   * @remarks 中文说明：功能说明：处理 exportJSON 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SerializedReferenceChipNode；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 exportJSON()，并按返回类型处理结果。 */
  override exportJSON(): SerializedReferenceChipNode {
    return {
      ...super.exportJSON(),
      type: 'reference-chip',
      version: 1,
      source: this.__source,
      ref: this.__ref,
      label: this.__label,
      ...(this.__appearance === undefined ? {} : { appearance: this.__appearance }),
      clipboardText: this.__clipboardText,
      invalid: this.__invalid,
    }
  }

  /**
   * Mount the chip's host element; the decorator portal renders into it.
   * @returns an inline, non-editable span carrying the test/e2e anchor.
   * @remarks 中文说明：功能说明：创建 DOM 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：_config（EditorConfig）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：HTMLElement；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * createDOM(_config)，并按返回类型处理结果。
   */
  override createDOM(_config: EditorConfig): HTMLElement {
    /**
     * 常量说明：el 用于处理 el 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const el = document.createElement('span')
    el.setAttribute('data-composer-chip', this.__source)
    el.setAttribute('contenteditable', 'false')
    return el
  }

  /** Host element never changes shape.
   * @remarks 中文说明：功能说明：更新 DOM 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 updateDOM()，并按返回类型处理结果。 */
  override updateDOM(): boolean {
    return false
  }

  /** Chips sit in the text line.
   * @remarks 中文说明：功能说明：判断是否为 Inline 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isInline()，并按返回类型处理结果。 */
  override isInline(): boolean {
    return true
  }

  /**
   * No keyboard-selected intermediate state: arrows step across the chip in
   * one move and Backspace/Delete remove it whole (the placeholder semantics
   * of the old textarea). `true` would put a NodeSelection between the
   * keystroke and the caret — a state the plain-text binding's handlers all
   * ignore, deadlocking arrows, typing, and deletion at the chip edge.
   * @remarks 中文说明：功能说明：判断是否为 Keyboard Selectable 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * isKeyboardSelectable()，并按返回类型处理结果。
   */
  override isKeyboardSelectable(): boolean {
    return false
  }

  /** Clipboard / persistence projection (native copy reads this).
   * @remarks 中文说明：功能说明：获取 Text Content 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getTextContent()，
   * 并按返回类型处理结果。 */
  override getTextContent(): string {
    return this.__clipboardText
  }

  /**
   * Flip the owner-resolution failure bit.
   * @param invalid - next bit; no-op writes are the caller's concern.
   * @remarks 中文说明：功能说明：设置 Invalid 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：invalid（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setInvalid(invalid)，并按返回类型处理结果。
   */
  setInvalid(invalid: boolean): void {
    /**
     * 常量说明：writable 用于处理 writable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writable = this.getWritable()
    writable.__invalid = invalid
  }

  /** Owner-resolution failure bit.
   * @remarks 中文说明：功能说明：判断是否为 Invalid 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isInvalid()，并按返回类型处理结果。 */
  isInvalid(): boolean {
    return this.getLatest().__invalid
  }

  /** Owning source name.
   * @remarks 中文说明：功能说明：获取 Source 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getSource()，并按返回类型处理结果。 */
  getSource(): string {
    return this.getLatest().__source
  }

  /** Owner-scoped reference id.
   * @remarks 中文说明：功能说明：获取 Reference 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getReference()，并按返回类型处理结果。 */
  getReference(): string {
    return this.getLatest().__ref
  }

  /** Inline display label.
   * @remarks 中文说明：功能说明：获取 Label 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getLabel()，并按返回类型处理结果。 */
  getLabel(): string {
    return this.getLatest().__label
  }

  /** Optional domain glyph.
   * @remarks 中文说明：功能说明：获取 Appearance 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：ReferenceInsert['appearance']；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 getAppearance()，并按返回类型处理结果。 */
  getAppearance(): ReferenceInsert['appearance'] {
    return this.getLatest().__appearance
  }

  /** React face rendered into the host element by the decorator portal.
   * @remarks 中文说明：功能说明：处理 decorate 相关流程；使用场景由所在模块及调用位置决定。；返回值：JSX.Element；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 decorate()，并按返回类型处理结果。 */
  override decorate(): JSX.Element {
    return (
      <ReferenceChip
        label={this.__label}
        appearance={this.__appearance}
        invalid={this.__invalid}
      />
    )
  }
}

/**
 * Mint one chip node from a reference insertion.
 * @param insert - the owner's reference insertion.
 * @returns the fresh node.
 * @remarks 中文说明：功能说明：处理 $createReferenceChipNode 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：insert（ReferenceInsert）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ReferenceChipNode；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * $createReferenceChipNode(insert)，并按返回类型处理结果。
 */
export function $createReferenceChipNode(insert: ReferenceInsert): ReferenceChipNode {
  return new ReferenceChipNode(insert)
}

/**
 * Chip type guard.
 * @param node - any node or nullish.
 * @returns whether the node is a ReferenceChipNode.
 * @remarks 中文说明：功能说明：处理 $isReferenceChipNode 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：node（LexicalNode | null | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：node is ReferenceChipNode；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 $isReferenceChipNode(node)，并按返回类型处理结果。
 */
export function $isReferenceChipNode(node: LexicalNode | null | undefined): node is ReferenceChipNode {
  return node instanceof ReferenceChipNode
}
