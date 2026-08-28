/** Question-composer Session store behavior.
 * @remarks 文件说明：文件职责：验证 client/ui-user-questions 中 question draft store
 * client spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { describe, expect, it } from 'vitest'
import { createQuestionDraftStore, type QuestionDraftProgress } from '../src/client/draft-store.ts'

/**
 * 常量说明：FIRST 用于处理 FIRST 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const FIRST: QuestionDraftProgress = {
  index: 1,
  drafts: [{ selected: ['Fast'], custom: '', skipped: false }],
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('createQuestionDraftStore', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps one request progress and ignores cleanup from an obsolete request', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = createQuestionDraftStore().create('session-one')

    store.actions.replace('question:one', FIRST)
    expect(store.getSnapshot()).toEqual({ requestKey: 'question:one', progress: FIRST })

    store.actions.clear('question:older')
    expect(store.getSnapshot()).toEqual({ requestKey: 'question:one', progress: FIRST })

    store.actions.clear('question:one')
    expect(store.getSnapshot()).toEqual({ progress: { index: 0, drafts: [] } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('replaces the previous request atomically instead of accumulating drafts', () => {
    /**
     * 常量说明：store 用于处理 store 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const store = createQuestionDraftStore().create('session-one')
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second: QuestionDraftProgress = {
      index: 0,
      drafts: [{ selected: [], custom: 'Careful', skipped: false }],
    }

    store.actions.replace('question:one', FIRST)
    store.actions.replace('question:two', second)

    expect(store.getSnapshot()).toEqual({ requestKey: 'question:two', progress: second })
  })
})
