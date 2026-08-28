/**
 * 文件职责：验证 sandbox/sandbox-local 中 packed workspace closure 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 常量说明：RUNTIME_SECTIONS 用于处理 RUNTIME_SECTIONS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

interface WorkspaceListEntry {
  name: string
  path: string
}

/** One workspace manifest available to the packed-install rehearsal. */
export interface WorkspacePackage {
  name: string
  directory: string
  manifest: Record<string, unknown>
}

/**
 * 功能说明：处理 dependencyEntries 相关流程；使用场景由所在模块及调用位置决定。
 * @param manifest （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param section （(typeof RUNTIME_SECTIONS)[number]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns [string, string][]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 dependencyEntries(manifest, section)，并按返回类型处理结果。
 */
function dependencyEntries(
  manifest: Record<string, unknown>,
  section: (typeof RUNTIME_SECTIONS)[number],
): [string, string][] {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = manifest[section]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：entry is [string, string]；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
}

/**
 * 功能说明：处理 optionalPeer 相关流程；使用场景由所在模块及调用位置决定。
 * @param manifest （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 optionalPeer(manifest, name)，并按返回类型处理结果。
 */
function optionalPeer(manifest: Record<string, unknown>, name: string): boolean {
  /**
   * 常量说明：metadata 用于处理 metadata 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const metadata = manifest.peerDependenciesMeta
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  /**
   * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entry = (metadata as Record<string, unknown>)[name]
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && (entry as Record<string, unknown>).optional === true
}

/**
 * Read the root pnpm workspace inventory and its package manifests.
 * @param repoRoot - repository root containing the pnpm workspace.
 * @returns Workspace packages indexed by package name.
 * @remarks 中文说明：功能说明：读取 Workspace Packages 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：repoRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Map<string,
 * WorkspacePackage>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * readWorkspacePackages(repoRoot)，并按返回类型处理结果。
 */
export function readWorkspacePackages(repoRoot: string): Map<string, WorkspacePackage> {
  /**
   * 常量说明：listed 用于处理 listed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listed = spawnSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (listed.status !== 0) {
    throw new Error(`pnpm workspace inventory failed:\n${listed.stdout}\n${listed.stderr}`)
  }
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed: unknown = JSON.parse(listed.stdout)
  if (!Array.isArray(parsed)) throw new Error('pnpm workspace inventory is not an array')
  /**
   * 常量说明：packages 用于处理 packages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const packages = new Map<string, WorkspacePackage>()
  /**
   * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const value of parsed) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('pnpm workspace inventory contains a non-object entry')
    }
    /**
     * 常量说明：name、path 用于处理 name、path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { name, path } = value as Partial<WorkspaceListEntry>
    if (typeof name !== 'string' || typeof path !== 'string') {
      throw new Error('pnpm workspace inventory entry lacks name/path')
    }
    /**
     * 常量说明：parsedManifest 用于处理 parsedManifest 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const parsedManifest: unknown = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    if (parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)) {
      throw new Error(`${path}/package.json is not an object`)
    }
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = parsedManifest as Record<string, unknown>
    if (manifest.name !== name) throw new Error(`${path}/package.json does not declare ${name}`)
    if (packages.has(name)) throw new Error(`pnpm workspace inventory repeats ${name}`)
    packages.set(name, { name, directory: path, manifest })
  }
  return packages
}

/**
 * Follow install dependencies and required peers inside one workspace.
 * @param rootName - package whose consumer closure is required.
 * @param packages - workspace packages indexed by package name.
 * @returns Transitive runtime closure sorted by package directory.
 * @remarks 中文说明：功能说明：处理 packedWorkspaceClosure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：rootName（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：packages（ReadonlyMap<string, WorkspacePackage>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：WorkspacePackage[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 packedWorkspaceClosure(rootName, packages)，
 * 并按返回类型处理结果。
 */
export function packedWorkspaceClosure(
  rootName: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): WorkspacePackage[] {
  /**
   * 常量说明：closure 用于处理 closure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const closure: WorkspacePackage[] = []
  /**
   * 常量说明：visited 用于处理 visited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const visited = new Set<string>()
  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(name)，并按返回类型处理结果。
   */
  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = packages.get(name)
    if (current === undefined) throw new Error(`packed workspace closure cannot resolve ${name}`)
    closure.push(current)
    /**
     * 变量说明：section 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const section of RUNTIME_SECTIONS) {
      /**
       * 变量说明：dependency、range 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [dependency, range] of dependencyEntries(current.manifest, section)) {
        if (!range.startsWith('workspace:')) continue
        if (section === 'peerDependencies' && optionalPeer(current.manifest, dependency)) continue
        visit(dependency)
      }
    }
  }
  visit(rootName)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  return closure.sort((left, right) => left.directory.localeCompare(right.directory))
}
