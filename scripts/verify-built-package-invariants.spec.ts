/**
 * 文件职责：验证 verify-built-package-invariants.spec.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

/** 中文说明：变量 verifier 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const verifier = fileURLToPath(new URL('./verify-built-package-invariants.mjs', import.meta.url))
/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(options: {
  companion?: boolean
  invariantSource?: string
  invariantExport?: string
  runtimeChunk?: string
} = {}): { root: string; loaderUrl: string } {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-built-package-invariants-'))
  roots.push(root)
  /** 中文说明：变量 packageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packageDir = join(root, 'packages/core/probe')
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  const companion = options.companion ?? true
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-probe',
    type: 'module',
    files: companion ? ['lib/invariant.js'] : [],
    exports: companion ? {
      './invariant': {
        default: options.invariantExport ?? './lib/invariant.js',
      },
    } : {},
  }, null, 2)}\n`)
  if (companion) {
    writeFileSync(
      join(packageDir, 'lib/invariant.js'),
      options.invariantSource ?? "export const name = 'probe-invariant'\nexport const inject = ['invariants']\nexport const apply = () => {}\n",
    )
  }
  if (options.runtimeChunk !== undefined) {
    writeFileSync(join(packageDir, 'lib/chunk.js'), options.runtimeChunk)
  }
  /** 中文说明：变量 loaderPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const loaderPath = join(root, 'loader.mjs')
  writeFileSync(loaderPath, 'export default class Loader { unwrapExports(value) { return value } }\n')
  return { root, loaderUrl: pathToFileURL(loaderPath).href }
}

/** 中文说明：函数 verify 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function verify(root: string, loaderUrl: string) {
  return spawnSync(process.execPath, [
    verifier,
    '--packages-root', root,
    '--loader-url', loaderUrl,
  ], {
    encoding: 'utf8',
    timeout: 5_000,
  })
}

describe('built package invariant verifier', () => {
  it('loads the staged compiled self-reference through plain Node and Loader normalization', () => {
    const { root, loaderUrl } = fixture()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = verify(root, loaderUrl)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('1 compiled companion(s) passed plain-Node Loader checks')
  })

  it('accepts packages that do not publish a companion', () => {
    const { root, loaderUrl } = fixture({ companion: false })
    const result = verify(root, loaderUrl)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('0 compiled companion(s) passed plain-Node Loader checks')
  })

  it('rejects a default export and a broken invariant export map', () => {
    /** 中文说明：变量 withDefault 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const withDefault = fixture({
      invariantSource: "export default {}\nexport const name = 'probe-invariant'\nexport const inject = ['invariants']\nexport const apply = () => {}\n",
    })
    /** 中文说明：变量 defaultResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaultResult = verify(withDefault.root, withDefault.loaderUrl)
    expect(defaultResult.status).toBe(1)
    expect(defaultResult.stderr).toContain('companion has a default export')

    /** 中文说明：变量 brokenExport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brokenExport = fixture({ invariantExport: './lib/missing.js' })
    /** 中文说明：变量 exportResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exportResult = verify(brokenExport.root, brokenExport.loaderUrl)
    expect(exportResult.status).toBe(1)
    expect(exportResult.stderr).toContain('@deepseek-ai/dsh-probe')
  })

  it('rejects an invariant bundle that needs an unstaged runtime chunk', () => {
    const { root, loaderUrl } = fixture({
      invariantSource: "export * from './chunk.js'\n",
      runtimeChunk: "export const name = 'probe-invariant'\nexport const inject = ['invariants']\nexport const apply = () => {}\n",
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = verify(root, loaderUrl)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('chunk.js')
  })
})
