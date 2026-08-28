/**
 * 文件职责：实现 client/ui-chat 中 searchable hidden 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Apply searchable hidden state without unmounting a stable subtree.
 * @param hidden - whether the subtree is currently hidden.
 * @param reveal - callback for browser find's `beforematch` reveal.
 * @returns ref for the stable subtree root.
 * @remarks 中文说明：功能说明：组合使用 Searchable Hidden 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：hidden（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：reveal（() =>
 * void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RefObject<HTMLDivElement>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * useSearchableHidden(hidden, reveal)，并按返回类型处理结果。
 */
export function useSearchableHidden(
  hidden: boolean,
  reveal: () => void,
): RefObject<HTMLDivElement> {
  /**
   * 常量说明：ref 用于处理 ref 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ref = useRef<HTMLDivElement>(null)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  useLayoutEffect(() => {
    /**
     * 常量说明：element 用于处理 element 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const element = ref.current
    if (element === null) return
    if (hidden && element.contains(element.ownerDocument.activeElement)) {
      reveal()
      return
    }
    if (hidden) element.setAttribute('hidden', 'until-found')
    else element.removeAttribute('hidden')
  }, [hidden, reveal])
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  useEffect(() => {
    /**
     * 常量说明：element 用于处理 element 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const element = ref.current
    if (element === null) return
    element.addEventListener('beforematch', reveal)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { element.removeEventListener('beforematch', reveal) }
  }, [reveal])
  return ref
}
