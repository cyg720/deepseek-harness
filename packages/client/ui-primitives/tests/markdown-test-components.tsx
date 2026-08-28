/**
 * 文件职责：验证 client/ui-primitives 中 markdown test components 相关行为与失败场景。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ComponentProps } from 'react'
import {
  JsonBlock as LocalizedJsonBlock,
  MarkdownText as LocalizedMarkdownText,
  type MarkdownCodeLabels,
  type MarkdownLabels,
} from '../src/index.ts'
import { markdownLabels as defaultMarkdownLabels } from './labels.client.ts'

type MarkdownTextProps = Omit<ComponentProps<typeof LocalizedMarkdownText>, 'labels'> & {
  labels?: MarkdownLabels
  codeLabels?: MarkdownCodeLabels
}

/**
 * 功能说明：处理 MarkdownText 相关流程；使用场景由所在模块及调用位置决定。
 * @param { labels, codeLabels, ...props } （MarkdownTextProps）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 MarkdownText({ labels, codeLabel…)，并按返回类型处理结果。
 */
export function MarkdownText({
  labels,
  codeLabels,
  ...props
}: MarkdownTextProps) {
  /**
   * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolved = labels ?? (codeLabels === undefined
    ? defaultMarkdownLabels
    : { ...defaultMarkdownLabels, code: codeLabels })
  return <LocalizedMarkdownText {...props} labels={resolved} />
}

type JsonBlockProps = Omit<ComponentProps<typeof LocalizedJsonBlock>, 'truncatedLabel'> & {
  truncatedLabel?: (total: number) => string
}

/**
 * 功能说明：处理 JsonBlock 相关流程；使用场景由所在模块及调用位置决定。
 * @param { truncatedLabel, ...props } （JsonBlockProps）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 JsonBlock({ truncatedLabel, .…)，并按返回类型处理结果。
 */
export function JsonBlock({ truncatedLabel, ...props }: JsonBlockProps) {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：total（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(total)，并按返回类型处理结果。
   */
  return (
    <LocalizedJsonBlock
      {...props}
      truncatedLabel={truncatedLabel ?? (total => `… 已截断，共 ${total} 字符`)}
    />
  )
}
