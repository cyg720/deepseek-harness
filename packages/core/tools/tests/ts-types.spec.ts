/**
 * 文件职责：验证工具注册与执行的 ts-types.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { jsonSchemaToTs, renderToolsSdk } from '@deepseek-ai/dsh-tools/src/ts-types.ts'
import type { ToolSdkSchema } from '@deepseek-ai/dsh-tools/src/ts-types.ts'
import { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'

describe('jsonSchemaToTs', () => {
  it('maps every unified schema construct', () => {
    /** 中文说明：测试局部值 cases，由紧邻初始化决定。 */
    const cases: [unknown, string][] = [
      [{ type: 'string' }, 'string'],
      [{ type: 'number' }, 'number'],
      [{ type: 'integer' }, 'number'],
      [{ type: 'boolean' }, 'boolean'],
      [{ type: 'null' }, 'null'],
      [{ type: 'string', enum: ['a', 'b'] }, '"a" | "b"'],
      [{ type: 'number', enum: [1, 2] }, '1 | 2'],
      [{ type: 'integer', const: 2 }, '2'],
      [{ type: 'boolean', const: true }, 'true'],
      [{ type: 'null', const: null }, 'null'],
      [{ type: 'string', enum: ['a', 'b'], const: 'a' }, '"a"'],
      [{ oneOf: [{ type: 'string' }, { type: 'null' }] }, 'string | null'],
      [{ type: 'array', items: { type: 'number' } }, 'number[]'],
      [{ type: 'array', items: { type: 'string', enum: ['x', 'y'] } }, '("x" | "y")[]'],
      [{ type: 'array' }, 'JsonValue[]'],
      [{ type: 'object' }, 'Record<string, JsonValue>'],
      [{ type: 'object', additionalProperties: false }, 'Record<string, never>'],
      [{ type: 'object', properties: {} }, 'Record<string, JsonValue>'],
      [{ type: 'object', properties: {}, additionalProperties: false }, 'Record<string, never>'],
      [{
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'integer' }, label: { type: 'string' } },
        required: ['id'],
      }, ['{', '  id: number;', '  label?: string;', '}'].join('\n')],
      [{}, 'JsonValue'],
    ]
    /** 中文说明：测试局部值 [schema，由紧邻初始化决定。 */
    for (const [schema, expected] of cases) {
      expect(jsonSchemaToTs(schema), JSON.stringify(schema)).toBe(expected)
    }
  })

  it('renders objects with required/optional keys, nested shapes, and per-property docs', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = parameterSchemaSpecToJsonSchema({
      path: { type: 'string', required: true, description: 'Absolute file path' },
      limit: { type: 'number' },
      opts: {
        type: 'object',
        additionalProperties: true,
        properties: { deep: { type: 'boolean', required: true } },
      },
    })
    expect(jsonSchemaToTs(schema)).toBe([
      '{',
      '  /** Absolute file path */',
      '  path: string;',
      '  limit?: number;',
      '  opts?: {',
      '    deep: boolean;',
      '  } & Record<string, JsonValue>;',
      '} & Record<string, JsonValue>',
    ].join('\n'))
  })

  it('is total: unsupported or hostile constructs degrade to unknown, never throw', () => {
    /** 中文说明：测试局部值 cases，由紧邻初始化决定。 */
    const cases: unknown[] = [
      undefined,
      null,
      42,
      'string-schema',
      { oneOf: [{ type: 'string' }] },
      { $ref: '#/defs/x' },
      { type: 'object', properties: 7 },
      { type: 'object', properties: { bad: { $ref: 'x' } } },
      { type: 'string', enum: [1, 2] },
      { type: 'string', enum: [] },
    ]
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    for (const schema of cases) {
      expect(() => jsonSchemaToTs(schema), JSON.stringify(schema)).not.toThrow()
    }
    expect(jsonSchemaToTs({ oneOf: [] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: 7 })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: { bad: { $ref: 'x' } }, required: ['bad'] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'string', enum: [1, 2] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'string', enum: [] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: { a: { type: 'string' } }, required: [7] })).toBe('unknown')
    expect(jsonSchemaToTs({ type: 'object', properties: { weird: 42 } })).toBe('unknown')
  })

  it('escapes a comment-closer inside a description so the generated JSDoc cannot end early', () => {
    /** 中文说明：测试局部值 rendered，由紧邻初始化决定。 */
    const rendered = jsonSchemaToTs({
      type: 'object',
      properties: { glob: { type: 'string', description: 'a pattern like packages/*/tool-*/ over here' } },
    })
    expect(rendered).not.toContain('tool-*/ over')
    expect(rendered).toContain(String.raw`tool-*\/ over`)
  })

  it('renders deeply nested unions without using the JavaScript call stack', () => {
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    const depth = 5_000
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    let schema: unknown = { type: 'string' }
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < depth; index++) schema = { oneOf: [schema, { type: 'null' }] }

    /** 中文说明：测试局部值 rendered，由紧邻初始化决定。 */
    const rendered = jsonSchemaToTs(schema)

    expect(rendered.startsWith('string | null')).toBe(true)
    expect(rendered.length).toBe('string'.length + depth * ' | null'.length)
  })
})

describe('renderToolsSdk', () => {
  /** 中文说明：测试局部值 bash，由紧邻初始化决定。 */
  const bash: ToolSdkSchema = {
    name: 'bash',
    description: 'Run a shell command.',
    parameters: parameterSchemaSpecToJsonSchema({ command: { type: 'string', required: true } }) as unknown as Record<string, unknown>,
    output: {
      type: 'object',
      additionalProperties: false,
      properties: { exitCode: { type: 'integer' } },
      required: ['exitCode'],
    },
  }
  /** 中文说明：测试局部值 exotic，由紧邻初始化决定。 */
  const exotic: ToolSdkSchema = {
    name: 'my-mcp.tool',
    description: 'Exotic name.',
    parameters: parameterSchemaSpecToJsonSchema({}) as unknown as Record<string, unknown>,
    output: { type: 'array', items: { type: 'string' } },
  }

  it('declares every tool in lexicographic order with quoted keys for exotic names', () => {
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = renderToolsSdk([exotic, bash])
    expect(text).toContain('interface ToolArgsMap {')
    expect(text).toContain('interface ToolOutputMap {')
    expect(text).toContain('type ToolName = keyof ToolOutputMap')
    expect(text).toContain('declare class ToolCallError extends Error')
    expect(text).toContain('readonly toolName: ToolName;')
    expect(text).toContain('declare const tools: {')
    expect(text).toContain('type JsonValue = null | boolean | number | string')
    expect(text.indexOf('bash: {')).toBeGreaterThan(0)
    expect(text).toContain('"my-mcp.tool":')
    expect(text.indexOf('bash:')).toBeLessThan(text.indexOf('"my-mcp.tool":'))
    expect(text).toContain('exitCode: number;')
    expect(text).toContain('"my-mcp.tool": string[];')
    expect(text).toContain('[K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;')
    expect(text).toContain('/** Run a shell command. */')
    // The fixed instruction lines the model relies on.
    expect(text).toContain('erasable syntax only')
    expect(text).toContain('rejects with `ToolCallError`')
    expect(text).toContain('MAY overlap under `Promise.all`')
    expect(text).toContain('lossless JSON')
  })

  it('names both required call arguments, not just the program', () => {
    // The schema requires `code` AND `description`; instructions that mention
    // only the program let a model emit `{code}` alone and fail INVALID_ARGS.
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = renderToolsSdk([bash])
    expect(text).toContain('`code`')
    expect(text).toContain('`description`')
    expect(text).toContain('two required arguments')
  })

  it('is deterministic: same tool set, byte-identical text regardless of input order', () => {
    expect(renderToolsSdk([bash, exotic])).toBe(renderToolsSdk([exotic, bash]))
    // Equal names sort stably (the comparator's equal arm).
    expect(renderToolsSdk([bash, bash])).toBe(renderToolsSdk([bash, bash]))
  })

  it('renders an empty declaration for an empty tool set', () => {
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = renderToolsSdk([])
    expect(text).toContain('interface ToolArgsMap {}')
    expect(text).toContain('interface ToolOutputMap {}')
  })
})
