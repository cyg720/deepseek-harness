/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-spine-demo`.
 * @module @deepseek-ai/dsh-agent-spine-demo/invariant
 */
/*
 * 文件职责：为代理主干演示组合注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册模式加入诊断清单。
 * 产品维度：帮助示例完整展示插件装配。
 * 逻辑维度：元数据与空 install 经 apply 注册。
 * 关键边界：组合包无独立状态，接线由 Loader 和构建测试覆盖。
 * 新手阅读建议：先看示例 cordis.yml，再理解此处只保留所有权。
 */
// PACKAGE_NAME：代理主干演示包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-spine-demo'

/** Cordis companion plugin name. */
/* name：稳定伴生名称。 */
export const name = 'agent-spine-demo-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this composition package owns no independent event stream or mutable data;
 * Loader and built-entry tests cover its wiring.
 */
/* install：空安装器；组合接线由 Loader 与构建测试覆盖。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
