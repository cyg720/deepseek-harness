/**
 * 文件职责：实现 client/ui-chat 中 TurnProcessNodeView 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { memo } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './TurnProcessNodeView.module.css'

/** Turn-level process disclosure controller.
 * @remarks 中文说明：常量说明：TurnProcessNodeView 用于处理 TurnProcessNodeView 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ node, turnProcess, t,
 * }（ChatNodeViewProps<'turn-process'>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({
 * node, turnProcess…)，并按返回类型处理结果。
 */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  if (!turnProcess.foldable) return null
  /**
   * 常量说明：open 用于打开 open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const open = turnProcess.open
  /**
   * 常量说明：labels 用于处理 labels 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const labels: string[] = []
  if (node.data.toolCallCount > 0) {
    labels.push(t(
      node.data.toolCallCount === 1
        ? 'message.turnProcess.toolCalls.one'
        : 'message.turnProcess.toolCalls.other',
      { count: node.data.toolCallCount },
    ))
  }
  if (node.data.messageCount > 0) {
    labels.push(t(
      node.data.messageCount === 1
        ? 'message.turnProcess.messages.one'
        : 'message.turnProcess.messages.other',
      { count: node.data.messageCount },
    ))
  }
  if (node.data.subagentCount > 0) {
    labels.push(t(
      node.data.subagentCount === 1
        ? 'message.turnProcess.subagents.one'
        : 'message.turnProcess.subagents.other',
      { count: node.data.subagentCount },
    ))
  }
  /**
   * 常量说明：label 用于处理 label 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const label = labels.length === 0
    ? t('message.turnProcess.thoughtForAWhile')
    : labels.join(t('message.turnProcess.separator'))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  return (
    <button
      type="button"
      className={css.root}
      data-open={open || undefined}
      data-turn-process={node.data.turn}
      data-turn-process-messages={node.data.messageCount}
      data-turn-process-tool-calls={node.data.toolCallCount}
      data-turn-process-subagents={node.data.subagentCount}
      aria-expanded={open}
      onClick={(event) => {
        event.currentTarget.focus()
        turnProcess.setOpen(!open)
      }}
    >
      <span className={css.label}>{label}</span>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )
})
