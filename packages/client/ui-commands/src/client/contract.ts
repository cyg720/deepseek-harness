/*
 * ================================ 文件注释 ================================
 * 【文件职责】客户端命令表面的冻结契约：只有类型声明，定义"命令贡献"（contribution）、
 *             "命令装饰"（decoration）与 popupSelect 业务规格，供业务包消费。
 * 【技术维度】纯类型契约：CommandUiRuntime 实现 CommandUiContract，业务包只调用
 *             register/decorate；类型驱动跨包协作，无运行时依赖。
 * 【产品维度】第三方/业务包可以注册自己的 / 命令入口，或给宿主命令的"裸调用"挂上
 *             自定义交互（弹出选择面板）。
 * 【逻辑维度】SelectConfirmation/SelectOption 描述弹出面板的选项；CommandUiSpec 定义
 *             popupSelect 行为；CommandContribution 是纯客户端命令；CommandDecoration
 *             只替换宿主命令的裸调用呈现；CommandUiContract 是服务对外接口。
 * 【关键边界】装饰不制造新命令：名字在宿主目录中不存在时装饰永远不会被触发；
 *             贡献与宿主命令重名在候选合成时报错，绝不静默遮蔽。
 * 【新手阅读建议】先读 CommandContribution 与 CommandDecoration 的差异，再看 CommandUiSpec。
 * ==========================================================================
 */
/**
 * Frozen contract of the client command surface. Types only. The
 * CommandUiRuntime (`ctx.commandUi`) implements this face; business packages
 * consume `register` alone.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** Copy for an option that must be acknowledged before onSelect can run. */
// 高风险选项的确认文案：选中此类选项时面板先展示风险说明，勾选确认后才能继续。
export interface SelectConfirmation {
  readonly title: string
  readonly description: string
  readonly acknowledgeLabel: string
  readonly cancelLabel: string
  readonly confirmLabel: string
}

/** One option row of a popupSelect shell. */
// 弹出面板的一行选项：id 用于标识，label/detail 用于展示与过滤，confirmation 为可选风险门。
export interface SelectOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly active?: boolean
  /** Optional in-page risk gate owned by the shared popup shell. */
  readonly confirmation?: SelectConfirmation
}

/**
 * Business registration for the popupSelect command kind. Data is
 * self-served: options/onSelect use the business package's own protocol.
 * The shell component is owned by ui-commands; business never sees it. Both
 * callbacks receive the ClientSessionContext captured at popup open.
 */
// popupSelect 命令的业务规格：选项由业务包自己提供（options/onSelect 使用自己的协议），
// 面板组件归 ui-commands 所有，业务包永远看不到它。
export type CommandUiSpec = {
  readonly kind: 'popupSelect'
  options(session: ClientSessionContext, signal: AbortSignal): Promise<readonly SelectOption[]>
  onSelect(option: SelectOption, session: ClientSessionContext): void | Promise<void>
}

/**
 * One client-owned command contribution: a slash-menu entry whose behavior
 * lives entirely on the client (no host descriptor). Merged with the host
 * catalog by name — a collision with a host command fails loud at candidate
 * synthesis, never shadows.
 */
// 客户端命令贡献：完全在浏览器侧实现行为的斜杠菜单条目（宿主无对应描述符）；
// 与宿主目录按名字合并，重名在候选合成时直接报错而不是遮蔽。
export interface CommandContribution {
  /** Command name without the leading slash (unique across contributions). */
  readonly name: string
  /** Menu row description. */
  readonly description: string
  /** Capability filter, called with a fresh projection per candidate pass. */
  available(session: ClientSessionContext): boolean
  /** The command's UI behavior (this phase: popupSelect only). */
  readonly ui: CommandUiSpec
}

/**
 * A UI decoration hung on one HOST command: what its BARE invocation does on
 * this client. Not a second command — the host command keeps its catalog
 * row, its argument claim (space / argued enter), and its lifecycle logging;
 * the decoration replaces only the bare menu-pick/enter with a popup whose
 * onSelect typically submits a completed line back through command.execute.
 * A decoration never manufactures a row: a name with no host catalog entry
 * in the session's directory simply never reaches the decoration.
 */
// 挂在宿主命令上的 UI 装饰：只替换该命令"裸调用"（无参数回车/菜单直接选中）在本客户端的
// 交互；命令目录行、参数声明与生命周期日志仍归宿主，装饰绝不凭空制造命令。
export interface CommandDecoration {
  /** The HOST command name this decorates (without the leading slash). */
  readonly name: string
  /** Capability filter, called with a fresh projection per bare invocation. */
  available(session: ClientSessionContext): boolean
  /** The bare-invocation UI (this phase: popupSelect only). */
  readonly ui: CommandUiSpec
}

/** The `ctx.commandUi` service face visible to business packages. */
// ctx.commandUi 服务对外可见的接口：业务包通过它注册贡献与装饰、取会话弹窗控制器。
export interface CommandUiContract {
  /**
   * Register one client command contribution; effect disposer. Duplicate
   * names throw at registration.
   */
  register(contribution: CommandContribution): () => void
  /**
   * Hang a bare-invocation decoration on one host command; effect disposer.
   * Duplicate names throw at registration.
   */
  decorate(decoration: CommandDecoration): () => void
  /** Resolve the per-session popup controller for one session scope (wiring/overlay layer). */
  popupFor(actx: ClientContext): unknown
}
