/**
 * ================================ 文件注释 ================================
 * 【文件职责】Team 工具适配器的 invariant 伴生插件：注册空安装器，
 *   说明本包无运行时不变量（团队服务拥有持久与授权关系）。
 * 【技术维度】标准 invariants 插件形态。
 * 【逻辑维度】name/inject → 空 install → apply。
 * 【新手阅读建议】团队数据不变量看 agent-team 包的 fold 与 invariant。
 * ==========================================================================
 */

/** Package-owned invariant companion for the Team tool adapter. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-tool-agent-team'

/** Cordis companion plugin name. */
export const name = 'tool-team-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** No runtime invariant: the Team service owns durable and authorization relations. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
