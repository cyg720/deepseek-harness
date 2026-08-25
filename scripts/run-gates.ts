/**
 * Run local and CI quality gates with bounded in-process scheduling.
 *
 * Package scripts own public aggregate names; this runner owns their validated
 * dependency graphs, scheduler environment, and process diagnostics.
 * @see ../.agents/notes/implemented/process/2026-07-06-parallel-pre-push-gates.md
 */
/**
 * 文件职责：实现 run-gates.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { CLIENT_BUILD_PROFILE_SELECTOR } from './client-build-environment.ts'
import { COVERAGE_EXEMPT_ENV, coverageExemptHeavySuites } from './coverage-exempt.ts'
import {
  COVERAGE_PARTITIONS_ENV,
  COVERAGE_TEST_TIMEOUT_ENV,
  coverageTestTimeoutArgs,
  parseCoveragePartitionCount,
} from './coverage-partitions.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** A named aggregate exposed by the gate runner. */
/** 中文说明：type Mode 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export type Mode =
  | 'ci-primary'
  | 'ci-linux-primary'
  | 'ci-static'
  | 'ci-lint-contracts-ready'
  | 'ci-coverage'
  | 'ci-snapshot'
  | 'ci-artifacts'
  | 'ci-consumers'
  | 'ci-windows-blocking'
  | 'ci-windows-complete'
  | 'ci-windows-observational'
  | 'node-compat'
  | 'check-all'
  | 'hygiene'
  | 'doc-sync'

/** 中文说明：type GateResultStatus 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type GateResultStatus = 'passed' | 'failed' | 'skipped'
/** 中文说明：type GateState 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type GateState = 'pending' | 'running' | GateResultStatus

/** A command and its dependency metadata inside one aggregate. */
/** 中文说明：interface Gate 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface Gate {
  id: string
  label: string
  displayCommand: string
  command: string
  args: string[]
  needs?: string[]
  /** Gate ids that must settle, regardless of outcome, before this gate starts. */
  after?: string[]
  env?: Record<string, string | undefined>
  /** Keep a failure visible without failing the aggregate. */
  allowFailure?: boolean
  /** Write child output as it arrives instead of buffering it until completion. */
  streamOutput?: boolean
}

/** The observed outcome of one gate process. */
/** 中文说明：interface GateResult 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface GateResult {
  gate: Gate
  status: GateResultStatus
  durationMs: number
  output: GateOutputChunk[]
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  error?: string
}

/** 中文说明：interface GateOutputChunk 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface GateOutputChunk {
  stream: 'stdout' | 'stderr'
  text: string
}

/** 中文说明：interface RunningGate 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface RunningGate {
  gate: Gate
  promise: Promise<GateResult>
}

/** 中文说明：interface ConcurrencyDefault 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ConcurrencyDefault {
  workers: number
  source: string
}

/** 中文说明：type GateExecutor 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type GateExecutor = (gate: Gate) => Promise<GateResult>
/** 中文说明：type ResultObserver 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type ResultObserver = (result: GateResult) => void

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function main(args: string[]): Promise<number> {
  /** 中文说明：变量 mode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mode = parseMode(args[0])
  /** 中文说明：变量 gates 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const gates = gatesForMode(mode)
  /** 中文说明：变量 concurrencyDefault 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const concurrencyDefault = defaultConcurrency(mode, gates.length)
  /** 中文说明：变量 concurrencyOverride 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const concurrencyOverride = process.env.DSH_GATE_CONCURRENCY
  /** 中文说明：变量 maxConcurrency 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const maxConcurrency = concurrencyFromEnv('DSH_GATE_CONCURRENCY', concurrencyDefault.workers)
  /** 中文说明：变量 concurrencySource 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const concurrencySource = concurrencyOverride === undefined || concurrencyOverride === ''
    ? concurrencyDefault.source
    : '$DSH_GATE_CONCURRENCY'
  /** 中文说明：变量 startedAt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const startedAt = performance.now()
  console.log(`run-gates: ${mode} running ${gates.length} gate(s) with ${maxConcurrency} worker(s) from ${concurrencySource}.`)

  /** 中文说明：变量 results 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const results = await runGates(gates, maxConcurrency, runGate, printResult)
  printSummary(results, performance.now() - startedAt)
  return results.some(result => result.gate.allowFailure !== true && (result.status === 'failed' || result.status === 'skipped'))
    ? 1
    : 0
}

/** 中文说明：函数 parseMode 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseMode(raw: string | undefined): Mode {
  switch (raw) {
    case 'ci-primary':
    case 'ci-linux-primary':
    case 'ci-static':
    case 'ci-lint-contracts-ready':
    case 'ci-coverage':
    case 'ci-snapshot':
    case 'ci-artifacts':
    case 'ci-consumers':
    case 'ci-windows-blocking':
    case 'ci-windows-complete':
    case 'ci-windows-observational':
    case 'node-compat':
    case 'check-all':
    case 'hygiene':
    case 'doc-sync':
      return raw
    default:
      throw new Error(
        `run-gates: expected mode ci-primary | ci-linux-primary | ci-static | ci-lint-contracts-ready | ci-coverage | ci-snapshot | ci-artifacts | ci-consumers | ci-windows-blocking | ci-windows-complete | ci-windows-observational | node-compat | check-all | hygiene | doc-sync, got ${JSON.stringify(raw)}.`,
      )
  }
}

/**
 * Resolve the default worker count for one aggregate.
 * @param selectedMode - aggregate whose resource posture applies.
 * @param total - number of gates in the aggregate.
 * @param available - host CPU availability for ordinary modes.
 * @returns the default worker count and its diagnostic source.
 */
/** 中文说明：函数 defaultConcurrency 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function defaultConcurrency(
  selectedMode: Mode,
  total: number,
  available = availableParallelism(),
): ConcurrencyDefault {
  if (selectedMode === 'ci-consumers') return { workers: total, source: 'ci-consumers gate count' }
  // Local modes cap workers: several doc gates each build a full ts.Program,
  // so an uncapped default on a large host trades wall clock for memory blowups.
  /** 中文说明：变量 localCap 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const localCap = selectedMode === 'check-all' || selectedMode === 'hygiene' || selectedMode === 'doc-sync'
  /** 中文说明：变量 modeLimit 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const modeLimit = localCap ? Math.min(4, available) : available
  return {
    workers: Math.min(total, modeLimit),
    source: localCap
      ? `${available} available CPU(s), ${selectedMode} cap 4`
      : `${available} available CPU(s)`,
  }
}

/** 中文说明：函数 concurrencyFromEnv 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function concurrencyFromEnv(name: string, fallback: number): number {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`run-gates: ${name} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return parsed
}

/** 中文说明：函数 pnpmScript 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function pnpmScript(id: string, script: string, options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: options.label ?? script,
    displayCommand: `pnpm run ${script}`,
    ...pnpmInvocation(['run', script]),
    ...options,
  }
}

/** Build official client artifacts inside a CI aggregate without changing sibling gate environments. */
/** 中文说明：函数 ciBuildGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciBuildGate(id = 'build', options: Partial<Gate> = {}): Gate {
  return pnpmScript(id, 'build', {
    ...options,
    env: { ...options.env, [CLIENT_BUILD_PROFILE_SELECTOR]: 'official' },
  })
}

/** 中文说明：函数 pnpmExec 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function pnpmExec(id: string, args: string[], options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: options.label ?? `pnpm exec ${args.join(' ')}`,
    displayCommand: `pnpm exec ${args.join(' ')}`,
    ...pnpmInvocation(['exec', ...args]),
    ...options,
  }
}

/**
 * Construct the complete gate list for a named aggregate.
 * @param selected - aggregate mode to construct.
 * @returns the aggregate's gate graph.
 */
/** 中文说明：函数 gatesForMode 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function gatesForMode(selected: Mode): Gate[] {
  switch (selected) {
    case 'ci-primary':
      return ciPrimaryGates()
    case 'ci-linux-primary':
      return [...ciPrimaryGates(), webSnapshotGate(['built-package-invariants'])]
    case 'ci-static':
      return ciStaticGates({ ownsBuild: false })
    case 'ci-lint-contracts-ready':
      return [
        lintGate(),
        pnpmScript('duplication', 'duplication'),
      ]
    case 'ci-coverage':
      return coverageGates()
    case 'ci-snapshot':
      return [ciBuildGate(), snapshotGate()]
    case 'ci-artifacts':
      return ciArtifactGates()
    case 'ci-consumers':
      return ciConsumerGates()
    case 'ci-windows-blocking':
      return ciWindowsBlockingGates()
    case 'ci-windows-complete':
      return ciWindowsCompleteGates()
    case 'ci-windows-observational':
      return ciWindowsObservationalGates()
    case 'node-compat':
      return nodeCompatGates()
    case 'check-all':
      return [
        pnpmScript('runtime-closure', 'verify-runtime-closure', { label: 'runtime closure' }),
        pnpmScript('cordis-config', 'verify-cordis-config', { label: 'Cordis config' }),
        pnpmScript('client-domain-graph', 'verify-client-domain-graph', { label: 'client domain graph' }),
        pnpmScript('test', 'test'),
        pnpmScript('issue-management', 'test:issue-management', { label: 'Issue management policy' }),
        pnpmScript('duplication', 'duplication'),
        snapshotGate(),
        pnpmScript('build', 'build'),
        pnpmScript('build:web', 'build:web'),
        ...hygieneLeafGates({ artifactNeeds: ['build'] }),
        ...docSyncLeafGates({
          docTypecheckNeeds: ['build'],
          docTypecheckEnv: { DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
          docTypecheckScript: 'doc-typecheck:contracts-ready',
        }),
        pnpmScript('module-graph', 'verify-module-graph', { label: 'module graph' }),
      ]
    case 'hygiene':
      return [
        ...hygieneLeafGates(),
        pnpmScript('cordis-config', 'verify-cordis-config', { label: 'Cordis config' }),
        pnpmScript('runtime-closure', 'verify-runtime-closure', { label: 'runtime closure' }),
        pnpmScript('vendored-links', 'verify-vendored-links', { label: 'vendored links' }),
      ]
    case 'doc-sync':
      return docSyncLeafGates()
  }
}

/** 中文说明：函数 ciSharedStaticGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciSharedStaticGates(): Gate[] {
  return [
    pnpmScript('runtime-closure', 'verify-runtime-closure', { label: 'runtime closure' }),
    pnpmScript('constraints', 'constraints'),
    pnpmScript('dsh-package-licenses', 'verify-dsh-package-licenses', { label: 'DSH package licenses' }),
    pnpmScript('package-invariants', 'verify-package-invariants', { label: 'package invariants' }),
    pnpmScript('cordis-config', 'verify-cordis-config', { label: 'Cordis config' }),
    pnpmScript('optional-dependency-imports', 'verify-optional-dependency-imports', {
      label: 'optional dependency imports',
    }),
    pnpmScript('client-packages', 'verify-client-packages', { label: 'client packages' }),
    pnpmScript('issue-management', 'test:issue-management', { label: 'Issue management policy' }),
  ]
}

/** 中文说明：函数 ciPrimaryGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciPrimaryGates(): Gate[] {
  return [
    ...ciSharedStaticGates(),
    typertContractsGate(),
    pnpmScript('typecheck', 'typecheck:contracts-ready', { needs: ['typert-contracts'] }),
    lintGate({ needs: ['typert-contracts'] }),
    pnpmScript('duplication', 'duplication'),
    ...coverageGates(),
    ...nodeCompatSmokeGates(),
    snapshotGate(),
    ...docSyncLeafGates({
      docTypecheckNeeds: ['typert-contracts'],
      docTypecheckScript: 'doc-typecheck:contracts-ready',
    }),
    pnpmScript('module-graph', 'verify-module-graph', { label: 'module graph' }),
    pnpmScript('knip', 'knip'),
    // The prepared typecheck and build both drive Client tsc, while build also
    // repeats the Host contract pass. Wait for all three consumers so build
    // neither races tsbuildinfo nor replaces declarations while they are read.
    ciBuildGate('build', { needs: ['typecheck', 'lint', 'doc-typecheck'] }),
    pnpmScript('publint', 'publint', { needs: ['build'] }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: ['build'],
    }),
    builtPackageInvariantsGate(['build']),
    builtBinSmokeGate(),
  ]
}

/** 中文说明：函数 nodeCompatGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function nodeCompatGates(): Gate[] {
  /** 中文说明：变量 typecheck 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const typecheck = flagEnabled('DSH_NODE_COMPAT_SKIP_TYPECHECK')
    ? []
    : [pnpmScript('typecheck', 'typecheck')]
  if (runningNodeMajor() !== 22) {
    return [...typecheck, ...nodeCompatSmokeGates()]
  }
  return [
    ...typecheck,
    pnpmScript('build', 'build', {
      ...typecheck.length === 0 ? {} : { needs: ['typecheck'] },
    }),
    pnpmScript('build:web', 'build:web', {
      label: 'Web frontend build',
      needs: ['build'],
    }),
    ...nodeCompatSmokeGates({ cliSmoke: true }),
  ]
}

/** 中文说明：函数 nodeCompatSmokeGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function nodeCompatSmokeGates(options: { cliSmoke?: boolean } = {}): Gate[] {
  /** 中文说明：变量 gates 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const gates: Gate[] = [
    pnpmExec('source-worker-smoke', [
      'vitest',
      'run',
      'packages/workflow/workflow-worker-thread/tests/source-worker.compat.spec.ts',
    ], { label: 'source worker smoke' }),
    pnpmExec('jsonl-zstd-smoke', [
      'vitest',
      'run',
      'packages/session/session-persistence-jsonl/tests/zstd.compat.spec.ts',
    ], { label: 'JSONL Zstandard smoke' }),
    pnpmExec('dsh-source-launch-smoke', [
      'vitest',
      'run',
      'apps/cli/tests/source-launch.compat.spec.ts',
    ], { label: 'dsh source-launch smoke' }),
    pnpmExec('vitest-jsdom-smoke', [
      'vitest',
      'run',
      'scripts/vitest-environment.compat.spec.ts',
    ], { label: 'Vitest jsdom smoke' }),
  ]
  if (options.cliSmoke) {
    gates.push(
      pnpmExec('cli-lazy-search-startup-smoke', [
        'vitest',
        'run',
        'apps/cli/tests/lazy-search-startup.compat.spec.ts',
      ], {
        label: 'CLI lazy-search startup smoke',
        env: { DSH_REQUIRE_BUILT_CLI_SMOKE: '1' },
        needs: ['build:web'],
      }),
    )
  }
  return gates
}

/** Active Node major used to select version-specific compatibility checks. */
/** 中文说明：函数 runningNodeMajor 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function runningNodeMajor(): number {
  /** 中文说明：变量 major 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
  if (!Number.isSafeInteger(major)) {
    throw new Error(`run-gates: cannot parse Node version ${JSON.stringify(process.versions.node)}.`)
  }
  return major
}

/** 中文说明：函数 ciStaticGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciStaticGates(options: { ownsBuild: boolean }): Gate[] {
  return [
    ...ciSharedStaticGates(),
    ...options.ownsBuild ? [ciBuildGate()] : [],
    ...docSyncLeafGates({
      includeDocTypecheck: options.ownsBuild,
      ...options.ownsBuild
        ? {
          docTypecheckNeeds: ['build'],
          docTypecheckEnv: { DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
          docTypecheckScript: 'doc-typecheck:contracts-ready',
        }
        : {},
      docsBuildScript: 'docs:build:mpa',
    }),
    pnpmScript('module-graph', 'verify-module-graph', { label: 'module graph' }),
    pnpmScript('knip', 'knip'),
  ]
}

/** 中文说明：函数 ciArtifactGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciArtifactGates(): Gate[] {
  return [
    ciBuildGate(),
    pnpmScript('publint', 'publint', { needs: ['build'] }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: ['build'],
    }),
    builtPackageInvariantsGate(['build']),
    builtBinSmokeGate(),
  ]
}

/** 中文说明：函数 ciConsumerGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciConsumerGates(): Gate[] {
  /** 中文说明：变量 builtTree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const builtTree = ['build']
  /** 中文说明：变量 validatedBuild 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const validatedBuild = ['built-package-invariants']
  return [
    ciBuildGate(),
    pnpmScript('node-compat', 'check:node-compat', {
      label: 'Node compatibility',
      env: { [CLIENT_BUILD_PROFILE_SELECTOR]: 'official' },
    }),
    pnpmScript('publint', 'publint', { needs: builtTree }),
    builtPackageInvariantsGate(builtTree),
    pnpmScript('lint-and-duplication', 'check:ci:lint:contracts-ready', {
      label: 'lint and duplication',
      needs: validatedBuild,
    }),
    snapshotGate(validatedBuild),
    webSnapshotGate(validatedBuild),
    pnpmScript('doc-typecheck', 'doc-typecheck:contracts-ready', {
      needs: validatedBuild,
      env: { DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
    }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: validatedBuild,
    }),
    builtBinSmokeGate(validatedBuild),
  ]
}

/** 中文说明：函数 webSnapshotGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function webSnapshotGate(needs: string[]): Gate {
  /** 中文说明：变量 workerRaw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workerRaw = process.env.DSH_WEB_SNAPSHOT_WORKERS
  if (workerRaw !== undefined && workerRaw !== '') {
    /** 中文说明：变量 workers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workers = Number.parseInt(workerRaw, 10)
    if (!Number.isSafeInteger(workers) || workers < 2 || String(workers) !== workerRaw) {
      throw new Error(`run-gates: DSH_WEB_SNAPSHOT_WORKERS must be an integer greater than 1, got ${JSON.stringify(workerRaw)}.`)
    }
    return pnpmScript('web-snapshot', 'test:web:ci', {
      label: 'web browser snapshot',
      displayCommand: `DSH_SNAPSHOT=replay DSH_WEB_SNAPSHOT_WORKERS=${workers} pnpm run test:web:ci`,
      env: { DSH_SNAPSHOT: 'replay' },
      needs,
      streamOutput: true,
    })
  }
  return pnpmScript('web-snapshot', 'test:web:built', {
    label: 'web browser snapshot',
    displayCommand: 'DSH_SNAPSHOT=replay pnpm run test:web:built',
    env: { DSH_SNAPSHOT: 'replay' },
    needs,
  })
}

/** 中文说明：函数 ciWindowsBlockingGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciWindowsBlockingGates(): Gate[] {
  return [
    ciBuildGate('windows-build', { label: 'build' }),
    pnpmScript('windows-site', 'docs:build', { label: 'production site' }),
  ]
}

/** 中文说明：函数 ciWindowsCompleteGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciWindowsCompleteGates(): Gate[] {
  /** 中文说明：函数值 coverage 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const coverage = coverageGates().map(gate => gate.id === 'coverage-exempt-heavy'
    ? { ...gate, needs: [...new Set(['build', ...(gate.needs ?? [])])] }
    : gate)
  /** 中文说明：函数值 coverageAfter 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const coverageAfter = coverage.map(gate => gate.id)
  /** 中文说明：变量 observational 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const observational = ciWindowsObservationalGates()
    // The required production site replaces the observational MPA build; both
    // VitePress modes write the same output directory and cannot overlap.
    .filter(gate => gate.id !== 'build' && gate.id !== 'docs-site-build')
    .map(gate => ({
      ...gate,
      allowFailure: true,
      after: [...new Set([...coverageAfter, ...(gate.after ?? [])])],
    }))
  return [
    ciBuildGate(),
    pnpmScript('windows-site', 'docs:build', { label: 'production site' }),
    ...coverage,
    ...observational,
  ]
}

/** 中文说明：函数 ciWindowsObservationalGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ciWindowsObservationalGates(): Gate[] {
  return [
    ...ciStaticGates({ ownsBuild: true }),
    // Linux owns required lint and snapshots; Windows omits those duplicates.
    pnpmScript('duplication', 'duplication'),
    pnpmScript('publint', 'publint', { needs: ['build'] }),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      needs: ['build'],
    }),
    builtPackageInvariantsGate(['build']),
    builtBinSmokeGate(),
  ]
}

/** 中文说明：函数 typertContractsGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function typertContractsGate(): Gate {
  return pnpmScript('typert-contracts', 'build:lib:host', { label: 'Typert contracts' })
}

/** 中文说明：函数 lintGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function lintGate(options: { needs?: string[] } = {}): Gate {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env.DSH_OXLINT_THREADS
  /** 中文说明：变量 script 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const script = 'lint:contracts-ready'
  return pnpmScript('lint', script, {
    ...raw === undefined || raw === ''
      ? {}
      : { displayCommand: `DSH_OXLINT_THREADS=${raw} pnpm run ${script}` },
    ...options.needs === undefined ? {} : { needs: options.needs },
  })
}

// The heavy suites run uninstrumented beside the thresholded gate: their
// compiler- and subprocess-bound fixtures pay a multiple of their runtime
// under v8 instrumentation while contributing nothing the thresholds need
// (membership rules in scripts/coverage-exempt.ts).
//
// DSH_COVERAGE_MAX_WORKERS is the ordinary lane's worker budget, so the two
// parallel gates split it instead of each claiming it whole. When
// DSH_COVERAGE_PARTITIONS is set, its single-worker processes replace the
// instrumented share while this budget still sizes the exempt gate. The exempt
// gate's wall clock is dominated by its longest single file, so it takes the
// small share. A budget of 1 gives each gate 1 worker; lanes that need a strict
// total of one (the serial reference jobs) also set DSH_GATE_CONCURRENCY=1,
// which keeps the gates from overlapping at all.
// DSH_COVERAGE_TEST_TIMEOUT_MS raises Vitest's per-test and expect.poll
// defaults together for instrumented lanes whose scheduling overhead exceeds
// those defaults. Explicit fixture timeouts remain authoritative.
/** 中文说明：函数 coverageWorkerArgs 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function coverageWorkerArgs(): { instrumented: string[]; exempt: string[] } {
  const [flag] = positiveIntArg('DSH_COVERAGE_MAX_WORKERS', '--maxWorkers')
  if (flag === undefined) return { instrumented: [], exempt: [] }
  /** 中文说明：变量 total 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const total = Number.parseInt(flag.split('=')[1] ?? '', 10)
  /** 中文说明：变量 exempt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exempt = Math.max(1, Math.floor(total / 3))
  /** 中文说明：变量 instrumented 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instrumented = Math.max(1, total - exempt)
  return {
    instrumented: [`--maxWorkers=${String(instrumented)}`],
    exempt: [`--maxWorkers=${String(exempt)}`],
  }
}

/** 中文说明：函数 coverageGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function coverageGates(): Gate[] {
  /** 中文说明：变量 workers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workers = coverageWorkerArgs()
  /** 中文说明：变量 timeouts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const timeouts = coverageTestTimeoutArgs(process.env[COVERAGE_TEST_TIMEOUT_ENV])
  /** 中文说明：变量 partitions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const partitions = parseCoveragePartitionCount(process.env[COVERAGE_PARTITIONS_ENV])
  /** 中文说明：变量 instrumented 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instrumented = partitions === undefined
    ? pnpmExec('coverage', [
      'vitest',
      'run',
      '--coverage',
      ...workers.instrumented,
      ...timeouts,
    ], {
      label: 'test:coverage',
      env: { [COVERAGE_EXEMPT_ENV]: '1' },
    })
    : pnpmScript('coverage', 'test:coverage:partitioned', {
      label: 'test:coverage',
      displayCommand: `${COVERAGE_PARTITIONS_ENV}=${partitions} pnpm run test:coverage:partitioned`,
      env: { [COVERAGE_EXEMPT_ENV]: '1' },
      streamOutput: true,
    })
  return [
    instrumented,
    pnpmExec('coverage-exempt-heavy', [
      'vitest',
      'run',
      ...coverageExemptHeavySuites.map(suite => suite.filter),
      ...workers.exempt,
      ...timeouts,
    ], {
      label: 'test:coverage-exempt-heavy',
    }),
  ]
}

// Example and package snapshots boot their bins in `lib` mode (built artifacts under plain Node,
// plugins via real exports); script snapshots execute their real source entry path.
// Callers wait either on `build` or on a validation gate that transitively owns that build.
/** 中文说明：函数 snapshotGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function snapshotGate(needs: string[] = ['build']): Gate {
  return pnpmScript('snapshot', 'test:snapshot', {
    env: { DSH_EXAMPLE_MODE: 'lib' },
    needs,
  })
}

/** 中文说明：函数 builtPackageInvariantsGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function builtPackageInvariantsGate(needs?: string[]): Gate {
  return pnpmScript('built-package-invariants', 'verify-built-package-invariants', {
    label: 'built package invariants',
    ...needs === undefined ? {} : { needs },
  })
}

/** 中文说明：函数 positiveIntArg 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function positiveIntArg(envName: string, flag: string): string[] {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env[envName]
  if (raw === undefined || raw === '') return []
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`run-gates: ${envName} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return [`${flag}=${raw}`]
}

/** 中文说明：函数 flagEnabled 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function flagEnabled(envName: string): boolean {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env[envName]
  if (raw === undefined || raw === '') return false
  if (raw !== '1') throw new Error(`run-gates: ${envName} must be 1 when set, got ${JSON.stringify(raw)}.`)
  return true
}

/** 中文说明：函数 hygieneLeafGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hygieneLeafGates(options: { artifactNeeds?: string[] } = {}): Gate[] {
  /** 中文说明：变量 artifactOptions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const artifactOptions = options.artifactNeeds === undefined ? {} : { needs: options.artifactNeeds }
  return [
    pnpmScript('rescope-vendor', 'rescope-vendor:check', { label: 'vendor rescope' }),
    pnpmScript('knip', 'knip'),
    pnpmScript('publint', 'publint', artifactOptions),
    pnpmScript('constraints', 'constraints'),
    pnpmScript('dsh-package-licenses', 'verify-dsh-package-licenses', { label: 'DSH package licenses' }),
    pnpmScript('package-invariants', 'verify-package-invariants', { label: 'package invariants' }),
    builtPackageInvariantsGate(options.artifactNeeds),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      ...artifactOptions,
    }),
    pnpmScript('optional-dependency-imports', 'verify-optional-dependency-imports', {
      label: 'optional dependency imports',
    }),
    pnpmScript('client-packages', 'verify-client-packages', { label: 'client packages' }),
  ]
}

/** 中文说明：函数 docSyncLeafGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function docSyncLeafGates(options: {
  includeDocTypecheck?: boolean
  docTypecheckNeeds?: string[]
  docTypecheckEnv?: Record<string, string | undefined>
  docTypecheckScript?: 'doc-typecheck' | 'doc-typecheck:contracts-ready'
  docsBuildScript?: 'docs:build' | 'docs:build:mpa'
} = {}): Gate[] {
  /** 中文说明：变量 docTypecheckOptions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const docTypecheckOptions: Partial<Gate> = {}
  if (options.docTypecheckNeeds !== undefined) docTypecheckOptions.needs = options.docTypecheckNeeds
  if (options.docTypecheckEnv !== undefined) docTypecheckOptions.env = options.docTypecheckEnv
  return [
    // Stable FIFO starts the longest leaves first; only docs-site-build writes website/.generated.
    ...options.includeDocTypecheck === false
      ? []
      : [pnpmScript('doc-typecheck', options.docTypecheckScript ?? 'doc-typecheck', docTypecheckOptions)],
    pnpmScript('docs-site-build', options.docsBuildScript ?? 'docs:build', { label: 'documentation build' }),
    pnpmScript('doc-graphs', 'verify-doc-graphs', { label: 'doc graphs' }),
    pnpmScript('markdown-links', 'verify-md-links', { label: 'markdown links' }),
    pnpmScript('type-equivalence', 'verify-type-equiv', { label: 'type equivalence' }),
    pnpmScript('cordis-catalog', 'verify-cordis-catalog', { label: 'cordis catalog' }),
    pnpmScript('mermaid', 'verify-mermaid'),
    pnpmScript('scoped-events', 'verify-scoped-events', { label: 'scoped events' }),
    pnpmScript('translation-pairing', 'verify-translation-pairing', { label: 'translation pairing' }),
    pnpmScript('markdown-wrap', 'verify-md-wrap', { label: 'markdown wrap' }),
    pnpmScript('client-catalog', 'verify-client-catalog', { label: 'client catalog' }),
    pnpmScript('export-jsdoc', 'verify-export-jsdoc', { label: 'export jsdoc' }),
    pnpmScript('tool-catalog', 'verify-tool-catalog', { label: 'tool catalog' }),
    pnpmScript('config-catalog', 'verify-config-catalog', { label: 'config catalog' }),
    pnpmScript('persistence-catalog', 'verify-persistence-catalog', { label: 'persistence catalog' }),
    pnpmScript('public-repository-links', 'verify-public-repository-links', { label: 'public repository links' }),
    pnpmScript('doc-refs', 'verify-doc-refs', { label: 'doc refs' }),
    pnpmScript('package-paths', 'verify-package-paths', { label: 'package paths' }),
    pnpmScript('config-source-ownership', 'verify-config-source-ownership', { label: 'config source ownership' }),
    pnpmScript('package-readme-model-experience', 'verify-package-readme-model-experience', { label: 'package README model experience' }),
    pnpmScript('agent-note-classification', 'verify-agent-note-classification', { label: 'agent note classification' }),
    pnpmScript('agent-note-format', 'verify-agent-note-format', { label: 'agent note format' }),
    pnpmScript('archived-agent-notes', 'verify-archived-agent-notes', { label: 'archived agent notes' }),
    pnpmScript('skill-invocation-metadata', 'verify-skill-invocation-metadata', { label: 'skill invocation metadata' }),
    pnpmScript('translation-prompt', 'verify-translation-prompt', { label: 'translation prompt' }),
    pnpmScript('doc-budgets', 'verify-doc-budgets', { label: 'doc budgets' }),
    pnpmExec('docs-site-projection', ['vitest', 'run', 'scripts/project-doc-site.spec.ts', 'scripts/verify-doc-site-fragments.spec.ts'], {
      label: 'documentation site checks',
    }),
    pnpmScript('package-readme-limitations', 'verify-package-readme-limitations', { label: 'package README limitations' }),
  ]
}

/** 中文说明：函数 builtBinSmokeGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function builtBinSmokeGate(needs: string[] = ['build']): Gate {
  return pnpmExec('built-bin-smoke', [
    'vitest',
    'run',
    '--config',
    'vitest.e2e.config.ts',
    'examples/headless-agent/tests/keyless-smoke.e2e.ts',
    'apps/cli/tests/built-bin.e2e.ts',
    'packages/examples/acp-demo/tests/built-bin.e2e.ts',
    'packages/host/directory-picker-native/tests/built-worker.e2e.ts',
    'packages/sdk/server/tests/built-scope-carrier.e2e.ts',
    'packages/subagent/subagent-codex/tests/loader-composition.e2e.ts',
    'packages/subagent/subagent-claude-code/tests/loader-composition.e2e.ts',
    'packages/api/remotes/tests/built-lib.e2e.ts',
    // Built execution consumers: the only automated proof that package-name
    // imports reach their lib/ entrypoints under plain Node. The e2e lane runs
    // unbuilt, so these files self-skip there.
    'packages/workflow/workflow-worker-thread/tests/built-worker.e2e.ts',
    'packages/code-runtime/code-runtime-worker-thread/tests/built-lib.e2e.ts',
    'packages/lsp/lsp-stdio/tests/built-lib.e2e.ts',
  ], {
    label: 'built-bin smoke',
    needs,
    env: { DSH_EXAMPLE_MODE: 'lib' },
  })
}

/**
 * Reject a gate list whose graph cannot be executed unambiguously.
 * @param gates - complete aggregate to validate.
 */
/** 中文说明：函数 validateGateGraph 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateGateGraph(gates: readonly Gate[]): void {
  if (gates.length === 0) throw new Error('run-gates: gate graph has no gates.')

  /** 中文说明：变量 ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ids = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const gate of gates) {
    if (ids.has(gate.id)) throw new Error(`run-gates: duplicate gate id ${JSON.stringify(gate.id)}.`)
    ids.add(gate.id)
  }
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const gate of gates) {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const dependency of gate.needs ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`run-gates: gate ${JSON.stringify(gate.id)} depends on unknown gate ${JSON.stringify(dependency)}.`)
      }
    }
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const predecessor of gate.after ?? []) {
      if (!ids.has(predecessor)) {
        throw new Error(`run-gates: gate ${JSON.stringify(gate.id)} waits for unknown gate ${JSON.stringify(predecessor)}.`)
      }
    }
  }

  /** 中文说明：变量 cycle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cycle = findDependencyCycle(gates)
  if (cycle !== undefined) throw new Error(`run-gates: dependency cycle: ${cycle.join(' -> ')}.`)
}

/** 中文说明：函数 findDependencyCycle 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findDependencyCycle(gates: readonly Gate[]): string[] | undefined {
  /** 中文说明：函数值 byId 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const byId = new Map(gates.map(gate => [gate.id, gate]))
  /** 中文说明：变量 complete 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const complete = new Set<string>()
  /** 中文说明：变量 active 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const active = new Map<string, number>()
  /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path: string[] = []

  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (id: string): string[] | undefined => {
    if (complete.has(id)) return undefined
    /** 中文说明：变量 cycleStart 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cycleStart = active.get(id)
    if (cycleStart !== undefined) return [...path.slice(cycleStart), id]
    /** 中文说明：变量 gate 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = byId.get(id)
    if (gate === undefined) return undefined

    active.set(id, path.length)
    path.push(id)
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const predecessor of [...(gate.needs ?? []), ...(gate.after ?? [])]) {
      /** 中文说明：变量 cycle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cycle = visit(predecessor)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    active.delete(id)
    complete.add(id)
    return undefined
  }

  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const gate of gates) {
    /** 中文说明：变量 cycle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cycle = visit(gate.id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/**
 * Validate and run one aggregate before the injected executor can start a child.
 * @param gates - complete aggregate to execute.
 * @param maxActive - maximum concurrent child count.
 * @param execute - child-process executor.
 * @param observe - result observer invoked when each gate settles.
 * @returns results in aggregate order.
 */
/** 中文说明：函数 runGates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export async function runGates(
  gates: Gate[],
  maxActive: number,
  execute: GateExecutor,
  observe: ResultObserver = () => {},
): Promise<GateResult[]> {
  validateGateGraph(gates)
  if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
    throw new Error(`run-gates: max concurrency must be a positive integer, got ${JSON.stringify(maxActive)}.`)
  }
  /** 中文说明：函数值 states 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const states = new Map<string, GateState>(gates.map(gate => [gate.id, 'pending']))
  /** 中文说明：变量 results 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const results = new Map<string, GateResult>()
  /** 中文说明：变量 running 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const running: RunningGate[] = []

  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (;;) {
    /** 中文说明：变量 madeProgress 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let madeProgress = false
    while (running.length < maxActive) {
      /** 中文说明：函数值 ready 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const ready = gates.find(gate => states.get(gate.id) === 'pending' && predecessorsReady(gate, states))
      if (ready === undefined) break
      states.set(ready.id, 'running')
      running.push({ gate: ready, promise: execute(ready) })
      console.log(`run-gates: start ${ready.label}`)
      madeProgress = true
    }

    if (running.length === 0) {
      /** 中文说明：函数值 pending 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const pending = gates.filter(gate => states.get(gate.id) === 'pending')
      if (pending.length === 0) break
      /** 中文说明：函数值 gate 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const gate = pending.find(item => (item.needs ?? []).some(id => gateFailed(states.get(id))))
      if (gate === undefined) throw new Error('run-gates: validated graph stalled without a failed dependency.')
      /** 中文说明：函数值 failedDeps 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const failedDeps = (gate.needs ?? []).filter(id => gateFailed(states.get(id)))
      /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result: GateResult = {
        gate,
        status: 'skipped',
        durationMs: 0,
        output: [],
        exitCode: null,
        signalCode: null,
        error: `dependency failed or skipped: ${failedDeps.join(', ')}`,
      }
      states.set(gate.id, 'skipped')
      results.set(gate.id, result)
      observe(result)
      continue
    }

    if (!madeProgress) {
      /** 中文说明：函数值 settled 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const settled = await Promise.race(running.map(async item => ({ item, result: await item.promise })))
      running.splice(running.indexOf(settled.item), 1)
      states.set(settled.item.gate.id, settled.result.status)
      results.set(settled.item.gate.id, settled.result)
      observe(settled.result)
    }
  }

  return gates.map((gate) => {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = results.get(gate.id)
    if (result === undefined) throw new Error(`run-gates: missing result for ${gate.id}.`)
    return result
  })
}

/** 中文说明：函数 predecessorsReady 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function predecessorsReady(gate: Gate, states: Map<string, GateState>): boolean {
  return (gate.needs ?? []).every(id => states.get(id) === 'passed')
    && (gate.after ?? []).every(id => gateSettled(states.get(id)))
}

/** 中文说明：函数 gateSettled 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function gateSettled(state: GateState | undefined): boolean {
  return state === 'passed' || state === 'failed' || state === 'skipped'
}

/** 中文说明：函数 gateFailed 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function gateFailed(state: GateState | undefined): boolean {
  return state === 'failed' || state === 'skipped'
}

/**
 * Execute one gate through the real shell-free child-process boundary.
 * @param gate - command and scheduler environment to execute.
 * @returns the complete process outcome.
 */
/** 中文说明：函数 runGate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export async function runGate(gate: Gate): Promise<GateResult> {
  /** 中文说明：变量 started 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = performance.now()
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output: GateOutputChunk[] = []
  /** 中文说明：变量 spawnError 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let spawnError: string | undefined

  /** 中文说明：变量 outcome 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const outcome = await new Promise<{
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }>((resolveExit) => {
    /** 中文说明：变量 child 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = spawn(gate.command, gate.args, {
      cwd: root,
      env: { ...process.env, ...gate.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (gate.streamOutput === true) process.stdout.write(chunk)
      else output.push({ stream: 'stdout', text: chunk })
    })
    child.stderr.on('data', (chunk: string) => {
      if (gate.streamOutput === true) process.stderr.write(chunk)
      else output.push({ stream: 'stderr', text: chunk })
    })
    child.on('error', (error) => {
      spawnError = `failed to start command: ${error.message}`
      resolveExit({ exitCode: null, signalCode: null })
    })
    child.on('close', (exitCode, signalCode) => {
      resolveExit({ exitCode, signalCode })
    })
    child.stdin.end()
  })
  const { exitCode, signalCode } = outcome

  /** 中文说明：变量 status 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const status: GateResultStatus = exitCode === 0 && signalCode === null && spawnError === undefined ? 'passed' : 'failed'
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result: GateResult = {
    gate,
    status,
    durationMs: performance.now() - started,
    output,
    exitCode,
    signalCode,
  }
  if (spawnError !== undefined) result.error = spawnError
  return result
}

/**
 * Format every independently observed failure fact for the aggregate summary.
 * @param result - unsuccessful gate result.
 * @returns error, exit, and signal facts without allowing one to hide another.
 */
/** 中文说明：函数 formatGateResultReason 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function formatGateResultReason(result: GateResult): string {
  /** 中文说明：变量 facts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const facts: string[] = []
  if (result.error !== undefined) facts.push(result.error)
  if (result.exitCode !== null) facts.push(`exit ${result.exitCode}`)
  if (result.signalCode !== null) facts.push(`signal ${result.signalCode}`)
  return facts.length === 0 ? 'no exit code or signal' : facts.join(', ')
}

/** 中文说明：函数 printResult 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function printResult(result: GateResult): void {
  /** 中文说明：变量 verbose 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const verbose = process.env.DSH_GATE_VERBOSE === '1'
  /** 中文说明：变量 seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seconds = (result.durationMs / 1000).toFixed(2)
  if (result.status === 'passed' && !verbose) {
    console.log(`run-gates: PASS ${result.gate.label} (${seconds}s)`)
    return
  }

  /** 中文说明：变量 heading 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const heading = `${result.status.toUpperCase()} ${result.gate.label} (${seconds}s)`
  /** 中文说明：变量 writeHeading 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const writeHeading = result.status === 'passed' ? console.log : console.error
  writeHeading(`\n== ${heading} ==`)
  if (result.status !== 'passed') {
    console.error(`command: ${result.gate.displayCommand}`)
    console.error(`outcome: ${formatGateResultReason(result)}`)
  }
  if (result.gate.streamOutput !== true) printOutput(result.output)
}

/** 中文说明：函数 printSummary 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function printSummary(results: GateResult[], durationMs: number): void {
  /** 中文说明：函数值 passed 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const passed = results.filter(result => result.status === 'passed').length
  /** 中文说明：函数值 failed 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const failed = results.filter(result => result.status === 'failed').length
  /** 中文说明：函数值 skipped 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const skipped = results.filter(result => result.status === 'skipped').length
  /** 中文说明：变量 seconds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seconds = (durationMs / 1000).toFixed(2)
  console.log(`\nrun-gates: ${passed} passed, ${failed} failed, ${skipped} skipped in ${seconds}s.`)

  /** 中文说明：函数值 unsuccessful 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const unsuccessful = results.filter(result => result.status === 'failed' || result.status === 'skipped')
  if (unsuccessful.length === 0) return

  console.error('run-gates: unsuccessful gates:')
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const result of unsuccessful) {
    /** 中文说明：变量 duration 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const duration = (result.durationMs / 1000).toFixed(2)
    /** 中文说明：变量 reason 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = formatGateResultReason(result)
    /** 中文说明：变量 disposition 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposition = result.gate.allowFailure === true ? 'NON-BLOCKING ' : ''
    console.error(`  - ${disposition}${result.status.toUpperCase()} ${result.gate.label} (${duration}s, ${reason})`)
    console.error(`    ${result.gate.displayCommand}`)
  }
}

/** 中文说明：函数 printOutput 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function printOutput(output: GateOutputChunk[]): void {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const chunk of output) {
    if (chunk.stream === 'stdout') process.stdout.write(chunk.text)
    else process.stderr.write(chunk.text)
  }
}
