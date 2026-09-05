/**
 * 文件职责：实现 vitest.snapshot.config.ts 覆盖的Vitest 测试分区与运行配置职责。
 * 技术维度：使用 TypeScript、Vitest、Vite 路径解析与测试项目配置。
 * 产品维度：保障不同测试层级以一致环境运行。
 * 逻辑维度：组合共享配置，选择测试文件并设置超时与执行环境。
 * 关键边界：测试分区不得重复或遗漏；环境相关用例应明确隔离。
 * 新手阅读建议：先看 include/exclude，再看项目环境和超时，最后对照顶层测试命令。
 */
import { availableParallelism } from 'node:os'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/** 中文说明：常量 DEFAULT_SNAPSHOT_MAX_CONCURRENCY 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_SNAPSHOT_MAX_CONCURRENCY = 5

/** 中文说明：函数 positiveIntFromEnv 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function positiveIntFromEnv(name: string, fallback: number): number {
  /** 中文说明：变量 raw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback

  /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

/** 中文说明：变量 snapshotMaxConcurrency 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const snapshotMaxConcurrency = positiveIntFromEnv(
  'DSH_SNAPSHOT_MAX_CONCURRENCY',
  Math.min(DEFAULT_SNAPSHOT_MAX_CONCURRENCY, availableParallelism()),
)

// Replay is the keyless default: boot real subprocess paths from recorded model responses and diff
// assembled requests, normalized protocol or transcript output, and persisted-log expected outputs.
// `record` calls the real API and updates fixtures and expected outputs; `refresh` replays committed scripts
// and updates current expected outputs. Replay/refresh never load `.env`; only record reads a key from the
// environment or root `.env`.
if (process.env.DSH_SNAPSHOT === 'record') {
  try {
    process.loadEnvFile(new URL('.env', import.meta.url).pathname)
  } catch (error) {
    // ENOENT (no .env) is fine — the key may already be in the environment.
    // Surface any other failure rather than silently recording with wrong env.
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }
}

export default defineConfig({
  // Same resolution note as vitest.config.ts: bare workspace names resolve
  // through the tsconfig.base.json paths facade; the native option cannot do
  // this (the root tsconfig is a solution file with no paths).
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    include: [
      'scripts/session-snapshot-corpus.corpus.ts',
      // The assembled Web snapshot executes generated client bundles; source
      // mode remains the zero-build path, while lib mode requires a prior build.
      ...(process.env.DSH_EXAMPLE_MODE === 'lib' ? ['apps/web/tests/**/*.snapshot.ts'] : []),
      'snapshots/**/*.snapshot.ts',
    ],
    // Replay never writes committed outputs and every scenario owns its
    // mutable runtime state (the subprocess suites use a unique temp dir and
    // fixture set per scenario), so replay runs the snapshot files in
    // parallel and bounds in-file concurrency with the environment knob
    // (value 1 restores fully serial replay on constrained machines). Record
    // and refresh stay serial: record spends real API quota per scenario, and
    // refresh write-back harvests volatile values from fixtures already on
    // disk, so concurrent writers would corrupt expected outputs.
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: (process.env.DSH_SNAPSHOT || 'replay') === 'replay' && snapshotMaxConcurrency > 1,
    maxConcurrency: snapshotMaxConcurrency,
  },
})
