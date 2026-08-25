/**
 * Verify that built package declarations are consumable by a standard external
 * TypeScript ESM project using NodeNext resolution.
 *
 * Run after `pnpm run build` has emitted declaration files under package
 * `lib/types` directories.
 */
/**
 * 文件职责：实现 verify-node-next-types.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** 中文说明：interface ExportTarget 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface ExportTarget {
  types?: string
}

/** 中文说明：interface PackageManifest 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface PackageManifest {
  name?: string
  types?: string
  exports?: Record<string, ExportTarget | string | null>
}

/** 中文说明：interface WorkspacePackage 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface WorkspacePackage {
  dir: string
  name: string
  manifest: PackageManifest
}

/** 中文说明：函数 readPackage 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readPackage(path: string): WorkspacePackage | null {
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (!manifest.name) return null
  return { dir: dirname(path), name: manifest.name, manifest }
}

/** 中文说明：函数 workspacePackages 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function workspacePackages(): WorkspacePackage[] {
  return [
    ...globSync('vendor/*/package.json', { cwd: root }),
    ...globSync('packages/*/*/package.json', { cwd: root }),
  ]
    .map(path => readPackage(resolve(root, path)))
    .filter(pkg => pkg !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 中文说明：变量 declarationSpecifierPattern 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const declarationSpecifierPattern = /(?:from\s*|import\s*\(\s*|import\s+|declare\s+module\s*)["'](\.{0,2}(?:\/[^"']*)?)["']/g
/** 中文说明：变量 hasExtension 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hasExtension = /\.[^/.]+$/

/** 中文说明：函数 relativeSpecifiersMissingExtensions 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function relativeSpecifiersMissingExtensions(): string[] {
  /** 中文说明：变量 errors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files = [
    ...globSync('vendor/*/lib/types/**/*.d.ts', { cwd: root }),
    ...globSync('packages/*/*/lib/types/**/*.d.ts', { cwd: root }),
  ].sort()

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const file of files) {
    /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(resolve(root, file), 'utf8')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const match of text.matchAll(declarationSpecifierPattern)) {
      /** 中文说明：变量 specifier 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const specifier = match[1]
      if (!specifier) continue
      /** 中文说明：变量 isRelative 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const isRelative = specifier === '.' || specifier.startsWith('./') || specifier.startsWith('../')
      if (isRelative && !hasExtension.test(specifier)) errors.push(`${file}: ${specifier}`)
    }
  }

  return errors
}

/** 中文说明：函数 publicSpecifiers 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function publicSpecifiers(pkg: WorkspacePackage): string[] {
  /** 中文说明：变量 specifiers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const specifiers = new Set<string>()
  if (pkg.manifest.types) specifiers.add(pkg.name)

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [key, target] of Object.entries(pkg.manifest.exports ?? {})) {
    if (key.includes('*') || key === './package.json') continue
    if (typeof target !== 'object' || target === null || !target.types) continue
    specifiers.add(key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`)
  }

  return [...specifiers].sort()
}

/** 中文说明：函数 linkPackage 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function linkPackage(pkg: WorkspacePackage, nodeModules: string): void {
  /** 中文说明：变量 parts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parts = pkg.name.split('/')
  /** 中文说明：变量 link 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const link = resolve(nodeModules, ...parts)
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(pkg.dir, link, 'dir')
}

/** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packages = workspacePackages()
/** 中文说明：变量 badSpecifiers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const badSpecifiers = relativeSpecifiersMissingExtensions()
if (badSpecifiers.length > 0) {
  console.error('verify-node-next-types: declaration files still contain relative specifiers without file extensions.')
  console.error(badSpecifiers.join('\n'))
  process.exit(1)
}

/** 中文说明：变量 missingOutputs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const missingOutputs = packages
  .filter(pkg => pkg.manifest.types && !existsSync(resolve(pkg.dir, pkg.manifest.types)))
  .map(pkg => `${pkg.name}: missing ${pkg.manifest.types}`)

if (missingOutputs.length > 0) {
  console.error('verify-node-next-types: build outputs are missing; run `pnpm run build` first.')
  console.error(missingOutputs.join('\n'))
  process.exit(1)
}

/** 中文说明：变量 tmp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const tmp = mkdtempSync(resolve(root, '.node-next-types-'))
/** 中文说明：变量 failed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let failed = false

try {
  /** 中文说明：变量 nodeModules 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const nodeModules = resolve(tmp, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pkg of packages) linkPackage(pkg, nodeModules)

  /** 中文说明：变量 rootTypes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rootTypes = resolve(root, 'node_modules/@types/node')
  if (existsSync(rootTypes)) {
    /** 中文说明：变量 typesDir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const typesDir = resolve(nodeModules, '@types')
    mkdirSync(typesDir, { recursive: true })
    symlinkSync(rootTypes, resolve(typesDir, 'node'), 'dir')
  }

  writeFileSync(resolve(tmp, 'package.json'), `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`)
  writeFileSync(resolve(tmp, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'es2024',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      // Third-party SDK declarations can have their own lib-check noise under a
      // symlinked temp install. The explicit scan above owns our regression:
      // relative specifiers without file extensions in built declarations.
      skipLibCheck: true,
      preserveSymlinks: true,
      noEmit: true,
      types: ['node'],
    },
    include: ['index.ts'],
  }, null, 2)}\n`)

  /** 中文说明：变量 imports 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const imports = packages.flatMap(publicSpecifiers)
    .map((specifier, index) => `import * as mod${index} from ${JSON.stringify(specifier)};\nvoid mod${index};`)
    .join('\n')
  writeFileSync(resolve(tmp, 'index.ts'), `${imports}\n`)

  // tsc's JS entry via the current node, not the .bin shim: the extensionless
  // shim isn't spawnable on Windows (CVE-2024-27980) and the .cmd variant needs
  // shell:true, which space-joins args UNESCAPED (DEP0190) — a hazard for the
  // temp tsconfig path. The JS entry behaves identically on every platform.
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', resolve(tmp, 'tsconfig.json'), '--pretty', 'false'], {
    cwd: root,
    stdio: 'pipe',
  })
  console.log(`verify-node-next-types: ${packages.length} workspace package declaration API(s) compile under NodeNext.`)
} catch (error: unknown) {
  failed = true
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = error as { stdout?: Buffer; stderr?: Buffer }
  console.error('verify-node-next-types: NodeNext consumer typecheck failed.\n')
  console.error(`${output.stdout?.toString() ?? ''}${output.stderr?.toString() ?? ''}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (failed) process.exit(1)
