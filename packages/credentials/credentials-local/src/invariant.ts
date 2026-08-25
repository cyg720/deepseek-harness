/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-credentials-local`.
 * @module @deepseek-ai/dsh-credentials-local/invariant
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】credentials-local 包的"不变量伴随插件"：向 invariants 服务注册本包名，
 *   并声明本包没有需要在运行时校验的不变量。
 * 【技术维度】遵循仓库约定：每个包一个 invariant 模块，通过 ctx.invariants.register 挂载。
 * 【产品维度】事件生命周期契约由 dsh-credentials/invariant 拥有；本包的文件/环境分层属于
 *   异步 IO 行为，由本包单元测试钉住，不放进运行时自检。
 * 【逻辑维度】name/inject 声明插件元数据 → install 为空操作 → apply 执行注册。
 * 【关键边界】注册的是进程内关系检查；IO 效果不在其覆盖范围。
 * 【新手阅读建议】对照 credentials 包的 invariant 理解两个包的职责划分。
 * ==========================================================================
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务里的注册名，与 npm 包名一致，便于错误报告中定位归属。
const PACKAGE_NAME = '@deepseek-ai/dsh-credentials-local'

// 该伴随插件的注册名，供 Cordis 按名加载与日志定位。
/** Cordis companion plugin name. */
export const name = 'credentials-local-invariant'
// 声明依赖全局 invariants 服务；Cordis 会先装载该服务再调用本插件。
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Service Definition companion (`dsh-credentials/invariant`) owns the
 * `credentials/reference-updated` lifecycle contract; this provider's file/environment layering is
 * asynchronous I/O pinned by its unit suite.
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
