/**
 * ================================ 文件注释 ================================
 * 【文件职责】注册 dsh-subprocess 包在 invariants 服务中的"包属主"声明：本包为纯类型
 * Service Definition，只拥有 spawn 规格/句柄类型，观测归各 Service Provider，无运行时不变式。
 * 【技术维度】Cordis 伴生插件模式：name / inject / apply 三件套，apply 内经
 * ctx.invariants.register 把包名与空安装函数挂钩。
 * 【产品维度】工程治理设施：为将来在本包增加运行时不变式检查预留唯一登记入口。
 * 【逻辑维度】定义包名常量 → 声明插件名与依赖 → 空安装函数 → apply 注册并返回释放器。
 * 【关键边界】inject 依赖须先就绪；register 返回的释放器由 Cordis 在插件卸载时自动调用。
 * 【新手阅读建议】与 dsh-shell/invariant.ts 对照阅读，两者是同一模板的包名变体。
 * ==========================================================================
 */

/** Package-owned invariant companion for the subprocess seam. @module @deepseek-ai/dsh-subprocess/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subprocess'
/** 本包的 npm 完整名称，作为 invariants 服务中包属主登记的键。 */

/** Cordis companion plugin name. */
/** 伴生插件的注册名，出现在 Cordis 日志与依赖图中。 */
export const name = 'subprocess-invariant'
/** Service required before the companion can reserve package ownership. */
/** 插件启动前必须已加载的服务列表：invariants 服务就绪后本伴生插件才能完成注册。 */
export const inject = ['invariants']

/** No runtime invariant: this stateless Service Definition owns spawn-spec/handle types, while Service Providers own observations. */
/** 安装函数体：本包为纯类型契约包，观测归各 Service Provider，故为空实现（显式声明而非遗漏）。 */
const install: InvariantInstaller = () => {}

/**
 * Register the subprocess invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 注册本包的 invariants 伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文
 * @returns 注册完成后得到的释放器，插件卸载时由 Cordis 自动调用
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
