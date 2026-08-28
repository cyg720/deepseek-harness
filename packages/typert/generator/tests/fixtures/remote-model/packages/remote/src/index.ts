/**
 * 文件职责：验证 typert/generator 中 index 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { TypertRemoteService, Remote, RemoteScope } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@fixture/domain'
import type {
  CreateGoalRequest,
  CreateGoalResult,
  RenameGoalRequest,
  RenameGoalResult,
} from './types.ts'

/** Remote-only business Service with no Cordis declaration merge.
 * @remarks 中文说明：类说明：GoalService 用于集中封装 处理 GoalService 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 typert/generator
 * 在对应插件或业务生命周期内创建和调用。 */
export class GoalService extends TypertRemoteService {
  /**
   * 功能说明：处理 GoalService 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new GoalService() 创建实例，并在所属生命周期内使用。
   */
  constructor() {
    super(undefined, 'goals')
  }

  /**
   * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
   * @param agent （Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param request （CreateGoalRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<CreateGoalResult>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 create(agent, request, signal)，并按返回类型处理结果。
   */
  @Remote
  async create(agent: Agent, request: CreateGoalRequest, signal: AbortSignal): Promise<CreateGoalResult> {
    signal.throwIfAborted()
    return { ref: `${agent.id}:${request.title}` }
  }

  /**
   * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （RenameGoalRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns RenameGoalResult；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rename(request)，并按返回类型处理结果。
   */
  @RemoteScope('agent')
  rename(request: RenameGoalRequest): RenameGoalResult {
    return { renamed: request.title.length > 0 }
  }

  /**
   * 功能说明：处理 watch 相关流程；使用场景由所在模块及调用位置决定。
   * @param agent （Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<CreateGoalResult>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 watch(agent, signal)，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  async *watch(agent: Agent, signal: AbortSignal): AsyncIterable<CreateGoalResult> {
    signal.throwIfAborted()
    yield { ref: agent.id }
  }
}

export type {
  CreateGoalRequest,
  CreateGoalResult,
  RenameGoalRequest,
  RenameGoalResult,
} from './types.ts'
