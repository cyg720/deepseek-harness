/** 发送准备状态由独立功能插件贡献，输入区只等待或呈现失败，不拥有其业务操作。 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** 准备状态绑定精确会话；reason 由贡献插件词典生成。 */
export interface QsSendPreparationEntry {
  readonly sessionId: SessionId
  readonly pending: boolean
  readonly reason: string
}
declare module '@deepseek-ai/cordis' { interface Context { qsSendPreparation: QsSendPreparation } }
/** 奇术输入呈现共享准备源，不替代官方输入机或权限判断。 */
export class QsSendPreparation extends Service {
  private readonly sources = new Map<string, { source: HostObservable<QsSendPreparationEntry | undefined>; off: () => void }>()
  private readonly interrupted = new Map<string, QsSendPreparationEntry>()
  private readonly listeners = new Set<() => void>()
  /** @param ctx - 拥有准备注册表的会话呈现上下文。 */
  constructor(ctx: Context) {
    super(ctx, 'qsSendPreparation')
    ctx.effect(() => () => {
      for (const entry of this.sources.values()) entry.off()
      this.sources.clear(); this.interrupted.clear(); this.notify(); this.listeners.clear()
    }, 'qs composer: preparation lifetime')
  }
  private notify(): void { for (const listener of this.listeners) listener() }
  /**
   * 贡献可观察准备状态；带未完成状态卸载时保留失败提示，直到新实例明确重试或整个服务释放。
   * @param id - 同一插件实例的唯一贡献名。
   * @param source - 稳定快照源。
   * @param interruptedReason - 贡献者卸载后的本地化恢复指引。
   * @returns 幂等释放函数。
   */
  register(id: string, source: HostObservable<QsSendPreparationEntry | undefined>, interruptedReason: string): () => void {
    if (this.sources.has(id)) throw new Error(`Duplicate QS send preparation: ${id}`)
    const update = (): void => {
      // 空闲重装不是重试成功；只有新贡献实际接管准备操作时才替代中断状态。
      if (source.getSnapshot() !== undefined) this.interrupted.delete(id)
      this.notify()
    }
    const entry = { source, off: source.subscribe(update) }
    if (source.getSnapshot() !== undefined) this.interrupted.delete(id)
    this.sources.set(id, entry); this.notify()
    return () => {
      if (this.sources.get(id) !== entry) return
      const value = source.getSnapshot()
      if (value !== undefined) this.interrupted.set(id, { ...value, pending: false, reason: interruptedReason })
      entry.off(); this.sources.delete(id); this.notify()
    }
  }
  /**
   * 读取某个会话的准备状态，其他会话的在途操作不会阻止它发送。
   * @param sessionId - 当前严格会话标识，无会话时不阻塞创建。
   * @returns 供输入控件订阅的只读面。
   */
  forSession(sessionId: SessionId | undefined): HostObservable<QsSendPreparationEntry | undefined> {
    return {
      getSnapshot: () => {
        if (sessionId === undefined) return undefined
        for (const { source } of this.sources.values()) {
          const value = source.getSnapshot()
          if (value?.sessionId === sessionId) return value
        }
        for (const value of this.interrupted.values()) if (value.sessionId === sessionId) return value
        return undefined
      },
      subscribe: (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
    }
  }
}
