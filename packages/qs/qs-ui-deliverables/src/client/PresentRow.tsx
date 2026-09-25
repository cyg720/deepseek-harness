/** present 工具卡显示持久调用状态；文件声明由官方投影在轮次尾部展示。 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-ui-tool/client'
import css from './deliverables.module.css'
/** 工具卡仅消费原始调用，不执行交付或打开操作。 */
export type PresentProps = PropsRuntime<'qs.tool.call.toolview'> & PropsLocale<'qs-ui-deliverables'>
/**
 * 保留运行、失败、中断与原始结果，避免将参数误报为成功交付。
 * @param props - 持久工具调用和本地化字典。
 * @returns 可展开工具卡。
 */
export function PresentRow({ block, t }: PresentProps) {
  const settled = 'kind' in block
  const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'failed' : 'ok'
  const args = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const output = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  return <div className={css.root} data-qs-present data-state={state}>
    <span>{t('presented')} · {t(state)}</span>
    <details><summary>{t('details')}</summary><pre>{args}</pre><pre>{output}</pre>
      {settled && block.error !== undefined && <pre>{block.error.name}: {block.error.code}</pre>}
    </details>
  </div>
}
