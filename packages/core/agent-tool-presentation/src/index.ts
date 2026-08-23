/**
 * ================================ 文件注释 ================================
 * 【文件职责】agent 平面的工具呈现选择器：插件行（preset 行）声明“该 agent 的模型看到哪种形式的工具”——native/code/both。
 * 【技术维度】Cordis 插件；通过 ctx.tools.presentAs() 在挂载作用域声明呈现方式；code 模式依赖 host 平面的代码运行时服务，用 ctx.inject 等待它，缺省即响亮失败。
 * 【产品维度】“Code Mode”类预设的开关：选 code 时模型只看到 run_code 与生成的 SDK，实现代码优先的交互体验。
 * 【逻辑维度】name/inject → Config 接口与 schema → apply（native 直接声明；code/both 注入 codeRuntime 后声明）。
 * 【关键边界】工具注册表本身留在 host 平面（不能被 preset 搬走）；mode 必填而非默认，避免“组合了却无效果”的静默失效。
 * 【新手阅读建议】很短，直接读完；注意 apply 中 native 与 code 两条路径的差异。
 * ==========================================================================
 */
/**
 * Agent-plane presentation selector: the row an agent preset carries to say
 * which form of its tools the model sees.
 *
 * The tool registry itself stays on the host plane — the agent loop's
 * scheduler, the API proxy's presenters, and every tool plugin are all its
 * consumers, so it cannot move into a preset. What a preset CAN own is the
 * presentation: `ctx.tools.presentAs()` declares it for the mounting SCOPE,
 * which is the preset's standing mount, so the declaration covers every agent
 * joined to that preset and a Code Mode preset runs beside native ones in one
 * process. One row per composition, not one per session.
 *
 * A code mode needs a TypeScript code runtime, which is a host-plane service
 * ([`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker/README.md)).
 * This row therefore waits for it rather than assuming it: a preset selecting
 * Code Mode against a deployment that composes no runtime fails at mount, named
 * in the preset's own activation audit, instead of at the first prompt.
 * @module @deepseek-ai/dsh-agent-tool-presentation
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'
// Type-only: brings the `ctx.tools` Context merge into this program.
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
// 插件名：agent 预设（preset）通过这个名字在 cordis.yml 中挂载本行。
export const name = 'tool-presentation'

/**
 * Required services. `codeRuntime` is NOT listed: a `native` row must mount in
 * a deployment that composes no runtime, and the mode-dependent wait is
 * declared inside {@link apply} instead.
 */
// 依赖声明：只需要 tools 服务。codeRuntime 故意不写在这里——native 模式在没装代码运行时的部署里也必须能挂载，
// 是否等待 codeRuntime 由 apply 按 mode 决定。
export const inject = ['tools']

/** Plugin config. */
// 插件配置：只收一个 mode，声明“本预设覆盖的 agent 让模型看到哪种工具形式”。
export interface Config {
  /**
   * The form this agent's model sees. `native` sends every visible schema,
   * `code` sends only `run_code` plus a generated SDK, `both` sends both.
   * Required rather than defaulted: the deployment default is what a preset
   * without this row already gets, so an omitted value would mean the row was
   * composed for nothing.
   */
  // mode 必须显式给出，不设默认值：没写本行的预设本来就用部署默认值，缺省会让这一行“组合了却什么都没干”。
  mode: ToolPresentationMode
}

/** Runtime schema. */
// 运行时 schema：在插件装载时校验配置，mode 只能是 native/code/both 三者之一。
export const Config: z<Config> = z.object({
  mode: z.union(['native', 'code', 'both'] as const).required(),
})

/**
 * Declare the tool presentation for every agent this composition covers.
 * @param ctx - the mounting composition's scope context (a preset's standing scope).
 * @param config - the selected presentation.
 */
// 插件入口：在挂载作用域上声明工具呈现方式；被哪个 preset 挂载就覆盖哪些 agent。
export function apply(ctx: Context, config: Config): void {
  // `presentAs` is itself the effect — it registers through the calling
  // context and hands back that exact disposer — so the declaration unwinds
  // with this row without a second wrapper owning it.
  // native：最常见的模式，直接把全部可见工具 schema 交给模型，无需等待代码运行时。
  if (config.mode === 'native') {
    ctx.tools.presentAs('native')
    return
  }
  // The wait is the loud failure: an entry still pending on `codeRuntime` is
  // what `dsh-agent-presets` reports as an unusable row, naming this id.
  // code/both：需要 TypeScript 代码运行时（host 平面的服务）。注入等待它存在，缺失时在装载审计中响亮失败，
  // 而不是等到第一次提示词组装才发现。
  ctx.inject(['codeRuntime'], (runtimeCtx: Context) => {
    runtimeCtx.tools.presentAs(config.mode)
  })
}
