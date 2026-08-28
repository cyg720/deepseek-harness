/**
 * 文件职责：实现 client/ui-chat 中 turn navigation 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatLocationNodeIndex, ChatNodeStore, TurnNavigationItem } from '../contract/snapshot.ts'

/**
 * Preview budget per field. The rail clamps two short lines, so anything past
 * this is invisible; copying whole transcripts into navigation state would
 * otherwise grow with the loaded window on every structural update.
 * @remarks 中文说明：常量说明：PREVIEW_LIMIT 用于处理 PREVIEW_LIMIT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PREVIEW_LIMIT = 160

/** Join rendered text until the preview budget is met, then stop reading.
 * @remarks 中文说明：功能说明：处理 preview 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：parts（Iterable<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 preview(parts)，并按返回类型处理结果。 */
function preview(parts: Iterable<string>): string {
  /**
   * 变量说明：text 用于处理 text 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let text = ''
  /**
   * 变量说明：part 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const part of parts) {
    text += text === '' ? part : ` ${part}`
    if (text.length >= PREVIEW_LIMIT) break
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LIMIT)
}

/**
 * 功能说明：处理 promptText 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （ChatNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 promptText(node)，并按返回类型处理结果。
 */
function promptText(node: ChatNode): string {
  if (node.kind !== 'user') return ''
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  return preview(node.data.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

/**
 * 功能说明：处理 responseText 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （ChatNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 responseText(node)，并按返回类型处理结果。
 */
function responseText(node: ChatNode): string {
  if (node.kind !== 'assistant-step') return ''
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  return preview(node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []))
}

/**
 * Whether two items carry the same rail state, so the reader can keep its array.
 * @param left - previously published item, when the Turn had one.
 * @param right - freshly derived item, when the Turn still has one.
 * @returns whether both sides describe the same mark.
 * @remarks 中文说明：功能说明：处理 sameTurnNavigationItem 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：left（TurnNavigationItem | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：right（TurnNavigationItem | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sameTurnNavigationItem(left, right)，并按返回类型处理结果。
 */
export function sameTurnNavigationItem(
  left: TurnNavigationItem | undefined,
  right: TurnNavigationItem | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.turn === right.turn && left.anchorKey === right.anchorKey
    && left.prompt === right.prompt && left.response === right.response
}

/**
 * Project one loaded Turn into its rail item.
 * @param turn - Turn number the item addresses.
 * @param locations - live Location index supplying the Turn's node keys.
 * @param nodes - live Chat node store.
 * @returns the item, or undefined when the Turn has no visible loaded node.
 * @remarks 中文说明：功能说明：处理 turnNavigationItem 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：locations（ChatLocationNodeIndex）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：nodes（ChatNodeStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TurnNavigationItem | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 turnNavigationItem(turn, locations, nodes)，
 * 并按返回类型处理结果。
 */
export function turnNavigationItem(
  turn: number,
  locations: ChatLocationNodeIndex,
  nodes: ChatNodeStore,
): TurnNavigationItem | undefined {
  /**
   * 常量说明：loaded 用于处理 loaded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：node is ChatNode；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  const loaded = locations.getTurn(turn)
    .map(key => nodes.get(key))
    .filter((node): node is ChatNode => node !== undefined && node.visibility === 'visible')
  /**
   * 常量说明：user 用于处理 user 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  const user = loaded.find(node => node.kind === 'user')
  /**
   * 常量说明：anchor 用于处理 anchor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const anchor = user ?? loaded[0]
  if (anchor === undefined) return undefined
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  const response = loaded.findLast(node => responseText(node) !== '')
  return {
    turn,
    anchorKey: anchor.key,
    prompt: user === undefined ? '' : promptText(user),
    response: response === undefined ? '' : responseText(response),
  }
}
