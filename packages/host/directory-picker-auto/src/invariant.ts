/*
 * ================================ 文件注释 ================================
 * 【文件职责】directory-picker-auto 包的"不变量伴生插件"：注册本包拥有者
 * 身份。无运行时不变量——唯一副作用是一次由插件 fiber 拥有的启动时 Loader
 * 条目挂载，存储即权威。
 * 【技术维度】Cordis 伴生插件模板（空 install + 理由）。
 * 【产品维度】为不变量门禁提供归属登记。
 * 【逻辑维度】包名 → 注入声明 → 空 install → apply 注册。
 * 【关键边界】无属主状态需要断言。
 * 【新手阅读建议】与带探针的 webserver 伴生对照阅读。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for the adaptive directory-picker chooser.
 * @module @deepseek-ai/dsh-host-directory-picker-auto/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在不变量注册表中使用的包名键。
const PACKAGE_NAME = '@deepseek-ai/dsh-host-directory-picker-auto'

/** Cordis companion plugin name. */
export const name = 'host-directory-picker-auto-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the sole effect is one boot-time Loader-entry mount owned by the plugin fiber; the store is authoritative. */
const install: InvariantInstaller = () => {}

/**
 * Register the adaptive directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
