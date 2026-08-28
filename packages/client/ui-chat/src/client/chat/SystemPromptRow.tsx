/**
 * 文件职责：实现 client/ui-chat 中 SystemPromptRow 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { memo, useState } from 'react'
import type { ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { OpaqueBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for one complete system prompt disclosure. */
export interface SystemPromptRowProps {
  /** Complete model-visible prompt text. */
  text: string
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}

/**
 * Render one complete system prompt as a collapsed disclosure whose expanded
 * body is the same opaque context chrome: 141px code-block scrollport and
 * model-facing text with its real line breaks.
 * @param props - Complete prompt text and the locale seat.
 * @returns The system-prompt disclosure row.
 * @remarks 中文说明：功能说明：处理 SystemPromptRow 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{
 * text, t }（SystemPromptRowProps）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * SystemPromptRow({ text, t })，并按返回类型处理结果。
 */
export function SystemPromptRow({ text, t }: SystemPromptRowProps) {
  /**
   * 常量说明：open、setOpen 用于处理 open、setOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [open, setOpen] = useState(false)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
  * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
  */
  return (
    <DisclosureRow
      className={css.root}
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t('message.systemPrompt')}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-system-prompt-body>
        <OpaqueBody content={[{ type: 'text', text }]} source={null} t={t} />
      </div>
    </DisclosureRow>
  )
}

/** System-prompt keyed Chat renderer.
 * @remarks 中文说明：常量说明：SystemPromptNodeView 用于处理 SystemPromptNodeView 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ node, t,
 * }（Pick<ChatNodeViewProps<'system-prompt'>, 'node' | 't'>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调({ node, t, })，并按返回类型处理结果。
 */
export const SystemPromptNodeView = memo(function SystemPromptNodeView({
  node, t,
}: Pick<ChatNodeViewProps<'system-prompt'>, 'node' | 't'>) {
  return <SystemPromptRow text={node.data.text} t={t} />
})
