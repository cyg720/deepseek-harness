/*
 * ================================ 文件注释 ================================
 * 【文件职责】file-reference-local 包自有的不变式伴生插件：向 dsh-invariants
 *             服务登记本包，声明"本包负责哪些运行时不变量"。
 * 【技术维度】Cordis 插件三元组（name/inject/apply）+ InvariantInstaller 模式。
 * 【产品维度】项目质量护栏的组成部分，与 file-reference 包的 invariant.ts 同构。
 * 【逻辑维度】声明插件名与依赖 → 定义空安装函数 → apply 登记进 invariants 服务。
 * 【关键边界】每个 agent 的索引是私有建议性缓存，其失效与销毁通过服务测试直接
 *             观察，因此这里不注册任何运行时检查。
 * 【新手阅读建议】可与 file-reference/invariant.ts 对照阅读，二者结构一致。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-file-reference-local`.
 * @module @deepseek-ai/dsh-file-reference-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 本包在 invariant 登记中的唯一标识名。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-file-reference-local'

/** Cordis companion plugin name. */
/* 该伴生插件的注册名。 */
export const name = 'file-reference-local-invariant'
/** Service required before the companion can reserve package ownership. */
/* 依赖注入声明：invariants 服务就绪后本插件才会被装载。 */
export const inject = ['invariants']

/**
 * No runtime invariant: per-agent indexes are private advisory caches whose
 * invalidation and disposal are observed directly through service tests.
 */
/*
 * 空安装函数：每个 agent 的索引是私有建议性缓存，其失效与销毁行为
 * 已由服务测试直接观察覆盖，无需额外注册运行时检查。
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
