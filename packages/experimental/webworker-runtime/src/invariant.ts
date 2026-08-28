/*
 * ================================ 文件注释 ================================
 * 【文件职责】apiproxy 包的"不变量伴生插件"：向 Cordis 的不变量服务注册本包
 * 拥有者身份。由于本包是纯线上契约层与网关（不自己发射 Cordis 事件），伴生
 * 插件是一个显式的空实现——它声明了"这里没有需要断言的不变量"这一事实。
 * 【技术维度】Cordis 伴生插件模式：导出 name/inject/apply，apply 把 install
 * 注册进 ctx.invariants 服务并返回释放函数；jscpd:ignore 包裹整个注册块。
 * 【产品维度】为协议同构测试与运行时监控提供归属登记：任何本包"应负责但未
 * 负责"的事件流会被不变量门禁识别为缺失。
 * 【逻辑维度】定义包名与注入依赖 → 空 install（附不变量缺失的理由说明）→
 * apply 注册并返回 disposer。
 * 【关键边界】会话/Agent 事件流的不变量由各自属主包的伴生插件断言，本包不
 * 重复声明；rpcId 往返与 schema 接收在载体边界与协议同构套件中校验。
 * 【新手阅读建议】理解"伴生插件 = 归属声明"即可；本文件是全仓库伴生插件的
 * 最小模板，可对照其他包的有实现版本阅读。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-experimental-webworker-runtime`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-webworker-runtime'

/** Cordis companion plugin name. */
export const name = 'webworker-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
// 启动前必须注入的服务：不变量注册服务（invariants）。
export const inject = ['invariants']
/**
 * No runtime invariant: this package is pre-Cordis platform glue —
 * the tree it boots runs the product packages' own invariants, and the
 * assembly's contracts (image contract gate, tunnel refusals) fail loud at
 * boot rather than drifting at run time.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 伴生插件入口：把空 install 注册进不变量服务，返回释放函数。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
