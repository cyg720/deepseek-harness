/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供仓库测试专用的工具定义夹具（fixture）：一个"把内容块数组直接当作
 *   规范输出值"的快捷 defineTool 包装，省去测试里重复声明 output 契约的样板。
 * 【技术维度】基于 schema.ts 的 defineTool 与其 ValueSchemaSpec DSL 做类型级包装
 *   （Omit + 泛型透传），运行时只是组装一个普通 ToolDefinition。
 * 【产品维度】不面向产品：仅服务于仓库内测试，让测试工具的输出契约一行搞定。
 * 【逻辑维度】固定输出 schema（字符串数组、项为任意无损 JSON）→ 恒等 render（透传）
 *   → 包装 execute 让返回的内容块数组成为规范值。
 * 【关键边界】@internal：产品工具必须声明领域自有的 DTO 输出契约，禁止模仿此捷径。
 * 【新手阅读建议】先看 CONTENT_VALUE_SCHEMA 的形状，再对照 defineTool 的签名理解
 *   ContentToolFixtureOptions 为何要 Omit 掉 output 与 execute。
 * ==========================================================================
 */

/** Canonical tool-definition fixtures for repository tests. @module dsh-tools/testing */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from './schema.ts'
import type { DefineToolOptions, ParameterSchemaSpec } from './schema.ts'
import type { ToolDefinition, ToolRunContext } from './index.ts'

/**
 * 【中文】夹具固定的输出契约：数组、每项为 `type: 'json'`（任意无损 JSON 值）。
 *   即"渲染用的内容块数组本身"被当作规范输出值；`as const` 让 defineTool 能从
 *   字面量推断出精确类型。产品工具不应模仿——应声明领域自有 DTO。
 */
const CONTENT_VALUE_SCHEMA = { type: 'array', items: { type: 'json' } } as const

/** Options for a fixture whose canonical value is its rendered content array. */
/**
 * 【中文】"以内容块数组充当规范输出值"的夹具选项类型：继承 DefineToolOptions 但
 *   剔除 output 与 execute——前者被固定为 CONTENT_VALUE_SCHEMA，后者在本类型中
 *   重新声明为直接返回 ContentBlock[] 的简化形态。
 */
export type ContentToolFixtureOptions<S extends ParameterSchemaSpec> = Omit<
  DefineToolOptions<S, typeof CONTENT_VALUE_SCHEMA>,
  'output' | 'execute'
> & {
  /** Produce the fixture's content blocks as its canonical test value. */
  /** 【中文】夹具函数体：返回的内容块数组会原样成为该工具的规范输出值。 */
  execute(args: import('./schema.ts').InferArgs<S>, exec: ToolRunContext): Promise<ContentBlock[]>
}

/**
 * Define a test fixture that deliberately uses its content blocks as the
 * canonical JSON value. Product tools must declare domain-owned DTOs instead.
 * @param options - ordinary fixture fields plus a content-producing body.
 * @returns a registry-ready tool with an explicit JSON-array output contract.
 * @internal
 */
/**
 * 【中文】定义一个"内容即输出"的测试夹具工具。做法：展开调用方的 options，注入
 *   固定的 output.schema（CONTENT_VALUE_SCHEMA）与恒等 render（内容块数组直接透传），
 *   再包装 execute 使其返回值被断言为规范 JSON 值数组。仅供仓库测试使用；
 *   产品工具请用 defineTool 声明领域化的输出 DTO。
 * @param options - 夹具常规字段（name/description/parameters 等）加一个返回内容块的 execute。
 * @returns 一个可直接注册进 ToolRuntime 的 ToolDefinition。
 * @returns 使用示例：defineContentToolFixture({ name: 'echo', description: '…',
 *   parameters: { text: { type: 'string', required: true } },
 *   execute: async (args) => [{ type: 'text', text: args.text }] })
 */
export function defineContentToolFixture<const S extends ParameterSchemaSpec>(
  options: ContentToolFixtureOptions<S>,
): ToolDefinition {
  // 【中文】先把用户的 execute 解构出来再放进下方对象字面量：方法引用脱离对象后不依赖 this，展开安全。
  // oxlint-disable-next-line typescript/unbound-method
  const execute = options.execute
  return defineTool({
    ...options,
    output: {
      schema: CONTENT_VALUE_SCHEMA,
      render: (_args, value) => value as unknown as ContentBlock[],
    },
    async execute(args, exec) {
      return await execute(args, exec) as unknown as JsonValue[]
    },
  })
}
