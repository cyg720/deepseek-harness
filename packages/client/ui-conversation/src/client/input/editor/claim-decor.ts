/**
 * Claim-token highlight: while a command claim holds, the draft's leading
 * token renders in the warn color. A TextNode transform keeps the token in
 * its own styled node (splitting when typing merges text into it), and the
 * shell nudges the first leaf dirty when the claim flips so entering and
 * leaving claimed restyles without a text edit.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 claim decor 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { LexicalEditor, TextNode as TextNodeType } from 'lexical'
import { $getRoot, $isElementNode, $isTextNode, TextNode } from 'lexical'

/** Inline style carried by the claim-token node (the old backdrop's hlToken color).
 * @remarks 中文说明：常量说明：TOKEN_STYLE 用于处理 TOKEN_STYLE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const TOKEN_STYLE = 'color: var(--dsw-alias-state-warn-label)'

/** The document's first text leaf, or null (empty document / leading chip).
 * @remarks 中文说明：功能说明：处理 firstTextLeaf 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：TextNodeType | null；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * firstTextLeaf()，并按返回类型处理结果。 */
function firstTextLeaf(): TextNodeType | null {
  /**
   * 常量说明：block 用于处理 block 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const block = $getRoot().getFirstChild()
  if (!$isElementNode(block)) return null
  /**
   * 常量说明：leaf 用于处理 leaf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const leaf = block.getFirstChild()
  return $isTextNode(leaf) ? leaf : null
}

/**
 * Register the claim-token styling transform.
 * @param editor - the shell-owned editor.
 * @param activeToken - live claim token accessor; null while unclaimed.
 * @returns the unregister disposer.
 * @remarks 中文说明：功能说明：注册 Claim Decoration 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：editor（LexicalEditor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：activeToken（() => string | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * registerClaimDecoration(editor, activeToken)，并按返回类型处理结果。
 */
export function registerClaimDecoration(editor: LexicalEditor, activeToken: () => string | null): () => void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  return editor.registerNodeTransform(TextNode, (node) => {
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = firstTextLeaf()
    if (first === null || node.getKey() !== first.getKey()) {
      // Off the token seat: clear a stale token style (a node can move here
      // by paragraph merges).
      if (node.getStyle() === TOKEN_STYLE) node.setStyle('')
      return
    }
    /**
     * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const token = activeToken()
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = node.getTextContent()
    if (token === null || !text.startsWith(token)) {
      if (node.getStyle() === TOKEN_STYLE) node.setStyle('')
      return
    }
    if (text.length > token.length) {
      // Typing at the token boundary lands in the styled node; split the
      // overflow back out so only the token itself carries the color.
      /**
       * 常量说明：tokenNode 用于处理 tokenNode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const [tokenNode] = node.splitText(token.length)
      if (tokenNode !== undefined && tokenNode.getStyle() !== TOKEN_STYLE) tokenNode.setStyle(TOKEN_STYLE)
      return
    }
    if (node.getStyle() !== TOKEN_STYLE) node.setStyle(TOKEN_STYLE)
  })
}

/**
 * Nudge the token seat dirty so the transform restyles after a claim flip
 * (claims change phase without a text edit; transforms only run on dirty
 * nodes).
 * @param editor - the shell-owned editor.
 * @remarks 中文说明：功能说明：处理 refreshClaimDecoration 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：editor（LexicalEditor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * refreshClaimDecoration(editor)，并按返回类型处理结果。
 */
export function refreshClaimDecoration(editor: LexicalEditor): void {
  // Not discrete: a refresh can fire from inside an update listener, where a
  // synchronous nested commit would recurse; the queued update lands on the
  // next flush.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  editor.update(() => {
    firstTextLeaf()?.markDirty()
  })
}
