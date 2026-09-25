/** 子代理配置使用官方模型目录；刷新、重连和卸载使旧请求失效。 */
import type { Context } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** 卡片可观察的模型目录状态，不携带远端错误原文。 */
export interface QsSubagentModelCatalogState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly groups: readonly ModelProviderGroup[]
  readonly partial: boolean
}
/** 由卡片注册生命周期持有的模型目录。 */
export interface QsSubagentModelCatalog extends HostObservable<QsSubagentModelCatalogState> {
  /** 获取最新目录；后发请求拥有结果。 */
  readonly refresh: () => Promise<void>
  /** 清除旧连接目录，同时使所有旧请求失效。 */
  readonly reset: () => void
  /** 释放订阅并使请求失效，不能取消已经发出的 RPC。 */
  readonly dispose: () => void
}
/**
 * 使用官方目录接口创建一个卡片拥有的读取状态。
 * @param load - 官方 session.modelCatalog RPC。
 * @returns 可观察目录与刷新、重连、释放操作。
 */
export function createModelCatalog(load: Context['remote']['session']['modelCatalog']): QsSubagentModelCatalog {
  let state: QsSubagentModelCatalogState = { status: 'idle', groups: [], partial: false }
  let generation = 0, disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: QsSubagentModelCatalogState): void => { state = next; for (const listener of listeners) listener() }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    reset: () => {
      if (disposed) return
      generation += 1; publish({ status: 'idle', groups: [], partial: false })
    },
    dispose: () => { disposed = true; generation += 1; listeners.clear() },
    refresh: async () => {
      if (disposed) return
      const request = ++generation
      publish({ ...state, status: 'loading', partial: false })
      let response: Awaited<ReturnType<typeof load>>
      try { response = await load() }
      catch {
        // 只处理目录 RPC 的传输失败；旧连接和旧实例不能覆盖新状态。
        if (request === generation) publish({ ...state, status: 'error', partial: false })
        return
      }
      if (request !== generation) return
      if (response.ok) publish({ status: 'ready', groups: response.value.groups, partial: response.value.failures.length > 0 })
      else publish({ ...state, status: 'error', partial: false })
    },
  }
}

/** 精确授权的供应商及模型路由；同名模型不代表相同路由。 */
export interface ModelRoute { readonly provider: string; readonly model: string }
/** 合并目录元数据及仍需允许用户移除的失效路由。 */
export interface ModelCandidate extends ModelRoute {
  readonly key: string
  readonly providerName: string
  readonly modelName: string
  readonly available: boolean
}
/**
 * 构造仅用于查找的无歧义路由标识，不把它解析成业务字段。
 * @param route - 精确模型路由。
 * @returns 本地候选项标识。
 */
export function modelRouteKey(route: ModelRoute): string { return JSON.stringify([route.provider, route.model]) }
/**
 * 已保存和草稿中的路由即使从目录消失，也保留为可删除候选项。
 * @param groups - 官方实时目录。
 * @param retained - 当前配置和草稿需要保留的路由。
 * @returns 目录顺序的可用候选，以及未被目录提供的路由。
 */
export function modelCandidates(groups: readonly ModelProviderGroup[], retained: readonly ModelRoute[]): ModelCandidate[] {
  const missing = new Map(retained.map(route => [modelRouteKey(route), route]))
  const candidates = groups.flatMap(group => group.models.map((model) => {
    const route = { provider: group.id, model: model.id }, key = modelRouteKey(route)
    missing.delete(key)
    return { ...route, key, providerName: group.name, modelName: model.name, available: true }
  }))
  for (const [key, route] of missing) {
    candidates.push({ ...route, key, providerName: route.provider, modelName: route.model, available: false })
  }
  return candidates
}
