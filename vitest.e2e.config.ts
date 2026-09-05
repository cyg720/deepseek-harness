/**
 * 文件职责：实现 vitest.e2e.config.ts 覆盖的Vitest 测试分区与运行配置职责。
 * 技术维度：使用 TypeScript、Vitest、Vite 路径解析与测试项目配置。
 * 产品维度：保障不同测试层级以一致环境运行。
 * 逻辑维度：组合共享配置，选择测试文件并设置超时与执行环境。
 * 关键边界：测试分区不得重复或遗漏；环境相关用例应明确隔离。
 * 新手阅读建议：先看 include/exclude，再看项目环境和超时，最后对照顶层测试命令。
 */
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Real-API suite, separate because it spends tokens. Each test self-skips without
// its provider credential for keyless CI; credentialed workflows preflight the
// secrets they require. Values may come from the environment or gitignored root
// `.env`, with provider-specific endpoint overrides where supported.
try {
  // Node >= 21.7 native; throws when the file does not exist.
  process.loadEnvFile(new URL('.env', import.meta.url).pathname)
} catch {
  // No .env — fine, the environment may already carry the variables.
}

/** 中文说明：常量 DEFAULT_E2E_MAX_WORKERS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_E2E_MAX_WORKERS = 4

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

/** 中文说明：变量 e2eMaxWorkers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const e2eMaxWorkers = positiveIntFromEnv('DSH_E2E_MAX_WORKERS', DEFAULT_E2E_MAX_WORKERS)

export default defineConfig({
  // Same resolution note as vitest.config.ts: bare workspace names resolve
  // through the tsconfig.base.json paths facade (no include = match-all, so
  // client-package sources get mapping too — dropping /client subpath imports
  // onto package exports would load browser dist bundles into node).
  // Built-artifact e2e suites are unaffected: their built-ness lives in
  // subprocesses and createRequire lookups, which bypass vite resolution
  // entirely.
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    // apps/cli only, not apps/*: apps/web/tests/*.e2e.ts needs the built
    // frontend dist and runs under vitest.web.config.ts (the test:web job).
    include: ['packages/*/*/tests/**/*.e2e.ts', 'apps/cli/tests/**/*.e2e.ts'],
    exclude: [
      '**/*.expected.e2e.ts',
      'packages/experimental/inspector/tests/client-browser.e2e.ts',
    ],
    // Real model calls: generous timeouts, and retries for transient flakes
    // (the shared internal key hits concurrency quotas). No coverage — the
    // unit suites own the coverage gate.
    testTimeout: 120_000,
    hookTimeout: 30_000,
    retry: 2,
    // Run files in a bounded pool: enough lower-level parallelism to keep CI
    // and local with-key runs moving, while leaving a resource knob for shared
    // API quotas (`DSH_E2E_MAX_WORKERS=1` restores serial execution).
    fileParallelism: e2eMaxWorkers > 1,
    maxWorkers: e2eMaxWorkers,
  },
})
