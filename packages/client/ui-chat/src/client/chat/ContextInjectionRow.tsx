/**
 * 文件职责：实现会话聊天界面的 ContextInjectionRow 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DisclosureRow, IconContextInjectionOutline16, ReferenceIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMessageNode } from '../contract/snapshot.ts'
import { contextBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
/* 中文说明：类型或类 ContextInjectionRowProps 约束本文件的数据或组件职责。 */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  provenance: ContextMessageNode['provenance']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
/* 中文说明：函数 ContextInjectionRow 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function ContextInjectionRow({ content, source, provenance, form, t }: ContextInjectionRowProps) {
  /** 中文说明：当前组件的局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  /** 中文说明：当前组件的局部值 { rendered, summary, body }，由紧邻初始化决定。 */
  const { rendered, summary, body } = contextBody(form, { content, source, t })

  return (
    <DisclosureRow
      className={css.root}
      icon={provenance.role === 'recall'
        ? <span data-context-recall-icon><ReferenceIcon kind="session" /></span>
        : <IconContextInjectionOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t(provenance.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
      collapsedContent={provenance.label === null ? undefined : (
        /* ToolRow's separator shape: an aria-hidden dot, so the accessible name
           stays the two readable parts and the two disclosure rows expose one
           name shape. A source that names no producer drops the dot with it. */
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.source} data-context-source>{provenance.label}</span>
          {summary !== null && (
            <>
              <span className={css.sep} aria-hidden />
              <span className={css.summary} data-context-summary>{summary}</span>
            </>
          )}
        </>
      )}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-context-injection-body data-context-form={rendered ?? undefined}>
        {body}
      </div>
    </DisclosureRow>
  )
}
