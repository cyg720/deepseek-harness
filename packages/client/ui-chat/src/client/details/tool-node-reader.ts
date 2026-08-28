/**
 * 文件职责：实现 client/ui-chat 中 tool node reader 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore, ChatSnapshot, ToolCallBlock } from '../contract/snapshot.ts'

/**
 * 功能说明：处理 toolNode 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （ReturnType<ChatNodeStore['get']>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns ChatNode<'tool-call'> | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toolNode(node)，并按返回类型处理结果。
 */
function toolNode(node: ReturnType<ChatNodeStore['get']>): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

/**
 * Find any root or nested Tool lifecycle through the internal Node store.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns current Tool lifecycle when materialized in the loaded window.
 * @remarks 中文说明：功能说明：查找 Tool Call 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：snapshot（ChatSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：callId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ToolCallBlock |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * findToolCall(snapshot, callId)，并按返回类型处理结果。
 */
export function findToolCall(snapshot: ChatSnapshot, callId: string): ToolCallBlock | undefined {
  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param block （ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ToolCallBlock | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(block)，并按返回类型处理结果。
   */
  const visit = (block: ToolCallBlock): ToolCallBlock | undefined => {
    if (block.callId === callId) return block
    /**
     * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const child of block.subCalls) {
      /**
       * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  /**
   * 变量说明：node 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const node of snapshot.nodes.values()) {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = toolNode(node)?.data.root
    if (root === undefined) continue
    /**
     * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const found = visit(root)
    if (found !== undefined) return found
  }
  return undefined
}
