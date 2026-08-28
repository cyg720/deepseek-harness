/**
 * 文件职责：验证 test-support/session-snapshot 中 workspace spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureExpectedWorkspaceSnapshot,
  captureWorkspaceSnapshot,
  EMPTY_WORKSPACE_MARKER,
} from '../src/workspace.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('workspace snapshots', () => {
  /**
   * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const roots: string[] = []

  /**
   * 功能说明：处理 root 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 root()，并按返回类型处理结果。
   */
  async function root(): Promise<string> {
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = await mkdtemp(join(tmpdir(), 'dsh-workspace-snapshot-'))
    roots.push(value)
    return value
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
     * 并按返回类型处理结果。
     */
    await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('captures readable text, binary bytes, links, and empty directories in path order', async () => {
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = await root()
    await writeFile(join(directory, 'a.txt'), 'hello\n')
    await writeFile(join(directory, 'b.bin'), Buffer.from([0xff, 0x01]))
    await mkdir(join(directory, 'empty'))
    await symlink('a.txt', join(directory, 'link'))

    expect(await captureWorkspaceSnapshot(directory)).toEqual([
      { path: 'a.txt', kind: 'text', content: 'hello\n' },
      { path: 'b.bin', kind: 'binary', base64: '/wE=' },
      { path: 'empty', kind: 'empty-directory' },
      { path: 'link', kind: 'symlink', target: 'a.txt' },
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps generic marker files but omits declared runtime roots and the expected-empty marker', async () => {
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = await root()
    await mkdir(join(directory, '.dsh'))
    await writeFile(join(directory, '.dsh', 'runtime.json'), '{}')
    await writeFile(join(directory, EMPTY_WORKSPACE_MARKER), '')
    await writeFile(join(directory, 'visible.txt'), 'visible')

    expect(await captureWorkspaceSnapshot(directory, { ignoredRootEntries: ['.dsh'] })).toEqual([
      { path: '.empty', kind: 'text', content: '' },
      { path: 'visible.txt', kind: 'text', content: 'visible' },
    ])
    expect(await captureExpectedWorkspaceSnapshot(directory)).toEqual([
      { path: '.dsh/runtime.json', kind: 'text', content: '{}' },
      { path: 'visible.txt', kind: 'text', content: 'visible' },
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('treats NUL-bearing UTF-8 as binary workspace state', async () => {
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = await root()
    await writeFile(join(directory, 'nul.bin'), Buffer.from([0x61, 0x00, 0x62]))
    expect(await captureWorkspaceSnapshot(directory)).toEqual([
      { path: 'nul.bin', kind: 'binary', base64: 'YQBi' },
    ])
  })
})
