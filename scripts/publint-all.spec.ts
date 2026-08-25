/**
 * 文件职责：验证 publint-all.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

/** 中文说明：变量 repositoryRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 runner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const runner = fileURLToPath(new URL('./publint-all.ts', import.meta.url))
/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(options: {
  exportPath?: string
  indexSource?: string
  files?: Record<string, string>
} = {}): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-publint-all-'))
  roots.push(root)
  /** 中文说明：变量 packageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packageDir = join(root, 'packages/core/probe')
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-probe',
    version: '0.0.1',
    type: 'module',
    license: 'MIT',
    engines: { node: '>=22.19' },
    sideEffects: false,
    files: ['lib'],
    exports: { '.': { default: options.exportPath ?? './lib/index.js' } },
  }, null, 2)}\n`)
  writeFileSync(join(packageDir, 'README.md'), '# Probe\n')
  writeFileSync(join(packageDir, 'lib/index.js'), options.indexSource ?? 'export const probe = true\n')
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const [path, source] of Object.entries(options.files ?? {})) {
    mkdirSync(join(packageDir, path, '..'), { recursive: true })
    writeFileSync(join(packageDir, path), source)
  }
  writeFileSync(join(packageDir, 'unpublished.js'), 'export const hidden = true\n')
  return root
}

/** 中文说明：函数 run 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function run(root: string) {
  return spawnSync(process.execPath, [
    '--import', 'tsx', runner,
    '--packages-root', root,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
  })
}

describe('publint package runner', () => {
  it('lints recursively declared files from an in-memory publication view', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = run(fixture())
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('linting 1 package(s)')
    expect(result.stdout).toContain('All good!')
  })

  it('rejects an export that exists in the workspace but is not published', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = run(fixture({ exportPath: './unpublished.js' }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('unpublished.js')
  })

  it('rejects a public export whose built file is missing', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = run(fixture({ exportPath: './lib/missing.js' }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('missing.js')
  })

  it('accepts published relative JavaScript and CSS targets', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = run(fixture({
      indexSource: "export { helper } from './helper.js'\nimport './theme.css'\n",
      files: {
        'lib/helper.js': 'export const helper = true\n',
        'lib/theme.css': ':root {}\n',
      },
    }))
    expect(result.status, result.stderr).toBe(0)
  })

  it('rejects unpublished relative JavaScript and CSS targets', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = run(fixture({
      indexSource: "export { helper } from './missing.js'\nimport './missing.css'\n",
    }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('imports "./missing.js"')
    expect(result.stderr).toContain('imports "./missing.css"')
  })
})
