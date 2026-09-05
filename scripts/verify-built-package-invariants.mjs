/** Verify every compiled companion through its staged package self-reference under plain Node. */
/*
 * 文件职责：实现 verify-built-package-invariants.mjs 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

/** 中文说明：变量 repositoryRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repositoryRoot = resolve(import.meta.dirname, '..')
const { values: options } = parseArgs({
  args: process.argv.slice(2),
  options: { 'packages-root': { type: 'string' }, 'loader-url': { type: 'string' } },
})
/** 中文说明：变量 packagesRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packagesRoot = resolve(options['packages-root'] ?? repositoryRoot)
/** 中文说明：变量 loaderUrl 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const loaderUrl = options['loader-url']
  ?? pathToFileURL(resolve(repositoryRoot, 'vendor/loader/lib/index.js')).href
/** 中文说明：变量 failures 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const failures = []
/** 中文说明：变量 manifests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const manifests = globSync('packages/*/*/package.json', { cwd: packagesRoot }).sort()
let companionCount = 0
const { default: Loader } = await import(loaderUrl)
/** 中文说明：变量 loader 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const loader = Object.create(Loader.prototype)

/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const manifestPath of manifests) {
  /** 中文说明：变量 packageDir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packageDir = dirname(resolve(packagesRoot, manifestPath))
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = JSON.parse(readFileSync(resolve(packagesRoot, manifestPath), 'utf8'))
  /** 中文说明：变量 packageName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packageName = manifest.name
  if (typeof packageName !== 'string' || packageName.length === 0) {
    failures.push(`${manifestPath}: missing package name`)
    continue
  }
  /** 中文说明：变量 invariantExport 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const invariantExport = manifest.exports?.['./invariant']
  if (invariantExport === undefined) continue
  companionCount += 1
  if (typeof invariantExport !== 'object'
    || invariantExport === null
    || invariantExport.default !== './lib/invariant.js'
    || !manifest.files?.includes('lib/invariant.js')) {
    failures.push(`${packageName}: manifest does not publish ./lib/invariant.js as ./invariant`)
    continue
  }

  // Keep the staged view below its owning package so Node reaches the real
  // pnpm dependency links. Junctioning node_modules elsewhere breaks pnpm's
  // relative workspace links on Windows. Copy the manifest-declared lib view
  // so a companion that imports an undeclared runtime chunk fails here.
  /** 中文说明：变量 stagedPackageDir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stagedPackageDir = mkdtempSync(resolve(packageDir, '.dsh-built-invariant-'))
  try {
    copyFileSync(resolve(packageDir, 'package.json'), resolve(stagedPackageDir, 'package.json'))
    copyDeclaredLibFiles(packageDir, stagedPackageDir, manifest.files)
    /** 中文说明：变量 probePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probePath = resolve(stagedPackageDir, 'probe.mjs')
    writeFileSync(
      probePath,
      `import * as companion from ${JSON.stringify(`${packageName}/invariant`)}\nexport default companion\n`,
    )
    const { default: companion } = await import(pathToFileURL(probePath).href)
    if ('default' in companion) throw new Error('companion has a default export')
    /** 中文说明：变量 unwrapped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(companion)
    if (unwrapped !== companion) throw new Error('Loader collapsed the companion namespace')
    if (typeof unwrapped.name !== 'string') throw new Error('companion name is missing')
    if (!Array.isArray(unwrapped.inject) || !unwrapped.inject.includes('invariants')) {
      throw new Error('companion does not inject invariants')
    }
    if (typeof unwrapped.apply !== 'function') throw new Error('companion apply is missing')
  } catch (error) {
    failures.push(`${packageName}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    rmSync(stagedPackageDir, { recursive: true, force: true })
  }
}

if (failures.length > 0) {
  console.error('verify-built-package-invariants: compiled companion failures:')
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-built-package-invariants: ${companionCount} compiled companion(s) passed plain-Node Loader checks.`)

/** 中文说明：函数 copyDeclaredLibFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function copyDeclaredLibFiles(packageDir, stagedPackageDir, files) {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pattern of files) {
    if (!pattern.startsWith('lib/')) continue
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const relativePath of globSync(pattern, { cwd: packageDir })) {
      /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const source = resolve(packageDir, relativePath)
      if (!existsSync(source)) continue
      /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const target = resolve(stagedPackageDir, relativePath)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, { recursive: true })
    }
  }
}
