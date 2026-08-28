/**
 * Registry for ordered system sections, dynamic context, tool schemas, and prompt variables.
 *
 * @module @deepseek-ai/dsh-system-prompt
 */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】系统提示词装配注册表：集中管理有序的系统段落（sections）、动态上下文（contexts）、
 *           工具 schema（tools）与提示词变量（variables），并在每次模型步骤前把它们装配成
 *           PromptAssembly；另附渲染函数（renderPrompt/renderContextSnapshot 等）完成 {{变量}} 插值。
 * 【技术维度】Cordis Service 与瀑布事件（system-prompt/assemble，返回值即权威结果）；dsh-scope 的
 *            分层注册（全局层 + 各 agent 作用域层，scoped 同名条目遮蔽全局）；NamedEntries/
 *            AnonymousEntries 管理具名/匿名注册并处理重复冲突；schemastery 声明插件 Config；
 *            手写的严格模板变量扫描器。
 * 【产品维度】决定模型“是谁、知道什么、能用什么”：harness 身份、部署人设 persona、各能力注入的
 *           使用指引与动态运行时上下文都从这里汇入系统提示；toolOrder 让部署方控制工具呈现顺序；
 *           complete section 允许某个组合整体接管系统提示。
 * 【逻辑维度】按代码顺序：Cordis 事件声明 → 装配上下文与输入/输出类型 → 常量（persona 槽位、变量名
 *           正则、toolOrder 保留标记）→ toolOrder 校验与排序 → 渲染与插值函数 → PromptLayer 层存储
 *           → SystemPrompt 服务（构造时装身份/persona，五个注册方法，assemble 总装）。
 * 【关键边界】同名注册在同层抛错（全局层的报错会提示改用 agent.ctx 做按 agent 覆盖）；order 必须是
 *           有限数；{{变量}} 引用严格：名字不合正则、未注册或值为 undefined 都抛错，孤立的 '{{'
 *           （其后再无 '}}'）视为普通文字；替换值不二次扫描；多个 complete section 同时激活即失败。
 * 【新手阅读建议】先读 PromptSection/PromptContext/PromptAssembly 理解输入输出模型，再读 assemble
 *           方法看装配全流程（变量求值 → 段落排序 → 工具收集排序 → 瀑布 → complete 恢复），
 *           最后读 interpolate 理解严格插值规则。
 * ==========================================================================
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AnonymousEntries, NamedEntries, ScopedLayers, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer, Scoped } from '@deepseek-ai/dsh-scope'
import type { ContextSnapshotSection, ToolSchema } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: SystemPrompt
  }

  interface Events {
    /**
     * Expert waterfall over the assembled sections, contexts, tools, and variables.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
     * receive only that scope's assemblies. The returned value is authoritative.
     * A supplied signal controls only this explicit assembly request and must not
     * be retained to control later turns. A registered complete section is
     * restored after this waterfall, so listeners cannot add to or replace
     * that scope's system prompt.
     * @param assembly - the mutable assembly built from registered providers.
     * @param context - the caller's per-assembly context.
     * @mode waterfall
     */
    // 中文说明：围绕已装配段落、上下文、工具与变量的专家瀑布事件。作用域过滤分发：scoped 监听器
    // 只收到自己作用域的装配。返回值即权威结果。传入的 signal 只控制这一次装配请求，不得留存控制
    // 后续轮次。已注册的 complete section 在瀑布之后被恢复，监听器无法增删或替换该作用域的系统提示。
    'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>
    /**
     * Emitted when any prompt provider changes. This registry notification is
     * unfiltered because a global change affects every scope.
     * @mode emit
     */
    // 中文说明：任一 prompt 提供方发生变化时发射。该注册表通知不做过滤，因为全局变化影响所有作用域。
    'system-prompt/change'(): void
  }
}

/** Merge-extensible context for one prompt assembly. */
/* 一次提示词装配所用上下文；可合并扩展（插件可追加字段）。 */
export interface AssembleContext {
  /**
   * Scope whose providers and waterfall listeners participate. When absent,
   * only global providers and subject-less listeners participate.
   */
  // 参与装配的作用域：哪些提供方与瀑布监听器生效。缺省时只有全局提供方与无主体监听器参与。
  scope?: ScopeKey
  /** Explicit control signal for the turn that requested this assembly, when any. */
  // 请求本次装配的那一轮所用的显式中止信号（如有）。
  signal?: AbortSignal
}

/** One contributed section of the system prompt (registry input). */
/* 系统提示的一个贡献段（注册表输入）。 */
export interface PromptSection {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.section}). */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Equal orders use code-unit
   * name order. Repository-owned placements use
   * {@link FIRST_PARTY_SECTION_ORDER}.
   */
  readonly order: number
  /**
   * Static text or a provider evaluated at each assembly with that assembly's
   * {@link AssembleContext}. The text may reference `{{variable}}`s — they are
   * interpolated later, by {@link renderPrompt}.
   */
  readonly text: string | ((context: AssembleContext) => string)
  /**
   * Treat this contribution as the complete system prompt. Assembly still
   * runs the cooperative waterfall so tools, contexts, and variables can be
   * resolved, then restores this exact section as the sole prompt section.
   * More than one effective complete section makes assembly fail.
   */
  readonly complete?: boolean
}

/** Dynamic model context materialized as a durable user-role snapshot. */
/* 物化为耐久 user 角色快照的动态模型上下文（随请求注入，而非写进系统提示）。 */
export interface PromptContext {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.context}). */
  // 唯一名——同层重复注册会抛错（见 SystemPrompt.context）。
  readonly name: string
  /** Contexts are joined in ascending order. */
  // 上下文按 order 升序拼接。
  readonly order: number
  /** Static text or a provider evaluated for each assembly. Empty text contributes nothing. */
  // 静态文本或每次装配求值的提供方；空文本不产生贡献。
  readonly text: string | ((context: AssembleContext) => string)
}

/** One section of an assembly: {@link PromptSection} with its text resolved. */
/* 装配结果中的一个段：PromptSection 且文本已解析（函数提供方已求值）。 */
export interface AssembledSection {
  /** The contributing section's unique name. */
  // 贡献段的唯一名。
  name: string
  /** The resolved (but not yet interpolated) section text. */
  // 已解析但尚未插值变量的段文本。
  text: string
}

/** One resolved dynamic context contribution. */
/* 一份已解析的动态上下文贡献。 */
export interface AssembledContext {
  /** The contributing context's unique name. */
  // 贡献上下文的唯一名。
  name: string
  /** The resolved text before variable interpolation. */
  // 插值变量之前的已解析文本。
  text: string
}

/** Tool schemas visible in one assembly and their pre-restriction name set. */
/* 一次装配可见的工具 schema 及其“限制前”的名字全集。 */
export interface ToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  // 本提供方向本次装配贡献的 schema。
  readonly schemas: readonly ToolSchema[]
  /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
  // 供 toolOrder 配置校验用的限制前名字全集（缺省取 schemas 的名字）。
  readonly knownNames?: readonly string[]
}

/**
 * Merge-extensible assembled model input. Sections and contexts remain
 * uninterpolated until rendered; tools are already in canonical order.
 */
/*
 * 可合并扩展的已装配模型输入。sections 与 contexts 保持未插值状态直到渲染；
 * tools 已处于规范顺序。
 */
export interface PromptAssembly {
  // 已解析文本的有序系统段落。
  sections: AssembledSection[]
  // 已解析文本的有序动态上下文。
  contexts: AssembledContext[]
  // 规范排序后的工具 schema。
  tools: ToolSchema[]
  // 变量名 → 值；undefined 表示已注册但本次装配无值。
  variables: Record<string, string | undefined>
}

/**
 * Sparse integer placements for repository-owned prompt sections.
 *
 * Adjacent values differ by at least ten to keep the first-party groups sparse
 * and make accidental collisions mechanically detectable.
 * External plugins may use any finite order; equal orders are deterministic by
 * section name.
 */
export const FIRST_PARTY_SECTION_ORDER = {
  HARNESS_IDENTITY: -1000,
  HARNESS_SOURCE: -900,
  WEB_SURFACE: -800,
  DEPLOYMENT_PERSONA: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2000,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_CORDIS: 2500,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
} as const

/**
 * The deployment persona's section name and order. Exported because a
 * composition can replace this slot — an agent preset shadows the
 * deployment's persona with its own — and both sides naming the same section
 * is what makes the replacement work rather than duplicate.
 */
/*
 * 部署人设（persona）的段名。之所以导出：组合可以用同名段替换这个槽位——agent preset 用自己的段
 * 遮蔽部署人设——两侧命名相同正是“替换”而非“重复”得以成立的原因。
 */
export const PERSONA_SECTION = 'deployment:persona'

/** Prompt order of the persona slot. */
export const PERSONA_ORDER = FIRST_PARTY_SECTION_ORDER.DEPLOYMENT_PERSONA

/** Valid variable names: how they are written between the braces. */
// 合法变量名：即花括号之间的书写形式（小写字母开头，后接小写字母/数字/下划线）。
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/** A complete `{{...}}` reference group at the scan position (validated after). */
// 在扫描位置匹配一个完整的 {{...}} 引用组（名字合法性稍后单独校验）。
const GROUP_AT = /^\{\{([^{}]*)\}\}/

/** Reserved {@link Config.toolOrder} marker for unlisted tools. */
// Config.toolOrder 中代表“未列出工具”的保留标记。
export const TOOL_ORDER_REST = '<unlisted-tools>'

/**
 * Validate duplicate names and the required {@link TOOL_ORDER_REST} marker.
 * Registered names are checked later because plugins have not loaded yet.
 */
/*
 * 校验重复名与必需的 {@link TOOL_ORDER_REST} 保留标记。
 * 已注册名留到装配时再查，因为此刻插件尚未加载。
 * @param toolOrder - 配置声明的工具顺序（可为 undefined）。
 * @returns 原样通过校验的顺序。
 */
function validateToolOrder(toolOrder: string[] | undefined): string[] | undefined {
  if (toolOrder === undefined) return undefined
  const seen = new Set<string>()
  for (const name of toolOrder) {
    if (seen.has(name)) throw new Error(`toolOrder lists "${name}" more than once`)
    seen.add(name)
  }
  if (!seen.has(TOOL_ORDER_REST)) {
    throw new Error(`toolOrder must contain the "${TOOL_ORDER_REST}" rest entry (where unlisted tools are inserted)`)
  }
  return toolOrder
}

/**
 * Apply configured tool order, inserting unlisted tools lexicographically at
 * {@link TOOL_ORDER_REST}. Unknown configured names fail; known but restricted
 * names may be absent.
 */
/*
 * 应用配置的工具顺序：未列出的工具按字典序插到 TOOL_ORDER_REST 标记所在位置。
 * 配置了未知名直接失败；已知但被隐藏的名字允许缺席。
 * @param tools - 收集到的工具 schema 列表。
 * @param toolOrder - 配置的顺序（undefined 表示按字典序）。
 * @param knownNames - 限制前的合法名字全集。
 * @returns 排好序的工具 schema。
 */
function orderTools(tools: ToolSchema[], toolOrder: string[] | undefined, knownNames: ReadonlySet<string>): ToolSchema[] {
  // 工具提供方若返回保留名即配置冲突，立即失败。
  const reserved = tools.find(tool => tool.name === TOOL_ORDER_REST)
  if (reserved !== undefined) {
    throw new Error(`tool provider returned reserved tool name "${TOOL_ORDER_REST}" (reserved for toolOrder's rest entry)`)
  }
  if (toolOrder === undefined) return tools.sort(compareToolNames)
  const unknown = toolOrder.filter(name => name !== TOOL_ORDER_REST && !knownNames.has(name))
  if (unknown.length > 0) {
    throw new Error(`toolOrder lists unregistered tool${unknown.length > 1 ? 's' : ''} ${unknown.map(name => `"${name}"`).join(', ')}; known tools: ${[...knownNames].sort().join(', ') || '(none)'}`)
  }
  // listed 是配置点名的集合；rest 是未点名工具按字典序排好、待插入标记位置的列表。
  const listed = new Set(toolOrder)
  const rest = tools.filter(tool => !listed.has(tool.name)).sort(compareToolNames)
  return toolOrder.flatMap(name =>
    name === TOOL_ORDER_REST ? rest : tools.filter(tool => tool.name === name))
}

/** Code-unit name comparison — locale-independent, so the order is identical on every machine. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Order prompt sections by their explicit placement, then deterministically by name. */
function comparePromptSections(a: PromptSection, b: PromptSection): number {
  return a.order - b.order || compareNames(a.name, b.name)
}

/** Order tool schemas lexicographically by name. */
function compareToolNames(a: ToolSchema, b: ToolSchema): number {
  return compareNames(a.name, b.name)
}

/** Plugin config: the deployment-authored fragment of the system prompt (see {@link Config.persona} for its contract). */
/* 插件配置：部署方撰写的系统提示词片段（persona 契约见字段注释）。 */
export interface Config {
  /** Include the fixed DeepSeek Harness identity before the deployment persona (default true). */
  // 是否在部署人设之前附带固定的 DeepSeek Harness 身份段（默认 true）。
  includeHarnessIdentity?: boolean
  /** Include dynamic runtime-context snapshots in model history (default true). */
  // 是否在模型历史中包含动态运行时上下文快照（默认 true）。
  includeRuntimeContext?: boolean
  /**
   * Deployment-wide order-0 persona template. A scoped section named
   * `deployment:persona` shadows it; `{{variable}}` references are strict.
   */
  // 部署级 order-0 人设模板。名为 deployment:persona 的 scoped 段会遮蔽它；{{变量}} 引用是严格的。
  persona?: string
  /**
   * Model-facing tool names in order, with {@link TOOL_ORDER_REST} exactly once.
   * Invalid fields fail at load and unknown names fail at assembly; known names
   * hidden in one scope may be absent there. Omitted means lexicographic order.
   */
  // 模型可见工具名的呈现顺序，TOOL_ORDER_REST 恰好出现一次。字段非法在加载期失败、未知名在装配期
  // 失败；某作用域隐藏的已知名在该作用域可缺席。缺省按字典序。
  toolOrder?: string[]
}

/**
 * Interpolate strict `{{variable}}` references, drop empty sections, and join
 * the rest with blank lines. Malformed, unknown, or undefined references throw;
 * a lone `{{` without any later `}}` is literal prose, and substituted values
 * are not scanned again.
 * @param assembly - the assembly whose sections and variables to render.
 * @returns the rendered prompt, or `''` when all sections are empty.
 */
/*
 * 插值严格的 {{变量}} 引用、剔除空段落后用空行连接其余段落。
 * 畸形、未知或值为 undefined 的引用都抛错；孤立的 '{{'（其后再无 '}}'）按普通文字处理；
 * 替换进去的值不会再被扫描。
 * @param assembly - 待渲染的装配（用其 sections 与 variables）。
 * @returns 渲染后的提示词；所有段落皆空时为 ''。
 */
export function renderPrompt(assembly: PromptAssembly): string {
  return assembly.sections
    .map(section => interpolate(section, assembly.variables, 'section'))
    .filter(text => text.length > 0)
    .join('\n\n')
}

/**
 * Render the complete dynamic context snapshot.
 * @param assembly - the assembly whose contexts and variables to render.
 * @returns the current full snapshot, or `''` when no context is active.
 */
/*
 * 渲染完整的动态上下文快照。
 * @param assembly - 待渲染的装配（用其 contexts 与 variables）。
 * @returns 当前完整快照；无活跃上下文时为 ''。
 */
export function renderContextSnapshot(assembly: PromptAssembly): string {
  return joinContextSections(renderContextSections(assembly))
}

/**
 * The model-facing snapshot text for an already-rendered section list.
 *
 * A caller that also needs the sections renders them once and joins here, so a
 * request does not interpolate every context twice.
 * @param sections - sections from {@link renderContextSections}.
 * @returns the current full snapshot, or `''` when no context is active.
 */
/*
 * 把已渲染的段落列表拼成面向模型的快照文本。
 * 同时需要段落的调用方只需渲染一次再在此拼接，避免一次请求里把每个上下文插值两遍。
 * @param sections - {@link renderContextSections} 的产物。
 * @returns 当前完整快照；无活跃上下文时为 ''。
 */
export function joinContextSections(sections: readonly ContextSnapshotSection[]): string {
  const body = sections.map(section => section.text).join('\n\n')
  if (body.length === 0) return ''
  return `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${body}`
}

/**
 * The same snapshot, kept as the named contributions it was assembled from.
 *
 * {@link renderContextSnapshot} joins these for the model; a consumer that
 * presents the snapshot uses them to attribute each part to the subsystem that
 * contributed it, without re-splitting the joined prose.
 * @param assembly - the assembly whose contexts and variables to render.
 * @returns one entry per contributing context that rendered to non-empty text.
 */
/*
 * 同一份快照，但保留为“有名有姓”的贡献条目。
 * {@link renderContextSnapshot} 把它们拼接给模型；展示快照的消费方则用它把每部分归属到贡献它的
 * 子系统，无需再切分拼好的散文。
 * @param assembly - 待渲染的装配。
 * @returns 每个渲染为非空文本的贡献上下文一条。
 */
export function renderContextSections(assembly: PromptAssembly): ContextSnapshotSection[] {
  return assembly.contexts
    .map(context => ({ name: context.name, text: interpolate(context, assembly.variables, 'context') }))
    .filter(section => section.text.length > 0)
}

/** Interpolate one section or context and attribute diagnostics to its owning input. */
/* 对一个段或上下文做插值，并把诊断信息归因到其所属输入（kind + 名字）。 */
function interpolate(
  input: AssembledSection | AssembledContext,
  variables: Record<string, string | undefined>,
  kind: 'section' | 'context',
): string {
  // result 是累计输出；last 是已消费到的扫描位置；open 是下一个 '{{' 的位置。
  const text = input.text
  let result = ''
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      // A later closing brace makes this malformed; otherwise it is literal prose.
      // 后面还有闭合括号说明本处畸形；否则这就是普通文字。
      if (text.indexOf('}}', open + 2) >= 0) {
        throw new Error(`malformed prompt variable reference at "${text.slice(open, open + 16)}…" in ${kind} "${input.name}" (references are complete simple {{name}} groups)`)
      }
      result += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    // `{{}}` yields an empty name and follows the malformed-reference path.
    // '{{}}' 得到空名，同样走畸形引用路径。
    const name = group[0].slice(2, -2)
    if (!VARIABLE_NAME.test(name)) {
      throw new Error(`malformed prompt variable reference "{{${name}}}" in ${kind} "${input.name}" (variable names match ${String(VARIABLE_NAME)})`)
    }
    // Do not resolve unregistered names through Object.prototype.
    // 不要让未注册的名字穿透到 Object.prototype 上解析。
    if (!Object.hasOwn(variables, name)) {
      const known = Object.keys(variables)
      throw new Error(`unknown prompt variable "{{${name}}}" in ${kind} "${input.name}"; registered variables: ${known.length > 0 ? known.join(', ') : '(none)'}`)
    }
    const value = variables[name]
    if (value === undefined) {
      throw new Error(`prompt variable "{{${name}}}" has no value for this assembly (${kind} "${input.name}")`)
    }
    result += text.slice(last, open) + value
    last = open + group[0].length
  }
  return result + text.slice(last)
}

/** One tool-schema provider stored in a prompt layer. */
// 存入提示层的工具 schema 提供方。
type ToolProvider = (context: AssembleContext) => ToolProviderResult

/** One prompt-variable provider stored in a prompt layer. */
// 存入提示层的提示词变量提供方。
type VariableProvider = (context: AssembleContext) => string | undefined

/** All prompt registrations owned by one global or scoped layer. */
/* 一个全局或作用域层拥有的全部提示词注册。 */
class PromptLayer implements ScopeLayer {
  // 具名段落注册表（重名报错文案按层归属定制）。
  readonly sections: NamedEntries<PromptSection>
  // 具名动态上下文注册表。
  readonly contexts: NamedEntries<PromptContext>
  // 匿名抑制器列表：任一存在即在本层作用域内关闭运行时上下文。
  readonly runtimeContextSuppressors = new AnonymousEntries<true>()
  // 匿名工具 schema 提供方列表（同层可多次追加）。
  readonly toolProviders = new AnonymousEntries<ToolProvider>()
  // 具名变量提供方注册表。
  readonly variables: NamedEntries<VariableProvider>

  /**
   * Create one prompt layer with diagnostics specific to its ownership scope.
   * @param scope - the scoped owner, or `undefined` for global registrations.
   */
  /*
   * 创建一个提示词层，重复名报错文案按其归属作用域定制。
   * @param scope - 作用域属主；全局注册时为 undefined。
   */
  constructor(scope: ScopeKey | undefined) {
    this.sections = new NamedEntries(name => new Error(scope === undefined
      ? `prompt section "${name}" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`
      : `prompt section "${name}" is already registered in this scope`))
    this.contexts = new NamedEntries(name => new Error(scope === undefined
      ? `prompt context "${name}" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`
      : `prompt context "${name}" is already registered in this scope`))
    this.variables = new NamedEntries(name => new Error(scope === undefined
      ? `prompt variable "${name}" is already registered (for a per-agent value, register through that agent's \`agent.ctx\` instead)`
      : `prompt variable "${name}" is already registered in this scope`))
  }

  /** @returns whether this layer owns no prompt registrations. */
  /* @returns 本层是否没有任何提示词注册。 */
  isEmpty(): boolean {
    return this.sections.isEmpty()
      && this.contexts.isEmpty()
      && this.runtimeContextSuppressors.isEmpty()
      && this.toolProviders.isEmpty()
      && this.variables.isEmpty()
  }
}

/** Registry service for the prompt inputs assembled before each model step. */
/* 在每次模型步骤前装配提示词输入的注册表服务。 */
export class SystemPrompt extends Service {
  // 插件配置 schema：与 Config 接口对应，提供默认值。
  static Config: z<Config> = z.object({
    includeHarnessIdentity: z.boolean().default(true),
    includeRuntimeContext: z.boolean().default(true),
    persona: z.string().default(''),
    // Preserve omission because an explicit empty order lacks the rest marker.
    // 保持“缺省即 undefined”：显式空数组缺少 rest 标记会校验失败。
    toolOrder: z.array(z.string()).default(undefined as unknown as string[]),
  })

  // 全局 + 各作用域的分层注册存储；任何增删都发射 system-prompt/change。
  private readonly layers = new ScopedLayers(
    scope => new PromptLayer(scope),
    () => { this.ctx.emit('system-prompt/change') },
  )
  // 构造期校验过的工具顺序配置。
  private readonly toolOrder: string[] | undefined

  /**
   * @param ctx - 宿主 Cordis 上下文。
   * @param config - 经过 schema 校验的插件配置。
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'systemPrompt')
    this.toolOrder = validateToolOrder(config.toolOrder)
    // Keep harness-owned openers independent of the selected loop plugin.
    // 让 harness 自己的开场白不依赖所选循环插件。
    if (config.includeHarnessIdentity ?? true) {
      this.section({
        name: 'harness:identity',
        order: FIRST_PARTY_SECTION_ORDER.HARNESS_IDENTITY,
        text: 'You are an AI agent powered by DeepSeek Harness.',
      })
    }
    this.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
      // The fallback narrows the optional input type; the schema already defaults it.
      // 这个兜底只为收窄可选的输入类型；schema 已给了默认值。
      text: config.persona ?? '',
    })
    if (!(config.includeRuntimeContext ?? true)) this.suppressRuntimeContext()
  }

  /**
   * Register an ordered prompt section in the calling context's scope. A scoped
   * section shadows a global section with the same name; duplicates within one
   * layer and non-finite orders throw. Registration and disposal emit
   * `system-prompt/change`.
   * @param section - the section to register.
   * @returns the exact Cordis effect disposer.
   */
  /*
   * 在调用方上下文所属作用域注册一个有序提示段。scoped 同名段遮蔽全局段；
   * 同层重复与非有限 order 都抛错。注册与注销都会发射 system-prompt/change。
   * @param section - 待注册的段。
   * @returns 确切的 Cordis effect disposer。
   */
  section(section: PromptSection): () => void {
    if (!Number.isFinite(section.order)) {
      throw new TypeError(`prompt section "${section.name}" order must be a finite number`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.sections.insert(section.name, section),
      { label: 'systemPrompt.section()' },
    )
  }

  /**
   * Register ordered dynamic context in the calling context's scope. Scoped
   * entries shadow global entries with the same name.
   * @param context - the context contribution to register.
   * @returns the exact Cordis effect disposer.
   */
  /*
   * 在调用方作用域注册有序动态上下文。scoped 同名条目遮蔽全局条目。
   * @param context - 待注册的上下文贡献。
   * @returns 确切的 Cordis effect disposer。
   */
  context(context: PromptContext): () => void {
    if (!Number.isFinite(context.order)) {
      throw new TypeError(`prompt context "${context.name}" order must be a finite number`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.contexts.insert(context.name, context),
      { label: 'systemPrompt.context()' },
    )
  }

  /**
   * Suppress every dynamic runtime-context contribution in the calling
   * context's scope without changing the services that own or enforce those
   * facts. Multiple suppressors remain independently disposable.
   * @returns the exact Cordis effect disposer.
   */
  /*
   * 在调用方作用域内抑制全部动态运行时上下文贡献，但不改动拥有或强制这些事实的服务。
   * 多个抑制器相互独立、各自可释放。
   * @returns 确切的 Cordis effect disposer。
   */
  suppressRuntimeContext(): () => void {
    return this.layers.effect(
      this.ctx,
      layer => layer.runtimeContextSuppressors.append(true),
      { label: 'systemPrompt.suppressRuntimeContext()' },
    )
  }

  /**
   * Register a tool-schema provider in the calling context's scope. Global and
   * matching scoped providers both contribute; returning the reserved
   * {@link TOOL_ORDER_REST} name makes assembly fail.
   * @param provider - evaluated for each assembly with its context.
   * @returns the exact Cordis effect disposer.
   */
  /*
   * 在调用方作用域注册一个工具 schema 提供方。全局与匹配作用域的提供方都会贡献；
   * 返回保留名 TOOL_ORDER_REST 会使装配失败。
   * @param provider - 每次装配时以该次上下文求值。
   * @returns 确切的 Cordis effect disposer。
   */
  tools(provider: (context: AssembleContext) => ToolProviderResult): () => void {
    return this.layers.effect(
      this.ctx,
      layer => layer.toolProviders.append(provider),
      { label: 'systemPrompt.tools()' },
    )
  }

  /**
   * Register a prompt variable in the calling context's scope. Scoped values
   * shadow globals; invalid or duplicate names throw. A provider may return
   * `undefined`, but rendering a section that references that value then fails.
   * @param name - the `[a-z][a-z0-9_]*` reference name.
   * @param provider - evaluated for each assembly.
   * @returns the exact Cordis effect disposer.
   */
  variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void {
    if (!VARIABLE_NAME.test(name)) {
      throw new Error(`invalid prompt variable name "${name}" (must match ${String(VARIABLE_NAME)})`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.variables.insert(name, provider),
      { label: 'systemPrompt.variable()' },
    )
  }

  /**
   * Assemble global and scoped providers, detach tool parameters, apply
   * canonical ordering, then run the assembly waterfall. Scoped sections and
   * variables shadow globals. The returned waterfall value is authoritative
   * except that an effective complete section is restored afterwards as the
   * sole prompt section.
   * @param context - the optional scope and plugin-defined assembly fields.
   * @returns the post-waterfall assembly with any complete prompt enforced.
   */
  // Keep configuration failures on the declared asynchronous error path.
  async assemble(context: AssembleContext = {}): Promise<PromptAssembly> {
    const scope = context.scope
    const scopeLayers = this.layers.chainLayers(scope)
    const runtimeContextSuppressed = !this.layers.global.runtimeContextSuppressors.isEmpty()
      || scopeLayers.some(layer => !layer.runtimeContextSuppressors.isEmpty())
    // Scoped variables shadow globals.
    const variables: Record<string, string | undefined> = {}
    for (const [name, provider] of this.layers.global.variables.entries()) {
      variables[name] = provider(context)
    }
    // Scope-chain variables, farthest first, so the nearest scope wins a name.
    for (const layer of scopeLayers) {
      for (const [name, provider] of layer.variables.entries()) {
        variables[name] = provider(context)
      }
    }
    // Scoped sections shadow globals before the deterministic order sort.
    const sectionByName = this.layers.merge(scope, layer => layer.sections)
    const contextByName = this.layers.merge(scope, layer => layer.contexts)
    // Validate order against pre-restriction names while collecting visible schemas.
    const providers = [
      ...this.layers.global.toolProviders.values(),
      ...scopeLayers.flatMap(layer => [...layer.toolProviders.values()]),
    ]
    const collected: ToolSchema[] = []
    const knownNames = new Set<string>()
    for (const provider of providers) {
      const result = provider(context)
      const schemas = result.schemas.map(({ name, description, parameters }): ToolSchema => ({
        name,
        description,
        parameters: structuredClone(parameters),
      }))
      const acceptedKnownNames = result.knownNames ?? schemas.map(tool => tool.name)
      collected.push(...schemas)
      for (const name of acceptedKnownNames) knownNames.add(name)
    }
    const sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections)
    const completeSections = sectionDefinitions.filter(section => section.complete === true)
    if (completeSections.length > 1) {
      throw new Error(`multiple complete prompt sections are active: ${completeSections.map(section => JSON.stringify(section.name)).join(', ')}`)
    }
    let completeSection: AssembledSection | undefined
    const sections = sectionDefinitions
      .map((section) => {
        const assembled = {
          name: section.name,
          text: typeof section.text === 'function' ? section.text(context) : section.text,
        }
        if (section.complete === true) completeSection = { ...assembled }
        return assembled
      })
    const assembly: PromptAssembly = {
      sections,
      contexts: runtimeContextSuppressed
        ? []
        : [...contextByName.values()]
          .sort((a, b) => a.order - b.order)
          .map(entry => ({
            name: entry.name,
            text: typeof entry.text === 'function' ? entry.text(context) : entry.text,
          })),
      tools: orderTools(collected, this.toolOrder, knownNames),
      variables,
    }
    const transformed = await this.ctx.waterfall(
      scopeTarget(this, scope), 'system-prompt/assemble', assembly, context,
      () => Promise.resolve(assembly),
    )
    if (completeSection === undefined && !runtimeContextSuppressed) return transformed
    return {
      ...transformed,
      sections: completeSection === undefined ? transformed.sections : [completeSection],
      contexts: runtimeContextSuppressed ? [] : transformed.contexts,
    }
  }
}

export default SystemPrompt
