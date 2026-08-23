/**
 * dsh-commands' owned branded id: command lifecycle pairing across the
 * session log, the wire admission response, and client-side flow pairing.
 *
 * The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; this module
 * is a pure type/constructor outlet (no cordis imports, no module
 * augmentation) so wire and client programs can name the brand without
 * loading the host plugin's Context merges — the `dsh-llm/brand` shape.
 *
 * @module @deepseek-ai/dsh-commands/brand
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-commands 自有的品牌类型 CommandId：把一次命令执行的 command/run 与
 *   command/done 两条生命周期记录、以及 command.execute 的 admission 响应配对起来。
 * 【技术维度】纯类型/构造器出口模块：不 import Cordis、不做模块扩充（同 dsh-llm/brand 形态），
 *   使跨进程与客户端程序无需加载宿主插件就能使用这个品牌。
 * 【产品维度】UI 能凭 commandId 把远端确认与事件流中的命令节点对应上，渲染完整的命令卡片。
 * 【逻辑维度】类型声明（Branded<'CommandId'>）→ 构造函数（无校验，仅打品牌标签）。
 * 【关键边界】构造器不做格式校验；配对 id 由执行器铸造：单调递增且带实例 token 前缀，
 *   保证跨进程重启、续写会话日志也不会重复。
 * 【新手阅读建议】对照 @deepseek-ai/dsh-llm 的 brand 模块理解"纯类型出口"的仓库惯例。
 * ==========================================================================
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Pairs one command execution's `command/run`/`command/done` lifecycle
 * records with each other and with the `command.execute` admission response.
 * Minted by the executor, monotonic per service instance.
 */
// 品牌类型：底层是字符串；由执行器铸造，每服务实例单调递增，跨重启续写日志不重复。
export type CommandId = Branded<'CommandId'>

/**
 * Brand a string as a {@link CommandId}.
 * @param id - the executor-minted pairing id.
 * @returns the same string, branded; no validation is performed.
 */
// 品牌构造函数：直接给字符串打标签、不做校验——id 的合法性由铸造方保证。
export function CommandId(id: string): CommandId {
  return id as CommandId
}
