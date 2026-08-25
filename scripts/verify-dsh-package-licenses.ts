/**
 * Enforce the MIT license declaration for repository-owned DSH npm packages.
 * @module scripts/verify-dsh-package-licenses
 */
/*
 * 文件职责：实现 verify-dsh-package-licenses.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** 中文说明：常量 ROOT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ROOT = resolve(import.meta.dirname, '..')
/** 中文说明：常量 DSH_PACKAGE_NAME 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DSH_PACKAGE_NAME = /^@deepseek-ai\/dsh(?:-|$)/

/** Result of checking every DSH package reachable through the root workspace list. */
/* 中文说明：interface DshPackageLicenseReport 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface DshPackageLicenseReport {
  /** Number of DSH package manifests checked. */
  packageCount: number
  /** Repository-relative diagnostics for non-MIT declarations. */
  failures: string[]
}

/** 中文说明：函数 readManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readManifest(root: string, file: string): Record<string, unknown> {
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-dsh-package-licenses: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

/** 中文说明：函数 isStringArray 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

/** 中文说明：函数 workspaceManifestPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function workspaceManifestPaths(root: string): string[] {
  /** 中文说明：变量 rootManifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rootManifest = readManifest(root, 'package.json')
  /** 中文说明：变量 workspaces 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workspaces = rootManifest.workspaces
  if (!isStringArray(workspaces)) {
    throw new Error('verify-dsh-package-licenses: package.json workspaces must be a string array.')
  }

  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files = new Set(['package.json'])
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pattern of workspaces) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const file of globSync(`${pattern}/package.json`, { cwd: root })) {
      files.add(file)
    }
  }
  return [...files].sort()
}

/** 中文说明：函数 printable 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function printable(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Check every DSH npm package declared by the repository workspace.
 * @param root - absolute repository root containing the workspace package.json.
 * @returns the checked package count and every non-MIT declaration.
 */
/* 中文说明：函数 inspectDshPackageLicenses 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function inspectDshPackageLicenses(root: string): DshPackageLicenseReport {
  /** 中文说明：变量 packageCount 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let packageCount = 0
  /** 中文说明：变量 failures 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const failures: string[] = []

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const file of workspaceManifestPaths(root)) {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = readManifest(root, file)
    /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const name = manifest.name
    if (typeof name !== 'string' || !DSH_PACKAGE_NAME.test(name)) continue

    packageCount++
    if (manifest.license !== 'MIT') {
      /** 中文说明：变量 normalizedFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const normalizedFile = file.split(sep).join('/')
      failures.push(
        `${normalizedFile}: ${name} must declare "license": "MIT"; found ${printable(manifest.license)}.`,
      )
    }
  }

  return { packageCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  /** 中文说明：变量 report 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const report = inspectDshPackageLicenses(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-dsh-package-licenses: non-MIT DSH package declarations found:\n')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-dsh-package-licenses: ${String(report.packageCount)} DSH package(s) checked; all declare MIT.\n`,
    )
  }
}
