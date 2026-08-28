/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-api-remotes 的 Client 面装配：把各属主包（commands、goal、
 * cordis-host-runner、file-reference 等）生成的远程贡献集（remote 描述符
 * 模块）显式挂载到客户端，并聚合导出客户端所需的全部远程类型词汇。
 * 【技术维度】Cordis 插件的 apply 里逐个调用 ctx.remote.$mount 挂载贡献集，
 * 挂载失败时逆序回滚；类型部分全部为 type-only 再导出，包括载体的客户端
 * 类型、被选命名空间的载荷词汇（payload vocabulary）与 JSON 词汇。
 * 【产品维度】这是"消费者编译面"的单一装配点：业务包只需依赖本包即可
 * 获得可调用的 remote.<ns> 方法与配套类型，无需逐个引入 Host 包或
 * Connection 插件；也避免在客户端重复声明 Host 才有的类型。
 * 【逻辑维度】按出现顺序：贡献集导入 → 远程类型再导出（ClientRemote、
 * 命名空间类型、事件座位、Events 词汇）→ 载体类型再导出（Connection 等）
 * → 载荷 / JSON / 引用发现词汇再导出 → Cordis Context 类型增强 →
 * inject 声明 → apply 挂载逻辑。
 * 【关键边界】被挂载的命名空间由本文件的导入清单显式选择；卸载按挂载
 * 逆序进行，保证后挂的命名空间先拆；类型再导出必须保持 type-only，
 * 载体的运行时值留在其模块边界之后。
 * 【新手阅读建议】先读 apply 理解挂载与回滚，再看各类再导出的分组注释
 * 理解"为什么每个词汇都从这里出口"，最后对照 gateway/client/index.ts
 * 理解 $mount 背后的机制。
 * ==========================================================================
 */
/** Platform-neutral assembly of generated Host Remote contributions. */
// 英文模块注释的中文解释：本文件是"平台无关的生成式 Host 远程贡献装配"，
// 负责在 Client 环境把选定的 Host 能力组装起来。

// 中文：导入各属主包生成的远程贡献集（每个 remote 模块暴露一个描述符贡献
// 对象），以及客户端远程服务的类型。挂载动作发生在下方 apply 中。
import type { Context } from '@deepseek-ai/cordis'
import agentPresetsRemote from '@deepseek-ai/dsh-agent-presets/remote'
import commandsRemote from '@deepseek-ai/dsh-commands/remote'
import settingsControllerRemote from '@deepseek-ai/dsh-api-settings-controller/remote'
import goalsRemote from '@deepseek-ai/dsh-goal/remote'
import llmRemote from '@deepseek-ai/dsh-llm/remote'
import dynamicRemote from '@deepseek-ai/dsh-cordis-host-runner/remote'
import pluginInventoryRemote from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import messageFeedbackRemote from '@deepseek-ai/dsh-message-feedback/remote'
import sessionReferencesRemote from '@deepseek-ai/dsh-session-reference/remote'
import subagentsRemote from '@deepseek-ai/dsh-subagent/remote'
import sessionRemote from '@deepseek-ai/dsh-api-session-controller/remote'
import workspaceRemote from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'

export type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
export type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
export type {} from '@deepseek-ai/dsh-agent-presets/remote'
export type {} from '@deepseek-ai/dsh-commands/remote'
export type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
export type {} from '@deepseek-ai/dsh-goal/remote'
export type {} from '@deepseek-ai/dsh-llm/remote'
export type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
export type {} from '@deepseek-ai/dsh-message-feedback/remote'
export type {} from '@deepseek-ai/dsh-session-reference/remote'
export type {} from '@deepseek-ai/dsh-subagent/remote'
export type * from '@deepseek-ai/dsh-subagent/client'
export type {} from '@deepseek-ai/dsh-api-session-controller/remote'
export type * from '@deepseek-ai/dsh-api-session-controller/types'
export type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
export type * from '@deepseek-ai/dsh-api-workspace-controller/types'
export type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
// 中文：转发事件白名单的选择座位：若消费者编译面缺少它，TypertRemoteEvent
// 会变成 never，所有 $on 调用都会编译失败——这里是它的唯一入口。
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
// 中文：属主包的客户端安全 ./types 导出提供 $on 交给监听器的 Events 签名，
// 消费者读到的是 Host 发出的原始声明，而不是被拍平的重述。
export type {} from '@deepseek-ai/dsh-commands/types'
export type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
export type {} from '@deepseek-ai/dsh-credentials/types'
export type {} from '@deepseek-ai/dsh-llm/types'
export type {} from '@deepseek-ai/dsh-agent-presets/types'
export type {} from '@deepseek-ai/dsh-settings/types'
export type {} from '@deepseek-ai/dsh-user-approval/types'
export type {} from '@deepseek-ai/dsh-user-questions/types'
export type {} from '@deepseek-ai/dsh-api-session-controller/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
// 中文：载体的客户端侧类型再导出：业务包只需命名这一个装配包，而不必同时
// 依赖本门面与 Connection 插件；仅类型导出，载体的运行时值留在其模块边界
// 之后，不被拉进客户端。
export type {
  ConnectionHandle, ConnectionSinks, ContentBlock,
  MessageId,
  RpcError, RpcId, RpcRequest, RpcResponse, RpcResult, SessionId,
  StreamChunk,
} from '@deepseek-ai/dsh-client-connection/client'
// 中文：把网关客户端与 host-runner 远程的类型副作用并入本编译面。
export type {} from '@deepseek-ai/dsh-api-gateway/client'
export type {} from '@deepseek-ai/dsh-cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
// 中文：被选命名空间的载荷词汇再导出：客户端贡献者可以不导入 Host 包就
// 命名自己收发的内容类型——本装配点是两个平面唯一合法的交汇处。
export type {
  ApprovalRequestId,
  CordisHalfState,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectMethodManifest,
  CordisInspectPlatform,
  CordisInspectProviderManifest,
  CordisInspectProviderView,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectQueryResolved,
  CordisInspectRequestId,
  CordisInspectResolveAck,
  CordisRunDiagnostic,
  CordisRunStatus,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunAttempt,
  DynamicCordisRunResponse,
  DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt,
  RequestRunOutcome,
} from '@deepseek-ai/dsh-cordis-host-runner/types'
// The JSON vocabulary those payloads are built from, re-exported for the same
// reason: a Client contribution names what it sends without importing a Host
// package, and this assembly is where both planes legitimately meet.
// 中文：这些载荷所基于的 JSON 词汇再导出，理由同上：客户端贡献者命名发送
// 内容时无需导入 Host 包。
export type { JsonValue } from '@deepseek-ai/dsh-session/types'
// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@deepseek-ai/dsh-settings/types'
// Provider registry and discovery vocabulary for the llm namespace.
export type {
  LlmConfigurableProvider, LlmDiscoveredModel, LlmModelDiscoveryError,
  LlmModelDiscoveryRequest, LlmProviderInfo,
} from '@deepseek-ai/dsh-llm/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
// 中文：引用发现结果词汇再导出，供 fileReferences 与 sessionReferenceResolver
// 命名空间的客户端使用。
export type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
export type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'

/** Failure vocabulary exposed by the assembled Client data layer. */
export type ClientFailure =
  | import('@deepseek-ai/dsh-client-connection/client').RpcError
  | import('@deepseek-ai/dsh-agent-presets/types').AgentPresetError
  | import('@deepseek-ai/dsh-api-session-controller/types').SessionError
  | import('@deepseek-ai/dsh-api-settings-controller/types').CredentialError
  | import('@deepseek-ai/dsh-api-settings-controller/types').SettingsError
  | import('@deepseek-ai/dsh-llm/types').LlmModelDiscoveryError
  | import('@deepseek-ai/dsh-subagent/client').SubagentControlError
  | import('@deepseek-ai/dsh-api-workspace-controller/types').WorkspaceError

/** Success or failure returned by Client operations spanning both API families. */
export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ClientFailure }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
// 中文：本插件依赖的服务：类型化的客户端远程贡献挂载点（remote）。
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
// 中文：插件启动入口：按顺序挂载全部选定的贡献集；任一个挂载失败都会
// 逆序回滚已挂载部分再抛错。返回的注销函数同样按挂载逆序拆卸，保证
// 命名空间不会比"在它之后挂载的命名空间"活得更久。
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = [] // 中文：已挂载贡献集的注销函数列表（用于回滚）
  try {
    for (const contribution of [
      agentPresetsRemote, commandsRemote, settingsControllerRemote, goalsRemote, llmRemote, dynamicRemote,
      pluginInventoryRemote, messageFeedbackRemote, sessionReferencesRemote,
      subagentsRemote, sessionRemote, workspaceRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  // 中文：按挂载逆序拆卸，命名空间不会比"在其后挂载的命名空间"存活更久。
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
