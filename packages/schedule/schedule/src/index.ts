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
// Type-only: resolves ctx.sessionProjections for the optional projection child.
import type {} from '@deepseek-ai/dsh-session-projection'
import { scheduleProjectionDefinition } from './projection.ts'
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
export const name = 'schedule'
/** Services required before future root agents can receive Schedule. */
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence']

type OwnerCleanup = () => void | Promise<void>

/** Install Schedule only for root agents published after this plugin loads. */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(scheduleProjectionDefinition)
  })

  const runtimes = new Map<Agent, OwnerCleanup>()
  let stopping = false

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (stopping || runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return
      const runtime = new ScheduleRuntime(ctx, agent)
      const cleanup: OwnerCleanup = agent.ctx.effect(() => {
        const disposeTools = registerScheduleTools(ctx, agent.ctx, agent, () => { runtime.requestDrive() })
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
      const cleanups = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
    }
  }, 'schedule.lifecycle()')
}
