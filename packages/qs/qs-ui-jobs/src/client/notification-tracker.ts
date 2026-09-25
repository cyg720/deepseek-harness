/** 作业通知只记已观察身份和状态；不复制任务结果，也不从历史终态生成新通知。 */
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 同一发布批次读取的控制代次、可访问范围及权威作业镜像。 */
export interface JobNotificationInput {
  readonly scope: object
  readonly baseline: number
  readonly ready: boolean
  readonly eligible: ReadonlySet<SessionId>
  readonly jobs: Readonly<Record<SessionId, readonly SessionJob[]>>
}

/** 仅供本地化展示的终态转换，原始结果仍由官方作业服务持有。 */
export interface JobNotification {
  readonly sessionId: SessionId
  readonly job: SessionJob
}

/** 有界的会话内通知去重；换 Host、退出或重连均不重放历史完成记录。 */
export class JobNotificationTracker {
  private scope: object | undefined
  private baseline: number | undefined
  private readonly seen = new Map<string, SessionJob['status']>()

  /** @param capacity - 由部署配置验证的正整数，限制保留的作业身份总数。 */
  constructor(private readonly capacity: number) {}

  /** 退出或所有者卸载时清空全部通知身份。 */
  clear(): void {
    this.scope = undefined
    this.baseline = undefined
    this.seen.clear()
  }

  /**
   * 对已打开且可访问会话的观察快照计算终态转换。
   * @param input - 一次发布批次的权威状态；非 ready 状态使下次读取重新建立静默基线。
   * @returns 新观察到的终态转换，不包含首次看到的终态或重复发布。
   */
  observe(input: JobNotificationInput): readonly JobNotification[] {
    if (!input.ready) { this.clear(); return [] }
    const seed = this.scope !== input.scope || this.baseline !== input.baseline
    if (seed) this.seen.clear()
    this.scope = input.scope
    this.baseline = input.baseline
    const present = new Set<string>(), notifications: JobNotification[] = []
    for (const sessionId of input.eligible) {
      for (const job of input.jobs[sessionId] ?? []) {
        // startedAt 区分服务重建后复用的 JobId；数组编码避免不透明身份中的分隔符碰撞。
        const key = JSON.stringify([sessionId, job.id, job.startedAt])
        present.add(key)
        const previous = this.seen.get(key)
        if (!seed && (previous === 'running' || previous === 'stopping')
          && (job.status === 'completed' || job.status === 'failed' || job.status === 'killed')) {
          notifications.push({ sessionId, job })
        }
        this.seen.delete(key)
        this.seen.set(key, job.status)
        if (this.seen.size > this.capacity) {
          for (const oldest of this.seen.keys()) { this.seen.delete(oldest); break }
        }
      }
    }
    for (const key of this.seen.keys()) if (!present.has(key)) this.seen.delete(key)
    return notifications
  }
}
