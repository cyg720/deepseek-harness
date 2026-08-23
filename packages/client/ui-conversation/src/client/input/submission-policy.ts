/**
 * ================================ 文件注释 ================================
 * 【文件职责】输入框提交策略：持有"繁忙时 Enter 行为"的响应式偏好，并把键盘手势解析为
 *             queue / steer 投递模式；真正的投递窗口权威在宿主与智能体侧。
 * 【技术维度】SnapshotStore + 可选 SettingsScope 持久化（订阅采纳宿主值，写入不回环）；
 *             解析为纯函数（不改状态）。
 * 【产品维度】设置页与输入栏共用同一策略：繁忙时 Enter 排队还是插话、Cmd+Enter 相反。
 * 【逻辑维度】1) busyEnter 偏好 store；2) resolve 手势→模式；3) setBusyEnter 写偏好并持久化；
 *             4) adopt 采纳宿主持久化值。
 * 【关键边界】steer 是尽力而为：窗口已关的提交会由 AgentLoop 变成下一个醒来的队列项。
 * 【新手阅读建议】先看 resolve 的两个分支（非繁忙恒 queue，繁忙时按偏好与手势取反）。
 * ==========================================================================
 */
/**
 * Composer submission policy. It owns the live busy-Enter
 * preference and resolves keyboard gestures into queue/steer delivery modes;
 * Host and Agent keep the actual delivery-window authority.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'
import { BUSY_ENTER_FIELD, DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'

export { DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'

/**
 * Busy-Enter policy used by both the composer inject face and its Settings row.
 * Direct `steer` is intentionally best-effort: AgentLoop turns a closed-window
 * submission into the next waking Queue item.
 */
/**
 * 输入框注入面与设置行共用的"繁忙时 Enter"策略。直接 steer 刻意是尽力而为：
 * AgentLoop 会把窗口已关的提交变成下一个醒来的队列项。
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Resolve one keyboard gesture without changing state.
   * @param running - whether the addressed agent currently reports busy.
   * @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
   * @param steeringAvailable - whether this session transport supports steering.
   * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
   */
  resolve(
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
  ): InputSubmitMode {
    if (!running || !steeringAvailable) return 'queue'
    const preferred = this.busyEnter.getSnapshot()
    if (gesture === 'enter') return preferred
    return preferred === 'queue' ? 'steer' : 'queue'
  }

  /**
   * Change the plain-Enter behavior used during busy state; the live value
   * publishes before the durable write starts.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Adopt the scope's accepted durable behavior without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.busyEnter.getSnapshot() === section.busyEnter) return
    this.busyEnter.set(section.busyEnter)
  }
}
