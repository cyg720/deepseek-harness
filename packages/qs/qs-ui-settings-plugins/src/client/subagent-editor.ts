/** 子代理授权草稿与提交，官方设置 scope 仍持有配置真值。 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  modelCandidates, modelRouteKey, type ModelCandidate, type QsSubagentModelCatalog, type QsSubagentModelCatalogState, type ModelRoute,
} from './model-catalog.ts'
import type { CardWriter, SaveOutcome } from './save.ts'

/** 对应 Host subagent-model-selection 配置，不创建新的持久协议。 */
export interface SubagentPreference { readonly enabled: boolean; readonly allowedModels: readonly ModelRoute[] }
/** 子代理卡所需的当前编辑状态。 */
export interface SubagentEditorState {
  readonly available: boolean
  readonly writable: boolean
  readonly enabled: boolean
  readonly selected: ReadonlySet<string>
  readonly candidates: readonly ModelCandidate[]
  readonly catalog: QsSubagentModelCatalogState
  readonly dirty: boolean
  readonly invalid: boolean
  readonly saving: boolean
  readonly conflicted: boolean
  readonly outcome: SaveOutcome['kind'] | undefined
}
/** 卡片持有的编辑动作与订阅生命周期。 */
export interface SubagentEditor extends HostObservable<SubagentEditorState> {
  /** 暂存子代理模型选择开关；首次启用加载目录。 */
  readonly toggleEnabled: () => void
  /**
   * 暂存一个明确的模型路由选择。
   * @param key - 当前候选目录中的不透明标识。
   */
  readonly toggleModel: (key: string) => void
  /** 放弃当前草稿，采用镜像配置。 */
  readonly discard: () => void
  /**
   * 一次提交开关与允许路由，保留原始编辑版本。
   * @returns 写入结束；实际回执保存在快照 outcome。
   */
  readonly save: () => Promise<void>
  /** 刷新当前连接的模型目录。 */
  readonly refresh: () => void
  /** 清理旧连接草稿及在途提交所有权。 */
  readonly reset: () => void
  /** 释放 scope/目录订阅与提交器。 */
  readonly dispose: () => void
}
/**
 * 绑定官方 scope、目录及明确回执提交器；不使用 void mutation 推断保存结果。
 * @param scope - 官方共享镜像派生的配置 scope。
 * @param catalog - 此卡拥有的目录及其请求代际。
 * @param createWriter - 当前连接的提交器工厂。
 * @returns 由卡片注册生命周期释放的编辑器。
 */
export function createSubagentEditor(
  scope: Pick<SettingsScope<SubagentPreference>, 'getSnapshot' | 'subscribe'>,
  catalog: QsSubagentModelCatalog,
  createWriter: () => CardWriter,
): SubagentEditor {
  type Draft = { enabled: boolean; routes: Map<string, ModelRoute>; revision: number }
  let draft: Draft | undefined
  let owner = { writer: createWriter(), pending: false }, disposed = false
  let outcome: SaveOutcome['kind'] | undefined
  const listeners = new Set<() => void>()
  const current = (): SubagentPreference => scope.getSnapshot().value ?? { enabled: false, allowedModels: [] }
  const project = (): SubagentEditorState => {
    const snapshot = scope.getSnapshot(), value = current(), enabled = draft?.enabled ?? value.enabled
    const selected = new Set(draft?.routes.keys() ?? value.allowedModels.map(modelRouteKey))
    const original = new Set(value.allowedModels.map(modelRouteKey))
    return {
      available: snapshot.status === 'ready', writable: snapshot.writable, enabled, selected,
      candidates: modelCandidates(catalog.getSnapshot().groups, [...value.allowedModels, ...draft?.routes.values() ?? []]),
      catalog: catalog.getSnapshot(), saving: owner.pending, outcome,
      dirty: enabled !== value.enabled || selected.size !== original.size || [...selected].some(key => !original.has(key)),
      invalid: enabled && selected.size === 0,
      conflicted: draft !== undefined && draft.revision !== snapshot.revision,
    }
  }
  let state = project()
  const publish = (): void => { state = project(); for (const listener of listeners) listener() }
  const editable = (): boolean => !disposed && !owner.pending && scope.getSnapshot().status === 'ready' && scope.getSnapshot().writable
  const begin = (): Draft => {
    if (draft !== undefined) return draft
    const snapshot = scope.getSnapshot(), value = current()
    if (snapshot.revision === undefined) throw new Error('Ready subagent settings require a revision')
    draft = {
      enabled: value.enabled, routes: new Map(value.allowedModels.map(route => [modelRouteKey(route), { ...route }])),
      revision: snapshot.revision,
    }
    return draft
  }
  const ensureCatalog = (): void => {
    if ((draft?.enabled ?? current().enabled) && catalog.getSnapshot().status === 'idle') void catalog.refresh()
  }
  const offScope = scope.subscribe(() => { ensureCatalog(); publish() })
  const offCatalog = catalog.subscribe(publish)
  ensureCatalog()
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    toggleEnabled: () => {
      if (!editable()) return
      const edit = begin(); edit.enabled = !edit.enabled; outcome = undefined; ensureCatalog(); publish()
    },
    toggleModel: (key) => {
      if (!editable() || !state.enabled) return
      const candidate = state.candidates.find(row => row.key === key)
      if (candidate === undefined) return
      const edit = begin()
      if (edit.routes.has(key)) edit.routes.delete(key)
      else edit.routes.set(key, { provider: candidate.provider, model: candidate.model })
      outcome = undefined; publish()
    },
    discard: () => { if (disposed || owner.pending) return; draft = undefined; outcome = undefined; ensureCatalog(); publish() },
    save: async () => {
      if (!editable() || !state.dirty || state.invalid || draft === undefined) return
      if (state.conflicted) { outcome = 'conflict'; publish(); return }
      const operation = owner
      operation.pending = true; outcome = undefined; publish()
      const result = await operation.writer.save([
        { op: 'set', path: ['enabled'], value: draft.enabled },
        { op: 'set', path: ['allowedModels'], value: [...draft.routes.values()].map(route => ({ ...route })) },
      ], draft.revision)
      // reset/dispose 已释放旧提交器；旧回执不得清除新连接草稿。
      if (disposed || operation !== owner) return
      operation.pending = false; outcome = result.kind
      if (result.kind === 'written') draft = undefined
      publish()
    },
    refresh: () => { if (!disposed && state.enabled) void catalog.refresh() },
    reset: () => {
      if (disposed) return
      owner.writer.dispose(); owner = { writer: createWriter(), pending: false }
      draft = undefined; outcome = undefined; catalog.reset(); ensureCatalog(); publish()
    },
    dispose: () => {
      disposed = true; offScope(); offCatalog(); owner.writer.dispose(); catalog.dispose(); listeners.clear()
    },
  }
}
