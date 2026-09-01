/** Platform-neutral assembly of generated Host Remote contributions. */

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
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
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
export type {
  ConnectionHandle, ConnectionSinks, ContentBlock,
  MessageId,
  RpcId, RpcRequest, RpcResponse, RpcResult, SessionId,
  StreamChunk,
} from '@deepseek-ai/dsh-client-connection/client'
export type {} from '@deepseek-ai/dsh-api-gateway/client'
export type {} from '@deepseek-ai/dsh-cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
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
// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@deepseek-ai/dsh-settings/types'
// Provider registry and discovery vocabulary for the llm namespace.
export type {
  LlmConfigurableProvider, LlmDiscoveredModel,
  LlmModelDiscoveryRequest, LlmProviderInfo,
} from '@deepseek-ai/dsh-llm/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
export type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
export type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'

// The Remote failure vocabulary, re-exported so business packages keep naming
// this assembly alone. Types only: a value export would make spec imports load
// this module's owner /remote artifacts; specs take RemoteError from
// dsh-client-test-runtime instead.
export type {
  RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteResult,
} from '@deepseek-ai/dsh-typert-protocol'
export type { RemoteHostFacts } from '@deepseek-ai/dsh-api-gateway/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
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
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
