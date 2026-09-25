/** 通知消费现有控制流与列表，不创建第二条 RPC，也不持久化已读状态。 */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IQsAuth, IQsToast, IQsUiMode } from '@deepseek-ai/dsh-qs-shell/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { JobNotificationTracker, type JobNotification } from './notification-tracker.ts'

/** 所有输入归属于同一插件作用域，卸载时共同取消订阅。 */
export interface JobNotificationServices {
  readonly sessions: Pick<ISessions, 'list' | 'control'>
  readonly connection: Pick<ConnectionHandle, 'generation'>
  readonly auth: IQsAuth
  readonly ui: IQsUiMode
  readonly toast: IQsToast
  /**
   * 在显示时按当前语言生成文案。
   * @param notification - 已观察的终态转换。
   * @returns 本地化纯文本。
   */
  readonly format: (notification: JobNotification) => string
}

/**
 * 订阅可访问的已打开会话，并在领域列表发布后统一处理当前批次。
 * @param services - 同一 Host 实例的服务及部署容量。
 * @returns 取消订阅、清理身份并使已排队微任务失效的动作。
 */
export function watchJobNotifications(services: JobNotificationServices): () => void {
  const { sessions, connection, auth, ui, toast } = services
  const tracker = new JobNotificationTracker(toast.notificationCapacity)
  const opened = new Set<SessionId>()
  let active = true, queued = false
  let generation = connection.generation.getSnapshot()
  const flush = (): void => {
    queued = false
    if (!active) return
    const nextGeneration = connection.generation.getSnapshot()
    if (nextGeneration !== generation) { tracker.clear(); toast.clear(); generation = nextGeneration }
    if (!auth.getSnapshot().authenticated) { tracker.clear(); opened.clear(); toast.clear(); return }
    const list = sessions.list.getSnapshot()
    for (const id of opened) if (list.phase !== 'pending' && list.byId[id] === undefined) opened.delete(id)
    if (list.current !== undefined && list.byId[list.current] !== undefined) {
      opened.delete(list.current)
      opened.add(list.current)
      if (opened.size > toast.notificationCapacity) {
        for (const oldest of opened) { opened.delete(oldest); break }
      }
    }
    const control = sessions.control.state.getSnapshot()
    const workbench = ui.getSnapshot().ui === 'workbench'
    if (!workbench) toast.clear()
    const ready = generation !== undefined && control.phase === 'ready' && list.phase !== 'pending' && workbench
    const notifications = tracker.observe({
      scope: connection, ready, baseline: control.baseline, eligible: opened, jobs: list.jobsBySession,
    })
    for (const notification of notifications) toast.show(services.format(notification))
  }
  const schedule = (): void => {
    if (!active || queued) return
    queued = true
    // 控制基线已同步投影；其余列表更新与控制通知在同批次合并读取。
    queueMicrotask(flush)
  }
  const resetOnLogout = (): void => {
    // 同一任务内退出再登录也必须清空，不能只读取批处理后的最终登录值。
    if (!auth.getSnapshot().authenticated) { tracker.clear(); opened.clear(); toast.clear() }
    schedule()
  }
  const disposers = [
    sessions.list.subscribe(schedule), sessions.control.state.subscribe(schedule),
    connection.generation.subscribe(schedule), auth.subscribe(resetOnLogout), ui.subscribe(schedule),
  ]
  schedule()
  return () => {
    active = false
    for (const dispose of disposers) dispose()
    tracker.clear(); opened.clear(); toast.clear()
  }
}
