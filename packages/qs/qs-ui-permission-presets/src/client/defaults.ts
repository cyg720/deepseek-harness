/** 新会话默认权限消费官方动态 schema，写入保留确认时版本。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsDescribeFace, SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Host schema 中可选的权限机器值及显示名。 */
export interface DefaultOption { readonly value: string; readonly name: string }
/** 默认权限设置的共享镜像派生值，不承载当前会话权限。 */
export interface DefaultState {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'error'
  readonly writable: boolean
  readonly current: string
  readonly revision: number
  readonly epoch: number
  readonly options: readonly DefaultOption[]
  readonly saving: boolean
  readonly outcome: 'none' | 'written' | 'conflict' | 'refused'
}
/** 插件拥有的默认权限读取、保存及释放入口。 */
export interface DefaultController extends HostObservable<DefaultState> {
  /** @returns 官方设置描述读取完成。 */
  load(): Promise<void>
  /**
   * 保存用户选择，新会话创建时才使用该默认值。
   * @param value - 动态 schema 提供的机器值。
   * @param revision - 用户选择或开始风险确认时的设置版本。
   * @param acknowledged - 用户是否明确接受完全访问风险。
   * @param epoch - 用户操作时的连接代次；重连使旧确认失效。
   * @returns 写入回执处理完毕；结果在快照中呈现。
   */
  select(value: string, revision: number, acknowledged: boolean, epoch: number): Promise<void>
  /** 连接重置后忽略旧连接的回执，重新派生镜像状态。 */
  reset(): void
  /** 取消订阅并阻止迟到回执更新共享镜像。 */
  dispose(): void
}
/**
 * 解析官方 defaultPreset 常量或联合选项，不自行添加权限等级。
 * @param view - permission 命名空间描述。
 * @param schema - 官方 schema 解析服务。
 * @returns 当前机器值与动态选项。
 */
export function readDefaults(view: SettingsNamespaceView, schema: Pick<SettingsSchemaService, 'rehydrate' | 'nodeAtPath'>): { current: string; options: DefaultOption[] } {
  const current = (view.value as { defaultPreset?: unknown } | null)?.defaultPreset
  if (typeof current !== 'string') throw new Error('permission defaultPreset unavailable')
  const node = schema.nodeAtPath(schema.rehydrate(view.schema), ['defaultPreset'])
  if (node === undefined) throw new Error('permission defaultPreset schema unavailable')
  const choices = node.type === 'union' ? node.list ?? [] : [node]
  const options = choices.flatMap((choice) => {
    if (choice.type !== 'const' || typeof choice.value !== 'string') return []
    const description = choice.meta.description
    return [{ value: choice.value, name: typeof description === 'string' && description.length > 0 ? description : choice.value }]
  })
  if (!options.some(option => option.value === current)) throw new Error('permission defaultPreset is not advertised')
  return { current, options }
}
/**
 * 持有呈现生命周期，复用官方设置镜像和带版本写接口。
 * @param mirror - 官方 describe 共享镜像。
 * @param remote - 官方 settings Remote。
 * @param schema - 官方 schema 解析服务。
 * @returns 无独立持久化状态的权限设置控制器。
 */
export function createDefaults(mirror: SettingsDescribeFace, remote: Pick<Context['remote']['settings'], 'mutate'>, schema: Pick<SettingsSchemaService, 'rehydrate' | 'nodeAtPath'>): DefaultController {
  let epoch = 0
  let disposed = false, owner = { saving: false }, outcome: DefaultState['outcome'] = 'none', readFailed = false
  const active = (): boolean => !disposed
  const listeners = new Set<() => void>()
  const project = (): DefaultState => {
    const source = mirror.getSnapshot()
    const empty = { writable: false, current: '', revision: 0, epoch, options: [], saving: owner.saving, outcome }
    if (source.status === 'unavailable') return { ...empty, status: 'unavailable' }
    if (readFailed || source.error !== null) return { ...empty, status: 'error' }
    if (source.status !== 'ready' || source.view === undefined) return { ...empty, status: 'loading' }
    const view = source.view.namespaces.find(entry => entry.ns === 'permission')
    if (view === undefined) return { ...empty, status: 'unavailable' }
    try { return { ...empty, ...readDefaults(view, schema), revision: view.revision, writable: source.view.writable, status: 'ready' } }
    catch {
      // 此段仅解析远端 schema 和设置值；无效描述禁用写入，不显示内部异常。
      return { ...empty, status: 'error' }
    }
  }
  let state = project()
  const publish = (): void => { if (active()) { state = project(); for (const listener of listeners) listener() } }
  const unsubscribe = mirror.subscribe(publish)
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    load: async () => {
      if (!active()) return
      const operation = owner
      readFailed = false
      publish()
      try { await mirror.ensure() }
      catch {
        // 仅吞掉 describe 的传输失败，后续仍可重新读取。
        if (active() && owner === operation) readFailed = true
      }
      if (owner === operation) publish()
    },
    select: async (value, revision, acknowledged, expectedEpoch) => {
      if (!active() || owner.saving || expectedEpoch !== epoch) return
      const current = project()
      if (current.status !== 'ready' || !current.writable || !current.options.some(option => option.value === value)
        || (value === 'danger-full-access' && !acknowledged)) return
      if (current.revision !== revision) { outcome = 'conflict'; publish(); return }
      const operation = owner
      operation.saving = true; outcome = 'none'; publish()
      let result: Awaited<ReturnType<typeof remote.mutate>>
      try { result = await remote.mutate('permission', [{ op: 'set', path: ['defaultPreset'], value }], revision) }
      catch {
        // 本次 RPC 未确认写入；不泄露传输错误，也不清除其他生命周期状态。
        if (active() && owner === operation) { operation.saving = false; outcome = 'refused'; publish() }
        return
      }
      if (!active() || owner !== operation) return
      operation.saving = false
      if (!result.ok) { outcome = result.error.code === 'settings/conflict' ? 'conflict' : 'refused'; publish(); return }
      outcome = 'written'
      const latest = mirror.getSnapshot().view?.namespaces.find(entry => entry.ns === 'permission')
      // 推送可能先于保存回执到达；成功回执不能将共享镜像退回旧版本。
      if (latest === undefined || latest.revision <= result.value.revision) mirror.acceptView(result.value)
      publish()
    },
    reset: () => { epoch++; owner = { saving: false }; outcome = 'none'; readFailed = false; publish() },
    dispose: () => { disposed = true; unsubscribe(); listeners.clear() },
  }
}
