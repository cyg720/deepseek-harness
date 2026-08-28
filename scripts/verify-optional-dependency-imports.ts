/**
 * Reject a static value import of an optional dependency.
 *
 * A dependency declared in `optionalDependencies`, or as a peer carrying
 * `peerDependenciesMeta.<name>.optional`, may be absent from an installed tree —
 * that absence is what "optional" promises a consumer. A static import is
 * evaluated when the importing module loads, so one absent package turns
 * "this capability is unavailable" into a load failure for everything that
 * reaches the importing module.
 *
 * The way out, in order: import it as a type, which emits nothing and is all
 * that declaration merging needs; or restructure so nothing at module scope
 * needs the package. A dynamic `import()` only moves the failure to first use,
 * so it belongs to a caller that genuinely requires the package and handles its
 * absence — it is a last resort, not the default answer, and reaching for it is
 * a sign the dependency is not optional.
 *
 * Value-vs-type is decided against a bound Program rather than the import
 * syntax, because `verbatimModuleSyntax` is off: a named import used only in
 * type positions is elided and does not load anything. The decision is
 * deliberately conservative in one direction — a value binding the compiler
 * would elide because nothing references it in a value position is still
 * reported, and the fix it asks for (`import type`, or dropping the binding) is
 * what the published package wants regardless. Both compiler faces are scanned,
 * and only files that ship — a published package's `src` — are subject.
 */
/*
 * 文件职责：实现 verify-optional-dependency-imports.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { TypeScriptProject, type CompilerFace } from './ts-project.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** Directories whose `src` ships as a published package. */
/* 中文说明：常量 PUBLISHED_SOURCE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PUBLISHED_SOURCE = /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+)\/src\//

/** How a manifest marked a dependency optional, for the violation message. */
/* 中文说明：type OptionalKind 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
type OptionalKind = 'optionalDependencies' | 'peerDependenciesMeta'

/**
 * The package name a module specifier resolves to.
 * @param specifier - an import specifier, possibly a subpath.
 * @returns The bare package name, keeping a leading scope.
 */
/* 中文说明：函数 packageOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function packageOf(specifier: string): string {
  /** 中文说明：变量 parts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier
}

/**
 * Read a manifest field as a record.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @returns The field value, or an empty record.
 */
/* 中文说明：函数 record 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function record(manifest: Record<string, unknown>, field: string): Record<string, unknown> {
  /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = manifest[field]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * The dependencies one manifest allows to be absent.
 * @param manifest - parsed manifest.
 * @returns Each optional package name and how it was marked.
 */
/* 中文说明：函数 optionalDependencies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function optionalDependencies(manifest: Record<string, unknown>): Map<string, OptionalKind> {
  /** 中文说明：变量 optional 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const optional = new Map<string, OptionalKind>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const name of Object.keys(record(manifest, 'optionalDependencies'))) {
    optional.set(name, 'optionalDependencies')
  }
  /** 中文说明：变量 peers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const peers = record(manifest, 'peerDependencies')
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [name, meta] of Object.entries(record(manifest, 'peerDependenciesMeta'))) {
    if (meta === null || typeof meta !== 'object') continue
    if ((meta as Record<string, unknown>).optional !== true) continue
    // A meta entry for an undeclared peer is check-workspace-constraints' business.
    if (!(name in peers)) continue
    optional.set(name, 'peerDependenciesMeta')
  }
  return optional
}

/** One package directory's optional dependencies, resolved once per directory. */
/* 中文说明：变量 optionalByDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const optionalByDirectory = new Map<string, Map<string, OptionalKind>>()

/**
 * The optional dependencies of the package owning a source file.
 * @param projectRoot - root the relative path is resolved against.
 * @param relativePath - repository-relative path of a source file.
 * @returns That package's optional dependencies, empty when it declares none.
 */
/* 中文说明：函数 optionalFor 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function optionalFor(projectRoot: string, relativePath: string): Map<string, OptionalKind> {
  /** 中文说明：变量 directory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = resolve(projectRoot, relativePath.slice(0, relativePath.indexOf('/src/')))
  /** 中文说明：变量 cached 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cached = optionalByDirectory.get(directory)
  if (cached !== undefined) return cached
  /** 中文说明：变量 manifestPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifestPath = resolve(directory, 'package.json')
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed: unknown = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
  /** 中文说明：变量 optional 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const optional = optionalDependencies(manifest)
  optionalByDirectory.set(directory, optional)
  return optional
}

/**
 * Whether one binding of an import or re-export names a value.
 * @param name - the local binding name node.
 * @param checker - the program's checker.
 * @returns True when the binding carries value meaning, and on an unresolved
 * symbol, so an unresolvable binding fails closed.
 */
/* 中文说明：函数 bindsValue 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function bindsValue(name: ts.Identifier | ts.StringLiteral, checker: ts.TypeChecker): boolean {
  /** 中文说明：变量 symbol 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const symbol = checker.getSymbolAtLocation(name)
  if (symbol === undefined) return true
  /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const target = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  return (target.flags & ts.SymbolFlags.Value) !== 0
}

/**
 * Whether an import declaration loads its module at run time.
 * @param declaration - the import declaration.
 * @param checker - the program's checker.
 * @returns True when the emitted module keeps the import.
 */
/* 中文说明：函数 importLoadsModule 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function importLoadsModule(declaration: ts.ImportDeclaration, checker: ts.TypeChecker): boolean {
  /** 中文说明：变量 clause 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const clause = declaration.importClause
  // A bare `import 'x'` is kept for its side effects.
  if (clause === undefined) return true
  // Only the type phase erases the import. `import defer` still resolves and
  // links the module, deferring evaluation alone, so an absent package fails
  // exactly as it would without the modifier.
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false
  if (clause.name !== undefined) return true
  /** 中文说明：变量 bindings 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bindings = clause.namedBindings
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return true
  return bindings.elements.some(element => !element.isTypeOnly && bindsValue(element.name, checker))
}

/**
 * Whether a re-export loads its module at run time.
 * @param declaration - the export declaration, which carries a module specifier.
 * @param checker - the program's checker.
 * @returns True when the emitted module keeps the re-export.
 */
/* 中文说明：函数 exportLoadsModule 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function exportLoadsModule(declaration: ts.ExportDeclaration, checker: ts.TypeChecker): boolean {
  if (declaration.isTypeOnly) return false
  /** 中文说明：变量 clause 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const clause = declaration.exportClause
  // `export * from 'x'` re-exports whatever values the module has.
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.some(element => !element.isTypeOnly && bindsValue(element.name, checker))
}

/**
 * Collect every static value import of an optional dependency in one face.
 * @param project - a bound repository project.
 * @returns One message per violation, sorted by location.
 */
/* 中文说明：函数 collectOptionalImportViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectOptionalImportViolations(project: TypeScriptProject): string[] {
  /** 中文说明：变量 checker 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const checker = project.checker
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const sourceFile of project.sourceFiles()) {
    if (sourceFile.isDeclarationFile) continue
    /** 中文说明：变量 relativePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const relativePath = project.relativePath(sourceFile)
    if (!PUBLISHED_SOURCE.test(relativePath)) continue
    /** 中文说明：变量 optional 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const optional = optionalFor(project.projectRoot, relativePath)
    if (optional.size === 0) continue

    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const statement of sourceFile.statements) {
      /** 中文说明：变量 isImport 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const isImport = ts.isImportDeclaration(statement)
      if (!isImport && !ts.isExportDeclaration(statement)) continue
      /** 中文说明：变量 specifierNode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const specifierNode = statement.moduleSpecifier
      if (specifierNode === undefined || !ts.isStringLiteral(specifierNode)) continue
      /** 中文说明：变量 kind 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const kind = optional.get(packageOf(specifierNode.text))
      if (kind === undefined) continue
      /** 中文说明：变量 loads 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const loads = isImport
        ? importLoadsModule(statement, checker)
        : exportLoadsModule(statement, checker)
      if (!loads) continue
      const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
      violations.push(
        `${relativePath}:${String(line + 1)} loads ${specifierNode.text} at module scope,`
        + ` declared optional in ${kind}; import it as a type, or restructure so module scope does not need it`,
      )
    }
  }
  return violations.sort((left, right) => left.localeCompare(right))
}

/** CLI entry: list every violation and exit 1, or confirm the invariant holds. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  /** 中文说明：变量 faces 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const faces: readonly CompilerFace[] = ['host', 'client']
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const face of faces) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const violation of collectOptionalImportViolations(new TypeScriptProject(root, face))) {
      violations.add(violation)
    }
  }
  if (violations.size === 0) {
    console.log('verify-optional-dependency-imports: no optional dependency is loaded at module scope.')
    return
  }
  console.error(`verify-optional-dependency-imports: ${String(violations.size)} optional dependency load(s) at module scope:`)
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const violation of [...violations].sort((left, right) => left.localeCompare(right))) {
    console.error(`  ${violation}`)
  }
  process.exit(1)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
