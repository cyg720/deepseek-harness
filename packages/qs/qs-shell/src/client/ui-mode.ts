/**
 * 开发者界面切换控制器。
 *
 * 控制器生命周期独立于奇术 root 的视图注册：切到官方界面时只释放奇术 root 与
 * 其子槽注册，控制器状态、官方插件加载与官方请求持有者都保持不变；返回时重新注册
 * 奇术视图，`qs.*` 贡献经 `slots.inject` 随声明恢复（不重复安装）。
 *
 * 运行期所选界面只存在于当前页面的内存快照里；刷新按启动配置 defaultUi 重新初始化，
 * 不读取 localStorage 或 URL 覆盖启动配置。配置关闭时动作本身被拒绝，而不只是隐藏按钮。
 */
import type { IQsUiMode, QsUiId, QsUiModeSnapshot } from './contract.ts'

/** 切换控制器实现：一份内存快照 + 订阅者集合。 */
export class QsUiModeController implements IQsUiMode {
  private snapshot: QsUiModeSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly onSwitch: (target: QsUiId) => void

  /**
   * @param initial - 启动配置决定的初始界面与入口开关。
   * @param onSwitch - 界面真正切换后由宿主执行注册/释放的回调。
   */
  constructor(
    initial: { defaultUi: QsUiId; showOfficialUiEntry: boolean },
    onSwitch: (target: QsUiId) => void,
  ) {
    this.snapshot = {
      ui: initial.defaultUi,
      showOfficialUiEntry: initial.showOfficialUiEntry,
    }
    this.onSwitch = onSwitch
  }

  getSnapshot(): QsUiModeSnapshot {
    return this.snapshot
  }

  /**
   * @param listener - 模式变化时的通知。
   * @returns 取消订阅动作。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  switchTo(target: QsUiId): void {
    if (!this.snapshot.showOfficialUiEntry) {
      this.publish('switch.disabled', undefined)
      return
    }
    if (this.snapshot.freeze !== undefined) {
      this.publish('switch.frozen', undefined)
      return
    }
    if (target === this.snapshot.ui) return
    try {
      this.onSwitch(target)
    } catch (error) {
      console.error('qs-shell: interface switch failed', error)
      this.publish('switch.failed', undefined)
      return
    }
    // 切换成功：清空错误，界面更新（冻结字段保持不变）。
    this.publish(null, target)
  }

  setLocalFreeze(reason: string | undefined): void {
    if (reason === this.snapshot.freeze) return
    this.publish(this.snapshot.error, this.snapshot.ui, { freeze: reason })
  }

  /**
   * 发布新快照。
   *
   * 可缺省字段显式重建对象：`exactOptionalPropertyTypes` 下不能把 `undefined`
   * 直接塞进可选属性，而"清除错误 / 解除冻结"正是这里的常见操作。
   * 因此 `error` 与 `freeze` 分别用 `null` 表示"清除"，`undefined` 表示"保持不变"。
   * @param error - 新的错误键；null 表示清除，undefined 表示不变。
   * @param ui - 新的当前界面；undefined 表示不变。
   * @param change - 冻结字段的变更；缺省表示不变，`{ freeze: undefined }` 表示解除。
   */
  private publish(
    error: string | null | undefined,
    ui: QsUiId | undefined,
    change?: { readonly freeze: string | undefined },
  ): void {
    const next: {
      ui: QsUiId
      showOfficialUiEntry: boolean
      freeze?: string
      error?: string
    } = {
      ui: ui ?? this.snapshot.ui,
      showOfficialUiEntry: this.snapshot.showOfficialUiEntry,
    }
    const freeze = change === undefined ? this.snapshot.freeze : change.freeze
    if (freeze !== undefined) next.freeze = freeze
    const nextError = error === undefined ? this.snapshot.error : error
    if (nextError !== null && nextError !== undefined) next.error = nextError
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
