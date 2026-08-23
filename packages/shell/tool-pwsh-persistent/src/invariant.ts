/**
 * ================================ 文件注释 ================================
 * 【文件职责】注册 dsh-tool-pwsh-persistent 包在 invariants 服务中的"包属主"声明：
 * 适配器私有的 owner→shell 缓存没有可观测的事件或数据关系，清理由生命周期测试证明，
 * 故无运行时不变式。
 * 【技术维度】Cordis 伴生插件三件套（name / inject / apply）注册到 invariants 服务；
 * 文件主体与其它包的同名镜像文件几乎相同，故包在 jscpd:ignore 豁免区内。
 * 【产品维度】工程治理设施：为监控/诊断工具指明"本包不变式归属"，为将来加检查预留入口。
 * 【逻辑维度】定义包名常量 → 声明插件名与依赖 → 空安装函数 → apply 注册并返回释放器。
 * 【关键边界】inject 依赖须先就绪；register 返回的释放器由 Cordis 在插件卸载时自动调用。
 * 【新手阅读建议】与 dsh-shell/invariant.ts 对照阅读，两者是同一模板的包名变体。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-pwsh-persistent`.
 * @module @deepseek-ai/dsh-tool-pwsh-persistent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-pwsh-persistent'
/** 本包的 npm 完整名称，作为 invariants 服务中包属主登记的键。 */

/** Cordis companion plugin name. */
/** 伴生插件的注册名，出现在 Cordis 日志与依赖图中。 */
export const name = 'tool-pwsh-persistent-invariant'
/** Service required before the companion can reserve package ownership. */
/** 插件启动前必须已加载的服务列表：invariants 服务就绪后本伴生插件才能完成注册。 */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter's private owner-to-shell cache has no
 * observable event or data relation. Lifecycle tests prove its cleanup without
 * adding a public API solely for an invariant.
 */
/**
 * 安装函数体：适配器私有的 owner→shell 缓存没有可观测的事件或数据关系，清理行为由
 * 生命周期测试证明，不为不变式专门新增公开 API，故为空实现（显式声明而非遗漏）。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
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
/* jscpd:ignore-end */
