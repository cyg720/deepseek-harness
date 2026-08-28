/**
 * 文件职责：实现 client/ui-chat 中 TurnUsageDisclosure 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { useState } from 'react'
import { DisclosureRow, IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import css from './TurnUsageDisclosure.module.css'

export interface TurnUsageDisclosureProps {
  usage: TurnTokenUsage
  t: ChatViewSlotProps['t']
}

/**
 * 功能说明：格式化 Compact Count 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param t （ChatViewSlotProps['t']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 formatCompactCount(value, t)，并按返回类型处理结果。
 */
function formatCompactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) })
}

/**
 * 功能说明：格式化 Exact Count 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param t （ChatViewSlotProps['t']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 formatExactCount(value, t)，并按返回类型处理结果。
 */
function formatExactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/** Compact per-Turn usage summary with an opt-in bucket breakdown.
 * @remarks 中文说明：功能说明：处理 TurnUsageDisclosure 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{
 * usage, t }（TurnUsageDisclosureProps）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * TurnUsageDisclosure({ usage, t })，并按返回类型处理结果。 */
export function TurnUsageDisclosure({ usage, t }: TurnUsageDisclosureProps) {
  /**
   * 常量说明：open、setOpen 用于处理 open、setOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [open, setOpen] = useState(false)
  /**
   * 常量说明：cacheHit 用于处理 cacheHit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  /**
   * 常量说明：total 用于处理 total 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const total = formatCompactCount(usage.totalTokens, t)
  /**
   * 常量说明：summary 用于处理 summary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const summary = cacheHit === null
    ? total
    : t('message.turnUsage.summaryWithCache', { total, percent: cacheHit })
  /**
   * 常量说明：routes 用于处理 routes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(route)，并按返回类型处理结果。
   */
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''

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
      icon={<IconDataOutline16 />}
      title={t('message.turnUsage.title')}
      open={open}
      expandable
      onToggle={() => { setOpen(value => !value) }}
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={(
        <>
          <span className={css.separator} aria-hidden />
          <span className={css.summary}>{summary}</span>
        </>
      )}
      className={css.root}
      chevronClassName={css.chevron}
    >
      <dl className={css.details} data-turn-usage-details>
        {routes !== '' && (
          <>
            <dt>{t('message.turnUsage.model')}</dt>
            <dd className={css.route}>{routes}</dd>
          </>
        )}
        <dt>{t('message.turnUsage.input')}</dt>
        <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
        {usage.cacheReadTokens !== undefined && (
          <>
            <dt>{t('message.turnUsage.cacheRead')}</dt>
            <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
          </>
        )}
        {usage.cacheWriteTokens !== undefined && (
          <>
            <dt>{t('message.turnUsage.cacheWrite')}</dt>
            <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
          </>
        )}
        <dt>{t('message.turnUsage.output')}</dt>
        <dd>
          {formatExactCount(usage.outputTokens, t)}
          {usage.reasoningTokens !== undefined && (
            <span className={css.reasoning}>
              {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
            </span>
          )}
        </dd>
        <dt className={css.totalLabel}>{t('message.turnUsage.total')}</dt>
        <dd className={css.totalValue}>{formatExactCount(usage.totalTokens, t)}</dd>
      </dl>
    </DisclosureRow>
  )
}
