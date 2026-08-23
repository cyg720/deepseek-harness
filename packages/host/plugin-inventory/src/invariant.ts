/**
 * ================================ 文件注释 ================================
 * 【文件职责】plugin-inventory 包的"不变量伴生插件"：向不变量服务注册本包
 * 拥有者身份。由于每个快照都直接从 Loader 拥有的状态投影（本包不维护自己的
 * 事件流），伴生插件是显式空实现。
 * 【技术维度】Cordis 伴生插件模板：name/inject/apply 三件套，apply 注册空
 * install 并返回 disposer；jscpd:ignore 包裹整个注册块。
 * 【产品维度】为协议同构测试与运行时监控提供归属登记。
 * 【逻辑维度】包名 → 注入声明 → 空 install（附理由）→ apply 注册。
 * 【关键边界】无运行时不变量需要断言：快照数据完全来自 Loader 自身状态。
 * 【新手阅读建议】这是伴生插件的极简模板，可与 webserver 的探针式伴生对比。
 * ==========================================================================
 */
/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-plugin-inventory/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在不变量注册表中使用的包名键。
const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-inventory'

/** Cordis companion plugin name. */
// 伴生插件的 Cordis 插件名。
export const name = 'host-plugin-inventory-invariant'
/** Service required before the companion can reserve package ownership. */
// 启动前必须注入的服务：不变量注册服务。
export const inject = ['invariants']

/** No runtime invariant: every snapshot is projected directly from Loader-owned state. */
// 无运行时不变量：每个快照都直接从 Loader 拥有的状态投影。
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
// 伴生插件入口：注册空 install，返回释放函数。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
