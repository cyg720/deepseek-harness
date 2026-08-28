/**
 * Real-composition proof: a cordis.yml loaded by the vendored Loader applies
 * spill-local configuration and completes its fiber-owned startup cleanup.
 * @remarks 文件说明：文件职责：验证 spill/spill-local 中 loader composition spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalSpillStore, { sessionDir } from '@deepseek-ai/dsh-spill-local'

/**
 * 常量说明：DAY_MS 用于处理 DAY_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 变量说明：root 用于处理 root 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let root: string | undefined
/**
 * 变量说明：context 用于处理 context 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let context: Context | undefined

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('spill-local real Loader composition through cordis.yml', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('loads cleanupPeriodDays and prunes only expired session contents', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-spill-loader-'))
    /**
     * 常量说明：oldDir 用于处理 oldDir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oldDir = sessionDir(root, 'old-session')
    /**
     * 常量说明：freshDir 用于处理 freshDir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const freshDir = sessionDir(root, 'fresh-session')
    await mkdir(oldDir, { recursive: true })
    await mkdir(freshDir, { recursive: true })
    /**
     * 常量说明：old 用于处理 old 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const old = join(oldDir, 'old.txt')
    /**
     * 常量说明：fresh 用于处理 fresh 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fresh = join(freshDir, 'fresh.txt')
    await writeFile(old, 'old')
    await writeFile(fresh, 'fresh')
    /**
     * 常量说明：now 用于处理 now 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const now = Date.now()
    await utimes(old, (now - 40 * DAY_MS) / 1000, (now - 40 * DAY_MS) / 1000)
    await utimes(fresh, (now - DAY_MS) / 1000, (now - DAY_MS) / 1000)

    /**
     * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-spill-local'",
      '  config:',
      `    root: ${JSON.stringify(root)}`,
      '    cleanupPeriodDays: 30',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      /**
       * 功能说明：处理 import 相关流程；使用场景由所在模块及调用位置决定。
       * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 import(specifier)，并按返回类型处理结果。
       */
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-spill-local') throw new Error(`unexpected Loader import: ${specifier}`)
        return LocalSpillStore
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    await context.fiber.dispose()
    context = undefined

    expect(existsSync(old)).toBe(false)
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(freshDir)).toBe(true)
    expect(existsSync(root)).toBe(true)
  }, 30_000)
})
