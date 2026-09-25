/** 命令行只呈现 Host 日志结算，不重复执行命令或回显敏感参数。 */
import { useState, type ReactNode } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsRowProps } from './rows.tsx'
import { visibleNode } from './adapter.ts'
import styles from './transcript.module.css'

/**
 * 命令运行、成功和失败来自官方 command 投影，结果全文按需挂载。
 * @param props - 当前命令节点和本地化座席。
 * @returns 命令状态行；隐藏或节点种类变更时为空。
 */
export function CommandRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  const [open, setOpen] = useState(false)
  if (node?.kind !== 'command') return null
  const command = node.data as ChatNode<'command'>['data']
  const text = command.outcome?.text
  return <section className={styles.message} data-qs-command>
    <strong>{command.name ?? t('command.title')}</strong>
    <p>{t(command.outcome === null ? 'command.running' : command.outcome.kind === 'error' ? 'command.failed' : 'command.done')}</p>
    {text === undefined ? null : <>
      <button type="button" className="qs-text-button" aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}>{t('command.expand')}</button>
      {open ? <pre className={styles.detailBody}>{text}</pre> : null}
    </>}
  </section>
}
