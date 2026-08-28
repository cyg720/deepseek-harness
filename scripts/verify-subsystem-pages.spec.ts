/** Regression coverage for package-group subsystem-page ownership.
 * @remarks 文件说明：文件职责：验证 仓库维护脚本 中 verify subsystem pages spec 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { auditSubsystemPages } from './verify-subsystem-pages.ts'

/**
 * 功能说明：处理 fixture 相关流程；使用场景由所在模块及调用位置决定。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fixture()，并按返回类型处理结果。
 */
function fixture(): string {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = mkdtempSync(join(tmpdir(), 'dsh-subsystem-pages-'))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

/**
 * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 write(root, path, source)，并按返回类型处理结果。
 */
function write(root: string, path: string, source: string): void {
  /**
   * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source)
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('package-group subsystem pages', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts a direct page link and a justified no-page group', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(root, 'packages/alpha/README.md', '[types](../../docs/subsystems/alpha.md#contract)\n')
    write(root, 'packages/alpha/alpha/package.json', '{}\n')
    write(root, 'docs/subsystems/alpha.md', '# Alpha\n')
    write(root, 'packages/adapter/README.md', '# Adapter\n')

    expect(auditSubsystemPages(root, { adapter: 'Adapter over an existing subsystem.' })).toEqual({
      groups: 2,
      linked: 1,
      exempt: 1,
      violations: [],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a new group whose README never declares subsystem ownership', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(root, 'packages/schedule/README.md', '# Schedule\n')
    write(root, 'packages/schedule/tool-schedule/package.json', '{}\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/schedule/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not treat the subsystem index or a Chinese counterpart as an owning page', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(
      root,
      'packages/wrong/README.md',
      '[index](../../docs/subsystems/README.md) [Chinese](../../docs/subsystems/wrong.zh.md)\n',
    )
    write(root, 'docs/subsystems/README.md', '# Subsystems\n')
    write(root, 'docs/subsystems/wrong.zh.md', '# Wrong\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/wrong/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not count links hidden in code, comments, or image syntax', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(
      root,
      'packages/hidden/README.md',
      [
        '`[inline](../../docs/subsystems/hidden.md)`',
        '```md',
        '[fenced](../../docs/subsystems/hidden.md)',
        '```',
        '<!-- [comment](../../docs/subsystems/hidden.md) -->',
        '![image](../../docs/subsystems/hidden.md)',
        '',
      ].join('\n'),
    )
    write(root, 'docs/subsystems/hidden.md', '# Hidden\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/hidden/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a link that escapes the subsystem directory', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(root, 'packages/escape/README.md', '[escape](../../docs/subsystems/../architecture.md)\n')
    write(root, 'docs/architecture.md', '# Architecture\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/escape/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects missing group READMEs and missing linked pages', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(root, 'packages/no-readme/pkg/package.json', '{}\n')
    write(root, 'packages/broken/README.md', '[missing](../../docs/subsystems/missing.md)\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/broken/README.md: linked subsystem page does not exist: docs/subsystems/missing.md',
      'packages/no-readme/README.md: package group has no group README declaring subsystem ownership',
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects blank, orphaned, and stale exemptions', () => {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = fixture()
    write(root, 'packages/linked/README.md', '[types](../../docs/subsystems/linked.md)\n')
    write(root, 'docs/subsystems/linked.md', '# Linked\n')
    write(root, 'packages/blank/README.md', '# Blank\n')

    expect(auditSubsystemPages(root, {
      blank: ' ',
      linked: 'No page.',
      orphan: 'Removed group.',
    }).violations).toEqual([
      'exemption blank: missing justification for omitting a subsystem page',
      'exemption orphan: no matching package group; remove the stale entry',
      'packages/linked/README.md: links a subsystem page but remains exempt; remove the stale exemption',
    ])
  })
})
