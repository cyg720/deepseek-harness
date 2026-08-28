/** Production documentation-site build with project-owned output preparation.
 * @remarks 文件说明：文件职责：实现 文档网站适配层 中 build 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 文档网站适配层 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { lstatSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vitepress'

/**
 * 常量说明：websiteRoot 用于处理 websiteRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const websiteRoot = resolve(import.meta.dirname)
type DocSiteBuildOptions = NonNullable<Parameters<typeof build>[1]>

/**
 * 功能说明：处理 escapesRoot 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param candidate （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 escapesRoot(root, candidate)，并按返回类型处理结果。
 */
function escapesRoot(root: string, candidate: string): boolean {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = relative(root, candidate)
  return child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)
}

/**
 * 功能说明：处理 nearestExistingAncestor 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 nearestExistingAncestor(path)，并按返回类型处理结果。
 */
function nearestExistingAncestor(path: string): string {
  /**
   * 变量说明：ancestor 用于处理 ancestor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let ancestor = path
  for (;;) {
    if (lstatSync(ancestor, { throwIfNoEntry: false }) !== undefined) return ancestor
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      throw new Error(`website/build: no existing ancestor found for ${JSON.stringify(path)}.`)
    }
    ancestor = parent
  }
}

/**
 * Remove one documentation build output without traversing a link-shaped output or an outside parent.
 * @param siteRoot - VitePress site root that owns the output.
 * @param outDir - Resolved VitePress output directory.
 * @throws When `outDir` is not a proper child of `siteRoot` or its existing parent resolves outside it.
 * @remarks 中文说明：功能说明：处理 cleanDocSiteOutput 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：siteRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：outDir（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cleanDocSiteOutput(siteRoot, outDir)，
 * 并按返回类型处理结果。
 */
export function cleanDocSiteOutput(siteRoot: string, outDir: string): void {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = resolve(siteRoot)
  /**
   * 常量说明：output 用于处理 output 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const output = resolve(outDir)
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = relative(root, output)
  if (child === '' || escapesRoot(root, output)) {
    throw new Error(`website/build: output directory ${JSON.stringify(output)} must be a child of site root ${JSON.stringify(root)}.`)
  }

  /**
   * 常量说明：realRoot 用于处理 realRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const realRoot = realpathSync(root)
  /**
   * 常量说明：realParent 用于处理 realParent 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const realParent = realpathSync(nearestExistingAncestor(dirname(output)))
  if (escapesRoot(realRoot, realParent)) {
    throw new Error(`website/build: output directory ${JSON.stringify(output)} must resolve inside site root ${JSON.stringify(realRoot)}.`)
  }

  /**
   * 常量说明：outputStats 用于处理 outputStats 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const outputStats = lstatSync(output, { throwIfNoEntry: false })
  if (outputStats?.isSymbolicLink()) {
    unlinkSync(output)
    return
  }
  rmSync(output, { recursive: true, force: true })
}

/**
 * Create VitePress build options that remove the resolved output directory before bundling.
 * @param siteRoot - VitePress site root to build.
 * @param mpa - Whether to use VitePress's multi-page application build.
 * @returns VitePress options with project-owned output preparation.
 * @remarks 中文说明：功能说明：处理 docSiteBuildOptions 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：siteRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mpa（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：DocSiteBuildOptions；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * docSiteBuildOptions(siteRoot, mpa)，并按返回类型处理结果。
 */
export function docSiteBuildOptions(siteRoot: string, mpa: boolean): DocSiteBuildOptions {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = resolve(siteRoot)
  return {
    ...mpa ? { mpa: 'true' } : {},
    /**
     * 功能说明：响应 After Config Resolve 相关流程；使用场景由所在模块及调用位置决定。
     * @param siteConfig （由 TypeScript 根据调用位置推断的类型）：提供本次操作使用的配置选项；
     * 必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAfterConfigResolve(siteConfig)，并按返回类型处理结果。
     */
    onAfterConfigResolve(siteConfig) {
      cleanDocSiteOutput(root, siteConfig.outDir)
    },
  }
}

/**
 * 功能说明：构建 Doc Site 相关流程；使用场景由所在模块及调用位置决定。
 * @param siteRoot （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param mpa （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 buildDocSite(siteRoot, mpa)，并按返回类型处理结果。
 */
async function buildDocSite(siteRoot: string, mpa: boolean): Promise<void> {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = resolve(siteRoot)
  await build(root, docSiteBuildOptions(root, mpa))
}

/**
 * 功能说明：解析 Mpa 相关流程；使用场景由所在模块及调用位置决定。
 * @param args （string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseMpa(args)，并按返回类型处理结果。
 */
function parseMpa(args: string[]): boolean {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--mpa') return true
  throw new Error(`website/build: expected no arguments or --mpa, got ${JSON.stringify(args)}.`)
}

/**
 * 常量说明：invokedPath 用于处理 invokedPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await buildDocSite(websiteRoot, parseMpa(process.argv.slice(2)))
}
