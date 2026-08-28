/**
 * The worker bundle's module proxy table: the ONLY platform fork of the host
 * tree. Every entry replaces a Node builtin or an external npm package;
 * workspace and vendored modules are always mounted as they ship.
 *
 * The build turns these into bundler aliases, and `node/builtins.ts` turns the
 * same modules into the loader's static table — one list, two consumers.
 *
 * The replacement path states the classification. `./node/builtin_modules/implemented/<module>.ts`
 * carries the module's real semantics over a worker-side data source (VFS, the
 * tunnel, a wasm codec, a browser primitive); `./node/builtin_modules/mock/<module>.ts` is a
 * structural placeholder that mounts silently and reports the missing capability
 * when a call finally reaches it. External npm replacements live in
 * `./externals/`, named after the package they stand in for.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/module-proxies
 */

/**
 * Module proxy table — the ONLY platform fork of the worker host. Every entry
 * replaces a Node builtin or an external npm package; workspace and vendored
 * modules are always mounted as-is. Keys are exact module specifiers.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 module proxies
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：MODULE_PROXIES 用于处理 MODULE_PROXIES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const MODULE_PROXIES: Record<string, string> = {
  // VFS-backed real implementations.
  'node:fs': './node/builtin_modules/implemented/fs.ts',
  'fs': './node/builtin_modules/implemented/fs.ts',
  'node:fs/promises': './node/builtin_modules/implemented/fs/promises.ts',
  'fs/promises': './node/builtin_modules/implemented/fs/promises.ts',
  'node:path': './node/builtin_modules/implemented/path.ts',
  'path': './node/builtin_modules/implemented/path.ts',
  'node:path/posix': './node/builtin_modules/implemented/path.ts',
  'node:os': './node/builtin_modules/implemented/os.ts',
  'os': './node/builtin_modules/implemented/os.ts',
  'node:url': './node/builtin_modules/implemented/url.ts',
  'node:module': './node/builtin_modules/implemented/module.ts',
  'node:crypto': './node/builtin_modules/implemented/crypto.ts',
  'crypto': './node/builtin_modules/implemented/crypto.ts',
  // `buffer` itself stays unaliased: the shim is backed by that npm package.
  'node:buffer': './node/builtin_modules/implemented/buffer.ts',
  // Tunnel request source: fake bind, real route face. `node:process` and
  // `process` are absent on purpose — the worker host installs that global
  // (`./globals/process.ts`).
  'node:http': './node/builtin_modules/implemented/http.ts',
  // Sync-stack AsyncLocalStorage semantics.
  'node:async_hooks': './node/builtin_modules/implemented/async_hooks.ts',
  // Real implementations over browser primitives.
  'node:util': './node/builtin_modules/implemented/util.ts',
  'node:util/types': './node/builtin_modules/implemented/util/types.ts',
  'node:events': './node/builtin_modules/implemented/events.ts',
  'node:timers/promises': './node/builtin_modules/implemented/timers/promises.ts',
  'node:perf_hooks': './node/builtin_modules/implemented/perf_hooks.ts',
  'node:tty': './node/builtin_modules/implemented/tty.ts',
  'tty': './node/builtin_modules/implemented/tty.ts',
  // Real zstd codec: session-log appends compress on every write.
  'node:zlib': './node/builtin_modules/implemented/zlib.ts',
  // The worker's own process layer: `bash -c` and the command table run against
  // the VFS, because a browser worker has no processes to fork.
  'node:child_process': './node/builtin_modules/implemented/child_process.ts',
  // Structural mocks: every symbol exists, every call throws.
  'node:dns/promises': './node/builtin_modules/mock/dns/promises.ts',
  'dns/promises': './node/builtin_modules/mock/dns/promises.ts',
  'node:net': './node/builtin_modules/mock/net.ts',
  'node:stream': './node/builtin_modules/implemented/stream.ts',
  'node:vm': './node/builtin_modules/mock/vm.ts',
  'node:worker_threads': './node/builtin_modules/mock/worker_threads.ts',
  'node:sqlite': './node/builtin_modules/mock/sqlite.ts',
  // External npm replacements, named after the package each stands in for.
  'koffi': './node/external_packages/koffi.ts',
  'sharp': './node/external_packages/sharp.ts',
  'node-pty': './node/external_packages/node-pty.ts',
  '@vscode/ripgrep': './node/external_packages/ripgrep.ts',
  '@earendil-works/pi-ai': './node/external_packages/pi-ai.ts',
  // Constructible fakes whose methods are never reached.
  'ws': './node/external_packages/ws.ts',
}


/** pi-ai subpaths (`/providers/all`, `/api/*.lazy`) share the one structural stub.
 * @remarks 中文说明：常量说明：MODULE_PROXY_PREFIXES 用于处理 MODULE_PROXY_PREFIXES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const MODULE_PROXY_PREFIXES: Record<string, string> = {
  '@earendil-works/pi-ai/': './node/external_packages/pi-ai.ts',
}
