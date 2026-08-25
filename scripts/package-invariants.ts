/**
 * Package-invariant companion discovery and structural checks.
 * The runtime registry stays product-independent; this gate makes ownership
 * exhaustive across packages without centralizing package checks.
 */
/*
 * 文件职责：实现 package-invariants.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/** Required explanation marker for an intentionally empty installer. */
/* 中文说明：常量 NO_RUNTIME_INVARIANT_MARKER 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const NO_RUNTIME_INVARIANT_MARKER = 'No runtime invariant:'

/** 中文说明：interface PackageManifest 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PackageManifest {
  name?: string
  exports?: Record<string, { types?: string; default?: string } | string | undefined>
  files?: string[]
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** One package and the files participating in its invariant publication rules. */
/* 中文说明：interface PackageInvariantOwner 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface PackageInvariantOwner {
  readonly dir: string
  readonly manifestPath: string
  readonly sourcePath: string
  readonly packageName: string
}

/** One gate violation with a repo-relative owner path. */
/* 中文说明：interface PackageInvariantViolation 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface PackageInvariantViolation {
  readonly path: string
  readonly message: string
}

/** Discover every package under the repository package tree. */
/* 中文说明：函数 packageInvariantOwners 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function packageInvariantOwners(root: string): PackageInvariantOwner[] {
  return globSync('packages/*/*/package.json', { cwd: root })
    .map(path => path.split(sep).join('/'))
    .sort()
    .map((manifestPath) => {
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = readManifest(resolve(root, manifestPath))
      if (manifest.name === undefined || manifest.name === '') {
        throw new Error(`${manifestPath}: package invariant owner must declare a package name`)
      }
      /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const dir = dirname(manifestPath)
      return {
        dir,
        manifestPath,
        sourcePath: `${dir}/src/invariant.ts`,
        packageName: manifest.name,
      }
    })
}

/** Return all violations of the package-invariant companion rules. */
/* 中文说明：函数 collectPackageInvariantViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectPackageInvariantViolations(root: string): PackageInvariantViolation[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: PackageInvariantViolation[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const owner of packageInvariantOwners(root)) {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = readManifest(resolve(root, owner.manifestPath))
    checkManifest(owner, manifest, violations)
    checkBuild(owner, root, violations)
    checkSource(owner, root, violations)
  }
  return violations
}

/** 中文说明：函数 readManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/** 中文说明：函数 addViolation 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function addViolation(
  violations: PackageInvariantViolation[],
  path: string,
  message: string,
): void {
  violations.push({ path, message })
}

/** 中文说明：函数 checkManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function checkManifest(
  owner: PackageInvariantOwner,
  manifest: PackageManifest,
  violations: PackageInvariantViolation[],
): void {
  /** 中文说明：变量 invariantExport 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const invariantExport = manifest.exports?.['./invariant']
  if (typeof invariantExport !== 'object'
    || invariantExport.types !== './lib/types/invariant.d.ts'
    || invariantExport.default !== './lib/invariant.js') {
    addViolation(
      violations,
      owner.manifestPath,
      'exports["./invariant"] must target ./lib/types/invariant.d.ts and ./lib/invariant.js',
    )
  }
  if (!manifest.files?.includes('lib/invariant.js')) {
    addViolation(violations, owner.manifestPath, 'files must publish lib/invariant.js')
  }
  if (owner.packageName === '@deepseek-ai/dsh-invariants') return
  if (manifest.peerDependencies?.['@deepseek-ai/dsh-invariants'] !== 'workspace:^') {
    addViolation(
      violations,
      owner.manifestPath,
      '@deepseek-ai/dsh-invariants must be a workspace:^ peerDependency',
    )
  }
  if (manifest.devDependencies?.['@deepseek-ai/dsh-invariants'] !== 'workspace:^') {
    addViolation(
      violations,
      owner.manifestPath,
      '@deepseek-ai/dsh-invariants must also be a workspace:^ devDependency',
    )
  }
}

/** 中文说明：函数 checkBuild 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function checkBuild(
  owner: PackageInvariantOwner,
  root: string,
  violations: PackageInvariantViolation[],
): void {
  /** 中文说明：变量 tsconfigPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tsconfigPath = `${owner.dir}/tsconfig.json`
  if (owner.packageName !== '@deepseek-ai/dsh-invariants'
    && !projectReferencesInvariants(root, owner.dir, tsconfigPath)) {
    addViolation(
      violations,
      tsconfigPath,
      'TypeScript project references must include ../../runtime-diagnostics/invariants',
    )
  }

  /** 中文说明：变量 configPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configPath = `${owner.dir}/tsdown.config.ts`
  if (!existsSync(resolve(root, configPath))) return
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = readFileSync(resolve(root, configPath), 'utf8')
  if (!source.includes('lib/types/invariant.js')) {
    addViolation(violations, configPath, 'package build override must bundle lib/types/invariant.js')
  }
}

/** 中文说明：函数 projectReferencesInvariants 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function projectReferencesInvariants(root: string, ownerDir: string, entryPath: string): boolean {
  /** 中文说明：变量 ownerRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ownerRoot = resolve(root, ownerDir)
  /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const target = resolve(root, 'packages/runtime-diagnostics/invariants')
  /** 中文说明：变量 pending 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const pending = [resolve(root, entryPath)]
  /** 中文说明：变量 visited 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const visited = new Set<string>()
  while (pending.length > 0) {
    /** 中文说明：变量 configPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configPath = pending.pop()
    if (configPath === undefined) break
    if (visited.has(configPath)) continue
    visited.add(configPath)
    /** 中文说明：变量 config 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      references?: Array<{ path?: string }>
    }
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const reference of config.references ?? []) {
      if (reference.path === undefined) continue
      /** 中文说明：变量 referenced 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const referenced = resolve(dirname(configPath), reference.path)
      if (referenced === target) return true
      if (!referenced.startsWith(`${ownerRoot}${sep}`)) continue
      /** 中文说明：变量 childConfig 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const childConfig = referenced.endsWith('.json') ? referenced : resolve(referenced, 'tsconfig.json')
      if (existsSync(childConfig)) pending.push(childConfig)
    }
  }
  return false
}

/** 中文说明：函数 checkSource 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function checkSource(
  owner: PackageInvariantOwner,
  root: string,
  violations: PackageInvariantViolation[],
): void {
  /** 中文说明：变量 absolutePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const absolutePath = resolve(root, owner.sourcePath)
  if (!existsSync(absolutePath)) {
    addViolation(violations, owner.sourcePath, 'missing package-owned invariant companion')
    return
  }
  /** 中文说明：变量 sourceText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceText = readFileSync(absolutePath, 'utf8')
  if (sourceText.includes('@generated')) {
    addViolation(
      violations,
      owner.sourcePath,
      'invariant companions must be hand-owned and may not carry @generated markers',
    )
  }

  /** 中文说明：变量 sourceFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  /** 中文说明：变量 constants 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const constants = topLevelStringConstants(sourceFile)
  /** 中文说明：变量 registrations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const registrations: string[] = []
  /** 中文说明：变量 unresolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const unresolved: number[] = []
  /** 中文说明：变量 mismatchedInstallers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mismatchedInstallers: number[] = []
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isInvariantRegistration(node.expression)) {
      /** 中文说明：变量 line 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      /** 中文说明：变量 argument 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const argument = node.arguments[0]
      /** 中文说明：变量 packageName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const packageName = argument === undefined ? undefined : stringValue(argument, constants)
      if (packageName === undefined) unresolved.push(line)
      else registrations.push(packageName)
      /** 中文说明：变量 installer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const installer = node.arguments[1]
      if (installer === undefined || !ts.isIdentifier(installer) || installer.text !== 'install') {
        mismatchedInstallers.push(line)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of unresolved) {
    addViolation(
      violations,
      owner.sourcePath,
      `line ${line}: ctx.invariants.register package name must resolve to a local string constant`,
    )
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of mismatchedInstallers) {
    addViolation(
      violations,
      owner.sourcePath,
      `line ${line}: ctx.invariants.register must use the checked local install function`,
    )
  }
  if (registrations.length !== 1 || registrations[0] !== owner.packageName) {
    addViolation(
      violations,
      owner.sourcePath,
      `must register exactly its own package name ${JSON.stringify(owner.packageName)}; saw ${JSON.stringify(registrations)}`,
    )
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const exportedName of ['name', 'inject', 'apply']) {
    if (!hasNamedExport(sourceFile, exportedName)) {
      addViolation(violations, owner.sourcePath, `must named-export ${exportedName}`)
    }
  }
  if (hasDefaultExport(sourceFile)) {
    addViolation(violations, owner.sourcePath, 'must not default-export; Loader must retain the companion namespace')
  }
  checkInstaller(owner, sourceFile, sourceText, violations)
}

/** 中文说明：函数 checkInstaller 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function checkInstaller(
  owner: PackageInvariantOwner,
  sourceFile: ts.SourceFile,
  sourceText: string,
  violations: PackageInvariantViolation[],
): void {
  /** 中文说明：变量 initializer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let initializer: ts.Expression | undefined
  /** 中文说明：变量 declarationStatement 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let declarationStatement: ts.VariableStatement | undefined
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)
        && declaration.name.text === 'install'
        && declaration.initializer !== undefined) {
        initializer = declaration.initializer
        declarationStatement = statement
      }
    }
  }
  /** 中文说明：变量 installer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const installer = initializer === undefined ? undefined : installerFunction(initializer)
  if (installer === undefined) {
    addViolation(violations, owner.sourcePath, 'must declare a local install function for package-owned checks')
    return
  }
  if (ts.isBlock(installer.body) && installer.body.statements.length === 0) {
    /** 中文说明：变量 declarationText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const declarationText = declarationStatement === undefined
      ? ''
      : sourceText.slice(declarationStatement.getFullStart(), declarationStatement.getEnd())
    if (!declarationText.includes(NO_RUNTIME_INVARIANT_MARKER)) {
      addViolation(
        violations,
        owner.sourcePath,
        `empty install function must explain why with a "${NO_RUNTIME_INVARIANT_MARKER}" comment`,
      )
    }
    return
  }
  /** 中文说明：变量 reporter 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reporter = installer.parameters[1]?.name
  if (reporter === undefined || !ts.isIdentifier(reporter)) {
    addViolation(violations, owner.sourcePath, 'install function must accept the bound failure reporter as its second parameter')
    return
  }
  if (!usesIdentifier(installer.body, reporter.text)) {
    addViolation(violations, owner.sourcePath, 'install function must use its bound failure reporter')
  }
}

/** 中文说明：函数 usesIdentifier 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function usesIdentifier(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name
    || node.getChildren().some(child => usesIdentifier(child, name))
}

/** 中文说明：函数 installerFunction 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function installerFunction(
  initializer: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer
  if (ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && ts.isIdentifier(initializer.expression.expression)
    && initializer.expression.expression.text === 'Object'
    && initializer.expression.name.text === 'assign') {
    /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = initializer.arguments[0]
    if (target !== undefined && (ts.isArrowFunction(target) || ts.isFunctionExpression(target))) return target
  }
  return undefined
}

/** 中文说明：函数 topLevelStringConstants 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function topLevelStringConstants(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  /** 中文说明：变量 constants 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const constants = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const value = stringValue(declaration.initializer, constants)
      if (value !== undefined) constants.set(declaration.name.text, value)
    }
  }
  return constants
}

/** 中文说明：函数 stringValue 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function stringValue(node: ts.Expression, constants: ReadonlyMap<string, string>): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return constants.get(node.text)
  return undefined
}

/** 中文说明：函数 isInvariantRegistration 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isInvariantRegistration(expression: ts.LeftHandSideExpression): boolean {
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'register'
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === 'invariants'
}

/** 中文说明：函数 hasNamedExport 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hasNamedExport(sourceFile: ts.SourceFile, name: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false
    return statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
  })
}

/** 中文说明：函数 hasDefaultExport 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hasDefaultExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return true
    /** 中文说明：变量 modifiers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return true
    if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined) return false
    if (ts.isNamespaceExport(statement.exportClause)) {
      return statement.exportClause.name.text === 'default'
    }
    return statement.exportClause.elements.some(element => element.name.text === 'default')
  })
}

/** Format violations for the command-line gate. */
/* 中文说明：函数 formatPackageInvariantViolation 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function formatPackageInvariantViolation(
  root: string,
  violation: PackageInvariantViolation,
): string {
  /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = resolve(root, violation.path)
  return `${relative(root, path)}: ${violation.message}`
}
