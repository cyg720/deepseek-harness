/** 代码子插件复用公共 CodeBlock，源文件只参与高亮，不作为可执行代码。 */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { DocumentProps } from '../contract.ts'
import { languageForPath } from './languages.ts'
import css from '../preview.module.css'

/** 代码正文及复制按钮文案。 */
export type CodeProps = DocumentProps & PropsLocale<'qs-ui-sidebar-documentpreview'>
/**
 * 以增量高亮呈现同一份累积源码。
 * @param props - 文本、文件地址、换行偏好及正文滚动容器回调。
 * @returns 带行号和复制功能的代码正文。
 */
export function CodeBody({ content, resourceAddress, wrap, scrollportRef, t }: CodeProps) {
  if (content.kind !== 'text') return null
  const file = parseFileAddress(resourceAddress)
  if (file === undefined) throw new Error('Code preview requires a file address')
  return <div className={css.codeRenderer} data-qs-document-code data-wrap={wrap}>
    <CodeBlock className={css.code} contentRef={scrollportRef} code={content.text} lang={languageForPath(file.path)}
      streaming={!content.eof} lineNumbers copyLabel={t('copy')} copiedLabel={t('copied')} />
  </div>
}
/**
 * 对应官方 code 子插件，挂接可独立释放的代码正文。
 * @param ctx - QS 文档子槽注册上下文。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('qs.sidebar.document', () => ctx.slots.register({
    name: 'qs.sidebar.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code', locale: 'qs-ui-sidebar-documentpreview',
  }, CodeBody))
}
