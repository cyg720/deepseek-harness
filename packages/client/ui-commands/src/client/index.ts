/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-commands 包在浏览器侧的插件入口：挂载 CommandUiRuntime 服务（ctx.commandUi）、
 *             注册 '/' 命令源与弹窗选择壳（PopupSelectView）到输入覆盖层槽位。
 * 【技术维度】Cordis 浏览器插件：ctx.plugin 挂服务、ctx.locale.register 注册字典、
 *             ctx.inject 注入会话作用域后注册槽位；声明合并把 commandUi 挂到 Context、
 *             把 command 命名空间挂到 LocaleNamespaceMap。
 * 【产品维度】用户敲 / 可弹出命令菜单并执行命令；带选项的命令显示弹出选择面板。
 * 【逻辑维度】1) 注册字典；2) 挂载 CommandUiRuntime（内部注册 '/' 源、监听目录失效）；
 *             3) 注入 slots/commandUi/sessions 作用域，把 PopupSelectView 注册进
 *             conversation.input.overlay（按会话解析控制器）。
 * 【关键边界】覆盖层按会话解析注入；缺少会话作用域时报错。
 * 【新手阅读建议】先读 service.ts 的运行时，再看本文件如何把视图挂到覆盖层槽位。
 * ==========================================================================
 */
/**
 * Command UI plugin, browser half: CommandUiRuntime (`ctx.commandUi`) owning the
 * capability-keyed directory cache, the '/' command source, the client
 * contribution registry, and the per-session popupSelect controllers; the
 * popupSelect shell self-registers into conversation.input.overlay with
 * per-session resolution.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the 'conversation.input.overlay' SlotMap declaration (the
// key's owner) into this program so the overlay registration below typechecks
// against the real declaration — no runtime edge to ui-conversation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { CommandUiRuntime } from './service.ts'
import type { PopupSelectInjected } from './PopupSelectView.tsx'
import { PopupSelectView } from './PopupSelectView.tsx'
import { en, zh, type CommandKey } from './locales.ts'

export { CommandUiRuntime } from './service.ts'
export { CommandDirectory } from './directory.ts'
export type { CommandDescriptor, DirectoryStatus } from './directory.ts'
export { filterOptions, PopupSelectController } from './popup.ts'
export type { PopupSelectDeps, PopupSpec, PopupState, TokenSegment } from './popup.ts'
export type { PopupSelectInjected, PopupSelectViewProps } from './PopupSelectView.tsx'
export type {
  CommandContribution, CommandDecoration, CommandUiContract, CommandUiSpec, SelectConfirmation, SelectOption,
} from './contract.ts'
export type { CommandKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    commandUi: CommandUiRuntime
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The popupSelect shell's copy. */
    command: CommandKey
  }
}

/** Dictionary namespace owned by this plugin. */
// 本插件拥有的字典命名空间名。
const NS = 'command'

/** Required services: the '/' source registry, session scopes, commands Remote, and locale registry. */
// 依赖服务：'/' 输入源注册表、会话作用域、远程网关与命令远程、本地化注册表。
export const inject = ['inputTriggers', 'sessions', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: mount the service, then register the popupSelect shell
 * into the input overlay once its declarer is up.
 * @param ctx - client root context.
 */
// 浏览器侧入口：注册字典、挂载命令运行时、把弹窗选择壳挂到输入覆盖层（按会话解析）。
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-commands: dictionaries')
  ctx.plugin(CommandUiRuntime)
  ctx.inject(['slots', 'commandUi', 'sessions'], (scope: ClientContext) => {
    const command = scope.commandUi
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay',
      id: 'command-popup',
      order: 1,
      locale: NS,
      inject: (sessionId): PopupSelectInjected => {
        const actx = sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`ui-commands: session "${String(sessionId)}" resolved no scope`)
        return { popup: command.popupFor(actx) }
      },
    }, PopupSelectView))
  })
}
