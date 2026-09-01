/** Canonical tool-definition fixtures for repository tests. @module dsh-tools/testing */

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

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from './schema.ts'
import type { DefineToolOptions, ParameterSchemaSpec } from './schema.ts'
import type { ToolDefinition, ToolRunContext } from './index.ts'

const CONTENT_VALUE_SCHEMA = { type: 'array', items: { type: 'json' } } as const

/** Options for a fixture whose canonical value is its rendered content array. */
export type ContentToolFixtureOptions<S extends ParameterSchemaSpec> = Omit<
  DefineToolOptions<S, typeof CONTENT_VALUE_SCHEMA>,
  'output' | 'execute'
> & {
  /** Produce the fixture's content blocks as its canonical test value. */
  execute(args: import('./schema.ts').InferArgs<S>, exec: ToolRunContext): Promise<ContentBlock[]>
}

/**
 * Define a test fixture that deliberately uses its content blocks as the
 * canonical JSON value. Product tools must declare domain-owned DTOs instead.
 * @param options - ordinary fixture fields plus a content-producing body.
 * @returns a registry-ready tool with an explicit JSON-array output contract.
 * @internal
 */
export function defineContentToolFixture<const S extends ParameterSchemaSpec>(
  options: ContentToolFixtureOptions<S>,
): ToolDefinition {
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
