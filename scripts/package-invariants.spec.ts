/**
 * 文件职责：验证 package-invariants.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectPackageInvariantViolations,
} from './package-invariants.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 handwrittenInvariant 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function handwrittenInvariant(packageName: string): string {
  return `
export const name = 'probe-invariant'
export const inject = ['invariants']
const install = (ctx: { on(name: string, listener: (value: number) => void): void }, fail: (message: string) => never) => {
  ctx.on('probe/value', (value) => {
    if (value < 0) fail('observed values must be non-negative')
  })
}
export const apply = (ctx: { invariants: { register(name: string, install: typeof install): () => void } }) =>
  Promise.resolve(ctx.invariants.register(${JSON.stringify(packageName)}, install))
`
}

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(options: {
  packageName?: string
  source?: string
  invariantExport?: boolean
  invariantDependency?: boolean
  invariantReference?: boolean
  buildEntry?: boolean
} = {}): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-invariants-'))
  roots.push(root)
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = join(root, 'packages/core/probe')
  mkdirSync(join(dir, 'src'), { recursive: true })
  /** 中文说明：变量 packageName 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packageName = options.packageName ?? '@deepseek-ai/dsh-probe'
  /** 中文说明：变量 manifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = {
    name: packageName,
    exports: options.invariantExport === false ? {} : {
      './invariant': {
        types: './lib/types/invariant.d.ts',
        default: './lib/invariant.js',
      },
    },
    files: ['lib/index.js', 'lib/invariant.js'],
    peerDependencies: options.invariantDependency === false ? {} : {
      '@deepseek-ai/dsh-invariants': 'workspace:^',
    },
    devDependencies: options.invariantDependency === false ? {} : {
      '@deepseek-ai/dsh-invariants': 'workspace:^',
    },
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify({
    references: options.invariantReference === false ? [] : [{ path: '../../runtime-diagnostics/invariants' }],
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'src/invariant.ts'), options.source ?? handwrittenInvariant(packageName))
  writeFileSync(
    join(dir, 'tsdown.config.ts'),
    options.buildEntry === false ? "export default { entry: ['lib/types/index.js'] }\n" : "export default { entry: ['lib/types/index.js', 'lib/types/invariant.js'] }\n",
  )
  return root
}

describe('package invariant gate', () => {
  it('accepts a hand-owned checking companion with publication metadata', () => {
    expect(collectPackageInvariantViolations(fixture())).toEqual([])
  })

  it('accepts an invariant reference owned by a package-local leaf project', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture({ invariantReference: false })
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = join(root, 'packages/core/probe')
    writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify({
      files: [],
      references: [{ path: './tsconfig.host.json' }],
    }, null, 2)}\n`)
    writeFileSync(join(dir, 'tsconfig.host.json'), `${JSON.stringify({
      references: [{ path: '../../runtime-diagnostics/invariants' }],
    }, null, 2)}\n`)

    expect(collectPackageInvariantViolations(root)).toEqual([])
  })

  it('rejects missing publication metadata and build output', () => {
    /** 中文说明：变量 violations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const violations = collectPackageInvariantViolations(fixture({
      invariantExport: false,
      invariantDependency: false,
      invariantReference: false,
      buildEntry: false,
    }))
    expect(violations.map(violation => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('exports["./invariant"]'),
      expect.stringContaining('peerDependency'),
      expect.stringContaining('devDependency'),
      expect.stringContaining('TypeScript project references'),
      expect.stringContaining('must bundle lib/types/invariant.js'),
    ]))
  })

  it('rejects foreign, duplicate, and unresolved registrations', () => {
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = `
export const name = 'probe-invariant'
export const inject = ['invariants']
const selected = process.env.PACKAGE_NAME
const install = (_ctx: unknown, fail: (message: string) => never) => { fail('probe') }
export const apply = (ctx: { invariants: { register(name: string, install: typeof install): () => void } }) => {
  ctx.invariants.register('@deepseek-ai/dsh-foreign', install)
  return ctx.invariants.register(selected!, install)
}
`
    /** 中文说明：变量 violations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const violations = collectPackageInvariantViolations(fixture({ source }))
    expect(violations.map(violation => violation.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('must resolve to a local string constant'),
      expect.stringContaining('must register exactly its own package name'),
    ]))
  })

  it('rejects generated markers and reporter-free executable installers', () => {
    /** 中文说明：变量 generated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const generated = fixture({
      source: `/** @generated */\n${handwrittenInvariant('@deepseek-ai/dsh-probe')}`,
    })
    expect(collectPackageInvariantViolations(generated).map(violation => violation.message))
      .toContain('invariant companions must be hand-owned and may not carry @generated markers')

    /** 中文说明：变量 reporterFree 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reporterFree = fixture({
      source: `
export const name = 'probe-invariant'
export const inject = ['invariants']
const install = () => { void 0 }
export const apply = (ctx: { invariants: { register(name: string, install: typeof install): () => void } }) =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-probe', install))
`,
    })
    expect(collectPackageInvariantViolations(reporterFree).map(violation => violation.message))
      .toContain('install function must accept the bound failure reporter as its second parameter')

    /** 中文说明：变量 unused 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unused = fixture({
      source: `
export const name = 'probe-invariant'
export const inject = ['invariants']
const install = (_ctx: unknown, _fail: (message: string) => never) => { void 0 }
export const apply = (ctx: { invariants: { register(name: string, install: typeof install): () => void } }) =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-probe', install))
`,
    })
    expect(collectPackageInvariantViolations(unused).map(violation => violation.message))
      .toContain('install function must use its bound failure reporter')
  })

  it('rejects registering a different installer than the checked local function', () => {
    /** 中文说明：变量 decoy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoy = fixture({
      source: `
export const name = 'probe-invariant'
export const inject = ['invariants']
const install = (_ctx: unknown, fail: (message: string) => never) => { fail('checked decoy') }
export const apply = (ctx: { invariants: { register(name: string, install: () => void): () => void } }) =>
  ctx.invariants.register('@deepseek-ai/dsh-probe', () => {})
`,
    })
    expect(collectPackageInvariantViolations(decoy).map(violation => violation.message))
      .toContain('line 6: ctx.invariants.register must use the checked local install function')
  })

  it.each([
    'export default { name, inject, apply }',
    "export * as default from './probe.ts'",
  ])('rejects a default export that would collapse the Loader namespace', (defaultExport) => {
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = `${handwrittenInvariant('@deepseek-ai/dsh-probe')}\n${defaultExport}\n`
    expect(collectPackageInvariantViolations(fixture({ source })).map(violation => violation.message))
      .toContain('must not default-export; Loader must retain the companion namespace')
  })

  it('accepts explained empty installers and rejects unexplained ones', () => {
    /** 中文说明：变量 explained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const explained = `
export const name = 'probe-invariant'
export const inject = ['invariants']
const PACKAGE_NAME = '@deepseek-ai/dsh-probe'
/** No runtime invariant: this pure package owns no events or mutable data. */
const install = () => {}
export const apply = (ctx: { invariants: { register(name: string, install: () => void): () => void } }) =>
  ctx.invariants.register(PACKAGE_NAME, install)
`
    expect(collectPackageInvariantViolations(fixture({ source: explained }))).toEqual([])

    /** 中文说明：变量 unexplained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unexplained = `
export const name = 'probe-invariant'
export const inject = ['invariants']
const PACKAGE_NAME = '@deepseek-ai/dsh-probe'
const install = () => {}
export const apply = (ctx: { invariants: { register(name: string, install: () => void): () => void } }) =>
  ctx.invariants.register(PACKAGE_NAME, install)
`
    expect(collectPackageInvariantViolations(fixture({ source: unexplained })).map(violation => violation.message))
      .toContain('empty install function must explain why with a "No runtime invariant:" comment')
  })
})
