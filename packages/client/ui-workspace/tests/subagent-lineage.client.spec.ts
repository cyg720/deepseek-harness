/**
 * 文件职责：验证 client/ui-workspace 中 subagent lineage client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { indexSubagentDescendants } from '../src/client/subagent-lineage.ts'

/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(id)，并按返回类型处理结果。
 */
const sid = (id: string): SessionId => id as SessionId

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('UI Workspace descendant projection', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('counts nested running descendants and stops at ordinary forks', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = { id: sid('root'), running: false }
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = { id: sid('child'), parentId: root.id, origin: 'subagent' as const, running: true }
    /**
     * 常量说明：leaf 用于处理 leaf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const leaf = { id: sid('leaf'), parentId: child.id, origin: 'subagent' as const, running: false }
    /**
     * 常量说明：fork 用于处理 fork 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fork = { id: sid('fork'), parentId: child.id, running: false }
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const result = indexSubagentDescendants(Object.fromEntries(
      [root, child, leaf, fork].map(item => [item.id, item]),
    ))
    expect(result.get(root.id)).toEqual({ count: 2, runningCount: 1 })
    expect(result.get(child.id)).toEqual({ count: 1, runningCount: 0 })
    expect(result.has(fork.id)).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('terminates cycles and retains missing-parent aggregates', () => {
    /**
     * 常量说明：a 用于处理 a 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const a = { id: sid('a'), parentId: sid('b'), origin: 'subagent' as const, running: false }
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = { id: sid('b'), parentId: sid('a'), origin: 'subagent' as const, running: false }
    /**
     * 常量说明：orphan 用于处理 orphan 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const orphan = { id: sid('orphan'), parentId: sid('missing'), origin: 'subagent' as const, running: true }
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = indexSubagentDescendants({ [a.id]: a, [b.id]: b, [orphan.id]: orphan })
    expect(result.get(a.id)?.count).toBe(2)
    expect(result.get(b.id)?.count).toBe(2)
    expect(result.get(sid('missing'))).toEqual({ count: 1, runningCount: 1 })
  })
})
