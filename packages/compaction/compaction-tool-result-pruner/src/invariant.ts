/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-compaction-tool-result-pruner`.
 * @module @deepseek-ai/dsh-compaction-tool-result-pruner/invariant
 */
/**
 * 文件职责：为工具结果裁剪压缩策略注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议声明包所有权。
 * 产品维度：让上下文压缩策略可被诊断发现。
 * 逻辑维度：元数据和空 install 经 apply 注册。
 * 关键边界：每次内容重写由 Session 验证，跨事件包围关系由其伴生模块拥有。
 * 新手阅读建议：先看 Session 重写验证，再理解本策略不重复检查。
 */
// PACKAGE_NAME：工具结果裁剪包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-compaction-tool-result-pruner'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'compaction-tool-result-pruner-invariant'
/** Services required before the companion can register. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/** No runtime invariant: Session validates each content-only rewrite and its companion owns cross-event enclosure. */
/** install：空安装器；Session 验证重写并拥有跨事件关系。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
