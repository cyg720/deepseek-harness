/*
 * ================================ 文件注释 ================================
 * 【文件职责】directory-picker-native 包的"不变量伴生插件"：注册本包拥有者
 * 身份。无运行时不变量——每次拾取都是一次无状态子进程往返，选择器结果只是
 * 返回的路径。
 * 【技术维度】Cordis 伴生插件模板（空 install + 理由）。
 * 【产品维度】为不变量门禁提供归属登记。
 * 【逻辑维度】包名 → 注入声明 → 空 install → apply 注册。
 * 【关键边界】无属主状态需要断言。
 * 【新手阅读建议】与带探针的 webserver 伴生对照阅读。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for the native directory-picker backend.
 * @module @deepseek-ai/dsh-host-directory-picker-native/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在不变量注册表中使用的包名键。
const PACKAGE_NAME = '@deepseek-ai/dsh-host-directory-picker-native'

/** Cordis companion plugin name. */
export const name = 'host-directory-picker-native-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: each pick is one stateless subprocess round trip; the chooser outcome is only the returned path. */
const install: InvariantInstaller = () => {}

/**
 * Register the native directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
