/**
 * Agent-scoped durable one-shot and fixed-rate reminders over the session event log.
 * @module @deepseek-ai/dsh-schedule
 */
/*
 * 文件职责：实现 index.ts 承担的计划调度配置、协议与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验、事件日志与异步资源管理。
 * 产品维度：为 Agent 提供可靠的计划调度能力。
 * 逻辑维度：解析输入，注册能力，执行核心操作，并在结束时释放所拥有的资源。
 * 关键边界：权限和配置失败必须显式；模型可见状态必须记录；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型和常量，再读主流程，最后关注平台限制、恢复和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { ScheduleRuntime } from './runtime.ts'
import { registerScheduleTools } from './tools.ts'

export type * from './types.ts'
export {
  SCHEDULE_CHANGE_VERSION,
  MIN_EVERY_INTERVAL_SECONDS,
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  allocateScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  decodeScheduleChange,
  foldScheduleEvents,
  renderReminderFraming,
  renderEveryReminderBatchFraming,
  resolveEveryOccurrence,
  scheduleView,
} from './domain.ts'
export { registerScheduleTools } from './tools.ts'

/** Cordis function-plugin name. */
/* 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'schedule'
/** Services required before future root agents can receive Schedule. */
/* 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence']

/** 中文说明：type OwnerCleanup 定义本模块所需的数据或行为，用于表达计划调度场景。 */
type OwnerCleanup = () => void | Promise<void>

/** Install Schedule only for root agents published after this plugin loads. */
/* 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context): void {
  /** 中文说明：变量 runtimes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runtimes = new Map<Agent, OwnerCleanup>()
  /** 中文说明：变量 stopping 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let stopping = false

  ctx.effect(() => {
    /** 中文说明：函数值 stopCreated 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (stopping || runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return
      /** 中文说明：变量 runtime 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const runtime = new ScheduleRuntime(ctx, agent)
      /** 中文说明：函数值 cleanup 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const cleanup: OwnerCleanup = agent.ctx.effect(() => {
        /** 中文说明：函数值 disposeTools 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
        const disposeTools = registerScheduleTools(ctx, agent.ctx, agent, () => { runtime.requestDrive() })
        /** 中文说明：函数值 stopStatus 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
        const stopStatus = agent.ctx.on('agent/status', ({ status }) => {
          if (status === 'idle' && agent.session.events.some(event => event.type === 'schedule/change')) {
            runtime.requestDrive()
          }
        })
        runtime.start()
        return async () => {
          stopStatus()
          disposeTools()
          try {
            await runtime.dispose()
          } finally {
            if (runtimes.get(agent) === cleanup) runtimes.delete(agent)
          }
        }
      }, 'schedule.runtime()')
      runtimes.set(agent, cleanup)
    })

    return async () => {
      stopping = true
      stopCreated()
      /** 中文说明：变量 cleanups 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cleanups = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
    }
  }, 'schedule.lifecycle()')
}
