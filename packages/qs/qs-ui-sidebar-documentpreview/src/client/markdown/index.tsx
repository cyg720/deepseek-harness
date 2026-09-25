/** Markdown 子插件复用公共安全渲染器；分页前缀作为同一文档持续解析。 */
import { useMemo } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentProps } from '../contract.ts'
import css from '../preview.module.css'

/** Markdown 文档正文与本地化公共组件文案。 */
export type MarkdownProps = DocumentProps & PropsLocale<'qs-ui-sidebar-documentpreview'>
/**
 * 渲染累积文本，直到 EOF 才完成整篇解析。
 * @param props - 已读取内容及本地化文案。
 * @returns 公共 Markdown 组件；字节读取结果不作为文本解释。
 */
export function MarkdownBody({ content, t }: MarkdownProps) {
  const copyLabel = t('copy'), copiedLabel = t('copied'), footnotes = t('footnotes')
  const labels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  if (content.kind !== 'text') return null
  return <div className={css.markdown} data-qs-document-markdown>
    <MarkdownText text={content.text} streaming={!content.eof} labels={labels} />
  </div>
}
/**
 * 对应官方 Markdown 子插件，只替换正文，不重复注册渲染元数据。
 * @param ctx - QS 文档子槽注册上下文。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('qs.sidebar.document', () => ctx.slots.register({
    name: 'qs.sidebar.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown', locale: 'qs-ui-sidebar-documentpreview',
  }, MarkdownBody))
}
