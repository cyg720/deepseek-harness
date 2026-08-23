/**
 * ================================ 文件注释 ================================
 * 【文件职责】本包的"不变量伴侣插件"（invariant companion）：向 dsh-invariants
 *   服务登记包所有权，声明本包不提供任何运行时不变量检查。
 * 【技术维度】Cordis 插件协议：导出 name / inject / apply 三件套；apply 返回
 *   登记项的 disposer（注销函数），交由容器在拆除时调用。
 * 【产品维度】每个包都在不变量注册表里占一个名位，保证包集合的完整性与可审计；
 *   本包明确声明"无运行时不变量"，避免审计工具误报缺失。
 * 【逻辑维度】定义包名常量与空安装器，apply 把安装器注册进 invariants 服务。
 * 【关键边界】持久化的正确性依赖后端往返测试与崩溃残尾测试，不存在可连续观测的
 *   进程内关系，因此这里刻意是空实现而非遗漏。
 * 【新手阅读建议】了解 Cordis 插件的 name/inject/apply 约定即可；install 为空
 *   是设计决定，见上方英文 JSDoc 的说明。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-persistence`.
 * @module @deepseek-ai/dsh-session-persistence/invariant
 */
/**
 * 【中文导读】上面英文说明：这是 dsh-session-persistence 包专属的不变量伴侣模块。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 【中文】本伴侣插件所代表（认领所有权）的包名。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-persistence'

/** Cordis companion plugin name. */
/** 【中文】Cordis 伴侣插件名。 */
export const name = 'session-persistence-invariant'
/** Service required before the companion can reserve package ownership. */
/** 【中文】依赖声明：需要先存在 invariants 服务才能登记包所有权。 */
export const inject = ['invariants']

/**
 * No runtime invariant: persistence correctness requires backend round-trip and crash-tail tests;
 * this package exposes no continuously observable in-process relation.
 */
/**
 * 【中文】空安装器：不注册任何运行时不变量——持久化正确性必须靠后端往返与崩溃
 * 残尾测试验证，进程内没有可连续观测的关系式。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 【中文】插件入口：把空安装器以 PACKAGE_NAME 登记进 invariants 服务。
 * @param ctx - 携带 invariants 服务的 Cordis 上下文。
 * @returns 设置成功后返回该登记项的 disposer（注销函数）。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
