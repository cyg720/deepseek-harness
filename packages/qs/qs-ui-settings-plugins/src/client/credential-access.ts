/** WebSearch 凭据只读取配置状态，写入必须依据本次明确回执。 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** 凭据呈现状态不包含字面量或远端错误原文。 */
export interface CredentialState {
  readonly ref: string
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly configured: boolean
  readonly writable: boolean
  readonly saving: boolean
}
/** 当前引用对应的凭据访问与生命周期。 */
export interface CredentialAccess extends HostObservable<CredentialState> {
  /**
   * 读取当前引用状态，切换引用使旧读写的 UI 回执失效。
   * @param ref - 官方配置指定的凭据引用。
   * @returns 状态读取结束。
   */
  readonly refresh: (ref: string) => Promise<void>
  /**
   * 向用户编辑时的引用写入字面量，不读取或缓存现有密钥。
   * @param ref - 草稿开始时的引用，不能静默改用新引用。
   * @param value - 用户明确保存的密钥字面量。
   * @returns 本次写入结果，已有密钥状态不能代替成功回执。
   */
  readonly write: (ref: string, value: string) => Promise<'written' | 'refused' | 'inactive' | 'busy'>
  /** 释放所有订阅与在途结果拥有权。 */
  readonly dispose: () => void
}
/**
 * 绑定官方凭据 Remote，不提供获取密钥明文的接口。
 * @param remote - 官方 describe/set 方法。
 * @returns 当前卡实例的凭据状态和显式写入命令。
 */
export function createCredentialAccess(remote: Pick<Context['remote']['credentials'], 'describe' | 'set'>): CredentialAccess {
  let state: CredentialState = { ref: '', status: 'idle', configured: false, writable: false, saving: false }
  let owner = { pending: false }, readGeneration = 0, disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: CredentialState): void => { state = next; for (const listener of listeners) listener() }
  const refresh = async (ref: string): Promise<void> => {
    if (disposed) return
    if (ref !== state.ref) owner = { pending: false }
    const request = ++readGeneration
    publish({ ref, status: 'loading', configured: false, writable: false, saving: owner.pending })
    let response: Awaited<ReturnType<typeof remote.describe>>
    try { response = await remote.describe([ref]) }
    catch {
      // 仅捕获本次 RPC 传输异常；不保留可能含敏感细节的原始消息。
      if (request === readGeneration) publish({ ...state, status: 'error' })
      return
    }
    if (request !== readGeneration) return
    if (!response.ok) { publish({ ...state, status: 'error' }); return }
    const info = response.value[ref]
    publish({ ref, status: 'ready', configured: info?.configured ?? false, writable: info?.writable ?? true, saving: owner.pending })
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh,
    dispose: () => { disposed = true; readGeneration += 1; owner = { pending: false }; listeners.clear() },
    write: async (ref, value) => {
      if (disposed) return 'inactive'
      if (owner.pending) return 'busy'
      if (ref !== state.ref || state.status !== 'ready' || !state.writable) return 'refused'
      const operation = owner
      operation.pending = true; publish({ ...state, saving: true })
      let response: Awaited<ReturnType<typeof remote.set>>
      try { response = await remote.set(ref, value) }
      catch {
        // 写入传输中断不等于成功，保留由表单拥有的草稿以供用户决定。
        if (operation !== owner) return 'inactive'
        operation.pending = false; publish({ ...state, saving: false }); return 'refused'
      }
      if (operation !== owner) return 'inactive'
      operation.pending = false; publish({ ...state, saving: false })
      if (!response.ok) return 'refused'
      // 刷新失败只影响状态徽标，不抹去已经收到的明确写入回执。
      await refresh(ref)
      return operation === owner ? 'written' : 'inactive'
    },
  }
}
