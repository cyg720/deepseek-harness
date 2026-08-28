/**
 * DisclosureRow's font-size-axis adoption as CSS text. jsdom has no layout,
 * so these read the declarations that make every flow row (tool calls, think,
 * commands) follow the Settings font-size preference: title size on the axis
 * variable, row/leading geometry on the shared px delta, and the leading
 * glyph override that scales registered icons while exempting StateDot.
 * @remarks 文件说明：文件职责：验证 client/ui-primitives 中 disclosure row styles
 * client spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
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
const css = readFileSync(fileURLToPath(new URL('../src/DisclosureRow.module.css', import.meta.url)), 'utf8')
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
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`DisclosureRow.module.css has no \`${selector}\` rule`)
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
describe('DisclosureRow.module.css font-size axis', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('sizes the title from the secondary content tier on the shared row line', () => {
    expect(declarations('.title')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
      'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('moves the row height and leading box by the same delta', () => {
    expect(declarations('.row')).toEqual(expect.arrayContaining([
      'height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
    expect(declarations('.leading')).toEqual(expect.arrayContaining([
      'width: calc(16px + var(--dsh-content-font-delta, 0px))',
      'height: calc(16px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('scales leading glyphs via the svg edge but exempts StateDot', () => {
    // StateDot marks itself with data-state; the :not filter keeps the status
    // mark at its fixed figma size while text-furniture icons follow the text.
    expect(declarations('.leading svg:not([data-state])')).toEqual(expect.arrayContaining([
      'width: calc(14px + var(--dsh-content-font-delta, 0px))',
      'height: calc(14px + var(--dsh-content-font-delta, 0px))',
    ]))
  })
})
