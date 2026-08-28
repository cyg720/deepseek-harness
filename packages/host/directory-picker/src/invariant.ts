/*
 * ================================ 文件注释 ================================
 * 【文件职责】directory-picker 包的"不变量伴生插件"：注册本包拥有者身份。
 * 无运行时不变量——本包是无状态 Service Definition，拥有能力词汇；后端与
 * RPC 消费者拥有观测。
 * 【技术维度】Cordis 伴生插件模板（空 install + 理由）。
 * 【产品维度】为不变量门禁提供归属登记。
 * 【逻辑维度】包名 → 注入声明 → 空 install → apply 注册。
 * 【关键边界】无属主状态需要断言。
 * 【新手阅读建议】与带探针的 webserver 伴生对照阅读。
 * ==========================================================================
 */
/** Package-owned invariant companion for the directory-picker seam. @module @deepseek-ai/dsh-host-directory-picker/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在不变量注册表中使用的包名键。
const PACKAGE_NAME = '@deepseek-ai/dsh-host-directory-picker'

/** Cordis companion plugin name. */
// 伴生插件的 Cordis 插件名。
export const name = 'host-directory-picker-invariant'
/** Service required before the companion can reserve package ownership. */
// 启动前必须注入的服务：不变量注册服务。
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless Service Definition owns the capability
 * vocabulary, while backends and the Remote controller own observations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
