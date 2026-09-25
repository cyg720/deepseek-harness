/** 纯文本子插件只呈现源行，内容通过 React 文本节点输出。 */
import type { Context } from '@deepseek-ai/cordis'
import type { DocumentProps } from '../contract.ts'
import css from '../preview.module.css'

/**
 * 按源文件行号呈现分页文本。
 * @param props - 已读取内容和标签导航。
 * @returns 保留空行的纯文本正文。
 */
export function TextBody({ content, wrap, useTabInfo }: DocumentProps) {
  const { tab } = useTabInfo(), params = tab.navigation.params
  const target = params !== undefined && 'line' in params ? params.line : undefined
  if (content.kind !== 'text') return null
  return <div data-qs-document-text className={css.source} data-wrap={wrap}>
    {content.pages.map(page => <pre key={page.offset}>
      {(page.lines === 0 ? [] : page.text.split('\n')).map((text, index) => <div key={page.offset + index}
        data-document-line={page.offset + index} data-target={target === page.offset + index}>{text}{'\n'}</div>)}
    </pre>)}
  </div>
}
/**
 * 对应官方 text 子插件，撤销时只移除 QS 正文。
 * @param ctx - QS 子槽注册上下文。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('qs.sidebar.document', () => ctx.slots.register({
    name: 'qs.sidebar.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
  }, TextBody))
}
