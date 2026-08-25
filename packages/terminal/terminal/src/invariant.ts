/*
 * ================================ 文件注释 ================================
 * 【文件职责】注册 dsh-terminal 包在 invariants 服务中的"包属主"声明：后端与 owner 级
 * 会话注册表是私有可变状态，服务不暴露独立生命周期流或无作用域快照，无运行时不变式。
 * 【技术维度】Cordis 伴生插件三件套（name / inject / apply）注册到 invariants 服务；
 * 文件主体与其它包的同名镜像文件几乎相同，故包在 jscpd:ignore 豁免区内。
 * 【产品维度】工程治理设施：为监控/诊断工具指明"本包不变式归属"，为将来加检查预留入口。
 * 【逻辑维度】定义包名常量 → 声明插件名与依赖 → 空安装函数 → apply 注册并返回释放器。
 * 【关键边界】inject 依赖须先就绪；register 返回的释放器由 Cordis 在插件卸载时自动调用。
 * 【新手阅读建议】与 dsh-shell/invariant.ts 对照阅读，两者是同一模板的包名变体。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-terminal`.
 * @module @deepseek-ai/dsh-terminal/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-terminal'

/** Cordis companion plugin name. */
export const name = 'terminal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: backend and owner-scoped session registries are private mutable state,
 * and the service exposes neither an independent lifecycle stream nor an unscoped snapshot.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
