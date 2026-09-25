/** WebSearch 草稿和部分保存结果；失败字段保留，成功字段单独清理。 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { CredentialAccess, CredentialState } from './credential-access.ts'
import type { SearchSaver, SearchSaveResult } from './search-save.ts'

/** 官方 web-search-deepseek 命名空间中的表单字段。 */
export interface SearchPreference { readonly baseURL?: string; readonly maxUses?: number; readonly apiKeyEnv?: string }
/** 公开配置字段，凭据明文不进入此字段集合。 */
export type SearchField = 'baseURL' | 'maxUses'
/** UI 单字段的草稿与继承状态。 */
export interface SearchFieldState { readonly text: string; readonly overridden: boolean; readonly invalid: boolean }
/** 表单局部状态，secret 只在当前编辑器实例内保留，不能持久化或写日志。 */
export interface SearchEditorState {
  readonly available: boolean
  readonly writable: boolean
  readonly fields: Readonly<Record<SearchField, SearchFieldState>>
  readonly secret: string
  readonly credential: CredentialState
  readonly referenceChanged: boolean
  readonly conflicted: boolean
  readonly dirty: boolean
  readonly invalid: boolean
  readonly saving: boolean
  readonly outcome: SearchSaveResult | undefined
}
/** 当前连接的私有写入资源。 */
export interface SearchConnection { readonly credentials: CredentialAccess; readonly saver: SearchSaver }
/** WebSearch 卡拥有的编辑命令及生命周期。 */
export interface SearchEditor extends HostObservable<SearchEditorState> {
  /**
   * 暂存公开字段。
   * @param field - 公开配置字段。
   * @param text - 用户输入。
   */
  readonly edit: (field: SearchField, text: string) => void
  /**
   * 移除字段覆盖，恢复继承。
   * @param field - 公开配置字段。
   */
  readonly resetField: (field: SearchField) => void
  /**
   * 暂存密钥；空输入表示不更新，不代表删除 Host 凭据。
   * @param text - 用户输入的字面量。
   */
  readonly editSecret: (text: string) => void
  /** 卡片卸载时清除明文，即使已有写入在途；不声称撤销 Host 写入。 */
  readonly clearSecret: () => void
  /** 放弃所有草稿并清除密钥明文。 */
  readonly discard: () => void
  /** @returns 本次保存结束，独立结果保存在快照 outcome。 */
  readonly save: () => Promise<void>
  /** 重新读取当前凭据配置状态。 */
  readonly refreshCredential: () => void
  /** 切换连接，释放旧资源并清除密钥草稿。 */
  readonly reset: () => void
  /** 释放订阅、写入资源和明文草稿。 */
  readonly dispose: () => void
}
/**
 * 与官方搜索 provider 使用相同的默认凭据引用。
 * @param value - 官方有效配置。
 * @returns 当前配置引用，空值采用 provider 默认引用。
 */
export function searchCredentialRef(value: SearchPreference | undefined): string {
  return value?.apiKeyEnv === undefined || value.apiKeyEnv.length === 0 ? 'DEEPSEEK_API_KEY' : value.apiKeyEnv
}
function layer(source: unknown, field: SearchField): unknown {
  return source !== null && typeof source === 'object' && !Array.isArray(source) ? (source as Record<string, unknown>)[field] : undefined
}
/**
 * 连接 scope 与配置/凭据保存器，不持久化密钥草稿。
 * @param scope - 官方配置只读快照。
 * @param createConnection - 当前连接的资源工厂。
 * @param valid - 官方 schema 对具体字段的校验。
 * @returns 卡片生命周期拥有的表单编辑器。
 */
export function createSearchEditor(
  scope: Pick<SettingsScope<SearchPreference>, 'getSnapshot' | 'subscribe'>,
  createConnection: () => SearchConnection,
  valid: (field: SearchField, value: string | number) => boolean,
): SearchEditor {
  type Draft = { text: string; clear: boolean }
  let drafts: Partial<Record<SearchField, Draft>> = {}, revision: number | undefined
  let secret = '', secretRef: string | undefined, outcome: SearchSaveResult | undefined, disposed = false
  let owner = { ...createConnection(), pending: false }
  const listeners = new Set<() => void>()
  const currentRef = (): string => searchCredentialRef(scope.getSnapshot().value)
  const fieldState = (field: SearchField): SearchFieldState => {
    const snapshot = scope.getSnapshot(), draft = drafts[field]
    const text = draft?.text ?? String(snapshot.value?.[field] ?? '')
    const clearing = draft?.clear === true || text.trim() === ''
    const value = field === 'maxUses' ? Number(text) : text.trim()
    return { text,
      overridden: draft === undefined ? layer(snapshot.user, field) !== undefined : !clearing,
      invalid: draft !== undefined && !clearing && ((typeof value === 'number' && !Number.isFinite(value)) || !valid(field, value)),
    }
  }
  const project = (): SearchEditorState => {
    const snapshot = scope.getSnapshot(), fields = { baseURL: fieldState('baseURL'), maxUses: fieldState('maxUses') }
    return { available: snapshot.status === 'ready', writable: snapshot.writable, fields, secret,
      credential: owner.credentials.getSnapshot(), referenceChanged: secretRef !== undefined && secretRef !== currentRef(),
      conflicted: revision !== undefined && revision !== snapshot.revision,
      dirty: Object.keys(drafts).length > 0 || secret.length > 0, invalid: fields.baseURL.invalid || fields.maxUses.invalid,
      saving: owner.pending, outcome,
    }
  }
  let state = project()
  const publish = (): void => { state = project(); for (const listener of listeners) listener() }
  const editable = (): boolean => !disposed && !owner.pending && scope.getSnapshot().status === 'ready' && scope.getSnapshot().writable
  const refresh = (): void => { if (!disposed && scope.getSnapshot().status === 'ready') void owner.credentials.refresh(currentRef()) }
  const ensure = (): void => {
    const credential = owner.credentials.getSnapshot()
    if (credential.status === 'idle' || credential.ref !== currentRef()) refresh()
  }
  let offCredential = owner.credentials.subscribe(publish)
  const offScope = scope.subscribe(() => { ensure(); publish() })
  const clear = (): void => { drafts = {}; revision = undefined; secret = ''; secretRef = undefined; outcome = undefined }
  const stage = (field: SearchField, draft: Draft): void => {
    if (!editable()) return
    revision ??= scope.getSnapshot().revision
    if (revision === undefined) throw new Error('Ready search settings require a revision')
    drafts = { ...drafts, [field]: draft }; outcome = undefined; publish()
  }
  ensure()
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    edit: (field, text) => { stage(field, { text, clear: false }) },
    resetField: (field) => {
      const base = layer(scope.getSnapshot().base, field)
      stage(field, { text: typeof base === 'string' || typeof base === 'number' ? String(base) : '', clear: true })
    },
    editSecret: (text) => {
      if (!editable() || owner.credentials.getSnapshot().status !== 'ready' || !owner.credentials.getSnapshot().writable) return
      secret = text; secretRef = text.length === 0 ? undefined : secretRef ?? currentRef(); outcome = undefined; publish()
    },
    clearSecret: () => { secret = ''; secretRef = undefined; publish() },
    discard: () => { if (disposed || owner.pending) return; clear(); publish() },
    refreshCredential: refresh,
    save: async () => {
      if (!editable() || !state.dirty || state.invalid || state.conflicted || state.referenceChanged) return
      const operation = owner, ops: SettingsPathOpView[] = []
      for (const field of ['baseURL', 'maxUses'] as const) {
        const draft = drafts[field]
        if (draft === undefined) continue
        ops.push(draft.clear || draft.text.trim() === '' ? { op: 'unset', path: [field] }
          : { op: 'set', path: [field], value: field === 'maxUses' ? Number(draft.text) : draft.text.trim() })
      }
      const version = revision ?? scope.getSnapshot().revision
      if (version === undefined) throw new Error('Ready search settings require a revision')
      operation.pending = true; outcome = undefined; publish()
      const result = await operation.saver.save({ ops, revision: version,
        ...(secretRef === undefined ? {} : { credential: { ref: secretRef, value: secret } }),
      })
      if (disposed || owner !== operation) return
      operation.pending = false; outcome = result
      // 两项结果独立清理；凭据失败不能使成功配置在下次重试重复提交。
      if (result.configuration === 'written') { drafts = {}; revision = undefined }
      if (result.credential === 'written') { secret = ''; secretRef = undefined }
      publish()
    },
    reset: () => {
      if (disposed) return
      offCredential(); owner.saver.dispose(); owner.credentials.dispose(); clear()
      owner = { ...createConnection(), pending: false }; offCredential = owner.credentials.subscribe(publish)
      ensure(); publish()
    },
    dispose: () => {
      disposed = true; offScope(); offCredential(); owner.saver.dispose(); owner.credentials.dispose()
      clear(); listeners.clear(); state = project()
    },
  }
}
