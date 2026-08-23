/**
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-api-remotes 的 Host 面入口与装配壳：把 Agent/Session 解析
 * 相关函数（agent-lookup.ts）、转发事件白名单（remote-events.ts）及其类型
 * 投影（types.ts）统一导出，并对白名单做编译期"形状门"校验。
 * 【技术维度】聚合导出（re-export）+ 一个 satisfies 断言：通过导入各属主
 * 包的客户端安全 ./types 声明，把真实 Events 词汇引入本编译面，使
 * TypertForwardableEvent 形状断言能校验真实签名而不是空事件词汇表。
 * 【产品维度】作为 Host 侧装配点，业务方只需 import 本入口即可获得远程
 * 组装所需的全部符号；白名单的形状校验把"转发非法事件"从线上提前到编译期。
 * 【逻辑维度】按出现顺序：事件词汇导入（type-only）→ agent-lookup 导出 →
 * 白名单值/类型导出 → 白名单形状门（satisfies 断言）→ 空 apply 插件体。
 * 【关键边界】本文件是 Host 面：实际贡献集的挂载只发生在 Client 环境
 * （见 client/index.ts），apply 是空实现；白名单的增删必须同步满足形状
 * 门的三项约束（事件已声明 / 不绑定 Scope / 单向）。
 * 【新手阅读建议】先看 remote-events.ts 的白名单，再看文件尾部的 satisfies
 * 断言理解三项静态约束，最后对照 client/index.ts 理解 Host 与 Client 分工。
 * ==========================================================================
 */
/** Host BFF entry and Loader shell for the Remote contribution assembly. */
// 英文模块注释的中文解释：本文件是 Host BFF 的入口与"远程贡献装配"的
// Loader 壳：负责聚合导出与白名单的形状校验。

import type { TypertForwardableEvent } from '@deepseek-ai/dsh-typert-protocol'
import { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

// The owner packages' client-safe `./types` exports carry the cordis `Events`
// declarations for every allowlisted event. Pulling them into this face is what
// makes the shape assertion below judge real signatures rather than an empty
// event vocabulary.
// 中文：各属主包的客户端安全 ./types 导出携带了白名单每个事件的 cordis
// Events 声明；把这些声明引入本编译面，形状断言才能用真实签名做判断，
// 而不是对着空的事件词汇表做无意义检查。
import type {} from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-settings/types'

// 中文：聚合导出 agent-lookup.ts 的会话 / Agent 解析能力，供 Host 侧
// 装配与 legacy API 使用。
export {
  ApiRemoteSessionNotFound,
  ApiRemoteSubagentSessionOwnership,
  apiRemoteSubagentOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  inspectApiRemoteSession,
} from './agent-lookup.ts'
export type {
  ApiRemoteAgentOptions,
  ApiRemoteAgentResult,
  ApiRemoteLookupError,
} from './agent-lookup.ts'
// 中文：转发白名单的值与类型投影的再导出，让消费方从本入口一并取到。
export { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'
export type { ApiRemoteForwardedEvent } from './types.ts'

// Shape gate over the allowlist, kept in the Host face because the Host's event
// vocabulary is the authoritative one. It pins three things at compile time:
// every entry NAMES a declared event (the predicate is keyed on `keyof
// Events`), no entry BINDS a Scope (a scoped event's `ThisParameterType` is not
// `unknown`, which is how "must not depend on AgentScope" is stated statically),
// and every entry is ONE-WAY (a waterfall or bail shape returns something other
// than void and is excluded). Widening the array to an event that fails any of
// these fails here, not on the wire.
// 中文：白名单的形状门检查，放在 Host 面是因为 Host 的事件词汇表才是权威。
// 它在编译期钉住三件事：每个条目必须命名一个已声明事件（谓词以 keyof
// Events 为键）；不能绑定 Scope（scoped 事件的 ThisParameterType 不是
// unknown，这正是"不得依赖 AgentScope"的静态表述）；必须单向（waterfall
// 或 bail 形状返回非 void 而被排除）。若把数组扩到违反任一约束的事件，
// 会在编译期失败，而不是等它上线才暴露。
API_REMOTE_FORWARDED_EVENTS satisfies readonly TypertForwardableEvent[]

/** Host plugin body; the selected contributions mount only in Client environments. */
// 中文：Host 插件体（空实现）：被选中的贡献集只会在 Client 环境中挂载，
// Host 面无需安装任何远程方法。
export function apply(): void {}
