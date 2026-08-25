/**
 * Verify client package modes, npm dependency sections, and the synchronous
 * browser module-request graph.
 */
/**
 * 文件职责：实现 verify-client-packages.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { TypeScriptProject } from './ts-project.ts'

/** 中文说明：常量 GATE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const GATE = 'verify-client-packages'
/** 中文说明：常量 CLIENT_MANIFEST_GLOB 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_MANIFEST_GLOB = 'packages/client/*/package.json'
/** 中文说明：常量 MANIFEST_GLOBS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MANIFEST_GLOBS = ['packages/*/*/package.json', 'apps/*/package.json', 'vendor/*/package.json']
/** 中文说明：常量 CONFIG_GLOB 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG_GLOB = 'packages/*/*/tsdown.config.ts'
/** 中文说明：常量 PLATFORM_SOURCE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PLATFORM_SOURCE = 'packages/client/web/src/platform.ts'
/** 中文说明：常量 PARSER_PRELOAD_SOURCE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PARSER_PRELOAD_SOURCE = 'packages/client/modules/src/index.ts'
/** 中文说明：常量 STATIC_PRESET_SOURCE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const STATIC_PRESET_SOURCE = 'packages/client/tsdown.client.ts'
/** 中文说明：常量 CORDIS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CORDIS = '@deepseek-ai/cordis'
/** 中文说明：常量 DSH_PREFIX 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DSH_PREFIX = '@deepseek-ai/dsh-'
/** 中文说明：常量 CLIENT_WEB 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_WEB = '@deepseek-ai/dsh-client-web'

/** One workspace package's browser-module declaration. */
/** 中文说明：interface ClientDeclaration 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface ClientDeclaration {
  /** npm package name. */
  readonly name: string
  /** Repository-relative package manifest. */
  readonly manifest: string
  /** Whether the manifest declares a dynamic dsh.client row. */
  readonly dynamic: boolean
  /** Exact module-table specifiers requested by the row. */
  readonly external: readonly string[]
  /** Informational package dependencies declared by the row. */
  readonly inject: readonly string[]
}

/** One package directly under packages/client. */
/** 中文说明：interface ClientPackage 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface ClientPackage extends ClientDeclaration {
  /** Whether its build config uses the staticLinked preset. */
  readonly staticLinked: boolean
  /** Production source locations grouped by imported package name. */
  readonly sourceUses: Readonly<Record<string, readonly string[]>>
  /** Production source locations grouped by runtime-imported package name. */
  readonly runtimeSourceUses: Readonly<Record<string, readonly string[]>>
  /** Installed implementation dependencies. */
  readonly dependencies: Readonly<Record<string, string>>
  /** Consumer-supplied dependencies. */
  readonly peerDependencies: Readonly<Record<string, string>>
  /** Dependencies available while developing the package. */
  readonly devDependencies: Readonly<Record<string, string>>
}

/** Complete source-plane input to the client package verifier. */
/** 中文说明：interface ClientPackageFacts 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface ClientPackageFacts {
  /** Packages directly under packages/client. */
  readonly packages: readonly ClientPackage[]
  /** Every workspace package, including packages without a browser row. */
  readonly declarations: readonly ClientDeclaration[]
  /** Packages whose build config uses the staticLinked preset. */
  readonly staticLinkedPackages: ReadonlySet<string>
  /** Specifiers the web shell seeds into the module table. */
  readonly platformModules: readonly string[]
  /** Dynamic factories the HTML parser loads before shell boot. */
  readonly preloadedExternals: readonly string[]
  /** Package rows whose bundles the HTML parser executes before shell boot. */
  readonly parserPreloadIds: readonly string[]
  /** Manifest field errors found while reading declarations. */
  readonly malformed: readonly string[]
}

/** Result of reading every workspace browser-module declaration. */
/** 中文说明：interface ClientDeclarations 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface ClientDeclarations {
  /** One declaration record per named workspace manifest. */
  readonly declarations: ClientDeclaration[]
  /** Manifest field errors that prevent a reliable declaration. */
  readonly malformed: string[]
}

/**
 * Collect bare packages referenced by one production source file.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @returns Bare package names referenced by imports, declarations, or JSX.
 */
/** 中文说明：函数 collectSourcePackageUses 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectSourcePackageUses(path: string, source: string): Set<string> {
  /** 中文说明：变量 sourceFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFilePackageUses(sourceFile, false)
}

/**
 * Collect bare packages whose values one production source file reaches at runtime.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @returns Bare package names retained by runtime imports, exports, requires, or JSX.
 */
/** 中文说明：函数 collectRuntimeSourcePackageUses 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectRuntimeSourcePackageUses(path: string, source: string): Set<string> {
  /** 中文说明：变量 sourceFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFilePackageUses(sourceFile, true)
}

/** 中文说明：函数 importCarriesRuntimeValue 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function importCarriesRuntimeValue(node: ts.ImportDeclaration): boolean {
  /** 中文说明：变量 clause 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const clause = node.importClause
  if (clause === undefined) return true
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false
  /** 中文说明：变量 bindings 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bindings = clause.namedBindings
  return clause.name !== undefined
    || bindings === undefined
    || ts.isNamespaceImport(bindings)
    || bindings.elements.length === 0
    || bindings.elements.some(element => !element.isTypeOnly)
}

/** 中文说明：函数 exportCarriesRuntimeValue 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function exportCarriesRuntimeValue(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false
  /** 中文说明：变量 clause 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const clause = node.exportClause
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.length === 0 || clause.elements.some(element => !element.isTypeOnly)
}

/** 中文说明：函数 collectSourceFilePackageUses 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectSourceFilePackageUses(sourceFile: ts.SourceFile, runtimeOnly: boolean): Set<string> {
  /** 中文说明：变量 uses 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const uses = new Set<string>()

  /** 中文说明：函数值 add 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const add = (specifier: ts.Expression | undefined): void => {
    if (specifier === undefined || !ts.isStringLiteral(specifier) || !isBareSpecifier(specifier.text)) return
    uses.add(packageNameOf(specifier.text))
  }
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!runtimeOnly || importCarriesRuntimeValue(node)) add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      if (!runtimeOnly || exportCarriesRuntimeValue(node)) add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!runtimeOnly || !node.isTypeOnly) add(node.moduleReference.expression)
    } else if (!runtimeOnly && ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      add(node.arguments[0])
    } else if (!runtimeOnly && ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      add(node.name)
    } else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      uses.add('react')
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return uses
}

/**
 * Read browser-module declarations from workspace manifests.
 * @param root - Absolute repository root.
 * @returns Declarations and malformed dsh.client fields.
 */
/** 中文说明：函数 readClientDeclarations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function readClientDeclarations(root: string): ClientDeclarations {
  /** 中文说明：变量 malformed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const malformed: string[] = []
  /** 中文说明：变量 declarations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declarations = globSync(MANIFEST_GLOBS, { cwd: root })
    .map(normalizePath)
    .sort()
    .flatMap(path => readDeclaration(root, path, malformed) ?? [])
  return { declarations, malformed }
}

/**
 * Return every client package policy violation.
 * @param facts - Package modes, manifests, source uses, and platform module lists.
 * @returns Stable self-contained diagnostics.
 */
/** 中文说明：函数 collectClientPackageViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectClientPackageViolations(facts: ClientPackageFacts): string[] {
  return [
    ...facts.malformed,
    ...collectModeViolations(facts),
    ...collectDependencyViolations(facts),
    ...collectModuleViolations(facts),
  ].sort((left, right) => left.localeCompare(right))
}

/** 中文说明：interface ManifestDocument 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface ManifestDocument {
  readonly path: string
  readonly manifest: Manifest
  changed: boolean
}

/** 中文说明：type DependencySection 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
type DependencySection = 'dependencies' | 'peerDependencies' | 'devDependencies'

/**
 * Repair manifest declarations whose intended result follows uniquely from the policy.
 * @param root - Absolute repository root.
 * @param facts - Facts used by the verification pass.
 * @returns Repository-relative manifests written by the fixer.
 */
/** 中文说明：函数 fixClientPackageManifests 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function fixClientPackageManifests(root: string, facts: ClientPackageFacts): string[] {
  /** 中文说明：变量 documents 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const documents = new Map<string, ManifestDocument>()
  /** 中文说明：函数值 document 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const document = (path: string): ManifestDocument => {
    /** 中文说明：变量 cached 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cached = documents.get(path)
    if (cached !== undefined) return cached
    /** 中文说明：变量 loaded 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded: ManifestDocument = {
      path,
      manifest: JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Manifest,
      changed: false,
    }
    documents.set(path, loaded)
    return loaded
  }

  /** 中文说明：变量 baseline 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const baseline = new Set([...facts.platformModules, ...facts.preloadedExternals])
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const declaration of facts.declarations.filter(entry => entry.dynamic)) {
    /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = document(declaration.manifest)
    /** 中文说明：变量 dsh 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = isRecord(target.manifest.dsh) ? target.manifest.dsh : undefined
    /** 中文说明：变量 client 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const client = isRecord(dsh?.client) ? dsh.client : undefined
    if (client === undefined) continue
    target.changed = normalizeClientArray(client, 'inject', () => false) || target.changed
    target.changed = normalizeClientArray(
      client,
      'external',
      value => baseline.has(value) || rowPackageOf(value, new Set([declaration.name])) === declaration.name,
    ) || target.changed
  }

  /** 中文说明：变量 staticInputs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const staticInputs = new Set([
    ...facts.staticLinkedPackages,
    ...facts.platformModules.map(packageNameOf),
  ])
  staticInputs.delete(CORDIS)
  /** 中文说明：变量 inferredRanges 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inferredRanges = dependencyRangeCandidates(root)
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pkg of facts.packages) {
    /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = document(pkg.manifest)
    /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = expectedSections(pkg, staticInputs)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const [name, rule] of expected) {
      /** 中文说明：变量 range 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const range = preferredRange(target.manifest, name, rule.kind, inferredRanges)
      if (range === undefined) continue
      target.changed = rule.kind === 'dependency'
        ? ensureDependencyOnly(target.manifest, name, range) || target.changed
        : rule.kind === 'dev'
          ? ensureDevOnly(target.manifest, name, range) || target.changed
          : ensurePeerDev(target.manifest, name, range) || target.changed
    }

    if (pkg.dynamic) {
      /** 中文说明：变量 productionNames 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const productionNames = new Set([
        ...Object.keys(section(target.manifest, 'dependencies')),
        ...Object.keys(section(target.manifest, 'peerDependencies')),
      ])
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const name of productionNames) {
        if (expected.has(name)) continue
        /** 中文说明：变量 range 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const range = preferredRange(
          target.manifest,
          name,
          staticInputs.has(name) ? 'dev' : 'peer-dev',
          inferredRanges,
        )
        if (range === undefined) continue
        if (staticInputs.has(name)) {
          target.changed = ensureDevOnly(target.manifest, name, range) || target.changed
        } else if (section(target.manifest, 'dependencies')[name] !== undefined && isInternalDsh(name)) {
          target.changed = ensurePeerDev(target.manifest, name, range) || target.changed
        }
      }
    }

    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const [name, range] of Object.entries(section(target.manifest, 'peerDependencies'))) {
      target.changed = setDependency(target.manifest, 'devDependencies', name, range) || target.changed
    }
    target.changed = deleteEmptySections(target.manifest) || target.changed
  }

  /** 中文说明：函数值 changed 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const changed = [...documents.values()].filter(target => target.changed).sort((left, right) =>
    left.path.localeCompare(right.path))
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const target of changed) {
    writeFileSync(resolve(root, target.path), JSON.stringify(target.manifest, null, 2) + '\n')
  }
  return changed.map(target => target.path)
}

/** 中文说明：函数 normalizeClientArray 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizeClientArray(
  client: Record<string, unknown>,
  field: 'external' | 'inject',
  remove: (value: string) => boolean,
): boolean {
  /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = client[field]
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) return false
  /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Set<string>()
  /** 中文说明：函数值 normalized 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const normalized = value.filter((entry: string) => {
    if (entry === '' || seen.has(entry) || remove(entry)) return false
    seen.add(entry)
    return true
  })
  if (normalized.length === value.length && normalized.every((entry, index) => entry === value[index])) return false
  if (normalized.length === 0) {
    if (field === 'external') delete client.external
    else delete client.inject
  } else {
    client[field] = normalized
  }
  return true
}

/** 中文说明：函数 ensureDevOnly 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ensureDevOnly(manifest: Manifest, name: string, range: string): boolean {
  /** 中文说明：变量 changed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let changed = deleteDependency(manifest, 'dependencies', name)
  changed = deleteDependency(manifest, 'peerDependencies', name) || changed
  return setDependency(manifest, 'devDependencies', name, range) || changed
}

/** 中文说明：函数 ensureDependencyOnly 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ensureDependencyOnly(manifest: Manifest, name: string, range: string): boolean {
  /** 中文说明：变量 changed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let changed = deleteDependency(manifest, 'peerDependencies', name)
  changed = deleteDependency(manifest, 'devDependencies', name) || changed
  return setDependency(manifest, 'dependencies', name, range) || changed
}

/** 中文说明：函数 ensurePeerDev 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ensurePeerDev(manifest: Manifest, name: string, range: string): boolean {
  /** 中文说明：变量 changed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let changed = deleteDependency(manifest, 'dependencies', name)
  changed = setDependency(manifest, 'peerDependencies', name, range) || changed
  return setDependency(manifest, 'devDependencies', name, range) || changed
}

/** 中文说明：函数 setDependency 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function setDependency(manifest: Manifest, field: DependencySection, name: string, range: string): boolean {
  /** 中文说明：变量 dependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dependencies = mutableSection(manifest, field)
  if (dependencies[name] === range) return false
  dependencies[name] = range
  return true
}

/** 中文说明：函数 deleteDependency 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function deleteDependency(manifest: Manifest, field: DependencySection, name: string): boolean {
  /** 中文说明：变量 dependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dependencies = section(manifest, field)
  if (dependencies[name] === undefined) return false
  manifest[field] = Object.fromEntries(Object.entries(dependencies).filter(([key]) => key !== name))
  return true
}

/** 中文说明：函数 deleteEmptySections 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function deleteEmptySections(manifest: Manifest): boolean {
  /** 中文说明：变量 changed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let changed = false
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
    if (manifest[field] === undefined || Object.keys(section(manifest, field)).length > 0) continue
    if (field === 'dependencies') delete manifest.dependencies
    else if (field === 'peerDependencies') delete manifest.peerDependencies
    else delete manifest.devDependencies
    changed = true
  }
  return changed
}

/** 中文说明：函数 preferredRange 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function preferredRange(
  manifest: Manifest,
  name: string,
  kind: ExpectedRule['kind'],
  inferred: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  /** 中文说明：变量 order 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const order: readonly DependencySection[] = kind === 'dependency'
    ? ['dependencies', 'devDependencies', 'peerDependencies']
    : kind === 'dev'
      ? ['devDependencies', 'peerDependencies', 'dependencies']
      : ['peerDependencies', 'devDependencies', 'dependencies']
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const field of order) {
    /** 中文说明：变量 range 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const range = section(manifest, field)[name]
    if (range !== undefined) return range
  }
  if (isInternalDsh(name)) return 'workspace:^'
  /** 中文说明：变量 candidates 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const candidates = inferred.get(name)
  return candidates?.size === 1 ? [...candidates][0] : undefined
}

/** 中文说明：函数 dependencyRangeCandidates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function dependencyRangeCandidates(root: string): Map<string, Set<string>> {
  /** 中文说明：变量 candidates 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const candidates = new Map<string, Set<string>>()
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = globSync([
    'package.json',
    ...MANIFEST_GLOBS,
    'website/package.json',
  ], { cwd: root }).map(normalizePath)
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const path of new Set(paths)) {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Manifest
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const [name, range] of Object.entries(section(manifest, field))) {
        /** 中文说明：变量 ranges 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ranges = candidates.get(name) ?? new Set<string>()
        ranges.add(range)
        candidates.set(name, ranges)
      }
    }
  }
  return candidates
}

/** 中文说明：函数 section 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function section(manifest: Manifest, field: DependencySection): Record<string, string> {
  return manifest[field] ?? {}
}

/** 中文说明：函数 mutableSection 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function mutableSection(manifest: Manifest, field: DependencySection): Record<string, string> {
  /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = manifest[field]
  if (value !== undefined) return value
  /** 中文说明：变量 created 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const created: Record<string, string> = {}
  manifest[field] = created
  return created
}

/** 中文说明：函数 collectModeViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectModeViolations(facts: ClientPackageFacts): string[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pkg of facts.packages) {
    if (pkg.dynamic && pkg.staticLinked) {
      violations.push(
        pkg.manifest + ': ' + pkg.name + ' declares dsh.client and uses the staticLinked preset;'
        + ' a client package must be dynamic or statically linked, not both',
      )
    } else if (!pkg.dynamic && !pkg.staticLinked) {
      violations.push(
        pkg.manifest + ': ' + pkg.name + ' has no supported client package mode;'
        + ' declare dsh.client or use the staticLinked preset',
      )
    }
  }

  /** 中文说明：函数值 workspaceNames 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const workspaceNames = new Set(facts.declarations.map(entry => entry.name))
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const specifier of facts.platformModules) {
    /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = packageNameOf(specifier)
    if (!workspaceNames.has(owner) || owner === CORDIS || facts.staticLinkedPackages.has(owner)) continue
    violations.push(
      PLATFORM_SOURCE + ': seeded workspace module ' + JSON.stringify(specifier)
      + ' belongs to ' + owner + ', whose build does not use the staticLinked preset',
    )
  }

  /** 中文说明：变量 rows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rows = rowNames(facts.declarations)
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const specifier of facts.preloadedExternals) {
    if (rowPackageOf(specifier, rows) === undefined) {
      violations.push(
        PLATFORM_SOURCE + ': parser-preloaded external ' + JSON.stringify(specifier)
        + ' has no dynamic dsh.client row',
      )
    }
    if (!facts.parserPreloadIds.includes(stripClientSuffix(specifier))) {
      violations.push(
        PLATFORM_SOURCE + ': parser-preloaded external ' + JSON.stringify(specifier)
        + ' has no matching PARSER_PRELOAD_IDS row in ' + PARSER_PRELOAD_SOURCE,
      )
    }
  }
  return violations
}

/** 中文说明：interface ExpectedRule 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface ExpectedRule {
  readonly kind: 'dependency' | 'dev' | 'peer-dev'
  readonly origins: Set<string>
}

/** 中文说明：函数 collectDependencyViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectDependencyViolations(facts: ClientPackageFacts): string[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 staticInputs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const staticInputs = new Set([
    ...facts.staticLinkedPackages,
    ...facts.platformModules.map(packageNameOf),
  ])
  staticInputs.delete(CORDIS)

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pkg of [...facts.packages].sort((left, right) => left.manifest.localeCompare(right.manifest))) {
    /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = expectedSections(pkg, staticInputs)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const [name, rule] of [...expected].sort(([left], [right]) => left.localeCompare(right))) {
      /** 中文说明：变量 actual 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const actual = declaredSections(pkg, name)
      if (rule.kind === 'dependency') {
        if (actual.length === 1 && actual[0] === 'dependencies') continue
        violations.push(
          pkg.manifest + ': ' + name + ' (' + describeOrigins(rule.origins) + ') is a runtime import'
          + ' retained by a statically linked artifact; declare it only in dependencies, found '
          + describeSections(actual),
        )
        continue
      }
      if (rule.kind === 'dev') {
        if (actual.length === 1 && actual[0] === 'devDependencies') continue
        violations.push(
          pkg.manifest + ': ' + name + ' (' + describeOrigins(rule.origins) + ') is a static client input;'
          + ' declare it only in devDependencies, found ' + describeSections(actual),
        )
        continue
      }

      /** 中文说明：变量 peerRange 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const peerRange = pkg.peerDependencies[name]
      /** 中文说明：变量 devRange 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const devRange = pkg.devDependencies[name]
      if (actual.length === 2
        && actual.includes('peerDependencies')
        && actual.includes('devDependencies')
        && peerRange === devRange) continue
      violations.push(
        pkg.manifest + ': ' + name + ' (' + describeOrigins(rule.origins) + ')'
        + ' is a peer-installed DSH relationship; declare it in peerDependencies and devDependencies'
        + ' with matching ranges, not dependencies; found ' + describeSections(actual)
        + describeRangeMismatch(peerRange, devRange),
      )
    }

    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const [name, peerRange] of Object.entries(pkg.peerDependencies).sort(([left], [right]) => left.localeCompare(right))) {
      if (expected.has(name)) continue
      /** 中文说明：变量 devRange 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const devRange = pkg.devDependencies[name]
      if (devRange === peerRange) continue
      violations.push(
        pkg.manifest + ': peerDependencies.' + name + ' is ' + peerRange + ', so devDependencies.' + name
        + ' must use the same range; found ' + (devRange ?? 'no declaration'),
      )
    }

    if (!pkg.dynamic) continue
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const section of ['dependencies', 'peerDependencies'] as const) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const name of Object.keys(pkg[section]).sort()) {
        if (expected.has(name)) continue
        if (staticInputs.has(name)) {
          violations.push(
            pkg.manifest + ': dynamic package declares static input ' + name + ' in ' + section + ';'
            + ' move it to devDependencies or delete the stale declaration',
          )
        } else if (section === 'dependencies' && isInternalDsh(name)) {
          violations.push(
            pkg.manifest + ': dynamic package declares ' + name + ' in dependencies;'
            + ' dynamic DSH relationships are peer plus dev, and static client inputs are dev-only',
          )
        }
      }
    }
  }
  return violations
}

/** 中文说明：函数 expectedSections 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function expectedSections(pkg: ClientPackage, staticInputs: ReadonlySet<string>): Map<string, ExpectedRule> {
  /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expected = new Map<string, ExpectedRule>([
    [CORDIS, { kind: 'peer-dev', origins: new Set(['client package baseline']) }],
  ])
  if (!pkg.dynamic) {
    if (pkg.name === CLIENT_WEB) return expected
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const [name, locations] of Object.entries(pkg.runtimeSourceUses)) {
      if (name === pkg.name || name === CORDIS || isInternalDsh(name)) continue
      expected.set(name, { kind: 'dependency', origins: new Set(locations) })
    }
    return expected
  }

  /** 中文说明：函数值 add 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const add = (name: string, origin: string): void => {
    if (name === pkg.name) return
    /** 中文说明：变量 kind 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const kind = staticInputs.has(name) ? 'dev' : isInternalDsh(name) ? 'peer-dev' : undefined
    if (kind === undefined) return
    /** 中文说明：变量 current 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const current = expected.get(name)
    if (current !== undefined) current.origins.add(origin)
    else expected.set(name, { kind, origins: new Set([origin]) })
  }
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [name, locations] of Object.entries(pkg.sourceUses)) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const location of locations) add(name, location)
  }
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const name of pkg.inject) add(name, 'dsh.client.inject')
  return expected
}

/** 中文说明：interface ModuleEdge 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface ModuleEdge {
  readonly from: string
  readonly to: string
  readonly specifier: string
}

/** 中文说明：函数 collectModuleViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectModuleViolations(facts: ClientPackageFacts): string[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 baseline 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const baseline = new Set([...facts.platformModules, ...facts.preloadedExternals])
  /** 中文说明：变量 rows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rows = rowNames(facts.declarations)
  /** 中文说明：函数值 byName 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const byName = new Map(facts.declarations.map(entry => [entry.name, entry]))
  /** 中文说明：变量 edges 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const edges: ModuleEdge[] = []

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pkg of facts.declarations.filter(entry => entry.dynamic)) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const field of ['external', 'inject'] as const) {
      /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const seen = new Set<string>()
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const value of pkg[field]) {
        if (value === '') violations.push(pkg.manifest + ': dsh.client.' + field + ' contains an empty value')
        else if (seen.has(value)) {
          violations.push(pkg.manifest + ': dsh.client.' + field + ' lists ' + JSON.stringify(value) + ' twice')
        }
        seen.add(value)
      }
    }

    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const specifier of new Set(pkg.external)) {
      if (specifier === '') continue
      if (baseline.has(specifier)) {
        violations.push(
          pkg.manifest + ': dsh.client.external repeats baseline module ' + JSON.stringify(specifier)
          + '; remove the explicit declaration',
        )
        continue
      }
      /** 中文说明：变量 supplier 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const supplier = rowPackageOf(specifier, rows)
      if (supplier === pkg.name) {
        violations.push(pkg.manifest + ': dsh.client.external names its own row ' + JSON.stringify(specifier))
      } else if (supplier !== undefined) {
        edges.push({ from: pkg.name, to: supplier, specifier })
      } else {
        /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const owner = stripClientSuffix(specifier)
        violations.push(
          pkg.manifest + ': dsh.client.external ' + JSON.stringify(specifier) + ' has no supplier;'
          + (byName.has(owner)
            ? ' workspace package ' + owner
              + ' declares no dynamic dsh.client row and the shell does not seed this specifier'
            : ' no dynamic row or PLATFORM_MODULES entry answers it'),
        )
      }
    }
  }

  violations.push(...collectModuleCycles(edges, byName))
  return violations
}

/** 中文说明：函数 collectModuleCycles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectModuleCycles(
  edges: readonly ModuleEdge[],
  byName: ReadonlyMap<string, ClientDeclaration>,
): string[] {
  /** 中文说明：变量 outgoing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const outgoing = new Map<string, ModuleEdge[]>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const edge of [...edges].sort((left, right) => left.specifier.localeCompare(right.specifier))) {
    outgoing.set(edge.from, [...outgoing.get(edge.from) ?? [], edge])
  }
  /** 中文说明：变量 finished 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const finished = new Set<string>()
  /** 中文说明：变量 onPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const onPath = new Set<string>()
  /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path: ModuleEdge[] = []
  /** 中文说明：变量 reported 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reported = new Map<string, string>()

  /** 中文说明：函数值 walk 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const walk = (name: string): void => {
    onPath.add(name)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const edge of outgoing.get(name) ?? []) {
      if (onPath.has(edge.to)) {
        /** 中文说明：函数值 start 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
        const start = path.findIndex(entry => entry.from === edge.to)
        /** 中文说明：变量 cycle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const cycle = start === -1 ? [edge] : [...path.slice(start), edge]
        /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = cycleKey(cycle)
        if (!reported.has(key)) reported.set(key, formatCycle(cycle, byName))
      } else if (!finished.has(edge.to)) {
        path.push(edge)
        walk(edge.to)
        path.pop()
      }
    }
    onPath.delete(name)
    finished.add(name)
  }

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const name of [...outgoing.keys()].sort()) {
    if (!finished.has(name)) walk(name)
  }
  return [...reported.values()]
}

/** 中文说明：函数 cycleKey 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function cycleKey(cycle: readonly ModuleEdge[]): string {
  /** 中文说明：函数值 labels 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const labels = cycle.map(edge => edge.from + ' ' + edge.specifier)
  /** 中文说明：变量 first 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = [...labels].sort()[0]
  /** 中文说明：变量 offset 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const offset = first === undefined ? 0 : labels.indexOf(first)
  return [...labels.slice(offset), ...labels.slice(0, offset)].join(' -> ')
}

/** 中文说明：函数 formatCycle 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatCycle(
  cycle: readonly ModuleEdge[],
  byName: ReadonlyMap<string, ClientDeclaration>,
): string {
  /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = cycle[0]
  /** 中文说明：函数值 chain 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const chain = cycle.map(edge => edge.from + ' --(' + edge.specifier + ')-->').join(' ')
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = entry === undefined ? 'packages/client' : byName.get(entry.from)?.manifest ?? entry.from
  return manifest + ': synchronous dsh.client.external cycle: ' + chain + ' ' + (entry?.from ?? '')
}

/** 中文说明：interface Manifest 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface Manifest {
  name?: unknown
  dsh?: unknown
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** 中文说明：函数 readDeclaration 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readDeclaration(
  root: string,
  manifestPath: string,
  malformed: string[],
): ClientDeclaration | undefined {
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as Manifest
  if (typeof manifest.name !== 'string') return undefined
  /** 中文说明：变量 dsh 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : undefined
  /** 中文说明：变量 rawClient 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rawClient = dsh?.client
  if (rawClient === undefined) {
    return { name: manifest.name, manifest: manifestPath, dynamic: false, external: [], inject: [] }
  }
  if (!isRecord(rawClient)) {
    malformed.push(manifestPath + ': ' + manifest.name + ' dsh.client must be an object')
    return { name: manifest.name, manifest: manifestPath, dynamic: false, external: [], inject: [] }
  }
  return {
    name: manifest.name,
    manifest: manifestPath,
    dynamic: true,
    external: stringArray(rawClient.external, manifest.name, manifestPath, 'external', malformed),
    inject: stringArray(rawClient.inject, manifest.name, manifestPath, 'inject', malformed),
  }
}

/** 中文说明：函数 stringArray 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function stringArray(
  value: unknown,
  packageName: string,
  manifestPath: string,
  field: string,
  malformed: string[],
): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    malformed.push(manifestPath + ': ' + packageName + ' dsh.client.' + field + ' must be a string array')
    return []
  }
  return value as string[]
}

/** 中文说明：函数 readStaticLinkedRoster 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function readStaticLinkedRoster(root: string): Promise<Set<string>> {
  /** 中文说明：变量 presetUrl 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const presetUrl = pathToFileURL(resolve(import.meta.dirname, '..', STATIC_PRESET_SOURCE)).href
  /** 中文说明：变量 preset 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const preset = await import(presetUrl) as { isStaticLinkedConfig?: unknown }
  if (typeof preset.isStaticLinkedConfig !== 'function') {
    throw new Error(GATE + ': ' + STATIC_PRESET_SOURCE + ' exports no isStaticLinkedConfig')
  }
  /** 中文说明：函数值 predicate 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const predicate = preset.isStaticLinkedConfig as (configs: readonly unknown[]) => boolean
  /** 中文说明：变量 roster 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const roster = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const configPath of globSync(CONFIG_GLOB, { cwd: root }).map(normalizePath).sort()) {
    /** 中文说明：变量 loaded 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await import(pathToFileURL(resolve(root, configPath)).href) as { default?: unknown }
    if (typeof loaded.default !== 'function') continue
    /** 中文说明：函数值 configs 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const configs = (loaded.default as (input: { env: Record<string, string> }) => unknown)({
      env: { DSH_BUILD_FACE: 'client' },
    })
    if (!Array.isArray(configs) || !predicate(configs)) continue
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = JSON.parse(
      readFileSync(resolve(root, configPath.replace(/tsdown\.config\.ts$/, 'package.json')), 'utf8'),
    ) as Manifest
    if (typeof manifest.name === 'string') roster.add(manifest.name)
  }
  return roster
}

/** 中文说明：函数 unwrapExpression 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  /** 中文说明：变量 current 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let current = expression
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

/** 中文说明：函数 readStringLiteralArray 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readStringLiteralArray(root: string, sourcePath: string, name: string): string[] {
  /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = resolve(root, sourcePath)
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  /** 中文说明：变量 constants 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const constants = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      /** 中文说明：变量 initializer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isStringLiteral(initializer)) constants.set(declaration.name.text, initializer.text)
    }
  }
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      /** 中文说明：变量 expression 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const expression = declaration.initializer === undefined ? undefined : unwrapExpression(declaration.initializer)
      if (expression === undefined || !ts.isArrayLiteralExpression(expression)) {
        throw new Error(GATE + ': ' + name + ' in ' + sourcePath + ' must be an array literal')
      }
      return expression.elements.map((element) => {
        /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const value = unwrapExpression(element)
        if (ts.isStringLiteral(value)) return value.text
        if (ts.isIdentifier(value) && constants.has(value.text)) return constants.get(value.text) as string
        throw new Error(GATE + ': ' + name + ' in ' + sourcePath + ' must contain only string constants')
      })
    }
  }
  throw new Error(GATE + ': ' + sourcePath + ' declares no ' + name)
}

/** 中文说明：函数 readFacts 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function readFacts(root: string): Promise<ClientPackageFacts> {
  const { declarations, malformed } = readClientDeclarations(root)
  /** 中文说明：函数值 byManifest 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const byManifest = new Map(declarations.map(entry => [entry.manifest, entry]))
  /** 中文说明：变量 staticLinkedPackages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const staticLinkedPackages = await readStaticLinkedRoster(root)
  /** 中文说明：变量 project 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const project = new TypeScriptProject(root, 'client')
  /** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packages: ClientPackage[] = []

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const manifestPath of globSync(CLIENT_MANIFEST_GLOB, { cwd: root }).map(normalizePath).sort()) {
    /** 中文说明：变量 declaration 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const declaration = byManifest.get(manifestPath)
    if (declaration === undefined) throw new Error(GATE + ': no declaration facts for ' + manifestPath)
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as Manifest
    if (typeof manifest.name !== 'string') throw new Error(GATE + ': ' + manifestPath + ' has no package name')
    /** 中文说明：变量 sourceUses 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceUses = new Map<string, Set<string>>()
    /** 中文说明：变量 runtimeSourceUses 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtimeSourceUses = new Map<string, Set<string>>()
    /** 中文说明：变量 packageDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageDirectory = dirname(manifestPath)
    /** 中文说明：变量 sourcePrefix 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourcePrefix = packageDirectory + '/src/'
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const sourceFile of project.sourceFiles()) {
      if (sourceFile.isDeclarationFile) continue
      /** 中文说明：变量 file 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const file = project.relativePath(sourceFile)
      if (!file.startsWith(sourcePrefix)) continue
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const name of collectSourceFilePackageUses(sourceFile, false)) {
        /** 中文说明：变量 locations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const locations = sourceUses.get(name) ?? new Set<string>()
        locations.add(file)
        sourceUses.set(name, locations)
      }
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const name of collectSourceFilePackageUses(sourceFile, true)) {
        /** 中文说明：变量 locations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const locations = runtimeSourceUses.get(name) ?? new Set<string>()
        locations.add(file)
        runtimeSourceUses.set(name, locations)
      }
    }
    packages.push({
      ...declaration,
      staticLinked: staticLinkedPackages.has(declaration.name),
      sourceUses: Object.fromEntries(
        [...sourceUses].sort(([left], [right]) => left.localeCompare(right))
          .map(([name, locations]) => [name, [...locations].sort()]),
      ),
      runtimeSourceUses: Object.fromEntries(
        [...runtimeSourceUses].sort(([left], [right]) => left.localeCompare(right))
          .map(([name, locations]) => [name, [...locations].sort()]),
      ),
      dependencies: manifest.dependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      devDependencies: manifest.devDependencies ?? {},
    })
  }

  return {
    packages,
    declarations,
    staticLinkedPackages,
    platformModules: readStringLiteralArray(root, PLATFORM_SOURCE, 'PLATFORM_MODULES'),
    preloadedExternals: readStringLiteralArray(root, PLATFORM_SOURCE, 'PRELOADED_CLIENT_EXTERNALS'),
    parserPreloadIds: readStringLiteralArray(root, PARSER_PRELOAD_SOURCE, 'PARSER_PRELOAD_IDS'),
    malformed,
  }
}

/** 中文说明：函数 packageNameOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function packageNameOf(specifier: string): string {
  /** 中文说明：变量 segments 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const segments = specifier.split('/')
  return segments.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
}

/** 中文说明：函数 stripClientSuffix 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function stripClientSuffix(specifier: string): string {
  return specifier.endsWith('/client') ? specifier.slice(0, -'/client'.length) : specifier
}

/** 中文说明：函数 rowNames 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function rowNames(declarations: readonly ClientDeclaration[]): Set<string> {
  return new Set(declarations.filter(entry => entry.dynamic).map(entry => entry.name))
}

/** 中文说明：函数 rowPackageOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function rowPackageOf(specifier: string, rows: ReadonlySet<string>): string | undefined {
  if (rows.has(specifier)) return specifier
  /** 中文说明：变量 stripped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stripped = stripClientSuffix(specifier)
  return rows.has(stripped) ? stripped : undefined
}

/** 中文说明：函数 declaredSections 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function declaredSections(pkg: ClientPackage, name: string): string[] {
  return (['dependencies', 'peerDependencies', 'devDependencies'] as const)
    .filter(section => pkg[section][name] !== undefined)
}

/** 中文说明：函数 describeSections 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function describeSections(sections: readonly string[]): string {
  return sections.length === 0 ? 'no dependency declaration' : sections.join(' + ')
}

/** 中文说明：函数 describeRangeMismatch 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function describeRangeMismatch(peer: string | undefined, dev: string | undefined): string {
  if (peer === undefined || dev === undefined || peer === dev) return ''
  return ' (peer ' + peer + ', dev ' + dev + ')'
}

/** 中文说明：函数 describeOrigins 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function describeOrigins(origins: ReadonlySet<string>): string {
  /** 中文说明：变量 sorted 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sorted = [...origins].sort()
  const [first, second, ...rest] = sorted
  if (first === undefined) return 'production use'
  if (second === undefined) return first
  return rest.length === 0 ? first + ', ' + second : first + ', ' + second + ', and ' + String(rest.length) + ' more'
}

/** 中文说明：函数 isInternalDsh 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isInternalDsh(name: string): boolean {
  return name === CORDIS || name.startsWith(DSH_PREFIX)
}

/** 中文说明：函数 isBareSpecifier 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#')
}

/** 中文说明：函数 isRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 normalizePath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function main(): Promise<void> {
  /** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = resolve(import.meta.dirname, '..')
  /** 中文说明：变量 facts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let facts = await readFacts(root)
  if (process.argv.includes('--fix')) {
    /** 中文说明：变量 changed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed = fixClientPackageManifests(root, facts)
    console.log(
      changed.length === 0
        ? GATE + ': no mechanically fixable manifest changes.'
        : GATE + ': fixed ' + String(changed.length) + ' manifest(s): ' + changed.join(', '),
    )
    facts = await readFacts(root)
  }
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations = collectClientPackageViolations(facts)
  if (violations.length > 0) {
    console.error(GATE + ': ' + String(violations.length) + ' violation(s):')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const violation of violations) console.error('  ' + violation)
    process.exit(1)
  }

  /** 中文说明：函数值 dynamic 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const dynamic = facts.packages.filter(pkg => pkg.dynamic).length
  /** 中文说明：函数值 requests 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const requests = facts.declarations.reduce((total, pkg) => total + pkg.external.length, 0)
  console.log(
    GATE + ': ' + String(facts.packages.length) + ' client packages (' + String(dynamic) + ' dynamic, '
    + String(facts.packages.length - dynamic) + ' statically linked) satisfy dependency and module-request rules; '
    + String(requests) + ' explicit external request(s).',
  )
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
