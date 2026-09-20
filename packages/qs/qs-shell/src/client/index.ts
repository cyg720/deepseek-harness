/**
 * 奇术工作台的浏览器入口。
 *
 * 本包是七个 qs-* 包中唯一注册 `root` 的包：以**负优先级**遮蔽官方 `AppFrame`
 * （同优先级注册会抛错，负优先级才稳定胜出）。同时它声明全部顶层 `qs.*` 槽，
 * 其余六个包用 `ctx.slots.inject(key, …)` 等待声明后贡献，因此不依赖加载顺序。
 *
 * 回退语义（见 10-界面切换与回退配置 第四节）：
 * - `defaultUi: official` ⇒ 不注册奇术 root（官方显示，贡献等待）；
 * - 停用全部七行 ⇒ 自建注册与副作用全部释放；
 * - 把 priority 改正数 ⇒ 官方显示，但**自建注册仍在**，不得据此断言"无残留"。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并与槽位契约。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// 仅类型：引入 ui-session 的 root 座席（useSessions / useSessionPendingInteraction）。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// 仅类型：引入 ui-sidebar 的 SlotMap 增补（sidebar.footer.action 是官方返回入口的挂载点）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import './styles/tokens.css'
import './styles/contract.css'
import { readInjectedQsShellConfig } from '../config.ts'
import type {
  IQsAuth, IQsUiMode, QsChromeInjected, QsConnectionSnapshot, QsOverlayInjected,
  QsShellRootInjected, QsStatusInjected, QsThemeSnapshot, QsToast, QsUiId, QsUiModeSnapshot,
} from './contract.ts'
import { createQsLayoutStore } from './layout-store.ts'
import { en, zh } from './locales.ts'
import { QsUiModeController } from './ui-mode.ts'
import { AppShell } from './AppShell.tsx'
import { QsOfficialReturn, type QsOfficialReturnInjected } from './OfficialReturn.tsx'
import { QsOverlayHost } from './OverlayHost.tsx'
import { QsRightPanel } from './RightPanel.tsx'
import { QsStatusBar } from './StatusBar.tsx'
import { QsStage } from './Stage.tsx'
import { QsTopBar } from './TopBar.tsx'
import { QsWelcomePane } from './WelcomePane.tsx'

/** 本包的本地化命名空间。 */
const NS = 'qs-shell'

/** 遮蔽官方 AppFrame 的优先级：负值稳定胜出（同优先级注册会抛错）。 */
export const QS_SHELL_ROOT_PRIORITY = -1000

/**
 * 契约再导出。
 *
 * 其它 qs-* 包通过 `import type {} from '@deepseek-ai/dsh-qs-shell/client'` 引入
 * SlotMap 增补与共享类型，所以 `/client` 入口必须把契约面转出去。
 */
export type * from './contract.ts'

/** 必需服务：槽注册表、语言与主题。`qsAuth` 不在此列（可选座席，见 apply）。 */
export const inject = ['slots', 'locale', 'theme']

/**
 * 安装工作台。
 *
 * `qsAuth` 不进 inject：必需服务缺失会让 fiber 一直等待，永远走不到
 * "登录组件未加载"故障分支。登录状态改由 root 座席可选读取（R22/R30）。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  const config = readInjectedQsShellConfig()
  const layoutStore = createQsLayoutStore()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-shell: dictionaries')

  // 快照引用必须稳定：useSyncExternalStore 每次渲染都会读它，返回新对象会造成无限重渲
  // （浏览器车道已实测到 "Maximum update depth exceeded"）。只有明暗档真的变了才换对象。
  let themeSnapshot: QsThemeSnapshot = { scheme: ctx.theme.getTheme().active.colorScheme }
  const themeSource: HostObservable<QsThemeSnapshot> = {
    getSnapshot: () => {
      const scheme = ctx.theme.getTheme().active.colorScheme
      if (scheme !== themeSnapshot.scheme) themeSnapshot = { scheme }
      return themeSnapshot
    },
    subscribe: listener => ctx.on('theme/change', () => { listener() }),
  }

  const modeSource: HostObservable<QsUiModeSnapshot> = {
    getSnapshot: () => mode.getSnapshot(),
    subscribe: listener => mode.subscribe(listener),
  }

  let disposeWorkbench: (() => void) | undefined
  let disposeOfficialEntry: (() => void) | undefined

  const mountWorkbench = (): void => {
    if (disposeWorkbench !== undefined) return
    const disposers = [
      ctx.slots.register({
        name: 'root',
        priority: QS_SHELL_ROOT_PRIORITY,
        locale: NS,
        children: {
          'qs.gate': { kind: 'single', scope: 'root' },
          'qs.chrome': { kind: 'single', scope: 'root' },
          'qs.nav': { kind: 'single', scope: 'root' },
          'qs.stage': { kind: 'single', scope: 'root' },
          'qs.inspector': { kind: 'single', scope: 'root' },
          'qs.status': { kind: 'list', scope: 'root' },
          'qs.overlay': { kind: 'list', scope: 'root' },
        },
        store: layoutStore,
        inject: (): QsShellRootInjected => ({ hooks: { qsTheme: themeSource } }),
      }, AppShell),
      // qs.stage 的入口自己声明并渲染欢迎区、转写与输入区三个子槽（R15/R27）。
      ctx.slots.register({
        name: 'qs.stage',
        locale: NS,
        children: {
          'qs.stage.body': { kind: 'single', scope: 'session-maybe' },
          'qs.stage.transcript': { kind: 'single', scope: 'session' },
          'qs.composer': { kind: 'single', scope: 'session-maybe' },
        },
      }, QsStage),
      ctx.slots.register({ name: 'qs.stage.body', locale: NS }, QsWelcomePane),
      ctx.slots.register({
        name: 'qs.status',
        id: 'qs-status-connection',
        locale: NS,
        inject: (): QsStatusInjected => ({
          hooks: { qsConnection: connectionSource },
          reconnect: () => { connection?.reconnect() },
        }),
      }, QsStatusBar),
      ctx.slots.register({
        name: 'qs.overlay',
        id: 'qs-overlay-toasts',
        locale: NS,
        inject: (): QsOverlayInjected => ({ hooks: { qsToasts: toastSource } }),
      }, QsOverlayHost),
      ctx.slots.register({
        name: 'qs.inspector',
        locale: NS,
        store: layoutStore,
      }, QsRightPanel),
      ctx.slots.register({
        name: 'qs.chrome',
        locale: NS,
        store: layoutStore,
        inject: (): QsChromeInjected => ({
          hooks: { qsUiMode: modeSource },
          signOut: () => { (ctx.get('qsAuth') as IQsAuth | undefined)?.signOut() },
          switchToOfficial: () => { mode.switchTo('official') },
        }),
      }, QsTopBar),
    ]
    disposeWorkbench = () => {
      disposeWorkbench = undefined
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  // toast：唯一入口是 qsToast 服务，由 overlay 宿主渲染。定时清理保证不无限累积。
  const toastTimers = new Set<ReturnType<typeof setTimeout>>()
  let toastSeq = 0
  let toasts: readonly QsToast[] = []
  const toastListeners = new Set<() => void>()
  const publishToasts = (next: readonly QsToast[]): void => {
    toasts = next
    for (const listener of [...toastListeners]) listener()
  }
  const toastSource: HostObservable<readonly QsToast[]> = {
    getSnapshot: () => toasts,
    subscribe: (listener) => { toastListeners.add(listener); return () => { toastListeners.delete(listener) } },
  }
  /**
   * 举起一条 toast。
   * @param message - 已本地化的正文。
   * @param ttlMs - 自动消失时间。
   */
  const showToast = (message: string, ttlMs = 3200): void => {
    const id = ++toastSeq
    publishToasts([...toasts, { id, message }])
    const timer = setTimeout(() => { toastTimers.delete(timer); publishToasts(toasts.filter(item => item.id !== id)) }, ttlMs)
    toastTimers.add(timer)
  }

  // 连接态：只读快照 + 手动重连；状态条是唯一消费者。
  const connection = ctx.get('connection') as { state: HostObservable<'connected' | 'disconnected' | 'connecting' | undefined>; reconnect: () => void; isLoopback?: boolean } | undefined
  const connectionSource: HostObservable<QsConnectionSnapshot> = {
    getSnapshot: () => ({ state: connection?.state.getSnapshot(), loopback: connection?.isLoopback === true }),
    subscribe: listener => (connection === undefined ? () => {} : connection.state.subscribe(listener)),
  }

  const mode: IQsUiMode = new QsUiModeController(config, (ui: QsUiId) => { applyUi(ui) })

  const mountOfficialEntry = (): void => {
    if (disposeOfficialEntry !== undefined) return
    disposeOfficialEntry = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'qs-official-return',
      locale: NS,
      inject: (): QsOfficialReturnInjected => ({ backToWorkbench: () => { mode.switchTo('workbench') } }),
    }, QsOfficialReturn))
  }

  const unmountOfficialEntry = (): void => {
    disposeOfficialEntry?.()
    disposeOfficialEntry = undefined
  }

  const applyUi = (ui: QsUiId): void => {
    if (ui === 'workbench') {
      unmountOfficialEntry()
      mountWorkbench()
      return
    }
    disposeWorkbench?.()
    if (config.showOfficialUiEntry) mountOfficialEntry()
  }

  ctx.effect(() => ctx.reflect.provide('qsShell', mode), 'qs-shell: switch controller')
  ctx.effect(() => ctx.reflect.provide('qsToast', { show: showToast }), 'qs-shell: toast service')

  applyUi(config.defaultUi)

  ctx.effect(() => () => {
    for (const timer of toastTimers) clearTimeout(timer)
    toastTimers.clear()
    toastListeners.clear()
    unmountOfficialEntry()
    disposeWorkbench?.()
  }, 'qs-shell: workbench teardown')
}
