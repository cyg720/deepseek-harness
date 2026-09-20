/**
 * 奇术工作台的槽位契约与跨包共享类型。
 *
 * 这是七个 qs-* 包之间唯一的类型通道：其它包通过
 * `import type {} from '@deepseek-ai/dsh-qs-shell/client'` 引入这里的 SlotMap 增补，
 * 再按槽名贡献或读取。运行时值一律不跨界（bundle 纯净度门禁不放行）。
 *
 * 声明权归属（见 06-槽位与状态设计 第二节）：`qs.*` 顶层槽全部由 qs-shell 声明，
 * 其中 `qs.stage.body` / `qs.stage.transcript` / `qs.composer` 声明在 qs-shell 自己的
 * `qs.stage` 条目下，因此渲染宿主是 Stage 组件本身而不是 root。
 * `qs.stage.transcript.row`（keyed）与 `qs.stage.interaction`（chain）由 qs-transcript
 * 声明并登记在它自己的契约文件里——框架里 inject face 归声明方所有，所以这两个槽的
 * inject 面只能由真正拥有它们的包提供。
 */
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 登录视图挂载点；由 qs-login 贡献，未登录时渲染。 */
    'qs.gate': { kind: 'single'; scope: 'root'; owner: QsGateOwnerProps }
    /** 顶栏：品牌、面板开关、状态入口；由 qs-shell 贡献。 */
    'qs.chrome': { kind: 'single'; scope: 'root'; owner: QsChromeOwnerProps }
    /** 左导航：会话列表容器；由 qs-sessions 贡献。 */
    'qs.nav': { kind: 'single'; scope: 'root'; owner: QsNavOwnerProps }
    /** 主区外框；由 qs-shell 贡献并声明其下的欢迎区、转写与输入区。 */
    'qs.stage': { kind: 'single'; scope: 'root'; owner: QsStageOwnerProps }
    /** 欢迎区与骨架；无会话时也渲染（session-maybe）。 */
    'qs.stage.body': { kind: 'single'; scope: 'session-maybe'; owner: QsStageBodyOwnerProps }
    /** 转写行；严格会话作用域，无绑定不得渲染。由 qs-transcript 贡献。 */
    'qs.stage.transcript': { kind: 'single'; scope: 'session'; owner: QsTranscriptOwnerProps }
    /** 输入区；无会话时也渲染，此时 inputActions 为 undefined。由 qs-composer 贡献。 */
    'qs.composer': { kind: 'single'; scope: 'session-maybe'; owner: QsComposerOwnerProps }
    /** 右栏：工作区辅助面板骨架与空态；由 qs-shell 贡献。 */
    'qs.inspector': { kind: 'single'; scope: 'root'; owner: QsInspectorOwnerProps }
    /** 底部状态条；连接态与同步态，按 id 并列。 */
    'qs.status': { kind: 'list'; scope: 'root'; owner: QsStatusOwnerProps }
    /** toast / dialog 宿主，也是 portal 目标；按 id 并列。 */
    'qs.overlay': { kind: 'list'; scope: 'root'; owner: QsOverlayOwnerProps }
  }

  interface LocaleNamespaceMap {
    'qs-shell': QsShellLocaleKey
  }

  /**
   * 静态登录座席。
   *
   * 该座席由 qs-login 经 provideRoot 发布，因此**只有 qs-login 装配时才存在**：
   * 声明为可选成员，既让 qs-shell 能显式渲染登录组件未加载故障面，也避免给
   * 官方组件的 props 增加必填项（框架级接口加必填成员会破坏所有官方组件与测试）。
   *
   * 工作台自己的座席（主题）不进这里：它只被 root  occupant 使用，走该条目自己的
   * inject face 更精确，也不污染共享接口。
   */
  interface GlobalStandardProps {
    /** 静态登录状态；qs-login 未装配时为 undefined。 */
    useQsAuth?: UseQsAuth | undefined
  }
}

/** 登录视图业主输入（无字段：登录页自持状态与副本）。 */
export interface QsGateOwnerProps { children?: never }
/** 顶栏业主输入。 */
export interface QsChromeOwnerProps { children?: never }
/** 左导航业主输入。 */
export interface QsNavOwnerProps { children?: never }
/** 主区外框业主输入。 */
export interface QsStageOwnerProps { children?: never }
/** 欢迎区业主输入。 */
export interface QsStageBodyOwnerProps { children?: never }
/** 转写业主输入。 */
export interface QsTranscriptOwnerProps { children?: never }
/** 输入区业主输入。 */
export interface QsComposerOwnerProps { children?: never }
/** 右栏业主输入。 */
export interface QsInspectorOwnerProps { children?: never }
/** 底部状态条业主输入。 */
export interface QsStatusOwnerProps { children?: never }
/** overlay 宿主业主输入。 */
export interface QsOverlayOwnerProps { children?: never }

/** `root` 条目的 inject face：工作台自己的根级事实，只服务 root occupant。 */
export interface QsShellRootInjected {
  readonly hooks: {
    /** 主题明暗档源，框架绑成 `useQsTheme`。 */
    readonly qsTheme: HostObservable<QsThemeSnapshot>
  }
}

/** `qs.chrome` 的 inject face：顶栏需要触发的跨包动作与界面切换状态。 */
export interface QsChromeInjected {
  readonly hooks: {
    /** 界面切换控制器状态源，框架绑成 `useQsUiMode`。 */
    readonly qsUiMode: HostObservable<QsUiModeSnapshot>
  }
  /** 登出：经可选读取 qsAuth 服务，缺失时什么都不做。 */
  readonly signOut: () => void
  /** 请求切到官方界面；部署未开启入口时控制器自身会拒绝。 */
  readonly switchToOfficial: () => void
}

/** `qs.status` 的 inject face：底部状态条的连接态来源。 */
export interface QsStatusInjected {
  readonly hooks: {
    /** 连接恢复生命周期源，框架绑成 `useQsConnection`。 */
    readonly qsConnection: HostObservable<QsConnectionSnapshot>
  }
  /** 手动重连：重置退避并立刻重试当前连接。 */
  readonly reconnect: () => void
}

/** `qs.overlay` 的 inject face：toast 宿主。 */
export interface QsOverlayInjected {
  readonly hooks: {
    /** 当前 toast 源，框架绑成 `useQsToasts`。 */
    readonly qsToasts: HostObservable<readonly QsToast[]>
  }
}

/** qs-shell 的本地化键（与 locales.ts 的 zh 字典同构）。 */
export type QsShellLocaleKey =
  | 'nav.agents'
  | 'nav.plugins'
  | 'nav.rag'
  | 'nav.skills'
  | 'nav.apps'
  | 'nav.terminals'
  | 'nav.empty'
  | 'nav.back'
  | 'inspector.workspace'
  | 'inspector.todos'
  | 'inspector.calendar'
  | 'brand.name'
  | 'brand.tagline'
  | 'platform.label'
  | 'nav.expand'
  | 'nav.resize'
  | 'inspector.resize'
  | 'nav.collapse'
  | 'inspector.expand'
  | 'inspector.collapse'
  | 'inspector.title'
  | 'inspector.empty'
  | 'inspector.isolation'
  | 'inspector.localOnly'
  | 'inspector.placeholder'
  | 'user.signOut'
  | 'welcome.eyebrow'
  | 'welcome.title'
  | 'welcome.lead'
  | 'welcome.tip'
  | 'stage.aiNotice'
  | 'stage.demoOnly'
  | 'stage.newSession'
  | 'fault.title'
  | 'fault.lead'
  | 'fault.retry'
  | 'fault.reload'
  | 'fault.detail'
  | 'fault.loginMissing.title'
  | 'fault.loginMissing.lead'
  | 'switch.toOfficial'
  | 'switch.toWorkbench'
  | 'switch.disabled'
  | 'switch.frozen'
  | 'switch.failed'
  | 'status.connected'
  | 'status.connecting'
  | 'status.disconnected'
  | 'status.loopback'
  | 'status.reconnect'
  | 'overlay.region'

/** 启动界面选择：奇术工作台或官方界面。 */
export type QsUiId = 'workbench' | 'official'

/** qs-shell 的部署级配置（宿主侧解析后经 index-inject 传给浏览器）。 */
export interface QsShellConfig {
  /** 本次启动的初始界面；默认 `workbench`。 */
  defaultUi: QsUiId
  /** 是否启用开发者双向切换入口与动作；默认 false。 */
  showOfficialUiEntry: boolean
}

/** 切换控制器快照。 */
export interface QsUiModeSnapshot {
  /** 当前显示的界面。 */
  readonly ui: QsUiId
  /** 部署是否开放开发者切换入口。 */
  readonly showOfficialUiEntry: boolean
  /** 本地冻结操作进行中时的原因键；无冻结时为 undefined。 */
  readonly freeze?: string
  /** 最近一次切换失败的原因键；成功后清空。 */
  readonly error?: string
}

/**
 * 开发者界面切换控制器。
 *
 * 生命周期独立于奇术 root 的视图注册：切到官方界面时只释放奇术 root 与子槽注册，
 * 控制器与其状态、以及官方插件的加载都保持不变（见 10-界面切换与回退配置 第三节）。
 */
export interface IQsUiMode extends HostObservable<QsUiModeSnapshot> {
  /**
   * 请求切换到目标界面。
   * @param target - 目标界面。
   */
  switchTo(target: QsUiId): void
  /**
   * 记录或清除本地冻结原因；冻结期间切换动作被拒绝。
   * @param reason - 本地化键，undefined 表示解除冻结。
   */
  setLocalFreeze(reason: string | undefined): void
}

/** 连接态快照：只取状态条要显示的部分。 */
export interface QsConnectionSnapshot {
  /** 连接状态；undefined 表示首次结果尚未产生。 */
  readonly state: 'connected' | 'disconnected' | 'connecting' | undefined
  /** 当前是否连到回环地址（本机部署）。 */
  readonly loopback: boolean
}

/** 一条 toast。 */
export interface QsToast {
  /** 单调递增 id，用于 React key 与去重。 */
  readonly id: number
  /** 已本地化的正文。 */
  readonly message: string
}

/** 工作台主题快照：只取令牌需要的明暗档。 */
export interface QsThemeSnapshot {
  readonly scheme: 'light' | 'dark'
}

/** 工作台主题选择器座席。 */
export type UseQsTheme = SnapshotSelectorHook<QsThemeSnapshot>
/** 界面切换状态选择器座席。 */
export type UseQsUiMode = SnapshotSelectorHook<QsUiModeSnapshot>

/** 静态登录状态快照（由 qs-login 发布）。 */
export interface QsAuthSnapshot {
  readonly authenticated: boolean
  /** 已登录用户名；未登录时缺省。 */
  readonly user?: string
}

/** 登录状态选择器座席。 */
export type UseQsAuth = SnapshotSelectorHook<QsAuthSnapshot>

/**
 * 静态登录状态与动作。**不是安全边界**：`/api` 没有用户级鉴权，
 * 该状态只用于选择首屏界面。
 */
export interface IQsAuth extends HostObservable<QsAuthSnapshot> {
  /**
   * 提交登录。
   * @param credentials - 用户名与密码（密码不落盘、不记录）。
   * @returns 登录完成；失败时 reject 业务错误。
   */
  signIn(credentials: { readonly username: string; readonly password: string }): Promise<void>
  /** 登出并清空登录态。 */
  signOut(): void
}
