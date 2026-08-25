/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-lsp-stdio 包的"运行时不变量伴生插件"：在全局不变量服务（ctx.invariants）中注册本包的伴生记录。当前无实际不变量断言，仅作为包所有权标记。
 * 【技术维度】遵循各包统一的伴生模板：导入 Cordis 的 Context 与 dsh-invariants 的 InvariantInstaller
 *   类型，通过 ctx.invariants.register(packageName, install) 注册；apply 把注册返回的 disposer 交给调用方。
 * 【产品维度】运行时诊断能力的组成部分：预留注册位，便于将来对进程池与每工作区队列等内部状态做一致性断言。
 * 【逻辑维度】定义包名常量与伴生插件名（name）和依赖注入声明（inject）→ 定义空安装函数 install → apply 将包名与安装函数注册进不变量服务并返回释放函数。
 * 【关键边界】文件骨架与其他包伴生插件雷同，被 jscpd（代码克隆检测）忽略；inject 声明必须先有 invariants 服务就绪；install 为空是刻意为之：进程池与队列是私有实现状态，无独立事件流或枚举快照可对照。
 * 【新手阅读建议】先理解 ctx.invariants.register 的作用，再对照本包 index.ts 的 LocalLspProvider 看哪些内部状态将来可加断言。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-lsp-stdio`.
 * @module @deepseek-ai/dsh-lsp-stdio/invariant
 */

// 该区段与其余各包 invariant.ts 骨架高度雷同，jscpd 克隆检测忽略本段。
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包包名：作为不变量服务中该包伴生记录的键（key）。
const PACKAGE_NAME = '@deepseek-ai/dsh-lsp-stdio'

/** Cordis companion plugin name. */
// 伴生插件名：插件加载时用于标识本伴生。
export const name = 'lsp-stdio-invariant'
/** Service required before the companion can reserve package ownership. */
// 依赖注入声明：必须先存在 invariants 服务，伴生才能注册包所有权。
export const inject = ['invariants']

/**
 * No runtime invariant: process pools and per-workspace queues are private implementation state,
 * and this provider publishes no independent lifecycle event stream or enumerable snapshot.
 */
// 空安装函数：进程池与每工作区队列是私有实现状态，本提供者不发布独立生命周期事件流或枚举快照，故当前不注册任何不变量。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 将本包的伴生注册进不变量服务：返回的释放函数可在卸载插件时反注册该包记录。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
