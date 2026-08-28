/**
 * WorkflowRunPanel's font-size-axis adoption as CSS text. jsdom has no
 * layout, so these read the declarations that make the run/phase headers and
 * the expanded member rows follow the Settings font-size preference: member
 * labels at the body size (--dsh-content-font-size / --dsh-content-font-delta),
 * the chrome around them on the secondary tier
 * (--dsh-content-font-size-secondary / --dsh-content-font-delta-secondary).
 * @remarks 文件说明：文件职责：验证 client/ui-workflow-run 中 panel styles client spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 常量说明：css 用于处理 css 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const css = readFileSync(
  fileURLToPath(new URL('../src/client/WorkflowRunPanel.module.css', import.meta.url)),
  'utf8',
)
/**
 * 常量说明：declarationText 用于处理 declarationText 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * 功能说明：处理 declarations 相关流程；使用场景由所在模块及调用位置决定。
 * @param selector （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 declarations(selector)，并按返回类型处理结果。
 */
function declarations(selector: string): string[] {
  /**
   * 常量说明：rule 用于处理 rule 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\,\s]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`WorkflowRunPanel.module.css has no \`${selector}\` rule`)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
   */
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('WorkflowRunPanel.module.css font-size axis', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('member labels ride the axis at the body size with matching row geometry', () => {
    expect(declarations('.memberLabel')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size, 14px)',
      'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
    expect(declarations('.memberLabelWrap')).toEqual(expect.arrayContaining([
      'height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('member status and the empty placeholder read the secondary tier', () => {
    /**
     * 变量说明：selector 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const selector of ['.memberStatus', '.empty']) {
      expect(declarations(selector)).toEqual(expect.arrayContaining([
        'font-size: var(--dsh-content-font-size-secondary, 13px)',
        'line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      ]))
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('the phase status column widens with the text so larger sizes do not truncate', () => {
    expect(declarations('.phaseStatus')).toEqual(expect.arrayContaining([
      'width: calc(132px + var(--dsh-content-font-delta-secondary, 0px) * 10)',
    ]))
  })
})
