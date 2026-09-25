/** 预设策略写入使用官方设置版本；连接重置后旧回执不得更新共享镜像。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'

/** 每次仅修改一个策略字段，避免覆盖另一项并发设置。 */
export type QsPresetPolicyChange = { field: 'default'; value: string } | { field: 'modeSelectionEnabled'; value: boolean }
/** 未发出请求与 Host 拒绝分别返回；失效回执不表示服务器撤销了写入。 */
export type QsPresetPolicyResult = 'written' | 'conflict' | 'refused' | 'inactive' | 'busy' | 'syncFailed'
/** 设置页面持有的写入生命周期，不持有另一份设置文档。 */
export interface QsPresetPolicy {
  /**
   * 保存一个已呈现的设置字段。
   * @param change - 官方预设命名空间字段。
   * @param revision - 用户开始操作时的文档版本。
   * @returns 当前操作结果；重连后的回执返回 inactive。
   */
  save(change: QsPresetPolicyChange, revision: number): Promise<QsPresetPolicyResult>
  /** 废弃旧连接写入的呈现权；不会撤销已经发送到 Host 的请求。 */
  reset(): void
  /** 释放后禁止新写入，忽略所有在途回执。 */
  dispose(): void
}
/**
 * 使用官方共享镜像核对写权限和版本，再提交单字段 CAS 更新。
 * @param mirror - 官方设置描述镜像。
 * @param remote - 官方设置写入能力。
 * @returns 由预设插件释放的策略写入器。
 */
export function createPolicy(mirror: SettingsDescribeFace, remote: Pick<Context['remote']['settings'], 'mutate'>): QsPresetPolicy {
  let disposed = false, owner = { busy: false }
  const active = (): boolean => !disposed
  return {
    save: async (change, revision) => {
      if (!active()) return 'inactive'
      if (owner.busy) return 'busy'
      const source = mirror.getSnapshot()
      if (source.status !== 'ready' || source.error !== null || source.view?.writable !== true) return 'refused'
      const view = source.view.namespaces.find(entry => entry.ns === 'agent-presets')
      if (view === undefined) return 'refused'
      if (view.revision !== revision) return 'conflict'
      const operation = owner
      operation.busy = true
      let response: Awaited<ReturnType<typeof remote.mutate>>
      try { response = await remote.mutate('agent-presets', [{ op: 'set', path: [change.field], value: change.value }], revision) }
      catch {
        // 仅处理本次 RPC 的传输失败；错误原文可能携带本机路径，不进入 UI。
        if (!active() || owner !== operation) return 'inactive'
        operation.busy = false
        return 'refused'
      }
      if (!active() || owner !== operation) return 'inactive'
      operation.busy = false
      if (!response.ok) return response.error.code === 'settings/conflict' ? 'conflict' : 'refused'
      const latest = mirror.getSnapshot().view?.namespaces.find(entry => entry.ns === 'agent-presets')
      // 配置推送可能先于 RPC 回执；不得用较旧保存结果回滚镜像。
      if (latest === undefined || latest.revision <= response.value.revision) mirror.acceptView(response.value)
      return 'written'
    },
    reset: () => { owner = { busy: false } },
    dispose: () => { disposed = true },
  }
}
