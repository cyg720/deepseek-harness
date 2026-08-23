/**
 * ================================ 文件注释 ================================
 * 【文件职责】file-reference 包自有的"不变式伴生插件"（invariant companion）。
 *             项目约定每个包通过 dsh-invariants 服务登记运行时不变式检查，
 *             本文件负责完成 file-reference 包的登记动作。
 * 【技术维度】Cordis 插件模式：导出 name/inject/apply 三元组；invariants 服务
 *             注册一个安装函数（InvariantInstaller）。
 * 【产品维度】作为项目质量护栏的一部分：在装配时声明"本包负责哪些运行时不变量"，
 *             便于测试与诊断快速定位不变量归属。
 * 【逻辑维度】1) 声明插件名与依赖服务；2) 定义空安装函数（本包没有需要检查的
 *             运行时不变式）；3) apply 把安装函数登记进 invariants 服务。
 * 【关键边界】本包的接口不保留候选或生命周期状态，具体 Provider 才拥有自己的
 *             缓存与失效关系，因此这里刻意不注册任何检查。
 * 【新手阅读建议】invariant.ts 是一类模板文件，各包的 invariant.ts 结构几乎相同，
 *                 读懂本文件即可举一反三。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-file-reference`.
 * @module @deepseek-ai/dsh-file-reference/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 本包在 invariant 登记中的唯一标识名，与 npm 包名一致。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-file-reference'

/** Cordis companion plugin name. */
/** 该伴生插件的注册名，供 Cordis 装配系统识别。 */
export const name = 'file-reference-invariant'
/** Service required before the companion can reserve package ownership. */
/** 依赖注入声明：invariants 服务就绪后本插件才会被装载。 */
export const inject = ['invariants']

/**
 * No runtime invariant: the interface retains no candidate or lifecycle
 * state; concrete providers own their cache and invalidation relationships.
 */
/**
 * 空安装函数：file-reference 的接口本身不保留任何候选或生命周期状态，
 * 缓存与失效关系由各具体 Provider 自持，因此这里无需注册任何检查。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 登记本包的 invariant 伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文
 * @returns 登记成功后的注销函数（用于卸载时回收注册）
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
