/** Host-side source layout invariants.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 layout host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 常量说明：sourceRoot 用于处理 sourceRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
/**
 * 常量说明：packageRoot 用于处理 packageRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
/**
 * 常量说明：testsRoot 用于处理 testsRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const testsRoot = fileURLToPath(new URL('./', import.meta.url))

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Inspector execution layout', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps Client and Host implementation paths mirrored', async () => {
    expect(await sourceFiles('client')).toEqual(await sourceFiles('host'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps Worker Client and Host backend paths mirrored', async () => {
    expect(await sourceFiles('worker/realms/client')).toEqual(await sourceFiles('worker/realms/host'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps shared modules independent of execution-specific directories', async () => {
    await expectNoImports('shared', ['client', 'host', 'worker'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps Client and Host modules isolated from each other and the Worker implementation', async () => {
    await expectNoImports('client', ['host', 'worker'])
    await expectNoImports('host', ['client', 'worker'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps compiler files and specs on their declared execution face', async () => {
    /**
     * 常量说明：hostFiles 用于处理 hostFiles 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const hostFiles = await compilerFiles('tsconfig.host.json')
    /**
     * 常量说明：clientFiles 用于处理 clientFiles 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const clientFiles = await compilerFiles('tsconfig.client.json')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    expect(hostFiles.some(file => file.startsWith('src/client/'))).toBe(false)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    expect(clientFiles.some(file => file.startsWith('src/host/') || file.startsWith('src/worker/'))).toBe(false)

    /**
     * 常量说明：testFiles 用于处理 testFiles 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    const testFiles = (await walk(testsRoot)).filter(file => file.endsWith('.ts'))
    /**
     * 常量说明：specs 用于处理 specs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    const specs = testFiles.filter(file => file.endsWith('.spec.ts'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    expect(specs.every(file => file.endsWith('.host.spec.ts') || file.endsWith('.client.spec.ts'))).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    await expectTestImports(testFiles.filter(file =>
      file.endsWith('.host.ts') || file.endsWith('.host.spec.ts')), ['client'])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
     * 并按返回类型处理结果。
     */
    await expectTestImports(testFiles.filter(file =>
      file.endsWith('.client.ts') || file.endsWith('.client.spec.ts')), ['host', 'worker'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps Worker repositories and realm backends independent of the Chrome adapter', async () => {
    await expectNoImports('worker/inspection', ['worker/cdp'])
    await expectNoImports('worker/realms', ['worker/cdp'])
  })
})

/**
 * 功能说明：处理 sourceFiles 相关流程；使用场景由所在模块及调用位置决定。
 * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sourceFiles(directory)，并按返回类型处理结果。
 */
async function sourceFiles(directory: string): Promise<string[]> {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = resolve(sourceRoot, directory)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  return (await walk(root))
    .filter(file => file.endsWith('.ts'))
    .map(file => relative(root, file).split(sep).join('/'))
    .sort()
}

/**
 * 功能说明：处理 compilerFiles 相关流程；使用场景由所在模块及调用位置决定。
 * @param config （string）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns Promise<string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 compilerFiles(config)，并按返回类型处理结果。
 */
async function compilerFiles(config: string): Promise<string[]> {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = JSON.parse(await readFile(resolve(packageRoot, config), 'utf8')) as { files?: unknown }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  if (!Array.isArray(parsed.files) || !parsed.files.every(file => typeof file === 'string')) {
    throw new Error(`${config} must declare a string files array`)
  }
  return parsed.files
}

/**
 * 功能说明：处理 expectTestImports 相关流程；使用场景由所在模块及调用位置决定。
 * @param files （readonly string[]）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @param forbidden （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 expectTestImports(files, forbidden)，并按返回类型处理结果。
 */
async function expectTestImports(files: readonly string[], forbidden: readonly string[]): Promise<void> {
  /**
   * 变量说明：file 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const file of files) {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await readFile(file, 'utf8')
    /**
     * 变量说明：specifier 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const specifier of relativeSpecifiers(source)) {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = resolve(dirname(file), specifier)
      /**
       * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const directory of forbidden) {
        /**
         * 常量说明：forbiddenRoot 用于处理 forbiddenRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const forbiddenRoot = resolve(sourceRoot, directory)
        expect(
          target === forbiddenRoot || target.startsWith(`${forbiddenRoot}${sep}`),
          `${relative(testsRoot, file)} imports ${specifier}`,
        ).toBe(false)
      }
    }
  }
}

/**
 * 功能说明：处理 expectNoImports 相关流程；使用场景由所在模块及调用位置决定。
 * @param owner （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param forbidden （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 expectNoImports(owner, forbidden)，并按返回类型处理结果。
 */
async function expectNoImports(owner: string, forbidden: readonly string[]): Promise<void> {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = resolve(sourceRoot, owner)
  /**
   * 变量说明：file 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const file of await walk(root)) {
    if (!file.endsWith('.ts')) continue
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await readFile(file, 'utf8')
    /**
     * 变量说明：specifier 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const specifier of relativeSpecifiers(source)) {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = resolve(dirname(file), specifier)
      /**
       * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const directory of forbidden) {
        /**
         * 常量说明：forbiddenRoot 用于处理 forbiddenRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const forbiddenRoot = resolve(sourceRoot, directory)
        expect(
          target === forbiddenRoot || target.startsWith(`${forbiddenRoot}${sep}`),
          `${relative(sourceRoot, file)} imports ${specifier}`,
        ).toBe(false)
      }
    }
  }
}

/**
 * 功能说明：处理 walk 相关流程；使用场景由所在模块及调用位置决定。
 * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 walk(directory)，并按返回类型处理结果。
 */
async function walk(directory: string): Promise<string[]> {
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entries = await readdir(directory, { withFileTypes: true })
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  const files = await Promise.all(entries.map(async (entry) => {
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = resolve(directory, entry.name)
    return entry.isDirectory() ? await walk(value) : [value]
  }))
  return files.flat()
}

/**
 * 功能说明：处理 relativeSpecifiers 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 relativeSpecifiers(source)，并按返回类型处理结果。
 */
function relativeSpecifiers(source: string): string[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：match（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(match)，并按返回类型处理结果。
   */
  return [...source.matchAll(/(?:from\s+|import\s*\()['"](\.[^'"]+)['"]/gu)].map(match => match[1] ?? '')
}
