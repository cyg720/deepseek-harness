/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-headless`.
 * @module @deepseek-ai/dsh-headless/invariant
 */
/*
 * 文件职责：为无界面单次运行器声明包级不变量伴生插件。
 * 技术维度：通过 Cordis 依赖注入接入 dsh-invariants，以安装器表达本包可持续检查的关系。
 * 产品维度：让维护者从统一入口确认该能力的状态所有权，避免重复或遗漏运行时检查。
 * 逻辑维度：声明包名、插件名和依赖，准备安装器，再由 apply 注册并返回注销函数。
 * 关键边界：最终文本和退出码属于进程级行为并由启动器端到端测试负责，本包不注册状态。
 * 新手阅读建议：先看包名与 inject，再理解空 install 的理由，最后阅读 apply 的注册调用。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-headless'
// 不变量注册表使用的正式包名；必须与当前 npm 包标识保持一致。

/** Cordis companion plugin name. */
/* Cordis 配置引用的伴生插件名称；不是最终用户看到的标题。 */
export const name = 'headless-invariant'
/** Service required before the companion can register. */
/* 启动前必须注入的不变量服务；依赖名称由 Cordis 解析。 */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner is a one-shot driver over the API carrier
 * whose observable contract (final text on stdout, exit code by turn-end
 * reason) is process-level and owned by the launcher e2e; it registers
 * nothing and holds no mutable relation to audit inside the tree.
 */
// 不增加运行时检查；空安装器仍明确保留本包在统一注册表中的记录。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册不变量声明。@param ctx 提供不变量服务的 Cordis 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
