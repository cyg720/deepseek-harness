/** 子代理呈现共享官方 Session 数据，目录只拥有展开状态。 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-subagent': keyof typeof import('./locales.ts').zh }
}

/** 地址由官方目录提供，导航不得从摘要臆造子会话模式。 */
export interface CatalogActions {
  /** @param address - 官方目录确认的完整子会话地址。 */
  readonly openChild: (address: SubagentAddress) => void
  /** @param id - 已知祖先会话标识。 */
  readonly openParent: (id: SessionId) => void
  /** @param id - 要刷新的目录所有者。 */
  readonly refresh: (id: SessionId) => void
  /** @param id - 目录所有者。 @param open - 是否需要持续观察目录变化。 */
  readonly setCatalogOpen: (id: SessionId, open: boolean) => void
}

/** 标题贡献携带标准会话列表订阅和地址化动作。 */
export type CatalogProps = PropsRuntime<'qs.stage.header.actions'> & CatalogActions & PropsLocale<'qs-ui-subagent'>

/** 接管原因不以目录尚未到达推断离线。 */
export interface ReadOnlyMatch { readonly reason: 'one-shot' | 'parent-unavailable' }

/** 链选举只读呈现使用的语言与匹配原因。 */
export type ReadOnlyProps = PropsRuntime<'qs.composer.takeover'> & { matched: ReadOnlyMatch } & PropsLocale<'qs-ui-subagent'>
