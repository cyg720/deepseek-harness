/**
 * 文件职责：验证 oxlint-contract.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from 'typescript'
import { describe, expect, it } from 'vitest'

/** 中文说明：变量 repositoryRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 oxlintCli 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const oxlintCli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url))
/** 中文说明：变量 tsxCli 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))

/** 中文说明：函数 isRecord 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 isUnknownArray 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** 中文说明：函数 runRepositoryOxlint 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runRepositoryOxlint(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [tsxCli, 'scripts/run-oxlint.ts', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

/** 中文说明：函数 runOxlint 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runOxlint(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [oxlintCli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

/** 中文说明：函数 normalizedOutput 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function normalizedOutput(result: ReturnType<typeof runOxlint>): string {
  return `${result.stdout}${result.stderr}`.replaceAll('\\', '/')
}

/** 中文说明：函数 writeContractConfig 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function writeContractConfig(suffix: string): Promise<string> {
  /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = join(repositoryRoot, `.oxlintrc.contract-${suffix}.json`)
  await writeFile(path, JSON.stringify({ extends: ['./.oxlintrc.json'], ignorePatterns: [] }))
  return path
}

describe('Oxlint executable contract', () => {
  it('discovers the owning TypeScript project for every file class', async () => {
    /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const suffix = randomUUID()
    /** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configPath = await writeContractConfig(suffix)
    /** 中文说明：变量 probes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probes = [
      ['host package source', 'packages/fs/fs-observation-policy/src', 'packages/fs/fs-observation-policy/tsconfig.json'],
      ['host package test', 'packages/fs/fs-observation-policy/tests', 'tsconfig.host.json'],
      ['client package source', 'packages/client/ui-primitives/src', 'packages/client/ui-primitives/tsconfig.json'],
      // A test under packages/client states its face in the filename, so the
      // probe carries the Client suffix to reach the Client aggregate.
      ['client package test', 'packages/client/ui-trajectory/tests', 'tsconfig.client.json', '.client.ts'],
      ['CLI profile test', 'apps/cli/tests/profiles/headless/tests', 'tsconfig.host.json'],
      ['website', 'website', 'tsconfig.host.json'],
    ] as const
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = `export function probePromise(): Promise<void> {
  return Promise.resolve()
}

probePromise()
`

    try {
      /** 中文说明：变量 paths 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const paths: Array<readonly [label: string, path: string, tsconfig: string]> = []
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const [label, parent, tsconfig, extension = '.ts'] of probes) {
        /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const path = join(repositoryRoot, parent, `oxlint-contract-${suffix}${extension}`)
        await writeFile(path, source)
        paths.push([label, relative(repositoryRoot, path), tsconfig])
      }
      /** 中文说明：变量 clientScript 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const clientScript = 'scripts/client-bundle-purity.spec.ts'

      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        ...paths.map(([, path]) => path),
        clientScript,
      ], { OXC_LOG: 'debug' })
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const [label, path, tsconfig] of paths) {
        expect(output, label).toContain(`${path.replaceAll('\\', '/')}:5:1: Promises must be awaited`)
        expect(output, `${label} project`).toContain(
          `Got tsconfig for file ${join(repositoryRoot, path).replaceAll('\\', '/')}: ${join(repositoryRoot, tsconfig).replaceAll('\\', '/')}`,
        )
      }
      expect(output.match(/typescript\(no-floating-promises\)/g)).toHaveLength(probes.length)
      expect(output, 'client aggregate script project').toContain(
        `Got tsconfig for file ${join(repositoryRoot, clientScript).replaceAll('\\', '/')}: ${join(repositoryRoot, 'tsconfig.client.json').replaceAll('\\', '/')}`,
      )
      expect(output).not.toContain('Unmatched file:')
    } finally {
      await Promise.all([
        ...probes.map(([, parent, , extension = '.ts']) =>
          rm(join(repositoryRoot, parent, `oxlint-contract-${suffix}${extension}`), { force: true })),
        rm(configPath, { force: true }),
      ])
    }
  }, 90_000)

  it('runs JavaScript compatibility and nursery rules', async () => {
    /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const suffix = randomUUID()
    /** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configPath = await writeContractConfig(suffix)
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(repositoryRoot, 'scripts', `oxlint-contract-${suffix}.ts`)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = `export function firstProbe(): number {
  const first = 1
  const second = 2
  return first + second
}

export function secondProbe(): number {
  const first = 1
  const second = 2
  return first + second
}

export function hasValue(value: string): boolean {
  return value !== undefined
}

export const longProbe = 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1
`

    try {
      await writeFile(path, source)
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        relative(repositoryRoot, path),
      ])
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      expect(output).toContain('@stylistic(max-len)')
      expect(output).toContain('sonarjs(no-identical-functions)')
      expect(output).toContain('typescript(no-unnecessary-condition)')
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(configPath, { force: true }),
      ])
    }
  }, 90_000)

  it('keeps the complete stylistic contract in Oxlint', async () => {
    /** 中文说明：变量 oxlintPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oxlintPath = join(repositoryRoot, '.oxlintrc.json')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = parseConfigFileTextToJson(oxlintPath, await readFile(oxlintPath, 'utf8'))
    if (result.error !== undefined) {
      throw new Error(flattenDiagnosticMessageText(result.error.messageText, '\n'))
    }
    /** 中文说明：变量 parsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parsed = result.config as unknown
    if (!isRecord(parsed) || !isUnknownArray(parsed.overrides)) {
      throw new Error('.oxlintrc.json must contain an overrides array')
    }
    expect(parsed.ignorePatterns).toEqual(expect.arrayContaining([
      'packages/typert/generator/tests/fixtures/type-model/**',
    ]))
    /** 中文说明：函数值 stylisticOverride 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const stylisticOverride = parsed.overrides.find((value: unknown) =>
      isRecord(value) && isRecord(value.rules) && '@stylistic/max-len' in value.rules)
    if (!isRecord(stylisticOverride) || !isRecord(stylisticOverride.rules)) {
      throw new Error('.oxlintrc.json must contain the @stylistic validator override')
    }
    expect(stylisticOverride.rules).toMatchObject({
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
      '@stylistic/member-delimiter-style': ['error', {
        multiline: { delimiter: 'none' },
        singleline: { delimiter: 'semi', requireLast: false },
      }],
      '@stylistic/max-len': ['error', { code: 140, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
    })
    /** 中文说明：函数值 typeGraphOverride 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const typeGraphOverride = parsed.overrides.find((value: unknown) =>
      isRecord(value)
      && isUnknownArray(value.files)
      && value.files.includes('packages/typert/generator/tests/fixtures/type-model/packages/host/src/models.ts'))
    expect(typeGraphOverride).toMatchObject({
      rules: { '@stylistic/quotes': 'off' },
    })
  })

  it('checks preserved TypeGraph syntax without type-aware analysis', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runOxlint([
      '--config',
      '.oxlintrc.staged.json',
      'packages/typert/generator/tests/fixtures/type-model',
    ])

    expect(result.error).toBeUndefined()
    expect(result.status, normalizedOutput(result)).toBe(0)
  })

  it('keeps repository lint workflows Oxlint-only', async () => {
    /** 中文说明：变量 packageJson 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as unknown
    if (!isRecord(packageJson) || !isRecord(packageJson.scripts) || !isRecord(packageJson.devDependencies)) {
      throw new Error('package.json must contain scripts and devDependencies objects')
    }

    expect(packageJson.scripts['lint:contracts-ready']).toBe('tsx scripts/run-oxlint.ts .')
    expect(packageJson.scripts['lint:fix:contracts-ready']).toBe(
      'tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json packages/typert/generator/tests/fixtures/type-model --fix && tsx scripts/run-oxlint.ts . --fix',
    )
    expect(packageJson.devDependencies).not.toHaveProperty('eslint')
    expect(packageJson.devDependencies).not.toHaveProperty('@typescript-eslint/parser')
    expect(existsSync(join(repositoryRoot, 'eslint.format.config.mjs'))).toBe(false)

    /** 中文说明：变量 lefthook 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lefthook = await readFile(join(repositoryRoot, 'lefthook.yml'), 'utf8')
    expect(lefthook).toContain('scripts/run-oxlint.ts --config .oxlintrc.staged.json --fix')
    expect(lefthook).not.toContain('node_modules/.bin/eslint')
    expect(lefthook).not.toContain('eslint.format.config.mjs')
  })

  it('reports an unused suppression', async () => {
    /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const suffix = randomUUID()
    /** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configPath = await writeContractConfig(suffix)
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(repositoryRoot, 'scripts', `oxlint-contract-${suffix}.ts`)

    try {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      await writeFile(path, '// oxlint-disable-next-line no-console\nexport const value = 1\n')
      const result = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        relative(repositoryRoot, path),
      ])
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(0)
      expect(output).toContain('Unused oxlint-disable directive')
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(configPath, { force: true }),
      ])
    }
  }, 90_000)

  it('accepts an ignored-only staged selection', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runOxlint([
      '--fix',
      '--no-error-on-unmatched-pattern',
      'scripts/install-lefthook.mjs',
    ])

    expect(result.error).toBeUndefined()
    expect(result.status, normalizedOutput(result)).toBe(0)
  })

  it('keeps staged validation project-free while preserving source rules', async () => {
    /** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configPath = join(repositoryRoot, '.oxlintrc.staged.json')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = parseConfigFileTextToJson(configPath, await readFile(configPath, 'utf8'))
    if (result.error !== undefined) {
      throw new Error(flattenDiagnosticMessageText(result.error.messageText, '\n'))
    }
    /** 中文说明：变量 stagedConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stagedConfig = result.config as unknown
    if (!isRecord(stagedConfig)) throw new Error('.oxlintrc.staged.json must contain a config object')
    expect(stagedConfig).toMatchObject({
      extends: ['./.oxlintrc.json'],
      options: { typeAware: false },
    })
    expect(stagedConfig.ignorePatterns).not.toContain('packages/typert/generator/tests/fixtures/type-model/**')

    /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const suffix = randomUUID()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(repositoryRoot, 'scripts', `staged-lint-probe-${suffix}.ts`)
    try {
      await writeFile(path, 'export const value={answer:1};\n')
      /** 中文说明：变量 lint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const lint = runOxlint([
        '--config',
        relative(repositoryRoot, configPath),
        '--format',
        'unix',
        relative(repositoryRoot, path),
      ])
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = normalizedOutput(lint)

      expect(lint.error).toBeUndefined()
      expect(lint.status, output).toBe(1)
      expect(output).toContain('@stylistic')
      expect(output).not.toContain('typescript(')
    } finally {
      await rm(path, { force: true })
    }
  })

  it('preserves successful fix output channels', async () => {
    /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const suffix = randomUUID()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(repositoryRoot, 'scripts', `staged-lint-probe-${suffix}.ts`)

    try {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      await writeFile(path, '// oxlint-disable-next-line no-console\nexport const value = 1\n')
      const result = runRepositoryOxlint([
        '--config',
        '.oxlintrc.staged.json',
        '--format',
        'unix',
        '--fix',
        relative(repositoryRoot, path),
      ])

      expect(result.error).toBeUndefined()
      expect(result.status, normalizedOutput(result)).toBe(0)
      expect(result.stdout).toContain('Unused oxlint-disable directive')
      expect(result.stderr).toBe('')
    } finally {
      await rm(path, { force: true })
    }
  })

  it('prints only the final diagnostics when a fix retry still fails', async () => {
    /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const suffix = randomUUID()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(repositoryRoot, 'scripts', `staged-lint-probe-${suffix}.ts`)

    try {
      await writeFile(path, `export const longProbe = ${'1 + '.repeat(80)}1\n`)
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRepositoryOxlint([
        '--config',
        '.oxlintrc.staged.json',
        '--format',
        'unix',
        '--fix',
        relative(repositoryRoot, path),
      ])
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      expect(output.match(/@stylistic\(max-len\)/g)).toHaveLength(1)
    } finally {
      await rm(path, { force: true })
    }
  })

  it.each(['--fix', '--fix-suggestions', '--fix-dangerously'])(
    'converges overlapping staged stylistic fixes through Oxlint under %s',
    async (fixFlag) => {
      /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const suffix = randomUUID()
      /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const directory = join(repositoryRoot, 'scripts', `.oxlint-contract-${suffix}`)
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = join(directory, 'fix.ts')

      try {
        await mkdir(directory, { recursive: true })
        await writeFile(path, 'const value={answer:1};  \nconsole.log(value)\n')

        /** 中文说明：变量 relativePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const relativePath = relative(repositoryRoot, path)
        /** 中文说明：变量 lintResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const lintResult = runRepositoryOxlint(['--config', '.oxlintrc.staged.json', fixFlag, relativePath])

        expect(lintResult.error).toBeUndefined()
        expect(lintResult.status, normalizedOutput(lintResult)).toBe(0)
        expect(normalizedOutput(lintResult)).not.toContain('@stylistic')
        await expect(readFile(path, 'utf8')).resolves.toBe('const value={ answer:1 }\nconsole.log(value)\n')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    90_000,
  )
})
