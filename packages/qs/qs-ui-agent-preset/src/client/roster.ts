/** 预设三个呈现面共用同一目录读取，不将当前会话组成与新会话默认值混合。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** 目录状态保留损坏条目供管理页修复，但不暴露远端异常原文。 */
export interface QsPresetRosterState {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  readonly roster: AgentPresetRoster | undefined
  readonly canOpenDirectory: boolean
}
/** 一个插件实例持有的预设目录与释放入口。 */
export interface QsPresetRoster extends HostObservable<QsPresetRosterState> {
  /** @returns 本次读取结束；只有最新读取可发布结果。 */
  readonly refresh: () => Promise<void>
  /** 清除旧连接目录并让其在途回执失效。 */
  reset(): void
  /** 移除订阅者，使释放后的读取不能更新界面。 */
  dispose(): void
}
/**
 * 读取真实预设目录及独立的本机打开能力；能力查询失败不隐藏目录。
 * @param presets - 官方 agentPresets Remote 的目录方法。
 * @param settings - 官方设置 Remote 的目录打开能力。
 * @returns 由预设插件生命周期持有的可观察目录。
 */
export function createRoster(presets: Pick<Context['remote']['agentPresets'], 'list'>, settings: Pick<Context['remote']['settings'], 'canOpenAgentPresetDirectory'>): QsPresetRoster {
  let generation = 0, disposed = false
  let state: QsPresetRosterState = { status: 'idle', roster: undefined, canOpenDirectory: false }
  const listeners = new Set<() => void>()
  const current = (value: number): boolean => !disposed && generation === value
  const publish = (next: QsPresetRosterState): void => { state = next; for (const listener of listeners) listener() }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh: async () => {
      if (disposed) return
      const request = ++generation
      publish({ status: 'loading', roster: state.roster, canOpenDirectory: false })
      // 两项独立网络读取同时开始，allSettled 接住各自传输失败，避免能力失败吞掉有效目录。
      const [directory, opener] = await Promise.allSettled([presets.list(), settings.canOpenAgentPresetDirectory()])
      if (!current(request)) return
      const canOpenDirectory = opener.status === 'fulfilled' && opener.value.ok && opener.value.value
      if (directory.status === 'rejected') { publish({ status: 'error', roster: undefined, canOpenDirectory: false }); return }
      const response = directory.value
      if (!response.ok) {
        publish({ status: response.error.code === 'gateway/invocation-unavailable' ? 'unavailable' : 'error', roster: undefined, canOpenDirectory: false })
        return
      }
      publish({ status: response.value.presets.length === 0 ? 'unavailable' : 'ready', roster: response.value, canOpenDirectory })
    },
    reset: () => { if (!disposed) { generation++; publish({ status: 'idle', roster: undefined, canOpenDirectory: false }) } },
    dispose: () => { disposed = true; generation++; listeners.clear() },
  }
}
