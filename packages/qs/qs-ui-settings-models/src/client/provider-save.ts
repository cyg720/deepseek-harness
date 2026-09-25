/** 配置与凭据分别确认，配置失败或卡片卸载后不能继续写密钥。 */
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'

/** 保存只接收用户确认的字段，不接收整个脱敏命名空间重建结果。 */
export interface ProviderSaveRequest {
  readonly ops: readonly SettingsPathOpView[]
  readonly revision: number
  readonly credential?: { readonly ref: string; readonly value: string }
}
/** 分别报告两个独立操作，不把配置已提交误报为完整失败或完整成功。 */
export interface ProviderSaveResult {
  readonly configuration: 'written' | 'unchanged' | 'conflict' | 'refused' | 'busy' | 'inactive'
  readonly credential: 'written' | 'unchanged' | 'refused' | 'not-attempted' | 'reference-changed' | 'inactive'
}
/** 当前编辑器持有的保存器。 */
export interface ProviderWriter {
  /** @param request - 字段操作、草稿版本和可选写入凭据。 @returns 不含密钥或远端错误原文的分步回执。 */
  save(request: ProviderSaveRequest): Promise<ProviderSaveResult>
  /** 禁止下一步副作用，已发送的 Host 请求不能据此撤销。 */
  dispose(): void
}
/** 编辑器的当前权限和已确认配置视图。 */
export interface ProviderWriteOwner {
  /** @returns 当前官方设置镜像是否允许写入。 */
  writable(): boolean
  /** @param view - 明确提交成功的新版本，须采纳后再计算下一次差异。 */
  accept(view: SettingsNamespaceView): void
  /** @returns 当前有效凭据引用；并发变更后拒绝向旧目标写入。 */
  credentialRef(): string | undefined
}
/**
 * 绑定官方操作与当前供应商的编辑生命周期。
 * @param namespace - 官方目录给定的配置命名空间。
 * @param operations - 已绑定官方服务的写操作。
 * @param owner - 当前权限、提交确认和有效凭据引用。
 * @returns 只允许单个在途保存的提交器。
 */
export function createProviderWriter(namespace: string, operations: ModelsOperations, owner: ProviderWriteOwner): ProviderWriter {
  let active = true, pending = false
  const alive = (): boolean => active
  return {
    dispose: () => { active = false },
    save: async (request) => {
      if (!alive()) return { configuration: 'inactive', credential: 'not-attempted' }
      if (pending) return { configuration: 'busy', credential: 'not-attempted' }
      const ops = structuredClone(request.ops) as SettingsPathOpView[], revision = request.revision
      const credential = request.credential === undefined ? undefined : { ...request.credential }
      pending = true
      let configuration: ProviderSaveResult['configuration'] = 'unchanged'
      try {
        if (ops.length > 0) {
          if (!owner.writable()) return { configuration: 'refused', credential: 'not-attempted' }
          let result: Awaited<ReturnType<ModelsOperations['writeSettings']>>
          // 这里只接住配置 RPC 的拒绝；错误原文可能含敏感配置，不返回给卡片。
          try { result = await operations.writeSettings(namespace, ops, revision) }
          catch { return { configuration: alive() ? 'refused' : 'inactive', credential: 'not-attempted' } }
          if (!alive()) return { configuration: 'inactive', credential: 'not-attempted' }
          if (result.kind !== 'written') return { configuration: result.kind, credential: 'not-attempted' }
          // 先采纳新版本；凭据失败后重试只提交尚未确认的部分。
          owner.accept(result.view)
          configuration = 'written'
        }
        if (!alive()) return { configuration, credential: 'inactive' }
        if (credential === undefined) return { configuration, credential: 'unchanged' }
        if (owner.credentialRef() !== credential.ref) return { configuration, credential: 'reference-changed' }
        let failure: string | undefined
        // 凭据 RPC 失败不改变已提交的配置状态，也不传播可能包含密钥的诊断。
        try { failure = await operations.storeCredential(credential.ref, credential.value) }
        catch { return { configuration, credential: alive() ? 'refused' : 'inactive' } }
        return { configuration, credential: !alive() ? 'inactive' : failure === undefined ? 'written' : 'refused' }
      } finally { pending = false }
    },
  }
}
