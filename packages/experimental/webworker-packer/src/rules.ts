/**
 * Pack rule tables: the one place the image's include/exclude decisions live.
 * Patterns are picomatch globs. Exclude patterns match tree-root-relative
 * paths (so `src/**` drops only a root-level source tree), page-asset
 * patterns match image paths. Traversal mechanics — nested `node_modules`
 * flattening and dot-directory pruning — stay in the collector; these tables
 * hold the judgement calls.
 */

/**
 * Paths dropped from every collected tree. Test trees, sourcemaps,
 * declarations, and archives never resolve at runtime while dominating the
 * byte count. Third-party `src/` directories remain eligible because package
 * entrypoints may resolve to JavaScript there.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-packer 中 rules 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-packer 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：EXCLUDE 用于处理 EXCLUDE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
export const EXCLUDE: readonly string[] = [
  'tests/**',
  'test/**',
  '__tests__/**',
  'coverage/**',
  '**/*.map',
  '**/*.tsbuildinfo',
  '**/*.tgz',
  '**/*.tar',
  '**/*.tar.gz',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
]

/**
 * Additional paths dropped from workspace and vendored packages only. Their
 * runtime plane is built `lib/`; a workspace `dist/` is a page-asset tree the
 * static deployment serves itself. External packages may place runtime code
 * under either directory.
 * @remarks 中文说明：常量说明：EXCLUDE_WORKSPACE 用于处理 EXCLUDE_WORKSPACE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const EXCLUDE_WORKSPACE: readonly string[] = [
  'src/**',
  'dist/**',
]

/**
 * Image paths that belong to the PAGE, not to the worker's loader.
 *
 * A package's `lib/client.js` is its browser bundle behind the `./client`
 * export: the page's own module system evaluates it with its own wrapper,
 * which has no ambient-store parameter. Transforming those bodies would
 * inject calls the page cannot resolve, so they ship untransformed — their
 * only change is the trailing debugger-name line every JavaScript entry
 * gains — and the manifest's all-or-nothing claim stays true, because the
 * worker loader never evaluates them (the tunnel serves them as bytes).
 * @remarks 中文说明：常量说明：PAGE_ASSETS 用于处理 PAGE_ASSETS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
export const PAGE_ASSETS: readonly string[] = [
  'node_modules/*/lib/client.js',
  'node_modules/@*/*/lib/client.js',
]

/**
 * Image specifiers the worker assembly requires directly, beyond the composed
 * roster: they are requested by worker-bundle code, so no image file
 * references them and the reachability sweep must seed them as roots. Keep in
 * step with the literal `require`/`resolve` calls in the runtime's
 * `worker-host.ts`.
 * @remarks 中文说明：常量说明：IMAGE_ENTRY_SEEDS 用于处理 IMAGE_ENTRY_SEEDS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const IMAGE_ENTRY_SEEDS: readonly string[] = [
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-include',
  'js-yaml',
]
