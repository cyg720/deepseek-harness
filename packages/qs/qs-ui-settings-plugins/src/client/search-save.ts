/** WebSearch 配置和凭据是两个独立事务，逐项记录明确回执。 */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { CardWriter, SaveOutcome } from './save.ts'
import type { CredentialAccess } from './credential-access.ts'

/** 用户明确保存的草稿；密钥只传给凭据接口，不放入配置操作。 */
export interface SearchSaveRequest {
  readonly ops: readonly SettingsPathOpView[]
  readonly revision: number
  readonly credential?: { readonly ref: string; readonly value: string }
}
/** 两项操作独立确认；未执行和未修改也保留区别。 */
export interface SearchSaveResult {
  readonly configuration: SaveOutcome['kind'] | 'unchanged'
  readonly credential: Awaited<ReturnType<CredentialAccess['write']>> | 'unchanged' | 'not-attempted' | 'reference-changed'
}
/** 组合保存仅持有本次卡片生命周期，不提供跨接口回滚承诺。 */
export interface SearchSaver {
  /**
   * 先提交配置，只有配置确认且引用仍相同时才写入密钥。
   * @param request - 用户本次确认的草稿及最初编辑版本。
   * @returns 不含明文的逐项保存结果。
   */
  readonly save: (request: SearchSaveRequest) => Promise<SearchSaveResult>
  /** 释放配置提交器并禁止后续凭据写入；凭据访问器由编辑器单独释放。 */
  readonly dispose: () => void
}
/**
 * 构造 WebSearch 的两步保存流程，配置失败时不触发凭据副作用。
 * @param configuration - 当前连接拥有的原子配置提交器。
 * @param credentials - 当前连接的凭据访问器。
 * @param currentRef - 从当前官方配置读取有效凭据引用。
 * @returns 当前卡实例的组合保存器。
 */
export function createSearchSaver(
  configuration: CardWriter,
  credentials: Pick<CredentialAccess, 'write'>,
  currentRef: () => string,
): SearchSaver {
  let active = true, pending = false
  const isActive = (): boolean => active
  return {
    dispose: () => { active = false; configuration.dispose() },
    save: async (request) => {
      if (!isActive()) return { configuration: 'inactive', credential: 'not-attempted' }
      if (pending) return { configuration: 'busy', credential: 'not-attempted' }
      pending = true
      // 调用方后续修改不能改变已确认的路由、字段或密钥引用。
      const ops = structuredClone(request.ops), revision = request.revision
      const credential = request.credential === undefined ? undefined : { ...request.credential }
      try {
        let saved: SearchSaveResult['configuration'] = 'unchanged'
        if (ops.length > 0) {
          saved = (await configuration.save(ops, revision)).kind
          if (saved !== 'written') return { configuration: saved, credential: credential === undefined ? 'unchanged' : 'not-attempted' }
        }
        if (!isActive()) return { configuration: saved, credential: 'not-attempted' }
        if (credential === undefined) return { configuration: saved, credential: 'unchanged' }
        if (credential.ref !== currentRef()) return { configuration: saved, credential: 'reference-changed' }
        const written = await credentials.write(credential.ref, credential.value)
        return { configuration: saved, credential: isActive() ? written : 'inactive' }
      } finally { pending = false }
    },
  }
}
