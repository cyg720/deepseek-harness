/**
 * Shared workspace-package graph discovery and Mermaid identifier helpers for
 * the generated module graph and relationship-diagram generators. Each caller
 * supplies its own group ordering because the documents use different visual
 * priorities; manifest parsing and dependency-safe ordering have one owner.
 */
/**
 * 文件职责：实现 package-graph.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

/** 中文说明：常量 SCOPE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCOPE = '@deepseek-ai/dsh-'

/** One harness package and its in-repo peer-dependency edges. */
/** 中文说明：interface PackageGraphNode 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface PackageGraphNode {
  /** Package name with the `@deepseek-ai/dsh-` prefix removed. */
  short: string
  /** Full npm package name. */
  name: string
  /** Package group from `packages/<group>/<pkg>`. */
  group: string
  /** Repo-relative package directory. */
  rel: string
  /** Short names of in-repo peer dependencies, sorted. */
  deps: string[]
}

/**
 * Read every harness package manifest and return dependency-safe graph nodes.
 * @param root - absolute repository root.
 * @param groupOrder - caller-specific tiebreak order for packages in the same dependency layer.
 * @param gate - command name used in structural error messages.
 * @returns package nodes ordered after all of their in-repo dependencies.
 */
/** 中文说明：函数 collectPackageGraph 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectPackageGraph(root: string, groupOrder: readonly string[], gate: string): PackageGraphNode[] {
  /** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packages: PackageGraphNode[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const rel of globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()) {
    /** 中文说明：变量 json 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const json = JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as {
      name: string
      peerDependencies?: Record<string, string>
    }
    if (!json.name.startsWith(SCOPE)) continue
    const [, group, leaf] = rel.split('/')
    if (group === undefined || leaf === undefined) throw new Error(`${gate}: unexpected package path ${rel}`)
    /** 中文说明：变量 deps 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const deps = Object.keys(json.peerDependencies ?? {})
      .filter(dep => dep.startsWith(SCOPE))
      .map(dep => dep.slice(SCOPE.length))
      .sort()
    packages.push({
      short: json.name.slice(SCOPE.length),
      name: json.name,
      group,
      rel: dirname(rel),
      deps,
    })
  }
  return topoSort(packages, groupOrder, gate)
}

/** 中文说明：函数 topoSort 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function topoSort(packages: PackageGraphNode[], groupOrder: readonly string[], gate: string): PackageGraphNode[] {
  /** 中文说明：函数值 remaining 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const remaining = new Map(packages.map(pkg => [pkg.short, pkg]))
  /** 中文说明：变量 placed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const placed = new Set<string>()
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: PackageGraphNode[] = []
  while (remaining.size > 0) {
    /** 中文说明：变量 ready 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ready = [...remaining.values()]
      .filter(pkg => pkg.deps.every(dep => placed.has(dep)))
      .sort((a, b) => comparePackages(a, b, groupOrder))
    if (ready.length === 0) throw new Error(`${gate}: dependency cycle among ${[...remaining.keys()].join(', ')}`)
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const pkg of ready) {
      out.push(pkg)
      placed.add(pkg.short)
      remaining.delete(pkg.short)
    }
  }
  return out
}

/** 中文说明：函数 comparePackages 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function comparePackages(a: PackageGraphNode, b: PackageGraphNode, groupOrder: readonly string[]): number {
  /** 中文说明：变量 groupA 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groupA = groupOrder.indexOf(a.group)
  /** 中文说明：变量 groupB 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groupB = groupOrder.indexOf(b.group)
  /** 中文说明：变量 normA 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normA = groupA === -1 ? Number.MAX_SAFE_INTEGER : groupA
  /** 中文说明：变量 normB 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normB = groupB === -1 ? Number.MAX_SAFE_INTEGER : groupB
  return normA - normB || a.group.localeCompare(b.group) || a.short.localeCompare(b.short)
}

/** Stable Mermaid id for a graph value. */
/** 中文说明：函数 graphNodeId 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function graphNodeId(prefix: string, value: string): string {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

/** Escape a value embedded in a quoted Mermaid label. */
/** 中文说明：函数 escapeMermaidLabel 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"')
}
