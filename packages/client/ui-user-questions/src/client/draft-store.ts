/**
 * Session-scoped draft state for the generic question composer. The Slot
 * registry owns store instances; this module exports only the factory so a
 * plugin reload cannot reuse a module-global handle.
 * @remarks 文件说明：文件职责：实现 client/ui-user-questions 中 draft store 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-user-questions 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** One in-progress answer, including an explicit skip. */
export interface QuestionDraftAnswer {
  /** Offered labels currently selected. */
  selected: string[]
  /** Human-authored alternative or additional answer. */
  custom: string
  /** Whether the user explicitly skipped this question. */
  skipped: boolean
}

/** Navigation and answer drafts for one pending request. */
export interface QuestionDraftProgress {
  /** Current question index. */
  index: number
  /** One draft per question, in request order. */
  drafts: QuestionDraftAnswer[]
}

interface QuestionDraftState {
  requestKey?: string
  progress: QuestionDraftProgress
}

type QuestionDraftActions = {
  replace: (draft: QuestionDraftState, requestKey: string, progress: QuestionDraftProgress) => void
  clear: (draft: QuestionDraftState, requestKey: string) => void
}

/**
 * 常量说明：emptyProgress 用于处理 emptyProgress 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 emptyProgress 相关流程；使用场景由所在模块及调用位置决定。
 * @returns QuestionDraftProgress；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 emptyProgress()，并按返回类型处理结果。
 */
const emptyProgress = (): QuestionDraftProgress => ({ index: 0, drafts: [] })

/**
 * Declare the question composer's transient Session store.
 * @returns a non-persisted store handle whose instance is owned by the Slot registry.
 * @remarks 中文说明：功能说明：创建 Question Draft Store 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：EngineStoreHandle<QuestionDraftState, QuestionDraftActions>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createQuestionDraftStore()，并按返回类型处理结果。
 */
export function createQuestionDraftStore(): EngineStoreHandle<QuestionDraftState, QuestionDraftActions> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：QuestionDraftState；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：requestKey（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：progress（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft, requestKey,
   * progress)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：requestKey（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft, requestKey)，
   * 并按返回类型处理结果。
   */
  return defineStore({
    init: (): QuestionDraftState => ({ progress: emptyProgress() }),
    actions: {
      replace: (draft, requestKey, progress) => {
        draft.requestKey = requestKey
        draft.progress = progress
      },
      clear: (draft, requestKey) => {
        if (draft.requestKey !== requestKey) return
        delete draft.requestKey
        draft.progress = emptyProgress()
      },
    },
  })
}
