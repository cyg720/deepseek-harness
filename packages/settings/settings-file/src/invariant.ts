/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-settings-file`.
 * @module @deepseek-ai/dsh-settings-file/invariant
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】本包的"不变量伴随插件"（invariant companion）：向全局 invariants 服务注册本包名，
 *   声明本包没有需要在运行时验证的不变量。
 * 【技术维度】遵循仓库约定：每个包一个 invariant 模块，通过 ctx.invariants.register 挂载。
 * 【产品维度】invariants 是仓库的运行时自检机制，注册包名用于在错误报告中定位归属。
 * 【逻辑维度】name/inject 声明插件元数据 → install 定义要安装的检查（此处为空）→ apply 执行注册。
 * 【关键边界】这里的检查只覆盖进程内关系；文件往返、watcher 时序等 IO 效果由包测试负责验证。
 * 【新手阅读建议】对照 packages/settings/settings/src/invariant.ts 看"有检查"与"无检查"两种形态。
 * ==========================================================================
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务里的注册名，与 npm 包名一致，便于错误报告中定位归属。
const PACKAGE_NAME = '@deepseek-ai/dsh-settings-file'

// 该伴随插件的注册名，供 Cordis 按名加载与日志定位。
/** Cordis companion plugin name. */
export const name = 'settings-file-invariant'
// 声明依赖全局 invariants 服务；Cordis 会先装载该服务再调用本插件。
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider's contracts are file round-trip,
 * watcher timing, and atomic-write behavior — IO effects proven by package
 * tests; the in-process commit relation is owned by `@deepseek-ai/dsh-settings`.
 */
// 安装逻辑：本包没有需要在运行时校验的关系，故为空函数；保留统一接口形态供 invariants 框架调用。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 插件入口：向全局 invariants 服务注册"包名 → 安装函数"，返回可撤销注册的 disposer。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
