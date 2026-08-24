// ApprovalPanel: the composer-takeover approval prompt (designer draft
// approval.png), registered as a selector-routed entry of the
// conversation-declared composer chain. While an approval question is
// pending, this panel occupies the composer slot in place of the InputBar:
// an amber "Waiting for approval" strip on the card top, the model's
// justification as the headline, the paired command in muted code text, and
// a right-aligned refuse/allow action row. Justification and command are
// unbounded model text, so they scroll inside the card at the shared composer
// cap (`data-approval-scroll`) and the action row stays outside it — the
// buttons must be reachable no matter how long the command is.
// One-shot: the buttons disable
// after a click and the panel leaves (the InputBar returns) on the broadcast
// resolved frame.
/**
 * 文件职责：实现会话骨架中的 ApprovalPanel 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式状态和 CSS Modules。
 * 产品维度：支持用户查看和操作会话骨架。
 * 逻辑维度：读取属性与服务，派生显示状态，处理事件并渲染界面。
 * 关键边界：空状态、禁用状态、异步取消和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { PendingApproval, type ApprovalComposerProps } from '../contract/slots.ts'
import { rootToolCall } from '../chat/tool-node-reader.ts'
import css from './ApprovalPanel.module.css'

/** Extract the shell command from an approval's paired running call (bash-family args carry `command`); undefined hides the line. */
/** 中文说明：函数 commandOf 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function commandOf(call: RunningToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    /** 中文说明：组件局部值 args，取值由紧邻初始化决定。 */
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    // Unparseable model args: the panel still renders, just without the command line.
    return undefined
  }
}

/**
 * Composer takeover boundary: mints the domain face on the carrier's stable
 * identity and remounts the flow per request key, so the one-shot answered
 * latch never leaks to the next pending approval.
 * @param props - the selector-matched pending approval carrier plus the framework standard kit.
 * @returns The approval prompt for this request.
 */
/** 中文说明：函数 ApprovalPanel 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  /** 中文说明：组件局部值 approval，取值由紧邻初始化决定。 */
  const approval = useMemo(() => new PendingApproval(props.matched), [props.matched])
  /** 中文说明：组件局部值 command，取值由紧邻初始化决定。 */
  const command = props.useSession((snapshot) => {
    if (approval.callId === undefined) return undefined
    /** 中文说明：组件局部值 root，取值由紧邻初始化决定。 */
    const root = rootToolCall(snapshot, approval.callId)
    if (root === undefined) return undefined
    return root.callId === approval.callId && !('kind' in root) ? commandOf(root) : undefined
  })
  return <ApprovalFlow key={approval.key} pending={approval} t={props.t} {...command === undefined ? {} : { command }} />
}

/** 中文说明：函数 ApprovalFlow 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function ApprovalFlow({ pending, command, t }: {
  pending: PendingApproval
  command?: string
  t: ApprovalComposerProps['t']
}) {
  // Local one-shot latch: the panel leaves only when the resolved frame
  // lands; until then the buttons must not re-fire. An answer failure
  // (rejected receipt / transport) re-arms them for retry.
  /** 中文说明：组件局部值 [answered, setAnswered]，取值由紧邻初始化决定。 */
  const [answered, setAnswered] = useState(false)
  /** 中文说明：组件局部值 answer，取值由紧邻初始化决定。 */
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setAnswered(true)
    void pending.answer(outcome).catch(() => { setAnswered(false) })
  }
  return (
    <div className={css.root} data-approval-key={pending.key}>
      <div className={css.card}>
        <div className={css.strip}><span className={css.dot} />{t('approval.waiting')}</div>
        {/* Tab stop: the region scrolls once the command passes the cap and
            holds nothing focusable of its own, so without one a keyboard-only
            user cannot reach the command's tail before answering. */}
        <div className={css.body} data-approval-scroll="" tabIndex={0} role="group" aria-label={t('approval.detail.aria')}>
          <div className={css.headline}>{pending.reason ?? t('approval.escalation', { toolName: pending.toolName })}</div>
          {command !== undefined && <div className={css.command}>{command}</div>}
        </div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.reject} disabled={answered} onClick={() => { answer('rejected') }}>
            {t('approval.reject')}
          </Button>
          <Button variant="primary" disabled={answered} onClick={() => { answer('allowed-once') }}>
            {t('approval.allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}
