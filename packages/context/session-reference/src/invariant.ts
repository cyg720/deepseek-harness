/*
 * ================================ 文件注释 ================================
 * 【文件职责】session-reference 包自有的不变式伴生插件：向 dsh-invariants
 *             服务登记本包，声明本包的运行时不变量归属。
 * 【技术维度】Cordis 插件三元组（name/inject/apply）+ InvariantInstaller 模式。
 * 【产品维度】项目质量护栏的组成部分，与其余包的 invariant.ts 同构。
 * 【逻辑维度】声明插件名与依赖 → 定义空安装函数 → apply 登记进 invariants 服务。
 * 【关键边界】准备过程返回的是每次调用独立的不可变快照（构建时就地校验），
 *             持久化接纳/冻结/回放由 agent/session 层负责，故此处无额外检查。
 * 【新手阅读建议】与 file-reference 包的 invariant.ts 对照阅读。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-reference`.
 * @module @deepseek-ai/dsh-session-reference/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 本包在 invariant 登记中的唯一标识名。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-reference'

/** Cordis companion plugin name. */
/* 该伴生插件的注册名。 */
export const name = 'session-reference-invariant'
/** Service required before the companion can reserve package ownership. */
/* 依赖注入声明：invariants 服务就绪后本插件才会被装载。 */
export const inject = ['invariants']

/**
 * No runtime invariant: preparation returns immutable per-call snapshots validated while they are
 * built, and the agent/session layers own durable context admission, freezing, and replay.
 */
/*
 * 空安装函数：准备过程返回的每次调用独立不可变快照在构建时就地校验，
 * 持久化上下文的接纳/冻结/回放由 agent/session 层负责，故无需额外检查。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 登记本包的 invariant 伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文
 * @returns 登记成功后的注销函数
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
