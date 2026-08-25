/**
 * 文件职责：验证 run-gates.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  defaultConcurrency,
  formatGateResultReason,
  gatesForMode,
  runGate,
  runGates,
  /** 中文说明：type Gate 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
  type Gate,
  /** 中文说明：type GateResult 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
  type GateResult,
} from './run-gates.ts'

/** 中文说明：函数 gate 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function gate(id: string, options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: id,
    displayCommand: `run ${id}`,
    command: process.execPath,
    args: ['-e', ''],
    ...options,
  }
}

/** 中文说明：函数 resultFor 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function resultFor(subject: Gate, status: GateResult['status'] = 'passed'): GateResult {
  return {
    gate: subject,
    status,
    durationMs: 10,
    output: [],
    exitCode: status === 'passed' ? 0 : 1,
    signalCode: null,
  }
}

/** 中文说明：函数 withPnpmEntrypoint 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function withPnpmEntrypoint<T>(action: () => T, entrypoint = '/private/pnpm.cjs'): T {
  /** 中文说明：变量 previous 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const previous = process.env.npm_execpath
  process.env.npm_execpath = entrypoint
  try {
    return action()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'npm_execpath')
    else process.env.npm_execpath = previous
  }
}

/** 中文说明：函数 withEnv 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function withEnv<T>(name: string, value: string | undefined, action: () => T): T {
  /** 中文说明：变量 previous 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const previous = process.env[name]
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
  try {
    return action()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = previous
  }
}

describe('gate graph validation', () => {
  it.each([
    'ci-primary',
    'ci-linux-primary',
    'ci-static',
    'ci-lint-contracts-ready',
    'ci-coverage',
    'ci-snapshot',
    'ci-artifacts',
    'ci-consumers',
    'ci-windows-blocking',
    'ci-windows-complete',
    'ci-windows-observational',
    'node-compat',
    'check-all',
    'hygiene',
    'doc-sync',
  ] as const)('constructs and executes preflight for a valid non-empty %s graph', async (mode) => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode(mode))
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = vi.fn(async (item: Gate) => resultFor(item))

    await expect(runGates(subject, subject.length, execute)).resolves.toHaveLength(subject.length)
  })

  it('keeps the public repository link policy in the documentation gate', () => {
    /** 中文说明：函数值 ids 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids).toContain('public-repository-links')
  })

  it('keeps the hygiene aggregate aligned with the package script checks', () => {
    /** 中文说明：函数值 ids 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ids = withPnpmEntrypoint(() => gatesForMode('hygiene').map(subject => subject.id))

    expect(ids).toEqual([
      'rescope-vendor', 'knip', 'publint', 'constraints', 'dsh-package-licenses',
      'package-invariants', 'built-package-invariants', 'node-next-types',
      'optional-dependency-imports', 'client-packages', 'cordis-config',
      'runtime-closure', 'vendored-links',
    ])
    expect(defaultConcurrency('hygiene', ids.length, 8)).toEqual({
      workers: 4,
      source: '8 available CPU(s), hygiene cap 4',
    })
  })

  it('schedules the longest documentation leaves before short checks', () => {
    /** 中文说明：函数值 ids 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ids = withPnpmEntrypoint(() => gatesForMode('doc-sync').map(subject => subject.id))

    expect(ids.slice(0, 10)).toEqual([
      'doc-typecheck', 'docs-site-build', 'doc-graphs', 'markdown-links', 'type-equivalence',
      'cordis-catalog', 'mermaid', 'scoped-events', 'translation-pairing', 'markdown-wrap',
    ])
  })

  it('launches a native pnpm entrypoint directly', () => {
    /** 中文说明：变量 entrypoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entrypoint = String.raw`C:\Program Files\pnpm\pnpm.exe`
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-windows-blocking')[0], entrypoint)

    expect(subject).toMatchObject({
      command: entrypoint,
      args: ['run', 'build'],
    })
  })

  it.each(['ci-primary', 'ci-static', 'check-all'] as const)(
    'keeps the DSH package license policy in %s',
    (mode) => {
      /** 中文说明：函数值 ids 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('dsh-package-licenses')
    },
  )

  it.each(['ci-primary', 'ci-static', 'check-all'] as const)(
    'keeps the client dependency policy in %s',
    (mode) => {
      /** 中文说明：函数值 ids 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const ids = withPnpmEntrypoint(() => gatesForMode(mode).map(subject => subject.id))

      expect(ids).toContain('client-packages')
    },
  )

  it('keeps native Windows coverage blocking while retaining the observational inventory', () => {
    /** 中文说明：函数值 complete 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const complete = withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))
    /** 中文说明：函数值 observational 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const observational = withPnpmEntrypoint(() => gatesForMode('ci-windows-observational'))
      .filter(gate => gate.id !== 'build' && gate.id !== 'docs-site-build')
    /** 中文说明：函数值 byId 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const byId = new Map(complete.map(subject => [subject.id, subject]))

    expect(byId.get('coverage')?.allowFailure).not.toBe(true)
    expect(byId.get('coverage-exempt-heavy')?.allowFailure).not.toBe(true)
    expect(byId.get('coverage-exempt-heavy')?.needs).toContain('build')
    expect(observational).not.toHaveLength(0)
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const gate of observational) {
      /** 中文说明：变量 completeGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const completeGate = byId.get(gate.id)
      expect(completeGate?.allowFailure).toBe(true)
      expect(completeGate?.after).toEqual(expect.arrayContaining([
        'coverage',
        'coverage-exempt-heavy',
      ]))
      expect(completeGate?.needs).toEqual(gate.needs)
    }
  })

  it('applies one configured test and polling timeout to both coverage gates', () => {
    /** 中文说明：函数值 gates 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const gates = withEnv('DSH_COVERAGE_TEST_TIMEOUT_MS', '15000', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete')))

    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const id of ['coverage', 'coverage-exempt-heavy']) {
      expect(gates.find(subject => subject.id === id)?.args).toEqual(expect.arrayContaining([
        '--testTimeout=15000',
        '--expect.poll.timeout=15000',
      ]))
    }
  })

  it('keeps Vitest timeout defaults when the coverage override is absent', () => {
    /** 中文说明：函数值 gates 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const gates = withEnv('DSH_COVERAGE_TEST_TIMEOUT_MS', undefined, () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete')))

    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const id of ['coverage', 'coverage-exempt-heavy']) {
      expect(gates.find(subject => subject.id === id)?.args).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/^--(?:testTimeout|expect\.poll\.timeout)=/),
      ]))
    }
  })

  it('rejects an invalid coverage timeout before starting a gate', () => {
    expect(() => withEnv('DSH_COVERAGE_TEST_TIMEOUT_MS', '0', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))))
      .toThrow('DSH_COVERAGE_TEST_TIMEOUT_MS must be a positive integer')
  })

  it('selects partitioned coverage only when explicitly configured', () => {
    /** 中文说明：函数值 coverage 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const coverage = withEnv('DSH_COVERAGE_PARTITIONS', '3', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete').find(subject => subject.id === 'coverage')))

    expect(coverage).toMatchObject({
      displayCommand: 'DSH_COVERAGE_PARTITIONS=3 pnpm run test:coverage:partitioned',
      args: ['/private/pnpm.cjs', 'run', 'test:coverage:partitioned'],
      streamOutput: true,
    })
  })

  it('rejects an invalid coverage partition count before starting a gate', () => {
    expect(() => withEnv('DSH_COVERAGE_PARTITIONS', '1', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-windows-complete'))))
      .toThrow('DSH_COVERAGE_PARTITIONS must be an integer greater than 1')
  })

  it.each([
    ['empty', [], /gate graph has no gates/],
    ['duplicate ids', [gate('same'), gate('same')], /duplicate gate id "same"/],
    ['unknown dependencies', [gate('subject', { needs: ['missing'] })], /depends on unknown gate "missing"/],
    ['unknown ordering predecessors', [gate('subject', { after: ['missing'] })], /waits for unknown gate "missing"/],
    ['cycles', [gate('first', { needs: ['second'] }), gate('second', { needs: ['first'] })], /dependency cycle: first -> second -> first/],
    ['mixed cycles', [gate('first', { after: ['second'] }), gate('second', { needs: ['first'] })], /dependency cycle: first -> second -> first/],
  ] as const)('rejects %s before starting a child', async (_label, invalid, message) => {
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = vi.fn(async (subject: Gate) => resultFor(subject))

    await expect(runGates([...invalid], 1, execute)).rejects.toThrow(message)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an invalid worker count before starting a child', async () => {
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = vi.fn(async (subject: Gate) => resultFor(subject))

    await expect(runGates([gate('subject')], 0, execute)).rejects.toThrow('max concurrency must be a positive integer')
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips dependents after their prerequisite fails', async () => {
    /** 中文说明：变量 dependent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dependent = gate('dependent', { needs: ['root'] })
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = gate('root')
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = vi.fn(async (subject: Gate) => resultFor(subject, 'failed'))

    /** 中文说明：变量 results 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const results = await runGates([dependent, root], 1, execute)

    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(root)
    expect(results[0]).toMatchObject({ gate: dependent, status: 'skipped', error: 'dependency failed or skipped: root' })
  })

  it('runs an ordered follower after its predecessor fails', async () => {
    /** 中文说明：变量 follower 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const follower = gate('follower', { after: ['root'] })
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = gate('root')
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = vi.fn(async (subject: Gate) => resultFor(subject, subject === root ? 'failed' : 'passed'))

    /** 中文说明：变量 results 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const results = await runGates([follower, root], 2, execute)

    expect(execute.mock.calls.map(([subject]) => subject.id)).toEqual(['root', 'follower'])
    expect(results.map(result => result.status)).toEqual(['passed', 'failed'])
  })

  it('runs an ordered follower after its predecessor is skipped', async () => {
    /** 中文说明：变量 follower 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const follower = gate('follower', { after: ['dependent'] })
    /** 中文说明：变量 dependent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dependent = gate('dependent', { needs: ['root'] })
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = gate('root')
    /** 中文说明：函数值 execute 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const execute = vi.fn(async (subject: Gate) => resultFor(subject, subject === root ? 'failed' : 'passed'))

    /** 中文说明：变量 results 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const results = await runGates([follower, dependent, root], 2, execute)

    expect(execute.mock.calls.map(([subject]) => subject.id)).toEqual(['root', 'follower'])
    expect(results.map(result => result.status)).toEqual(['passed', 'skipped', 'failed'])
  })
})

describe('Oxlint gate', () => {
  it('uses the package script when no worker bound is configured', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withEnv('DSH_OXLINT_THREADS', undefined, () =>
      withPnpmEntrypoint(() => gatesForMode('ci-lint-contracts-ready')[0]))

    expect(subject).toMatchObject({
      id: 'lint',
      displayCommand: 'pnpm run lint:contracts-ready',
      command: process.execPath,
      args: ['/private/pnpm.cjs', 'run', 'lint:contracts-ready'],
    })
  })

  it('surfaces the configured worker bound on the shared package script', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withEnv('DSH_OXLINT_THREADS', '4', () =>
      withPnpmEntrypoint(() => gatesForMode('ci-lint-contracts-ready')[0]))

    expect(subject).toMatchObject({
      id: 'lint',
      displayCommand: 'DSH_OXLINT_THREADS=4 pnpm run lint:contracts-ready',
      command: process.execPath,
      args: ['/private/pnpm.cjs', 'run', 'lint:contracts-ready'],
    })
  })
})

describe('Typert contract preparation', () => {
  it('prepares primary source consumers once before they run', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withEnv('DSH_OXLINT_THREADS', undefined, () =>
      withPnpmEntrypoint(() => gatesForMode('ci-primary')))

    expect(subject.find(item => item.id === 'typert-contracts')).toMatchObject({
      displayCommand: 'pnpm run build:lib:host',
      args: ['/private/pnpm.cjs', 'run', 'build:lib:host'],
    })
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const [id, script] of [
      ['typecheck', 'typecheck:contracts-ready'],
      ['lint', 'lint:contracts-ready'],
      ['doc-typecheck', 'doc-typecheck:contracts-ready'],
    ] as const) {
      expect(subject.find(item => item.id === id)).toMatchObject({
        displayCommand: `pnpm run ${script}`,
        args: ['/private/pnpm.cjs', 'run', script],
        needs: ['typert-contracts'],
      })
    }
    expect(subject.find(item => item.id === 'build')?.needs).toEqual([
      'typecheck',
      'lint',
      'doc-typecheck',
    ])
  })

  it('reuses contracts from the validated consumer build', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-consumers'))

    expect(subject.find(item => item.id === 'lint-and-duplication')).toMatchObject({
      displayCommand: 'pnpm run check:ci:lint:contracts-ready',
      args: ['/private/pnpm.cjs', 'run', 'check:ci:lint:contracts-ready'],
    })
    expect(subject.find(item => item.id === 'doc-typecheck')).toMatchObject({
      displayCommand: 'pnpm run doc-typecheck:contracts-ready',
      args: ['/private/pnpm.cjs', 'run', 'doc-typecheck:contracts-ready'],
    })
  })

  it('keeps standalone doc sync responsible for preparation', () => {
    /** 中文说明：函数值 docTypecheck 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const docTypecheck = withPnpmEntrypoint(() =>
      gatesForMode('doc-sync').find(item => item.id === 'doc-typecheck'))

    expect(docTypecheck?.displayCommand).toBe('pnpm run doc-typecheck')
  })
})

describe('Node compatibility graph', () => {
  it('runs the jsdom environment smoke on every advertised Node line', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode('node-compat'))

    expect(subject.find(item => item.id === 'vitest-jsdom-smoke')).toMatchObject({
      label: 'Vitest jsdom smoke',
      args: [
        '/private/pnpm.cjs',
        'exec',
        'vitest',
        'run',
        'scripts/vitest-environment.compat.spec.ts',
      ],
    })
  })
})

describe('Node 24 lane ownership', () => {
  it('keeps the static lane source-only', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-static'))

    expect(subject.map(item => item.id)).not.toContain('build')
    expect(subject.map(item => item.id)).not.toContain('doc-typecheck')
  })

  it('owns the build and orders its artifact consumers', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-consumers'))

    expect(defaultConcurrency('ci-consumers', subject.length, 4)).toEqual({
      workers: 10,
      source: 'ci-consumers gate count',
    })
    expect(subject.map(item => item.id)).toEqual([
      'build',
      'node-compat',
      'publint',
      'built-package-invariants',
      'lint-and-duplication',
      'snapshot',
      'web-snapshot',
      'doc-typecheck',
      'node-next-types',
      'built-bin-smoke',
    ])
    expect(subject.find(item => item.id === 'publint')?.needs).toEqual(['build'])
    expect(subject.find(item => item.id === 'build')?.env).toEqual({
      DSH_BUILD_CLIENT_PROFILE: 'official',
    })
    expect(subject.find(item => item.id === 'node-compat')?.env).toEqual({
      DSH_BUILD_CLIENT_PROFILE: 'official',
    })
    expect(subject.find(item => item.id === 'built-package-invariants')?.needs).toEqual(['build'])
    expect(subject.find(item => item.id === 'lint-and-duplication')?.needs).toEqual(['built-package-invariants'])
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const id of [
      'snapshot',
      'web-snapshot',
      'doc-typecheck',
      'node-next-types',
      'built-bin-smoke',
    ]) {
      expect(subject.find(item => item.id === id)?.needs).toEqual(['built-package-invariants'])
    }
    expect(subject.find(item => item.id === 'snapshot')?.env).toEqual({ DSH_EXAMPLE_MODE: 'lib' })
    expect(subject.find(item => item.id === 'doc-typecheck')?.env).toEqual({
      DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1',
    })
    expect(subject.find(item => item.id === 'built-bin-smoke')?.args).toEqual(
      expect.arrayContaining([
        'packages/subagent/subagent-codex/tests/loader-composition.e2e.ts',
        'packages/subagent/subagent-claude-code/tests/loader-composition.e2e.ts',
      ]),
    )
    expect(subject.find(item => item.id === 'web-snapshot')).toMatchObject({
      displayCommand: 'DSH_SNAPSHOT=replay pnpm run test:web:built',
      env: { DSH_SNAPSHOT: 'replay' },
    })
  })
})

describe('Linux primary graph', () => {
  it('adds the same compare-only web gate after built client artifacts', () => {
    /** 中文说明：函数值 subject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const subject = withPnpmEntrypoint(() => gatesForMode('ci-linux-primary'))
    /** 中文说明：函数值 web 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const web = subject.find(item => item.id === 'web-snapshot')

    expect(web).toMatchObject({
      displayCommand: 'DSH_SNAPSHOT=replay pnpm run test:web:built',
      env: { DSH_SNAPSHOT: 'replay' },
      needs: ['built-package-invariants'],
    })
  })
})

describe('gate process outcomes', () => {
  it('streams selected gate output without retaining it', async () => {
    /** 中文说明：变量 write 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await runGate(gate('streamed', {
        args: ['-e', "process.stdout.write('live output')"],
        streamOutput: true,
      }))

      expect(result.status).toBe('passed')
      expect(result.output).toEqual([])
      expect(write).toHaveBeenCalledWith('live output')
    } finally {
      write.mockRestore()
    }
  })

  it.skipIf(process.platform === 'win32')('reports signal termination independently from exit status', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await runGate(gate('terminated', {
      args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
    }))

    expect(result.status).toBe('failed')
    expect(result.exitCode).toBeNull()
    expect(result.signalCode).toBe('SIGTERM')
    expect(formatGateResultReason(result)).toBe('signal SIGTERM')
  })
})
