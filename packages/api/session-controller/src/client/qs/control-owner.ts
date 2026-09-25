/** 会话控制流的唯一所有者：失败重试串行替换实例，视图只读状态。 */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionControlFrame } from '../../types.ts'
import { createSessionControlStream, type SessionControlStream } from '../transport.ts'
import type { SessionRemotes } from '../sessions/remotes.ts'

/** 控制流状态不包含远端错误正文，避免界面泄露诊断数据。 */
export interface SessionControlSnapshot {
  readonly phase: 'loading' | 'ready' | 'reconnecting' | 'failed' | 'disposed'
  /** 每次收到完整基线递增；与会话目录的 phase 无关。 */
  readonly baseline: number
}

/** Jobs 等消费者只读状态，并请求所有者重试终止失败。 */
export interface SessionControlStatus {
  readonly state: ObservableSnapshot<SessionControlSnapshot>
  /**
   * 处置失败实例后启动一个替代实例；并发调用合并。
   * @returns 替代实例已启动，不表示其基线已经到达。
   */
  retry(): Promise<void>
}

/** 官方控制流的生命周期封装，不创建额外订阅或复制领域数据。 */
export class SessionControlOwner implements SessionControlStatus {
  private readonly store = createSnapshotStore<SessionControlSnapshot>({ phase: 'loading', baseline: 0 })
  readonly state: ObservableSnapshot<SessionControlSnapshot> = this.store
  private active: SessionControlStream | undefined
  private retrying: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private disposed = false

  /**
   * @param remote - 官方 Remote 及流工厂。
   * @param accept - 唯一领域状态接收器。
   */
  constructor(private readonly remote: SessionRemotes, private readonly accept: (frame: SessionControlFrame) => void) {}

  /** 启动唯一流；卸载后或已启动时不重复创建。 */
  start(): void {
    if (this.disposed || this.active !== undefined || this.retrying !== undefined) return
    this.install()
  }

  private install(): void {
    const stream = createSessionControlStream(this.remote, {
      accept: (frame) => {
        if (this.disposed || this.active !== stream) return
        this.accept(frame)
        if (frame.type === 'baseline') {
          this.store.set({ phase: 'ready', baseline: this.store.getSnapshot().baseline + 1 })
        }
      },
      carrierFailed: () => {
        if (!this.disposed && this.active === stream) this.publish('reconnecting')
      },
      failed: (error) => {
        if (this.disposed || this.active !== stream) return
        this.publish('failed')
        console.error('[session-controller] control stream failed:', error)
      },
    })
    this.active = stream
    stream.start()
  }

  /**
   * 仅终止失败可重试；载体中断由官方流自动重连。
   * @returns 旧流静默并启动替代流后的完成信号。
   */
  retry(): Promise<void> {
    if (this.retrying !== undefined) return this.retrying
    const previous = this.active
    if (this.disposed || previous === undefined || this.store.getSnapshot().phase !== 'failed') return Promise.resolve()
    // 先撤销旧回调资格；dispose 等待期间不允许迟到基线覆盖新状态。
    this.active = undefined
    this.publish('loading')
    const operation = previous.dispose().then(() => {
      if (!this.disposed) this.install()
    }, (error: unknown) => {
      if (!this.disposed) {
        this.active = previous
        this.publish('failed')
      }
      throw error
    }).finally(() => { this.retrying = undefined })
    this.retrying = operation
    return operation
  }

  /**
   * 永久关闭；等待进行中的替换和现存流，不允许卸载后重启。
   * @returns 所有消费循环均静默。
   */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.disposed = true
    this.publish('disposed')
    const previous = this.active
    this.active = undefined
    this.closing = Promise.all([previous?.dispose(), this.retrying]).then(() => {})
    return this.closing
  }

  private publish(phase: SessionControlSnapshot['phase']): void {
    this.store.set({ ...this.store.getSnapshot(), phase })
  }
}
