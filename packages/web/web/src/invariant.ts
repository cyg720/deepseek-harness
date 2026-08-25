/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-web 包自带的"运行时不变量伴生插件"：把本包注册进全局 invariants
 *             服务，并声明"本包没有独立的运行时状态需要额外交叉校验"。
 * 【技术维度】Cordis 插件三要素（name / inject / apply）+ invariants 服务的 register() 入口；
 *             用 jscpd 忽略标记包住这段模板代码，避免仓库查重工具误报。
 * 【产品维度】让仓库统一的不变量校验框架知道每个包是否需要运行时检查，保证一致性治理。
 * 【逻辑维度】定义包名常量 → 定义空安装器 install → apply() 里注册并返回释放函数。
 * 【关键边界】注释不得插入 jscpd pragma 与代码之间；本包注册逻辑为空是有意为之（seam 自校验）。
 * 【新手阅读建议】这是全仓库最典型的"空伴生插件"样板，可为任何新包照抄改编。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-web`.
 * @module @deepseek-ai/dsh-web/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务中登记的包名（与 npm 包名一致，用于归属校验）。
const PACKAGE_NAME = '@deepseek-ai/dsh-web'

/** Cordis companion plugin name. */
// 伴生插件的名字，供加载器日志与诊断使用。
export const name = 'web-invariant'
/** Service required before the companion can reserve package ownership. */
// 声明依赖：必须等 invariants 服务就绪后本插件才会执行。
export const inject = ['invariants']

/**
 * No runtime invariant: provider maps are private and selection/result caps are enforced on each
 * call; the seam publishes no independent registry or request/result observation stream.
 */
// 本包没有运行时校验逻辑——提供者注册表是私有的，提供者选择与结果截断都在调用时
// 即时执行，seam 不发布任何独立的注册表或请求/结果观测流，因此安装器是空函数。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 插件入口 apply：把本包注册进 invariants 服务，注册成功后返回可解除注册的释放函数。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
