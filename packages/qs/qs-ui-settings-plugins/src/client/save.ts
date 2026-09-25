/** 配置卡的单次原子提交；明确回执，不把 void 或镜像相等当作保存成功。 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
/** 保存结果只包含可公开状态，不把远端错误原文交给视图。 */
export type SaveOutcome =
  | { readonly kind: 'written'; readonly view: SettingsNamespaceView }
  | { readonly kind: 'conflict' | 'refused' | 'inactive' | 'busy' }
/** 每个配置卡拥有的提交入口及生命周期释放。 */
export interface CardWriter {
  /**
   * 提交同一命名空间的一批编辑，版本取自开始编辑的快照。
   * @param ops - 用户明确保存的字段操作。
   * @param revision - 编辑开始时的 Host 版本，不自动升级为新版本。
   * @returns 明确成功、冲突、拒绝或当前生命周期不可用。
   */
  readonly save: (ops: readonly SettingsPathOpView[], revision: number) => Promise<SaveOutcome>
  /** 阻止后续提交和迟到回执更新镜像；已发送的 Host 写入不能据此撤销。 */
  readonly dispose: () => void
}
/**
 * 绑定已有官方写接口及共享镜像；同一卡仅允许一个在途提交。
 * @param namespace - 此卡拥有的官方设置命名空间。
 * @param remote - 官方 settings Remote 的 mutate 方法。
 * @param mirror - 官方共享设置镜像。
 * @returns 由对应卡生命周期释放的提交器。
 */
export function createCardWriter(
  namespace: string,
  remote: Pick<Context['remote']['settings'], 'mutate'>,
  mirror: Pick<SettingsDescribeFace, 'getSnapshot' | 'acceptView'>,
): CardWriter {
  let active = true, busy = false
  // await 期间 dispose 可改变生命周期；每次读取均取当前所有者状态。
  const isActive = (): boolean => active
  return {
    dispose: () => { active = false },
    save: async (ops, revision) => {
      if (!isActive()) return { kind: 'inactive' }
      if (busy) return { kind: 'busy' }
      const state = mirror.getSnapshot()
      // 不可写或尚未服务的命名空间不得通过 UI 绕过官方镜像的限制。
      if (state.status !== 'ready' || state.view?.writable !== true || !state.view.namespaces.some(view => view.ns === namespace)) return { kind: 'refused' }
      busy = true
      try {
        // 复制操作隔离调用者后续修改，所有字段共享一个 CAS fence 和原子提交。
        const owned = structuredClone(ops) as SettingsPathOpView[]
        let result: Awaited<ReturnType<typeof remote.mutate>>
        try { result = await remote.mutate(namespace, owned, revision) }
        catch {
          // 仅吞掉本次 RPC 的传输异常，不能把未确认写入报告为成功。
          return { kind: isActive() ? 'refused' : 'inactive' }
        }
        if (!isActive()) return { kind: 'inactive' }
        if (!result.ok) return { kind: result.error.code === 'settings/conflict' ? 'conflict' : 'refused' }
        const current = mirror.getSnapshot().view?.namespaces.find(view => view.ns === namespace)
        // 其他客户端的新版本可能先由推送进入镜像，迟到成功不能回滚它。
        if (current === undefined || current.revision <= result.value.revision) mirror.acceptView(result.value)
        return { kind: 'written', view: result.value }
      } finally { busy = false }
    },
  }
}
