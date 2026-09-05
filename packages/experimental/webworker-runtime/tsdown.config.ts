/**
 * 文件职责：实现 experimental/webworker-runtime 中 tsdown config 模块的职责，
 * 并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 experimental/webworker-runtime 能力，
 * 使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { MODULE_PROXIES, MODULE_PROXY_PREFIXES } from './src/module-proxies.ts'

/**
 * 常量说明：here 用于处理 here 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 here 相关流程；使用场景由所在模块及调用位置决定。
 * @param relative （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 here(relative)，并按返回类型处理结果。
 */
const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

/**
 * 常量说明：resolveFrom 用于解析 From 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const resolveFrom = createRequire(import.meta.url)

/**
 * `@yarnpkg/parsers`' shell face, reached at its own file rather than through the
 * package root. The root barrel also re-exports the Syml parser, which pulls in
 * that grammar and js-yaml — around 175 kB of this bundle for a format the worker
 * never parses, plus their module bodies at worker start. The shell entry holds
 * `parseShell` and the stringifiers, requiring only its own grammar.
 *
 * This pins a path inside the package, which its `exports` field does not
 * publish: upgrading `@yarnpkg/parsers` must re-check that `lib/shell.js` is still
 * where the shell parser lives and still exports `parseShell`. The path is
 * derived from the package manifest, the one subpath the package does publish, so
 * a move fails the build here rather than silently reinstating the barrel.
 * @remarks 中文说明：常量说明：SHELL_PARSER_ENTRY 用于处理 SHELL_PARSER_ENTRY 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SHELL_PARSER_ENTRY = join(dirname(resolveFrom.resolve('@yarnpkg/parsers/package.json')), 'lib/shell.js')

/** Redirects the parsers root specifier onto {@link SHELL_PARSER_ENTRY}.
 * @remarks 中文说明：常量说明：shellParserOnlyPlugin 用于处理 shellParserOnlyPlugin 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const shellParserOnlyPlugin = {
  name: 'dsh-shell-parser-only',
  /**
   * 功能说明：解析 Id 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string | null；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveId(source)，并按返回类型处理结果。
   */
  resolveId(source: string): string | null {
    return source === '@yarnpkg/parsers' ? SHELL_PARSER_ENTRY : null
  },
}

/**
 * Resolve the module proxy table at bundle time: every Node builtin or
 * replaced external the worker graph imports lands on its `./node/` proxy,
 * so `lib/worker.js` is one self-contained ES module a deployment serves and
 * loads with `new Worker(url, { type: 'module' })`.
 * @remarks 中文说明：常量说明：moduleProxyPlugin 用于处理 moduleProxyPlugin 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const moduleProxyPlugin = {
  name: 'dsh-module-proxies',
  /**
   * 功能说明：解析 Id 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string | null；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveId(source)，并按返回类型处理结果。
   */
  resolveId(source: string): string | null {
    /**
     * 常量说明：exact 用于处理 exact 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exact = MODULE_PROXIES[source]
    if (exact !== undefined) return here(`./src/${exact.replace('./', '')}`)
    /**
     * 变量说明：prefix、replacement 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [prefix, replacement] of Object.entries(MODULE_PROXY_PREFIXES)) {
      if (source.startsWith(prefix)) return here(`./src/${replacement.replace('./', '')}`)
    }
    return null
  },
}

/**
 * Three artifacts from one pipeline: the runtime library the worker bundle is
 * built from (neutral), the worker bundle itself (browser, single file), and
 * the page half a deployment's shell imports (browser).
 */
export default defineConfig([{
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}, {
  // The worker artifact: the host tree's Node-compatibility layer plus the
  // assembly, bundled whole — a worker served from a static URL can fetch no
  // sibling chunk.
  entry: ['src/worker.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  fixedExtension: false,
  dts: false,
  clean: false,
  noExternal: [/.*/],
  plugins: [moduleProxyPlugin, shellParserOnlyPlugin],
  outputOptions: { inlineDynamicImports: true },
}, {
  // Page half: an ordinary browser ES module the deployment's page imports. It
  // is not a `dsh.client` graph row — it installs the module loader the graph is
  // loaded through, so it cannot be loaded by it. Workspace peers stay external
  // so the page keeps one instance of each.
  entry: ['src/client/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: 'client.js' },
}])
