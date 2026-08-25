/*
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的 lsp 工具插件：在 ctx.lsp 之上注册一个只读工具，提供四种操作（跳转定义、查找引用、跳转实现、悬停）；负责一基→零基坐标转换、会话工作区获取、结果封顶与渲染、超时预算配置。命名空间插件。
 * 【技术维度】基于 dsh-tools 的 defineTool 定义工具（含 JSON Schema 参数与输出声明、render 渲染器）；schemastery 校验配置；仅运行时注入 tools、lsp、systemPrompt 三个服务，不引入任何提供者。
 * 【产品维度】模型获得"精确代码导航"能力：当文本搜索匹配含糊、或改动前需要精确的定义、实现、引用时调用 lsp 工具；system-prompt 引导其使用时机。
 * 【逻辑维度】re-export 渲染工具 → 插件名与依赖注入 → 默认常量与提示文本 → 配置类型与校验 → 输出 schema 常量 → apply（校验配置、注册 prompt 段落、注册工具：参数声明、输出渲染、超时、execute 执行）→ 配置校验辅助。
 * 【关键边界】坐标一基（模型）与零基（缝/协议）在工具层转换；无工作区 cwd 时抛 LSP_WORKSPACE_REQUIRED
 *   （无回退）；结果按 maxLocations/maxResultChars 封顶；timeoutMs 不超过 MAX_TIMER_DELAY_MS。
 * 【新手阅读建议】先读 apply 的 execute 看一次工具调用如何把参数转成 ctx.lsp.query，再对照 render.ts 理解结果如何呈现。
 * ==========================================================================
 */
/**
 * Model-facing `lsp` tool over `ctx.lsp`. One read-only tool with four operations
 * (`goToDefinition`/`findReferences`/`goToImplementation`/`hover`); it converts one-based UTF-16
 * cursor coordinates to the seam's zero-based positions, requires the session workspace with no
 * fallback, caps and renders results, and attaches a configurable timeout budget for
 * `dsh-tool-call-timeout-policy` to enforce. It runtime-injects only `tools`, `lsp`, and `systemPrompt` and
 * imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-lsp
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { LspError } from '@deepseek-ai/dsh-lsp'
import type {} from '@deepseek-ai/dsh-lsp'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
} from './render.ts'
import { sessionCwd } from './session-cwd.ts'

export {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
  renderUri,
} from './render.ts'
export { sessionCwd } from './session-cwd.ts'

/** Cordis plugin name for loader diagnostics. */
// 插件名：供加载器诊断使用。
export const name = 'tool-lsp'

/** Services required by this plugin. */
// 依赖注入声明：需要 tools、lsp、systemPrompt 三个服务。
export const inject = ['tools', 'lsp', 'systemPrompt']

/** Default tool-call timeout budget (ms), covering the queued open/query/close lifecycle. */
// 默认工具调用超时预算（毫秒）：覆盖"排队打开→查询→关闭"的完整生命周期。
export const DEFAULT_LSP_TOOL_TIMEOUT_MS = 60_000

/** The stable system-prompt guidance positioning LSP as a precision aid. */
// 稳定的 system-prompt 引导文本：把 lsp 定位为"精确导航辅助"，说明一基坐标约定与 findReferences 语义。
export const LSP_PROMPT_TEXT =
  'Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration.'

/** Plugin configuration: result caps and the timeout budget. */
// 插件配置：结果封顶与超时预算。
export interface Config {
  /** Largest number of rendered locations before an omission marker (default 100). */
  // 渲染位置数上限，超出加省略标记（默认 100）。
  maxLocations?: number
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  // 完整渲染结果的字符上限（含截断元信息，默认 16000）。
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 60000). */
  // 工具调用超时预算（毫秒，默认 60000）。
  timeoutMs?: number
}

// 配置校验器：填默认值；timeoutMs 不得超过 MAX_TIMER_DELAY_MS。
export const Config: z<Config> = z.object({
  maxLocations: z.number().default(DEFAULT_MAX_LOCATIONS),
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_LSP_TOOL_TIMEOUT_MS),
})

// schemastery 填默认值后的必填配置形状。
type ResolvedConfig = Required<Config>

// 输出 schema 中"位置"的 JSON Schema 片段。
const LSP_POSITION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer', required: true },
    character: { type: 'integer', required: true },
  },
} as const

// 输出 schema 中"范围"的 JSON Schema 片段（复用位置片段）。
const LSP_RANGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    start: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
    end: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
  },
} as const

/**
 * Register the `lsp` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `lsp`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
// 插件装配：校验配置 → 注册 system-prompt 段落 → 注册 lsp 工具（参数与输出 schema、渲染器、超时、execute 执行）。
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  // 配置值在加载时校验，错误配置大声失败。
  assertPositiveInteger('maxLocations', resolved.maxLocations)
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)

  // 注册"何时使用 lsp"的引导段落。
  ctx.systemPrompt.section({ name: 'tool:lsp', order: 112, text: LSP_PROMPT_TEXT })

  ctx.tools.register(defineTool({
    name: 'lsp',
    description:
      'Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration.',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: [...LSP_OPERATIONS],
        description: 'goToDefinition, findReferences, goToImplementation, or hover.',
      },
      file_path: { type: 'string', required: true, description: 'The source file to query, relative to the workspace or absolute.' },
      line: { type: 'number', required: true, description: 'One-based line of the cursor.' },
      character: { type: 'number', required: true, description: 'One-based UTF-16 column of the cursor.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'locations' },
              locations: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    uri: { type: 'string', required: true },
                    range: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
                  },
                },
              },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'hover' },
              hover: {
                required: true,
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      contents: { type: 'string', required: true },
                      range: LSP_RANGE_OUTPUT_SCHEMA,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      render: (_args, value) => {
        // 按结果类型选择渲染器：locations 用 formatLocations，hover 用 formatHover。
        switch (value.kind) {
          case 'locations':
            return [{ type: 'text', text: formatLocations(value.locations, value.resolvedWorkspaceUri, resolved.maxLocations, resolved.maxResultChars) }]
          case 'hover':
            return [{ type: 'text', text: formatHover(value.hover, resolved.maxResultChars) }]
          /* v8 ignore next -- exhaustive over the output schema's closed union; unreachable. */
          default:
            return assertNever(value, 'tool-lsp output')
        }
      },
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      // 校验并转换模型参数（一基→零基）。
      const input = parseLspArgs(args)
      // 获取会话工作区 cwd；缺失时直接失败（lsp 无提供者回退）。
      const workspaceRoot = sessionCwd(exec)
      if (workspaceRoot === undefined) {
        throw new LspError('the lsp tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      // 调用缝执行查询，取消信号透传给提供者。
      const result = await ctx.lsp.query({
        operation: input.operation,
        filePath: input.filePath,
        position: input.position,
        workspaceRoot,
      }, exec.signal)
      // 把缝的规范化结果按输出 schema 展开成原始形状。
      switch (result.kind) {
        case 'locations':
          return {
            kind: 'locations' as const,
            locations: result.locations.map(location => ({
              uri: location.uri,
              range: {
                start: { line: location.range.start.line, character: location.range.start.character },
                end: { line: location.range.end.line, character: location.range.end.character },
              },
            })),
            resolvedWorkspaceUri: result.resolvedWorkspaceUri,
          }
        case 'hover':
          return {
            kind: 'hover' as const,
            hover: result.hover === null
              ? null
              : {
                contents: result.hover.contents,
                ...result.hover.range === undefined
                  ? {}
                  : {
                    range: {
                      start: { line: result.hover.range.start.line, character: result.hover.range.start.character },
                      end: { line: result.hover.range.end.line, character: result.hover.range.end.character },
                    },
                  },
              },
          }
        /* v8 ignore next -- exhaustive over the closed LspQueryResult union; unreachable. */
        default:
          return assertNever(result, 'tool-lsp result')
      }
    },
    presentCall: presentLspCall,
  }))
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
// 在加载时拒绝非正整数配置值，让错误配置大声失败。
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-lsp: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
// 拒绝 Node 会"钳制"而非按配置调度的定时器值（必须为正整数且不超过 MAX_TIMER_DELAY_MS）。
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-lsp: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
