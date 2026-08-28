/** Ask-user transcript rendering from validated plain card data. @module
 * @remarks 文件说明：文件职责：实现 client/ui-tool 中 AskQuestionCard 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-tool 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { AskQuestionCardModel } from '../models/ask-question-card-model.ts'
import css from './AskQuestionCard.module.css'

/**
 * Render a validated ask-user transcript from plain card data.
 * @param props - Localized transcript card data.
 * @returns the readable answered or unanswered question list.
 * @remarks 中文说明：功能说明：处理 AskQuestionCard 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{ card
 * }（{ card: AskQuestionCardModel }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * AskQuestionCard({ card })，并按返回类型处理结果。
 */
export function AskQuestionCard({ card }: { card: AskQuestionCardModel }) {
  if (card.kind === 'unanswered') {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：question（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(question)，并按返回类型处理结果。
     */
    return (
      <div className={css.card}>
        <p className={css.verdict}>{card.verdict}</p>
        <ul className={css.questionList}>
          {card.questions.map(question => (
            <li className={css.unansweredQuestion} key={question.id}>{question.question}</li>
          ))}
        </ul>
      </div>
    )
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：question（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(question)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：answer（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(answer, index)，并按返回类型处理结果。
   */
  return (
    <dl className={css.card}>
      {card.questions.map(question => (
        <div className={css.item} key={question.id}>
          <dt className={css.question}>{question.question}</dt>
          <dd className={css.answer}>
            {question.answers.length === 0
              ? <span className={css.skipped}>{card.skippedLabel}</span>
              : question.answers.map((answer, index) => (
                <span className={css.answerLine} key={`${question.id}-${String(index)}`}>{answer}</span>
              ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
