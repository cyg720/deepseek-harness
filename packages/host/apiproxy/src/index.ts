/*
 * ================================ 文件注释 ================================
 * 【文件职责】apiproxy 包的入口（barrel + 网关插件装配）：导出契约层（api/）、
 * fetch 载体对（fetch/）与宿主实现（api-proxy.ts），并注册 ApiProxyService 网关
 * 插件，把宿主能力以 `ctx.apiProxy` 服务的形式提供给整个 Cordis 应用。
 * 【技术维度】Cordis Service 插件：通过声明式依赖注入（static inject）装配所需
 * 服务，用 schemastery 定义 Config，构造时调用 createApiProxy 工厂并在成员上
 * 逐一绑定各域实现。导出声明合并把 apiProxy 注入 Context 类型。
 * 【产品维度】这是远程客户端访问宿主能力的统一网关入口：任何物理载体（HTTP、
 * WebSocket、进程内）都基于 `ctx.apiProxy` 组装，实现"传输无关"的网关设计。
 * 【逻辑维度】重导出 api/ 契约与 fetch/ 载体工具 → 声明 Context.apiProxy 类型 →
 * 定义 Config（原生打开、压缩级别、冷探测上限）→ ApiProxyService 类装配实现。
 * 【关键边界】本包不注册任何物理路由（路由由各物理载体自己实现）；模型默认值
 * 依赖 ctx.agentDefaultModel 服务，切换模型经该服务持久化，已记录选择的会话不受影响。
 * 【新手阅读建议】从本文件了解包的对外形状，再读 api/rpc.ts（消息模型）与
 * api-proxy.ts（实现），最后读 fetch/handler.ts 与 fetch/client.ts（载体）。
 * ==========================================================================
 */
/**
 * @deepseek-ai/dsh-host-apiproxy — the API gateway every client shape shares:
 * the ApiProxy contract (api/: types + zod schemas, browser-safe), the fetch
 * carrier pair (fetch/: toFetchHandler on the host side, AbstractApiClient +
 * platform subclasses on the client side), and the host-side implementation
 * (api-proxy.ts: createApiProxy + the ApiProxyService gateway plugin providing
 * `ctx.apiProxy`). Transport-agnostic by design: this package registers no
 * routes — physical carriers wrap `ctx.apiProxy` themselves.
 *
 * The gateway consumes `ctx.agentDefaultModel`, the transport-independent default
 * shared with direct entry points. Switching models persists through that
 * service; sessions that have already logged a selection remain unchanged.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { ApiProxy } from './api/index.ts'
import { createApiProxy, DEFAULT_COLD_BLANK_PROBE_MAX_BYTES } from './api-proxy.ts'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  type SessionLogCompressionLevel,
} from './session-export.ts'

export type * from './api/index.ts'
export { RpcId } from './api/rpc.ts'
export { toFetchHandler } from './fetch/handler.ts'
export { AbstractApiClient, InProcessApiClient } from './fetch/client.ts'
export type { IApiClient } from './fetch/client.ts'
export { createApiProxy } from './api-proxy.ts'
export type { ApiProxyDefaults } from './api-proxy.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host-side ApiProxy implementation (the transport-agnostic gateway face). */
    apiProxy: ApiProxy
  }
}

/** Gateway plugin configuration. */
// 网关插件配置：nativeOpen 显式覆盖平台探测（如容器内无可见显示器）；
// sessionExportCompressionLevel 控制日志 ZIP 压缩级别（0 不压缩、9 最小体积）；
// coldBlankProbeMaxBytes 限制冷会话空白探测的工件大小（0 禁用探测）。
export interface Config {
  /**
   * Whether this deployment can hand paths to a native desktop opener —
   * the `hasDocument` capability the agent-preset roster reports. Absent,
   * the platform is asked (macOS/Windows/WSL yes; Linux only with a display
   * server); set it explicitly where detection misleads, e.g. `false` in a
   * container whose DISPLAY points nowhere a user can see.
   */
  nativeOpen?: boolean
  /**
   * DEFLATE level for every session-log ZIP entry: `0` stores without
   * compression, `1` favors CPU/latency, and `9` favors archive size.
   * @default 6
   */
  sessionExportCompressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /**
   * Maximum physical size of a cold Session artifact eligible for blankness
   * verification. Zero disables probes.
   * @default 1024
   */
  coldBlankProbeMaxBytes?: number
}

/**
 * The API gateway service: implements the ApiProxy contract over the composed
 * host context and provides it as `ctx.apiProxy`. The Host cwd is the default
 * project directory.
 */
// 网关服务插件：在装配好的宿主 Context 上实现 ApiProxy 契约并作为
// ctx.apiProxy 提供服务。构造时用 createApiProxy 工厂生成实现，把各域成员
// 绑定到实例（respond 因工厂返回闭包而需要 bind）。
export class ApiProxyService extends Service implements ApiProxy {
  // 声明式注入列表：网关实现依赖的宿主服务，由 Cordis 在插件启动前装配。
  static inject = [
    'agentDefaultModel', 'agents', 'attachments', 'directoryPicker', 'llm', 'sessions', 'subagents', 'sessionQuery',
    'tools', 'userQuestions', 'workspaceRegistry',
  ]

  // schemastery 配置 schema：三个可选字段，分别提供默认值（压缩级别 6、探测上限 1024）。
  static Config: z<Config> = z.object({
    nativeOpen: z.boolean(),
    sessionExportCompressionLevel: z.number().step(1).min(0).max(9)
      .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL) as z<SessionLogCompressionLevel>,
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
  })

  // 各域实现成员：类型均取自 ApiProxy 契约，构造时从工厂实现绑定到实例。
  readonly sessions: ApiProxy['sessions']
  readonly subagents: ApiProxy['subagents']
  readonly workspace: ApiProxy['workspace']
  readonly host: ApiProxy['host']
  readonly goals: ApiProxy['goals']
  readonly skills: ApiProxy['skills']
  readonly agentPresets: ApiProxy['agentPresets']
  readonly settings: ApiProxy['settings']
  readonly credentials: ApiProxy['credentials']
  readonly llm: ApiProxy['llm']
  readonly events: ApiProxy['events']
  readonly downloads: ApiProxy['downloads']
  readonly respond: ApiProxy['respond']

  constructor(ctx: Context, config: Config) {
    super(ctx, 'apiProxy')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      saveDefaultModelSelection: selection => ctx.agentDefaultModel.saveSelection(selection),
      cwd: process.cwd(),
      ...config.nativeOpen === undefined ? {} : { canOpenPath: () => config.nativeOpen as boolean },
      ...(config.sessionExportCompressionLevel === undefined
        ? {}
        : { sessionExportCompressionLevel: config.sessionExportCompressionLevel }),
      ...(config.coldBlankProbeMaxBytes === undefined
        ? {}
        : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }),
    })
    this.sessions = api.sessions
    this.subagents = api.subagents
    this.workspace = api.workspace
    this.host = api.host
    this.goals = api.goals
    this.skills = api.skills
    this.agentPresets = api.agentPresets
    this.settings = api.settings
    this.credentials = api.credentials
    this.llm = api.llm
    this.events = api.events
    this.downloads = api.downloads
    // createApiProxy returns closures (no `this` capture), so the bind is
    // behavior-neutral.
    this.respond = api.respond.bind(api)
  }
}

export default ApiProxyService
