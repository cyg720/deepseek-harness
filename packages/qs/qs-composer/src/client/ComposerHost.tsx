/** 输入宿主只负责选举；业务插件拥有只读原因，普通输入仍绑定官方输入机。 */
import type { ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsComposerProps } from './contract.ts'
import { Composer } from './Composer.tsx'

/** 普通输入座席加上独立业务接管槽。 */
export type QsComposerHostProps = QsComposerProps & PropsRenderSlots<'qs.composer.takeover'>

/**
 * 使用官方会话与待回答快照选举输入呈现，接管时卸载普通编辑器及其命令租约。
 * @param props - 输入动作、会话快照与子槽渲染座席。
 * @returns 被选中的业务输入，或普通输入回退。
 */
export function ComposerHost(props: QsComposerHostProps): ReactNode {
  const { sessionId, useSession, useSessionPendingInteraction, renderSlotChain } = props
  const session = useSession(value => value)
  const pendingInteraction = useSessionPendingInteraction(map => sessionId === undefined ? undefined : map.get(sessionId))
  return renderSlotChain('qs.composer.takeover', { sessionId, session, pendingInteraction }, {
    fallback: <Composer {...props} />,
    fallbackOnly: sessionId === undefined,
  })
}
