// @vitest-environment jsdom
// The streaming fence arm: StreamingHighlightSession's incremental
// tokenization equals from-scratch tokenization at every appended prefix, and
// CodeBlock's `streaming` arm renders the same token tree as the settled
// shiki-HTML swap while keeping completed lines' DOM nodes untouched. Lives
// apart from code-block.client.spec.tsx so its lazy-grammar timing cannot
// race that file's first-touch assertions (files run isolated).

/**
 * 文件职责：验证 client/ui-primitives 中 streaming code block client spec
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CodeBlock } from '../src/markdown/CodeBlock.tsx'
import { StreamingHighlightSession } from '../src/markdown/highlight.ts'
import { markdownLabels } from './labels.client.ts'

/**
 * 常量说明：LABELS 用于处理 LABELS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const LABELS = markdownLabels.code

afterEach(cleanup)

/**
 * One arm's rendered token tree, with every style channel the settled shiki
 * HTML emits (color plus the markup font-style bits), so equality between the
 * streaming spans and the settled `codeToHtml` swap pins full visual parity.
 * @remarks 中文说明：功能说明：读取 Pre 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：root（HTMLElement）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readPre(root)，
 * 并按返回类型处理结果。
 */
function readPre(root: HTMLElement) {
  /**
   * 常量说明：pre 用于处理 pre 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pre = root.querySelector('pre.shiki')
  expect(pre).not.toBeNull()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
   */
  return {
    classes: [...pre!.classList].sort().join(' '),
    tabIndex: pre!.getAttribute('tabindex'),
    text: pre!.textContent,
    lines: [...pre!.querySelectorAll('.line')].map(line =>
      [...line.querySelectorAll('span[style]')].map((span) => {
        /**
         * 常量说明：style 用于处理 style 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const style = (span as HTMLElement).style
        return `${span.textContent ?? ''}|${style.color}|${style.fontStyle}|${style.fontWeight}|${style.textDecoration}`
      }),
    ),
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('StreamingHighlightSession', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reconstructs the code verbatim and colors tokens through --shiki-* properties', () => {
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = 'const a = 1\n// note\nconst b = "x"'
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = new StreamingHighlightSession().update(code, 'ts')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
     */
    expect(lines?.map(line => line.map(span => span.text).join('')).join('\n')).toBe(code)
    expect(lines?.[0]?.[0]).toEqual({ text: 'const', style: { color: 'var(--shiki-token-keyword)' } })
    expect(lines?.[1]?.[0]?.style.color).toBe('var(--shiki-token-comment)')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('incremental growth equals a fresh from-scratch tokenization at every prefix', () => {
    // The template literal spans lines, so mid-stream states leave the
    // grammar inside a multi-line construct — the case where a stale saved
    // state would color the continuation wrong.
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = 'const s = `template\nline ${x} mid\n` // done\nconst t: number = 42'
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 变量说明：end 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let end = 1; end <= code.length; end++) {
      /**
       * 常量说明：slice 用于处理 slice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const slice = code.slice(0, end)
      expect(session.update(slice, 'ts')).toEqual(new StreamingHighlightSession().update(slice, 'ts'))
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps completed lines\' span arrays identical across growth and re-tokenizes only the tail', () => {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = session.update('const a = 1\nlet', 'ts')
    expect(first).toBeDefined()
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = session.update('const a = 1\nlet b = 2', 'ts')
    expect(second?.[0]).toBe(first?.[0])
    expect(second?.[1]).not.toBe(first?.[1])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('is idempotent per input: repeated calls return the identical result array', () => {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = session.update('const a = 1', 'ts')
    expect(result).toBeDefined()
    expect(session.update('const a = 1', 'ts')).toBe(result)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('an alias switch onto the same grammar keeps the cache; a different grammar re-tokenizes correctly', () => {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = session.update('const a = 1\nlet', 'ts')
    expect(first).toBeDefined()
    // Same code under a different alias of the same grammar: recomputed
    // (the idempotence key is the raw input) but the line cache is kept.
    /**
     * 常量说明：aliased 用于处理 aliased 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const aliased = session.update('const a = 1\nlet', 'typescript')
    expect(aliased?.[0]).toBe(first?.[0])
    /**
     * 常量说明：json 用于处理 json 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const json = session.update('{"a": 1}', 'json')
    expect(json).toEqual(new StreamingHighlightSession().update('{"a": 1}', 'json'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('non-append input re-tokenizes from scratch', () => {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    session.update('const a = 1\nconst b = 2', 'ts')
    /**
     * 常量说明：replaced 用于处理 replaced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replaced = session.update('let c = 3', 'ts')
    expect(replaced).toEqual(new StreamingHighlightSession().update('let c = 3', 'ts'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('returns undefined for unknown or absent languages, then recovers when a known one arrives', () => {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    expect(session.update('x', 'cobol')).toBeUndefined()
    expect(session.update('x', undefined)).toBeUndefined()
    expect(session.update('const x = 1', 'ts')).toEqual(new StreamingHighlightSession().update('const x = 1', 'ts'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a lazy grammar reports plain until it registers, then highlights on the next update', async () => {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    expect(session.update('print(1)', 'python')).toBeUndefined()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const lines = session.update('print(1)', 'python')
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
       */
      expect(lines?.[0]?.map(span => span.text).join('')).toBe('print(1)')
      expect(lines?.[0]?.length).toBeGreaterThan(1)
    }, { timeout: 5_000 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a trailing newline renders as a real empty last line (settled-arm parity)', () => {
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = new StreamingHighlightSession().update('const a = 1\n', 'ts')
    expect(lines).toHaveLength(2)
    expect(lines?.[1]).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a blank line inside a multi-line construct keeps the saved grammar state', () => {
    // The empty completed segment tokenizes as [[]]; the state saved after it
    // must still be the inside-template state, so the continuation stays
    // string-colored (incremental equals from-scratch at every prefix).
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = 'const s = `a\n\nb` // done'
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 变量说明：end 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let end = 1; end <= code.length; end++) {
      /**
       * 常量说明：slice 用于处理 slice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const slice = code.slice(0, end)
      expect(session.update(slice, 'ts')).toEqual(new StreamingHighlightSession().update(slice, 'ts'))
    }
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = session.update(code, 'ts')
    expect(lines?.[1]).toEqual([])
    expect(lines?.[2]?.[0]?.text).toBe('b`')
    expect(lines?.[2]?.[0]?.style.color).toBe('var(--shiki-token-string-expression)')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a CRLF boundary never leaks its \\r into the grammar (shiki line-split parity)', () => {
    // bash: a backslash continuation only holds if the line ends at the
    // continuation — a leaked \r would break the saved state and recolor the
    // next line as a fresh command.
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = 'echo a \\\r\nb\r\nc'
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 变量说明：end 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let end = 1; end <= code.length; end++) {
      /**
       * 常量说明：slice 用于处理 slice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const slice = code.slice(0, end)
      expect(session.update(slice, 'bash')).toEqual(new StreamingHighlightSession().update(slice, 'bash'))
    }
    // Span text carries no \r for completed lines, exactly like the settled
    // arm's shiki output.
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = session.update(code, 'bash')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
     */
    expect(lines?.map(line => line.map(span => span.text).join('')).join('\n')).toBe('echo a \\\nb\nc')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('markdown markup styles (bold/italic/underline) reach the spans once the grammar loads', async () => {
    /**
     * 常量说明：snippet 用于处理 snippet 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snippet = '# Heading\n**bold words** and *italic* and a [link with spaces](https://x.example) tail'
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(new StreamingHighlightSession().update('# x', 'md')).toBeDefined()
    }, { timeout: 5_000 })
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new StreamingHighlightSession()
    /**
     * 变量说明：end 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let end = 1; end <= snippet.length; end++) {
      /**
       * 常量说明：slice 用于处理 slice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const slice = snippet.slice(0, end)
      expect(session.update(slice, 'md')).toEqual(new StreamingHighlightSession().update(slice, 'md'))
    }
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = session.update(snippet, 'md')
    expect(lines?.[0]?.[0]?.style.fontWeight).toBe('bold')
    /**
     * 常量说明：spans 用于处理 spans 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const spans = lines?.[1] ?? []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
     */
    expect(spans.some(span => span.style.fontWeight === 'bold')).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
     */
    expect(spans.some(span => span.style.fontStyle === 'italic')).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
     */
    expect(spans.some(span => span.style.textDecoration === 'underline')).toBe(true)
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('CodeBlock streaming arm', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('renders the same token tree as the settled shiki HTML swap', () => {
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = 'const s = `tpl\nline ${x}\n`\n'
    /**
     * 常量说明：streamed 用于处理 streamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const streamed = render(<CodeBlock code={code} lang="ts" streaming {...LABELS} />)
    /**
     * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const settled = render(<CodeBlock code={code} lang="ts" {...LABELS} />)
    expect(readPre(streamed.container)).toEqual(readPre(settled.container))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a markdown fence matches the settled swap including font styles, and a CRLF fence matches too', async () => {
    // md is a lazy grammar: wait for it so both arms highlight.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(new StreamingHighlightSession().update('# x', 'md')).toBeDefined()
    }, { timeout: 5_000 })
    /**
     * 常量说明：md 用于处理 md 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const md = '# Heading\n**bold words** and *italic* and a [link with spaces](https://x.example) tail\n'
    /**
     * 常量说明：mdStreamed 用于处理 mdStreamed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const mdStreamed = render(<CodeBlock code={md} lang="md" streaming {...LABELS} />)
    /**
     * 常量说明：mdSettled 用于处理 mdSettled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mdSettled = render(<CodeBlock code={md} lang="md" {...LABELS} />)
    /**
     * 常量说明：streamedTree 用于处理 streamedTree 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const streamedTree = readPre(mdStreamed.container)
    expect(streamedTree).toEqual(readPre(mdSettled.container))
    // The settled arm really carries the styles, so the equality above cannot
    // pass by both arms dropping them.
    /**
     * 常量说明：flat 用于处理 flat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const flat = streamedTree.lines.flat().join(' ')
    expect(flat).toContain('|bold|')
    expect(flat).toContain('|italic|')
    expect(flat).toContain('|underline')
    /**
     * 常量说明：crlf 用于处理 crlf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const crlf = 'echo a \\\r\nb\r\nc\n'
    /**
     * 常量说明：crlfStreamed 用于处理 crlfStreamed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const crlfStreamed = render(<CodeBlock code={crlf} lang="bash" streaming {...LABELS} />)
    /**
     * 常量说明：crlfSettled 用于处理 crlfSettled 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const crlfSettled = render(<CodeBlock code={crlf} lang="bash" {...LABELS} />)
    expect(readPre(crlfStreamed.container)).toEqual(readPre(crlfSettled.container))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps completed lines\' DOM nodes as the code grows and appends the new ones', () => {
    /**
     * 常量说明：view 用于处理 view 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const view = render(<CodeBlock code={'const a = 1\nlet partial\n'} lang="ts" streaming {...LABELS} />)
    /**
     * 常量说明：firstLine 用于处理 firstLine 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstLine = view.container.querySelector('pre.shiki .line')
    expect(firstLine).not.toBeNull()
    view.rerender(<CodeBlock code={'const a = 1\nlet partial = 2\n// tail\n'} lang="ts" streaming {...LABELS} />)
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = view.container.querySelectorAll('pre.shiki .line')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(firstLine)
    expect(lines[2]?.textContent).toBe('// tail')
    // Newlines separate the line spans, so pre textContent (the copy source)
    // stays the code verbatim.
    expect(view.container.querySelector('pre.shiki')?.textContent).toBe('const a = 1\nlet partial = 2\n// tail')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('streaming with an unknown language stays on the identical plain arm', () => {
    /**
     * 常量说明：view 用于处理 view 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const view = render(<CodeBlock code={'IDENTIFICATION DIVISION.\n'} lang="cobol" streaming {...LABELS} />)
    expect(view.container.querySelector('pre.shiki')).toBeNull()
    expect(view.getByText('IDENTIFICATION DIVISION.')).toBeTruthy()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('the settle swap (streaming to settled) preserves the code content', () => {
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = 'const answer = 42\n'
    /**
     * 常量说明：view 用于处理 view 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const view = render(<CodeBlock code={code} lang="ts" streaming {...LABELS} />)
    /**
     * 常量说明：streamedText 用于处理 streamedText 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const streamedText = view.container.querySelector('pre.shiki')?.textContent
    view.rerender(<CodeBlock code={code} lang="ts" {...LABELS} />)
    /**
     * 常量说明：settledText 用于处理 settledText 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const settledText = view.container.querySelector('pre.shiki')?.textContent
    expect(streamedText).toBe('const answer = 42')
    expect(settledText).toBe(streamedText)
  })
})
