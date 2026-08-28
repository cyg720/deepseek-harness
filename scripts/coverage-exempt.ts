/**
 * Heavy suites the coverage aggregate runs uninstrumented in a parallel gate.
 * Membership rule: a suite qualifies only when every coverage-measured
 * file it executes in-process (`coverage.include` spans package src trees;
 * typert generator src is threshold-excluded in vitest.config.ts) is already
 * fully covered by other suites, so removing it from the instrumented run
 * changes no threshold outcome. The aggregate still runs every listed suite
 * plain beside the instrumented gate, so correctness signal is unchanged —
 * only the v8 instrumentation tax on compiler- and subprocess-heavy fixtures
 * is dropped.
 */
/*
 * 中文说明：
 * - 文件职责：声明应从带插桩覆盖率运行中移出、但仍在并行普通测试中执行的重型套件。
 * - 技术维度：使用 TypeScript 只读配置表、Vitest 文件过滤前缀和 exclude glob。
 * - 产品维度：保持完整正确性信号的同时，降低编译器和子进程夹具的 V8 插桩成本。
 * - 逻辑维度：定义单项结构、控制环境变量，再列出过滤器与排除规则严格对应的套件。
 * - 关键边界：只有其覆盖源码已被其他测试完全覆盖的套件才可加入；filter 与 exclude 必须命中同一集合。
 * - 新手阅读建议：先理解“仍运行但不插桩”，再对照每项 filter/exclude 和伴随一致性测试。
 */

/** One coverage-exempt suite: a Vitest CLI filter and its exclude glob. */
/* 中文：一项覆盖率豁免重型套件的普通运行过滤器和插桩排除规则。 */
export interface CoverageExemptSuite {
  /** Positional file filter selecting the suite in the uninstrumented gate. */
  /* 中文：普通无插桩门禁传给 Vitest 的位置文件过滤前缀。 */
  readonly filter: string
  /** Exclude glob removing the suite from the instrumented gate. */
  /* 中文：从带插桩项目中移除同一测试集合的 glob。 */
  readonly exclude: string
}

/**
 * Set to `1` by the instrumented coverage gate; vitest.config.ts then drops
 * the exempt suites from every project. CLI `--exclude` cannot express this:
 * it does not reach per-project include resolution.
 */
/* 中文：插桩门禁设置为 1 的环境变量；Vitest 配置据此从各项目移除重型套件。 */
export const COVERAGE_EXEMPT_ENV = 'DSH_COVERAGE_EXEMPT_HEAVY'

/** Coverage-exempt heavy suites; keep filter and exclude selecting the same files. */
/* 中文：获准并行无插桩运行的重型套件清单；每个过滤器和排除 glob 必须等价。 */
export const coverageExemptHeavySuites: readonly CoverageExemptSuite[] = [
  // Whole-workspace compiler analysis per case — the lane's longest tail.
  // Generator src is threshold-excluded; tools-catalog's registry and
  // tool-cordis imports are fully covered by those packages' own tests.
  // 中文：生成器每例分析整个工作区，是最长尾任务；其相关源码已由包自身测试覆盖。
  {
    filter: 'packages/typert/generator/tests/',
    exclude: 'packages/typert/generator/tests/**',
  },
  // The webworker-runtime package is outside the coverage requirement by
  // decision: vitest.config.ts threshold-excludes its src, so every suite
  // runs uninstrumented. This tree includes the full-corpus import gate, a
  // single 900s-budget case that spawns a child sweep over every built
  // bundle; inside an instrumented partition it exceeds the Windows
  // partition budget under load.
  {
    filter: 'packages/experimental/webworker-runtime/tests/',
    exclude: 'packages/experimental/webworker-runtime/tests/**',
  },
  // Real child-process fixtures over scripts/ sources, which coverage never measures.
  // 中文：以下用例通过真实子进程执行 scripts 源码，而覆盖率本来就不度量该目录。
  { filter: 'scripts/install-lefthook.spec.ts', exclude: 'scripts/install-lefthook.spec.ts' },
  { filter: 'scripts/oxlint-contract.spec.ts', exclude: 'scripts/oxlint-contract.spec.ts' },
  { filter: 'scripts/change-scope.spec.ts', exclude: 'scripts/change-scope.spec.ts' },
  { filter: 'scripts/translation-pairing-merge.spec.ts', exclude: 'scripts/translation-pairing-merge.spec.ts' },
  // Built-artifact proof. Packer/runtime src is threshold-excluded, and the
  // native Windows aggregate makes this uninstrumented gate wait for build so
  // the suite never observes a partially emitted workspace closure.
  {
    filter: 'packages/experimental/webworker-packer/tests/image-loadable.spec.ts',
    exclude: 'packages/experimental/webworker-packer/tests/image-loadable.spec.ts',
  },
]
