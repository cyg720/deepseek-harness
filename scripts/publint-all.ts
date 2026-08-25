/** Run publint over the exact manifest-declared publication view of every package. */
/*
 * 文件职责：实现 publint-all.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import {
  globSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, posix, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { publint, type Message, type PackFile } from 'publint'
import { formatMessage } from 'publint/utils'
import ts from 'typescript'

/** 中文说明：常量 CONCURRENCY_ENV 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONCURRENCY_ENV = 'DSH_PUBLINT_CONCURRENCY'
/** 中文说明：变量 repositoryRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repositoryRoot = resolve(import.meta.dirname, '..')
const { values: options } = parseArgs({
  args: process.argv.slice(2),
  options: { 'packages-root': { type: 'string' } },
})
/** 中文说明：变量 packagesRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packagesRoot = resolve(options['packages-root'] ?? repositoryRoot)

/** 中文说明：interface PackageTarget 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PackageTarget {
  path: string
  directory: string
  manifest: PackageManifest
}

/** 中文说明：interface PackageManifest 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PackageManifest {
  name?: string
  files?: unknown
}

/** 中文说明：type PublintResult 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PublintResult =
  | {
    path: string
    status: 'passed'
    messages: Message[]
    closureViolations: string[]
    manifest: Record<string, unknown>
  }
  | {
    path: string
    status: 'failed'
    messages: Message[]
    closureViolations: string[]
    manifest: Record<string, unknown>
    failure?: string
  }

/** 中文说明：函数 workspacePackages 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function workspacePackages(): PackageTarget[] {
  return globSync('packages/*/*/package.json', { cwd: packagesRoot })
    .sort()
    .map((manifestPath) => {
      /** 中文说明：变量 absoluteManifestPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const absoluteManifestPath = resolve(packagesRoot, manifestPath)
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = JSON.parse(readFileSync(absoluteManifestPath, 'utf8')) as PackageManifest
      return { path: dirname(manifestPath), directory: dirname(absoluteManifestPath), manifest }
    })
}

/** 中文说明：函数 publintConcurrency 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function publintConcurrency(total: number): number {
  if (total === 0) return 0

  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env[CONCURRENCY_ENV]
  if (raw !== undefined && raw !== '') {
    /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
      throw new Error(`publint-all: ${CONCURRENCY_ENV} must be a positive integer, got ${JSON.stringify(raw)}.`)
    }
    return Math.min(total, parsed)
  }

  return Math.min(total, availableParallelism())
}

/** 中文说明：函数 publicationFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function publicationFiles(target: PackageTarget): PackFile[] {
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = new Set<string>()
  addPath(resolve(target.directory, 'package.json'), paths)
  /** 中文说明：变量 declared 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declared = Array.isArray(target.manifest.files)
    ? target.manifest.files.filter((value): value is string => typeof value === 'string')
    : []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const pattern of [
    ...declared,
    'README*',
    'LICENSE*',
    'LICENCE*',
    'CHANGELOG*',
    'CHANGES*',
    'HISTORY*',
    'NOTICE*',
  ]) {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const match of globSync(pattern, { cwd: target.directory })) {
      addPath(resolve(target.directory, match), paths)
    }
  }

  return [...paths]
    .sort()
    .map(path => ({
      name: `package/${relative(target.directory, path).split(sep).join('/')}`,
      data: readFileSync(path),
    }))
}

/** 中文说明：函数 addPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function addPath(path: string, paths: Set<string>): void {
  /** 中文说明：变量 stat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stat = statSync(path)
  if (stat.isDirectory()) {
    // readdirSync, not globSync: `**/*` skips dot-prefixed segments, but npm
    // pack publishes dotfiles inside included directories, and this view must
    // match what npm publishes.
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) paths.add(resolve(entry.parentPath, entry.name))
    }
  } else if (stat.isFile()) {
    paths.add(path)
  }
}

/** 中文说明：interface RelativeImport 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface RelativeImport {
  specifier: string
  line: number
}

/** Return relative imports whose targets are absent from the publication view. */
/* 中文说明：函数 publicationClosureViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function publicationClosureViolations(target: PackageTarget, files: readonly PackFile[]): string[] {
  /** 中文说明：函数值 published 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const published = new Set(files.map(file => file.name))
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const file of files) {
    if (!/\.(?:js|mjs|cjs)$/.test(file.name)) continue
    /** 中文说明：变量 bytes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bytes = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data
    /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const imported of relativeImports(file.name, source)) {
      /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const resolved = posix.normalize(posix.join(posix.dirname(file.name), imported.specifier))
      if (resolutionCandidates(resolved).some(candidate => published.has(candidate))) continue
      violations.push(
        `${target.path}/${file.name.slice('package/'.length)}:${String(imported.line)}`
        + ` imports ${JSON.stringify(imported.specifier)}, but ${target.manifest.name ?? target.path}`
        + ` does not publish ${JSON.stringify(resolved.slice('package/'.length))}`,
      )
    }
  }
  return violations
}

/** Paths a relative JavaScript module request can resolve to in a published package. */
/* 中文说明：函数 resolutionCandidates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function resolutionCandidates(target: string): string[] {
  /** 中文说明：变量 base 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const base = target.replace(/\/+$/, '')
  return [
    target,
    ...['.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs'].map(suffix => base + suffix),
  ]
}

/** Extract relative static imports, re-exports, dynamic imports, and requires. */
/* 中文说明：函数 relativeImports 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function relativeImports(file: string, sourceText: string): RelativeImport[] {
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  /** 中文说明：变量 imports 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const imports: RelativeImport[] = []
  /** 中文说明：函数值 record 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const record = (node: ts.Node, literal: ts.Expression | undefined): void => {
    if (literal === undefined || !ts.isStringLiteralLike(literal) || !literal.text.startsWith('.')) return
    imports.push({
      specifier: literal.text,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    })
  }
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node, node.moduleSpecifier)
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      record(node, node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

/** 中文说明：函数 runPublint 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function runPublint(target: PackageTarget): Promise<PublintResult> {
  try {
    /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files = publicationFiles(target)
    /** 中文说明：变量 closureViolations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closureViolations = publicationClosureViolations(target, files)
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await publint({
      pkgDir: 'package',
      pack: { files },
    })
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = result.pkg as Record<string, unknown>
    return result.messages.some(message => message.type === 'error') || closureViolations.length > 0
      ? { path: target.path, status: 'failed', messages: result.messages, closureViolations, manifest }
      : { path: target.path, status: 'passed', messages: result.messages, closureViolations, manifest }
  } catch (error: unknown) {
    return {
      path: target.path,
      status: 'failed',
      messages: [],
      closureViolations: [],
      manifest: target.manifest as Record<string, unknown>,
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 中文说明：函数 runAll 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function runAll(targets: PackageTarget[], concurrency: number): Promise<PublintResult[]> {
  /** 中文说明：变量 next 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let next = 0
  /** 中文说明：变量 results 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const results: Array<PublintResult | undefined> = []
  await Promise.all(Array.from({ length: concurrency }, async () => {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (;;) {
      /** 中文说明：变量 index 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const index = next
      next += 1
      /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const target = targets[index]
      if (target === undefined) return
      results[index] = await runPublint(target)
    }
  }))

  return targets.map((target, index) => {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = results[index]
    if (result === undefined) throw new Error(`publint-all: missing result for ${target.path}.`)
    return result
  })
}

/** 中文说明：函数 printResult 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function printResult(result: PublintResult): void {
  console.log(`Running publint for ${result.path}...`)
  if ('failure' in result) console.error(result.failure)
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const message of result.messages) {
    console.log(formatMessage(message, result.manifest, { color: false }) ?? message.code)
  }
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const violation of result.closureViolations) console.error(violation)
  if (result.status === 'passed' && result.messages.length === 0 && result.closureViolations.length === 0) {
    console.log('All good!')
  }
}

/** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packages = workspacePackages()
/** 中文说明：变量 concurrency 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const concurrency = publintConcurrency(packages.length)
console.log(`publint-all: linting ${packages.length} package(s) with ${concurrency} worker(s).`)

/** 中文说明：变量 results 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const results = await runAll(packages, concurrency)
/** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
for (const result of results) printResult(result)

if (results.some(result => result.status === 'failed')) process.exit(1)
