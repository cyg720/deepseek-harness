/**
 * Plain-text reference decoration (the plain-text-reference decision;
 * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * a `/name` or `@name` token whose name is on the trigger's lexicon, and
 * syntax-recognizable `@dir/` folder tokens, render in the chip family
 * colors. Color only, no icon: a token still carrying its trigger character
 * is editable text, not a settled chip — the domain icon marks exactly the
 * settled state. Pure derivation as before — the entity transform converts
 * matching text into TextRefNode and back as edits move it in and out of
 * match shape; no occurrence identity exists.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 text ref 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { EditorConfig, LexicalEditor, SerializedTextNode } from 'lexical'
import { TextNode } from 'lexical'
import { registerLexicalTextEntity } from '@lexical/text'
import { mergeRegister } from '@lexical/utils'
import { $getRoot } from 'lexical'
import { scanTextRefs } from '../decorations.ts'
import css from './composer-editor.module.css'

/** JSON form of one text-ref node. */
export type SerializedTextRefNode = SerializedTextNode

/** One matched plain-text reference as a styled, fully editable text node.
 * @remarks 中文说明：类说明：TextRefNode 用于集中封装 处理 TextRefNode 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-conversation
 * 在对应插件或业务生命周期内创建和调用。 */
export class TextRefNode extends TextNode {
  /** Lexical node registry type tag.
   * @remarks 中文说明：功能说明：获取 Type 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getType()，并按返回类型处理结果。 */
  static override getType(): string {
    return 'composer-text-ref'
  }

  /**
   * Clone with identity (Lexical writable-copy contract).
   * @param node - node to clone.
   * @returns a copy carrying the same NodeKey.
   * @remarks 中文说明：功能说明：处理 clone 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（TextRefNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：TextRefNode；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clone(node)，并按返回类型处理结果。
   */
  static override clone(node: TextRefNode): TextRefNode {
    return new TextRefNode(node.__text, node.__key)
  }

  /**
   * Rebuild one text-ref from its JSON form.
   * @param json - serialized node.
   * @returns a fresh node.
   * @remarks 中文说明：功能说明：处理 importJSON 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：json（SerializedTextRefNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：TextRefNode；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * importJSON(json)，并按返回类型处理结果。
   */
  static override importJSON(json: SerializedTextRefNode): TextRefNode {
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = new TextRefNode(json.text)
    node.setFormat(json.format)
    node.setDetail(json.detail)
    node.setMode(json.mode)
    node.setStyle(json.style)
    return node
  }

  /** Serialize to the JSON node form.
   * @remarks 中文说明：功能说明：处理 exportJSON 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SerializedTextRefNode；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * exportJSON()，并按返回类型处理结果。 */
  override exportJSON(): SerializedTextRefNode {
    return {
      ...super.exportJSON(),
      type: 'composer-text-ref',
    }
  }

  /** Style the span the base TextNode mounts.
   * @remarks 中文说明：功能说明：创建 DOM 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：config（EditorConfig）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：HTMLElement；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * createDOM(config)，并按返回类型处理结果。 */
  override createDOM(config: EditorConfig): HTMLElement {
    /**
     * 常量说明：el 用于处理 el 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const el = super.createDOM(config)
    el.classList.add(css.textRef ?? 'textRef')
    el.setAttribute('data-composer-text-ref', '')
    return el
  }

  /** Entity nodes never merge with plain siblings (the transform owns their bounds).
   * @remarks 中文说明：功能说明：判断是否为 Text Entity 相关流程；使用场景由所在模块及调用位置决定。；返回值：true；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isTextEntity()，并按返回类型处理结果。 */
  override isTextEntity(): true {
    return true
  }

  /** Editing continues inside; the transform re-evaluates match shape per edit.
   * @remarks 中文说明：功能说明：判断是否能够 Insert Text Before 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * canInsertTextBefore()，并按返回类型处理结果。 */
  override canInsertTextBefore(): boolean {
    return true
  }
}

/**
 * Register the plain-text reference entity transform. The claim decoration
 * has precedence on the leading-token seat: while a command claim holds, the
 * claimed token must stay a plain TextNode (transforms register per concrete
 * node class, so a TextRefNode would never receive the TextNode claim
 * transform and the warn color would be lost).
 * @param editor - the shell-owned editor.
 * @param lexiconOf - live per-trigger name-roll accessor (the controller's aggregated store).
 * @param activeToken - live claim token accessor; null while unclaimed.
 * @returns the unregister disposer.
 * @remarks 中文说明：功能说明：注册 Text Ref Decoration 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：editor（LexicalEditor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：lexiconOf（() => ReadonlyMap<'/' | '@', readonly
 * string[]>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：activeToken（() => string |
 * null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 registerTextRefDecoration(editor,
 * lexiconOf, activeToken)，并按返回类型处理结果。
 */
export function registerTextRefDecoration(
  editor: LexicalEditor,
  lexiconOf: () => ReadonlyMap<'/' | '@', readonly string[]>,
  activeToken: () => string | null,
): () => void {
  /**
   * 常量说明：getMatch 用于获取 Match 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：获取 Match 相关流程；使用场景由所在模块及调用位置决定。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns { start: number; end: number } | null；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getMatch(text)，并按返回类型处理结果。
   */
  const getMatch = (text: string): { start: number; end: number } | null => {
    /**
     * 常量说明：claim 用于处理 claim 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const claim = activeToken()
    /**
     * 变量说明：range 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const range of scanTextRefs(text, lexiconOf())) {
      if (claim !== null && range.start === 0 && text.slice(range.start, range.end) === claim) continue
      return { start: range.start, end: range.end }
    }
    return null
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  return mergeRegister(
    ...registerLexicalTextEntity(
      editor,
      getMatch,
      TextRefNode,
      node => new TextRefNode(node.getTextContent()),
    ),
  )
}

/**
 * Force a re-scan of the whole document (transforms only visit dirty nodes;
 * a lexicon roll change dirties nothing on its own). Queued, not discrete —
 * the caller may sit inside an update listener.
 * @param editor - the shell-owned editor.
 * @remarks 中文说明：功能说明：处理 rescanTextRefs 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：editor（LexicalEditor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rescanTextRefs(editor)，
 * 并按返回类型处理结果。
 */
export function rescanTextRefs(editor: LexicalEditor): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  editor.update(() => {
    /**
     * 变量说明：node 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const node of $getRoot().getAllTextNodes()) node.markDirty()
  })
}
