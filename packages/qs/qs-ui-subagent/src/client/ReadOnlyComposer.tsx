/** 子代理只读输入提示；运行中可续聊子会话交还普通输入的停止动作。 */
import type { ReactNode } from 'react'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReadOnlyMatch, ReadOnlyProps } from './contract.ts'
import css from './Subagent.module.css'

/**
 * 对应官方 ui-subagent 的接管条件，不复制会话执行权限。
 * @param owner - 官方会话快照。
 * @returns 只读原因；无需接管时返回 null。
 */
export function selectReadOnly(owner: ComposerChainProps): ReadOnlyMatch | null {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (subagent.parentAvailable !== false || owner.session?.running === true) return null
  return { reason: 'parent-unavailable' }
}

/**
 * 呈现确定的只读原因，不拦截 Host 的输入权限校验。
 * @param props - 选举结果及语言。
 * @returns 可由辅助技术读取的只读提示。
 */
export function ReadOnlyComposer({ matched, t }: Pick<ReadOnlyProps, 'matched' | 't'>): ReactNode {
  return <div className={css.readOnly} role="status" data-qs-subagent-readonly>
    <strong>{t('readonly')}</strong>
    <p>{t(matched.reason)}</p>
  </div>
}
