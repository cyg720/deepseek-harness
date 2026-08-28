/**
 * Doc-sync gate for package-group subsystem references. Every package group
 * either links at least one existing `docs/subsystems/` page from its English
 * group README or carries an explicit, justified exemption below.
 * @remarks 文件说明：文件职责：实现 仓库维护脚本 中 verify subsystem pages 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 仓库维护脚本 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { parseMarkdown, visitMarkdown } from './markdown.ts'

/**
 * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const root = resolve(import.meta.dirname, '..')

/**
 * Package groups that do not own a standalone subsystem reference. Reasons
 * are reviewable policy: a new group cannot silently inherit an exemption.
 * @remarks 中文说明：常量说明：GROUPS_WITHOUT_SUBSYSTEM_PAGE 用于处理
 * GROUPS_WITHOUT_SUBSYSTEM_PAGE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const GROUPS_WITHOUT_SUBSYSTEM_PAGE: Readonly<Record<string, string>> = {
  acp: 'Protocol transport entry point; the server package README owns its interoperability contract.',
  boot: 'Shared application-bin boot library rather than a runtime subsystem.',
  bundle: 'Composition patch carriers whose mounted packages own all runtime contracts.',
  examples: 'Non-product demonstration compositions whose mounted packages own all runtime contracts.',
  hooks: 'External hook-protocol bridges over existing interception points, not a new Harness service.',
  sdk: 'Out-of-process protocol and client packages whose package READMEs own the SDK contracts.',
  util: 'Low-level primitives whose business semantics remain with their consuming subsystems.',
}

/** Result of auditing package-group subsystem documentation. */
export interface SubsystemPageAudit {
  /** Package groups discovered from group READMEs or child package manifests. */
  readonly groups: number
  /** Groups carrying at least one direct subsystem-page link. */
  readonly linked: number
  /** Groups covered by an explicit no-page policy. */
  readonly exempt: number
  /** Actionable contract violations. */
  readonly violations: readonly string[]
}

/** Normalize one filesystem glob result to repository slash form.
 * @remarks 中文说明：功能说明：规范化 normalize 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalize(path)，
 * 并按返回类型处理结果。 */
function normalize(path: string): string {
  return path.split(sep).join('/')
}

/** Extract the package-group segment from a repository-relative path.
 * @remarks 中文说明：功能说明：处理 groupOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 groupOf(path)，并按返回类型处理结果。 */
function groupOf(path: string): string {
  /**
   * 常量说明：group 用于处理 group 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const group = path.split('/')[1]
  if (group === undefined || group.length === 0) throw new Error(`invalid package path: ${path}`)
  return group
}

/** Return canonical subsystem-page targets linked by one group README.
 * @remarks 中文说明：功能说明：处理 subsystemLinks 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subsystemLinks(source)，
 * 并按返回类型处理结果。 */
function subsystemLinks(source: string): string[] {
  /**
   * 常量说明：links 用于处理 links 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const links = new Set<string>()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type !== 'link') return
    /**
     * 常量说明：match 用于处理 match 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const match = /^\.\.\/\.\.\/docs\/subsystems\/([^/#?]+\.md)(?:#[^?#]*)?$/.exec(node.url)
    /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const page = match?.[1]
    if (page !== undefined && page !== 'README.md' && !page.endsWith('.zh.md')) links.add(`docs/subsystems/${page}`)
  })
  return [...links].sort()
}

/**
 * Audit package-group subsystem ownership for one repository tree.
 * @param scanRoot - repository root containing `packages/` and `docs/`.
 * @param exemptions - groups intentionally carrying no subsystem-page link.
 * @returns counts plus every actionable violation.
 * @remarks 中文说明：功能说明：处理 auditSubsystemPages 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：scanRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：exemptions（Readonly<Record<string, string>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：SubsystemPageAudit；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 auditSubsystemPages(scanRoot, exemptions)，
 * 并按返回类型处理结果。
 */
export function auditSubsystemPages(
  scanRoot: string = root,
  exemptions: Readonly<Record<string, string>> = GROUPS_WITHOUT_SUBSYSTEM_PAGE,
): SubsystemPageAudit {
  /**
   * 常量说明：readmes 用于处理 readmes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readmes = globSync('packages/*/README.md', { cwd: scanRoot }).map(normalize).sort()
  /**
   * 常量说明：manifests 用于处理 manifests 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifests = globSync('packages/*/*/package.json', { cwd: scanRoot }).map(normalize).sort()
  /**
   * 常量说明：groups 用于处理 groups 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const groups = new Set([...readmes, ...manifests].map(groupOf))
  /**
   * 常量说明：violations 用于处理 violations 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const violations: string[] = []
  /**
   * 变量说明：linked 用于处理 linked 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let linked = 0
  /**
   * 变量说明：exempt 用于处理 exempt 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let exempt = 0

  /**
   * 变量说明：group、reason 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [group, reason] of Object.entries(exemptions)) {
    if (!groups.has(group)) {
      violations.push(`exemption ${group}: no matching package group; remove the stale entry`)
    }
    if (reason.trim().length === 0) {
      violations.push(`exemption ${group}: missing justification for omitting a subsystem page`)
    }
  }

  /**
   * 变量说明：group 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const group of [...groups].sort()) {
    /**
     * 常量说明：readme 用于处理 readme 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readme = `packages/${group}/README.md`
    /**
     * 常量说明：readmePath 用于处理 readmePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const readmePath = resolve(scanRoot, readme)
    if (!existsSync(readmePath)) {
      violations.push(`${readme}: package group has no group README declaring subsystem ownership`)
      continue
    }

    /**
     * 常量说明：links 用于处理 links 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const links = subsystemLinks(readFileSync(readmePath, 'utf8'))
    /**
     * 常量说明：isExempt 用于判断是否为 Exempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const isExempt = Object.hasOwn(exemptions, group)
    if (links.length === 0) {
      if (isExempt) {
        exempt += 1
      } else {
        violations.push(
          `${readme}: no reader-visible direct docs/subsystems/*.md link; add the owning page and link,`
          + ' or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
        )
      }
      continue
    }

    linked += 1
    if (isExempt) {
      violations.push(`${readme}: links a subsystem page but remains exempt; remove the stale exemption`)
    }
    /**
     * 变量说明：page 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const page of links) {
      if (!existsSync(resolve(scanRoot, page))) {
        violations.push(`${readme}: linked subsystem page does not exist: ${page}`)
      }
    }
  }

  return { groups: groups.size, linked, exempt, violations }
}

/** Run the repository audit as a standalone doc-sync gate.
 * @remarks 中文说明：功能说明：处理 main 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 main()，并按返回类型处理结果。 */
function main(): void {
  /**
   * 常量说明：audit 用于处理 audit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const audit = auditSubsystemPages()
  if (audit.violations.length > 0) {
    console.error('verify-subsystem-pages: package-group documentation violations found:')
    /**
     * 变量说明：violation 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const violation of audit.violations) console.error(`  ${violation}`)
    process.exit(1)
  }
  console.log(
    `verify-subsystem-pages: ${String(audit.groups)} group(s) checked`
    + ` (${String(audit.linked)} linked, ${String(audit.exempt)} explicitly exempt), all conform.`,
  )
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) main()
