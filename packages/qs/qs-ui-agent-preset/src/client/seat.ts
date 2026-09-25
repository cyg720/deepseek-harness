/** 预设选择暂存于当前插件；只把用户选择交给仍为空白的目标会话。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsPresetRoster } from './roster.ts'
import type { QsSendPreparationEntry } from '@deepseek-ai/dsh-qs-composer/client'

/** 只读会话事实来自官方会话列表，不另建会话状态。 */
export interface QsPresetSeatSession {
  readonly id: Parameters<Context['remote']['agentPresets']['select']>[0]
  readonly blank: boolean
  readonly preset: string | undefined
}
/** 同一选择器的可见状态，错误文案由视图本地化。 */
export interface QsPresetSeatState {
  readonly current: string
  readonly busy: boolean
  readonly failed: boolean
}
/** 页面暂存选择随插件生命周期释放。 */
export interface QsPresetSeat extends HostObservable<QsPresetSeatState> {
  /** 发送准备绑定实际 RPC 目标，不随用户切换当前会话迁移。 */
  readonly preparation: HostObservable<Omit<QsSendPreparationEntry, 'reason'> | undefined>
  /**
   * 选择健康预设；无会话时暂存，有空白会话时立即提交。
   * @param id - 目录提供的预设标识。
   * @returns 本次选择处理结束。
   */
  select(id: string): Promise<void>
  /** @returns 会话列表变化后的暂存选择应用完成。 */
  update(): Promise<void>
  /** @returns 捕获当前空白会话和连接代次的同步函数；true 表示成功或目标已不适用，false 表示同步失败。 */
  captureDefaultSync(): (id: string) => Promise<boolean>
  /** 重连废弃旧请求和旧选择，不重放可能已提交的操作。 */
  reset(): void
  /** 移除订阅并阻止迟到结果发布。 */
  dispose(): void
}
/**
 * 复用官方选择接口，只在明确为空白的会话上应用组成。
 * @param roster - 插件共享目录。
 * @param remote - 官方预设选择方法。
 * @param session - 当前会话事实，每次提交前重新读取。
 * @returns 可装卸的选择状态。
 */
export function createSeat(roster: QsPresetRoster, remote: Pick<Context['remote']['agentPresets'], 'select'>, session: () => QsPresetSeatSession | undefined): QsPresetSeat {
  let disposed = false, generation = 0, staged: string | undefined
  let state: QsPresetSeatState = { current: '', busy: false, failed: false }
  let targetId: QsPresetSeatSession['id'] | undefined
  let preparation: Omit<QsSendPreparationEntry, 'reason'> | undefined
  let interruptedPreparation: typeof preparation
  const listeners = new Set<() => void>()
  const active = (epoch: number): boolean => !disposed && generation === epoch
  const publish = (next: QsPresetSeatState): void => {
    state = next
    preparation = targetId !== undefined && (next.busy || next.failed)
      ? { sessionId: targetId, pending: next.busy } : interruptedPreparation
    for (const listener of listeners) listener()
  }
  const current = (): string => {
    const target = session()
    return target === undefined ? roster.getSnapshot().roster?.presets.find(row => row.isDefault)?.id ?? '' : target.preset ?? ''
  }
  const applyChoice = async (target: QsPresetSeatSession, choice: string): Promise<boolean> => {
    const epoch = generation
    targetId = target.id
    interruptedPreparation = undefined
    staged = undefined
    publish({ current: choice, busy: true, failed: false })
    let result: Awaited<ReturnType<typeof remote.select>>
    try { result = await remote.select(target.id, choice) }
    catch {
      // 仅处理选择 RPC 的传输失败，不把远端异常原文展示给用户。
      if (active(epoch)) publish({ current: current(), busy: false, failed: session()?.id === target.id })
      return false
    }
    if (!active(epoch)) return true
    // 回执只属于捕获的目标；切换后的页面不得显示前一会话结果。
    if (session()?.id !== target.id) { publish({ current: current(), busy: false, failed: false }); return true }
    publish({ current: result.ok ? result.value : current(), busy: false, failed: !result.ok })
    return result.ok
  }
  const update = async (): Promise<void> => {
    if (disposed || state.busy) return
    const source = roster.getSnapshot(), target = session()
    if (source.status !== 'ready') { publish({ ...state, current: target?.preset ?? '' }); return }
    if (!source.roster?.modeSelectionEnabled) staged = undefined
    if (staged !== undefined && !source.roster?.presets.some(row => row.id === staged && row.broken === undefined)) staged = undefined
    if (staged === undefined) { publish({ ...state, current: current() }); return }
    if (target === undefined) { publish({ ...state, current: staged }); return }
    if (!target.blank || target.preset === staged) { staged = undefined; publish({ ...state, current: current() }); return }
    await applyChoice(target, staged)
  }
  const off = roster.subscribe(() => { void update() })
  return {
    preparation: {
      getSnapshot: () => preparation,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    select: async (id) => {
      const source = roster.getSnapshot()
      if (disposed || state.busy || source.status !== 'ready' || !source.roster?.modeSelectionEnabled
        || !source.roster.presets.some(row => row.id === id && row.broken === undefined) || session()?.blank === false) return
      staged = id; publish({ current: id, busy: false, failed: false }); await update()
    },
    update,
    captureDefaultSync: () => {
      const captured = session(), epoch = generation
      return async (id) => {
        const target = session()
        if (!active(epoch) || captured?.blank !== true || target?.blank !== true || target.id !== captured.id) return true
        if (target.preset === id) return true
        const source = roster.getSnapshot()
        if (state.busy || source.status !== 'ready' || !source.roster?.presets.some(row => row.id === id && row.broken === undefined)) return false
        // 保存后同步采用 Host 生效默认值，即使选择器关闭也不能继续使用旧空白组成。
        return applyChoice(target, id)
      }
    },
    reset: () => {
      if (disposed) return
      generation++; staged = undefined
      // 重连或选择器卸载不是 RPC 成功，保留目标会话的失败状态以取消自动发送交接。
      interruptedPreparation = preparation === undefined ? undefined : { ...preparation, pending: false }
      publish({ current: current(), busy: false, failed: false })
    },
    dispose: () => { disposed = true; generation++; staged = undefined; off(); listeners.clear() },
  }
}
