/**
 * 文件职责：为不能接受人工输入的子代理会话渲染只读输入区替代组件。
 * 技术维度：使用 React TSX、插槽属性类型、判别联合原因和 CSS Module。
 * 产品维度：向用户解释一次性子代理或父会话不可用时为何不能继续发送消息。
 * 逻辑维度：根据 matched.reason 计算 oneShot，再选择对应标题和正文翻译键。
 * 关键边界：只接受 one-shot 与 parent-unavailable 两种原因；组件不提供任何输入控件。
 * 新手阅读建议：先看 Match 的两个原因，再跟踪 oneShot 如何决定两组本地化文案。
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './SubagentReadOnlyComposer.module.css'

/** Why a catalog-addressed conversation cannot accept human input. */
/* 说明目录寻址的子会话为何不能接收人工输入。 */
export interface SubagentReadOnlyMatch {
  // 只读原因；one-shot 表示一次性执行，parent-unavailable 表示父会话不可继续访问。
  reason: 'one-shot' | 'parent-unavailable'
}

/** Full chain props after the read-only subagent selector accepts the owner currency. */
/* 选择器命中只读子代理后传给组件的完整插槽、匹配结果和本地化属性。 */
export type SubagentReadOnlyComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: SubagentReadOnlyMatch } & PropsLocale<typeof NS>

/**
 * Explain why the normal composer is unavailable for an addressed child.
 * @param props - selector-owned read-only reason plus standard slot props.
 * @returns A read-only composer replacement.
 */
/*
 * 渲染只读输入区说明。
 * @param matched 选择器提供的只读原因。
 * @param t 当前命名空间的翻译函数。
 * @returns 替代普通输入框的状态提示元素。
 * @example <SubagentReadOnlyComposer matched={{ reason: 'one-shot' }} t={t} />。
 */
export function SubagentReadOnlyComposer({
  matched, t,
}: Pick<SubagentReadOnlyComposerProps, 'matched' | 't'>) {
  // 是否为一次性子代理；false 时表示父会话不可用。
  const oneShot = matched.reason === 'one-shot'
  return (
    <div className={css.frame} role="status">
      <strong>{t(oneShot ? 'readonly.oneShot.title' : 'readonly.title')}</strong>
      <span>
        {t(oneShot ? 'readonly.oneShot.body' : 'readonly.body')}
      </span>
    </div>
  )
}
