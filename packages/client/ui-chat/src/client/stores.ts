/** Per-Session Chat selection store shared by the transcript and details panel.
 * @remarks 文件说明：文件职责：实现 client/ui-chat 中 stores 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TurnProcessGeneration } from './contract/turn-process.ts'
import type { ChatStoreState, SelectionTarget, TurnProcessViewEntry } from './contract/store.ts'

type ChatActions = {
  select: (draft: ChatStoreState, target: SelectionTarget | null) => void
  setTurnProcessOpen: (
    draft: ChatStoreState,
    turn: number,
    generation: TurnProcessGeneration,
    open: boolean,
  ) => void
}

/**
 * Resolve any stored generation for one Turn.
 * @param state - Chat store snapshot.
 * @param turn - owning Turn.
 * @returns the Turn's stored entry, when present.
 * @remarks 中文说明：功能说明：处理 storedTurnProcessEntry 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：state（Readonly<ChatStoreState>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Readonly<TurnProcessViewEntry> | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 storedTurnProcessEntry(state, turn)，并按返回类型处理结果。
 */
export function storedTurnProcessEntry(
  state: Readonly<ChatStoreState>,
  turn: number,
): Readonly<TurnProcessViewEntry> | undefined {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  return state.turnProcesses.find(entry => entry.turn === turn)
}

/**
 * Create the Chat selection store handle.
 * @returns a handle instantiated once per rendered Session scope.
 * @remarks 中文说明：功能说明：创建 Chat Store 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：EngineStoreHandle<ChatStoreState, ChatActions>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createChatStore()，并按返回类型处理结果。
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：ChatStoreState；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：target（SelectionTarget |
   * null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft, target)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：draft（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：turn（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：generation（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：open（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(draft, turn, generation,
   * open)，并按返回类型处理结果。
   */
  return defineStore({
    init: (): ChatStoreState => ({ selection: null, turnProcesses: [] }),
    actions: {
      select: (draft, target: SelectionTarget | null) => { draft.selection = target },
      setTurnProcessOpen: (draft, turn, generation, open) => {
        /**
         * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
         */
        const index = draft.turnProcesses.findIndex(entry => entry.turn === turn)
        if (!open) {
          if (index >= 0) draft.turnProcesses.splice(index, 1)
          return
        }
        /**
         * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const next = { turn, generation } satisfies TurnProcessViewEntry
        if (index < 0) draft.turnProcesses.push(next)
        else draft.turnProcesses[index] = next
      },
    },
  })
}
