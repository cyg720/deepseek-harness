/**
 * `node:os` for the worker: every value points into the VFS or reports the fixed
 * platform identity the host tree is built for (`linux`, one CPU). Values are
 * real rather than throwing because several `[Service.init]` bodies read them
 * during construction.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 os 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { DSH_HOME, DSH_TMP } from '../../../storage/paths.ts'
import type { CpuInfo, NetworkInterfaceInfo } from 'node:os'

/** Line ending of the virtual platform.
 * @remarks 中文说明：常量说明：EOL 用于处理 EOL 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const EOL = '\n'

/**
 * Temporary directory.
 * @returns the VFS temp path.
 * @remarks 中文说明：功能说明：处理 tmpdir 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 tmpdir()，并按返回类型处理结果。
 */
export function tmpdir(): string {
  return DSH_TMP
}

/**
 * Home directory.
 * @returns `$DSH_HOME` inside the VFS.
 * @remarks 中文说明：功能说明：处理 homedir 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 homedir()，并按返回类型处理结果。
 */
export function homedir(): string {
  return DSH_HOME
}

/**
 * Platform identity.
 * @returns always 'linux'.
 * @remarks 中文说明：功能说明：处理 platform 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：NodeJS.Platform；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * platform()，并按返回类型处理结果。
 */
export function platform(): NodeJS.Platform {
  return 'linux'
}

/**
 * Operating-system type.
 * @returns always 'Linux'.
 * @remarks 中文说明：功能说明：处理 type 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 type()，并按返回类型处理结果。
 */
export function type(): string {
  return 'Linux'
}

/**
 * CPU architecture.
 * @returns always 'x64'.
 * @remarks 中文说明：功能说明：处理 arch 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 arch()，并按返回类型处理结果。
 */
export function arch(): string {
  return 'x64'
}

/**
 * Kernel release.
 * @returns a synthetic release string.
 * @remarks 中文说明：功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 release()，并按返回类型处理结果。
 */
export function release(): string {
  return '0.0.0-dsh-worker'
}

/**
 * Host name.
 * @returns a synthetic name.
 * @remarks 中文说明：功能说明：处理 hostname 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 hostname()，并按返回类型处理结果。
 */
export function hostname(): string {
  return 'dsh-worker'
}

/**
 * Usable parallelism.
 * @returns the browser's hardware concurrency, at least 1.
 * @remarks 中文说明：功能说明：处理 availableParallelism 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * availableParallelism()，并按返回类型处理结果。
 */
export function availableParallelism(): number {
  return Math.max(1, navigator.hardwareConcurrency)
}

/**
 * CPU inventory.
 * @returns an empty list (no per-core facts inside a worker).
 * @remarks 中文说明：功能说明：处理 cpus 相关流程；使用场景由所在模块及调用位置决定。；返回值：CpuInfo[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cpus()，并按返回类型处理结果。
 */
export function cpus(): CpuInfo[] {
  return []
}

/**
 * Network interfaces.
 * @returns an empty record — the worker webserver binds the loopback literal, so
 * no LAN address is ever derived.
 * @remarks 中文说明：功能说明：处理 networkInterfaces 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：NodeJS.Dict<NetworkInterfaceInfo[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 networkInterfaces()，并按返回类型处理结果。
 */
export function networkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]> {
  return {}
}

/** OS constants: only the signal table is read (terminal signal name mapping).
 * @remarks 中文说明：常量说明：constants 用于处理 constants 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const constants = {
  signals: {
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGBUS: 7, SIGFPE: 8,
    SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15,
  },
  errno: {},
  priority: {},
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:os` declarations this module stands in for. `constants` keeps this
 * module's own value: Node declares the full `errno`, `priority`, and `dlopen`
 * tables, while only the signal-name mapping is read here.
 */
type NodeFace = Partial<Omit<typeof import('node:os'), 'constants'>> & Record<'constants', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  EOL, tmpdir, homedir, platform, type, arch, release, hostname, availableParallelism, cpus,
  networkInterfaces, constants,
} satisfies NodeFace
