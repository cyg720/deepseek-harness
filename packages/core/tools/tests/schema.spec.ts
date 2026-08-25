/**
 * 文件职责：验证工具注册与执行的 schema.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  JsonSchemaError,
  parameterSchemaSpecToJsonSchema,
  valueSchemaSpecToJsonSchema,
  /** 中文说明：类型或类 InferArgs 约束服务或测试数据职责。 */
  type InferArgs,
  /** 中文说明：类型或类 InferValue 约束服务或测试数据职责。 */
  type InferValue,
  /** 中文说明：类型或类 JsonValue 约束服务或测试数据职责。 */
  type JsonValue,
  /** 中文说明：类型或类 ParameterSchemaSpec 约束服务或测试数据职责。 */
  type ParameterSchemaSpec,
  /** 中文说明：类型或类 ValueSchemaSpec 约束服务或测试数据职责。 */
  type ValueSchemaSpec,
} from '../src/index.ts'

describe('the unified author schema DSL', () => {
  it('compiles every value root and the author-only json node', () => {
    expect(valueSchemaSpecToJsonSchema({ type: 'string', enum: ['a', 'b'], const: 'a' }))
      .toEqual({ type: 'string', enum: ['a', 'b'], const: 'a' })
    expect(valueSchemaSpecToJsonSchema({ type: 'number' })).toEqual({ type: 'number' })
    expect(valueSchemaSpecToJsonSchema({ type: 'integer' })).toEqual({ type: 'integer' })
    expect(valueSchemaSpecToJsonSchema({ type: 'boolean' })).toEqual({ type: 'boolean' })
    expect(valueSchemaSpecToJsonSchema({ type: 'null' })).toEqual({ type: 'null' })
    expect(valueSchemaSpecToJsonSchema({ type: 'array', items: { type: 'json' } }))
      .toEqual({ type: 'array', items: {} })
    expect(valueSchemaSpecToJsonSchema({ type: 'object', additionalProperties: false, properties: {} }))
      .toEqual({ type: 'object', additionalProperties: false, properties: {} })
    expect(valueSchemaSpecToJsonSchema({
      type: 'json',
      description: 'anything',
      title: 'Any JSON',
      default: null,
      examples: [{ nested: true }],
    })).toEqual({ description: 'anything', title: 'Any JSON', default: null, examples: [{ nested: true }] })
    expect(valueSchemaSpecToJsonSchema({ oneOf: [{ type: 'string' }, { type: 'null' }] }))
      .toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }] })
  })

  it('keeps the implicit parameter root open while preserving explicit object openness', () => {
    expect(parameterSchemaSpecToJsonSchema({
      closed: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: { id: { type: 'integer', required: true } },
      },
      open: { type: 'object', additionalProperties: true },
    })).toEqual({
      type: 'object',
      properties: {
        closed: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'integer' } },
          required: ['id'],
        },
        open: { type: 'object', additionalProperties: true },
      },
      required: ['closed'],
    })
  })

  it('rejects runtime-forged author forms rather than compiling them lossily', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    for (const schema of [
      { type: 'object' },
      { oneOf: [{ type: 'string' }] },
      { type: 'number', enum: ['1'] },
      { type: 'string', enum: ['a'], const: 'b' },
      { type: 'integer', const: 1.5 },
      { type: 'json', default: undefined },
      { type: 'array', items: { type: 'string', required: true } },
      { type: 'array', items: 42 },
      { type: 'string', extra: true },
      { type: 'string', oneOf: [{ type: 'string' }, { type: 'null' }] },
      { oneOf: 'not-an-array' },
      { type: 'string', enum: 'a' },
      {},
      null,
    ]) {
      expect(() => valueSchemaSpecToJsonSchema(schema as ValueSchemaSpec), JSON.stringify(schema)).toThrow(JsonSchemaError)
    }
    expect(() => parameterSchemaSpecToJsonSchema({
      value: { type: 'string', required: false },
    } as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    expect(() => parameterSchemaSpecToJsonSchema(null as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    expect(() => parameterSchemaSpecToJsonSchema({ bad: 42 } as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)

    /** 中文说明：测试局部值 symbolKey，由紧邻初始化决定。 */
    const symbolKey = Symbol('hidden')
    expect(() => parameterSchemaSpecToJsonSchema({
      value: { type: 'string' },
      [symbolKey]: { type: 'number' },
    } as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    /** 中文说明：测试局部值 hiddenKey，由紧邻初始化决定。 */
    const hiddenKey = Object.defineProperty({ value: { type: 'string' } }, 'hidden', {
      value: { type: 'number' },
    })
    expect(() => parameterSchemaSpecToJsonSchema(hiddenKey as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    /** 中文说明：测试局部值 sparseOneOf，由紧邻初始化决定。 */
    const sparseOneOf = new Array<ValueSchemaSpec>(2)
    sparseOneOf[0] = { type: 'string' }
    expect(() => valueSchemaSpecToJsonSchema({ oneOf: sparseOneOf } as unknown as ValueSchemaSpec)).toThrow(JsonSchemaError)
    /** 中文说明：测试局部值 decoratedEnum，由紧邻初始化决定。 */
    const decoratedEnum = Object.assign(['a'], { hidden: true })
    expect(() => valueSchemaSpecToJsonSchema({
      type: 'string',
      enum: decoratedEnum,
    })).toThrow(JsonSchemaError)
  })

  it('rejects cyclic author schemas', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema: Record<string, unknown> = { type: 'array' }
    schema.items = schema
    expect(() => valueSchemaSpecToJsonSchema(schema as unknown as ValueSchemaSpec)).toThrow(/circular/)

    /** 中文说明：测试局部值 properties，由紧邻初始化决定。 */
    const properties: Record<string, unknown> = {}
    properties.self = { type: 'object', additionalProperties: true, properties }
    expect(() => parameterSchemaSpecToJsonSchema(properties as ParameterSchemaSpec)).toThrow(/circular/)
  })

  it('compiles deeply nested author unions without using the JavaScript call stack', () => {
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    const depth = 5_000
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    let spec: unknown = { type: 'string' }
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < depth; index++) spec = { oneOf: [spec, { type: 'null' }] }

    /** 中文说明：测试局部值 compiled，由紧邻初始化决定。 */
    const compiled = valueSchemaSpecToJsonSchema(spec as ValueSchemaSpec)

    /** 中文说明：测试局部值 cursor，由紧邻初始化决定。 */
    let cursor = compiled
    /** 中文说明：测试局部值 layers，由紧邻初始化决定。 */
    let layers = 0
    while (cursor.oneOf !== undefined) {
      cursor = cursor.oneOf[0]!
      layers++
    }
    expect(layers).toBe(depth)
    expect(cursor).toEqual({ type: 'string' })
  })

  it('preserves a property literally named __proto__ as schema data', () => {
    /** 中文说明：测试局部值 properties，由紧邻初始化决定。 */
    const properties = Object.create(null) as ParameterSchemaSpec
    properties.__proto__ = { type: 'string', required: true }

    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = parameterSchemaSpecToJsonSchema(properties)

    expect(Object.hasOwn(schema.properties, '__proto__')).toBe(true)
    expect(schema.properties.__proto__).toEqual({ type: 'string' })
    expect(schema.required).toEqual(['__proto__'])
  })

  it('infers scalar literals, arrays, objects, json, and exact-one unions', () => {
    expectTypeOf<InferValue<{ type: 'string'; enum: readonly ['a', 'b'] }>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<InferValue<{ type: 'number'; const: 1 }>>().toEqualTypeOf<1>()
    expectTypeOf<InferValue<{ type: 'integer' }>>().toEqualTypeOf<number>()
    expectTypeOf<InferValue<{ type: 'boolean'; enum: readonly [true] }>>().toEqualTypeOf<true>()
    expectTypeOf<InferValue<{ type: 'null' }>>().toEqualTypeOf<null>()
    expectTypeOf<InferValue<{ type: 'array'; items: { type: 'string' } }>>().toEqualTypeOf<string[]>()
    expectTypeOf<InferValue<{ type: 'array' }>>().toEqualTypeOf<JsonValue[]>()
    expectTypeOf<InferValue<{ type: 'json' }>>().toEqualTypeOf<JsonValue>()
    expectTypeOf<InferValue<{ oneOf: readonly [{ type: 'string' }, { type: 'null' }] }>>()
      .toEqualTypeOf<string | null>()
    expectTypeOf<InferValue<{
      type: 'object'
      additionalProperties: false
      properties: { id: { type: 'integer'; required: true }; label: { type: 'string' } }
    }>>().toEqualTypeOf<{ id: number; label?: string }>()
    expectTypeOf<InferValue<{
      type: 'object'
      additionalProperties: true
      properties: { id: { type: 'integer'; required: true } }
    }>>().toEqualTypeOf<{ id: number } & Record<string, JsonValue>>()
  })

  it('bounds inference for deeply nested author schemas', () => {
    /** 中文说明：类型或类 Repeat 约束服务或测试数据职责。 */
    type Repeat<Count extends number, Result extends unknown[] = []> =
      Result['length'] extends Count ? Result : Repeat<Count, [unknown, ...Result]>
    /** 中文说明：类型或类 DeepArraySchema 约束服务或测试数据职责。 */
    type DeepArraySchema<Levels extends unknown[]> =
      Levels extends [unknown, ...infer Rest]
        ? { type: 'array'; items: DeepArraySchema<Rest> }
        : { type: 'string' }
    /** 中文说明：类型或类 PeelArrays 约束服务或测试数据职责。 */
    type PeelArrays<Value, Levels extends unknown[]> =
      Levels extends [unknown, ...infer Rest]
        ? Value extends (infer Item)[] ? PeelArrays<Item, Rest> : never
        : Value

    /** 中文说明：类型或类 DeepValue 约束服务或测试数据职责。 */
    type DeepValue = InferValue<DeepArraySchema<Repeat<50>>>
    expectTypeOf<PeelArrays<DeepValue, Repeat<16>>>().toEqualTypeOf<JsonValue>()
  })

  it('infers required and optional parameter keys', () => {
    expectTypeOf<InferArgs<{
      path: { type: 'string'; required: true }
      offset: { type: 'integer' }
      data: { type: 'json' }
    }>>().toEqualTypeOf<{ path: string; offset?: number; data?: JsonValue }>()
  })

  it('makes invalid author forms compile-time errors', () => {
    /** 中文说明：测试局部值 symbolKey，由紧邻初始化决定。 */
    const symbolKey = Symbol('parameter')
    /** 中文说明：测试局部值 invalidObjects，由紧邻初始化决定。 */
    const invalidObjects = {
      // @ts-expect-error explicit object schemas require an openness decision
      object: { type: 'object' } satisfies ValueSchemaSpec,
      // @ts-expect-error oneOf requires at least two branches
      oneOf: { oneOf: [{ type: 'string' }] } satisfies ValueSchemaSpec,
      // @ts-expect-error scalar enum values must match the node type
      enum: { type: 'number', enum: ['1'] } satisfies ValueSchemaSpec,
      // @ts-expect-error parameter requiredness is true-or-absent
      required: { value: { type: 'string', required: false } } satisfies ParameterSchemaSpec,
      // @ts-expect-error parameter maps accept string keys only
      symbol: { [symbolKey]: { type: 'string' } } satisfies ParameterSchemaSpec,
    }
    expect(Object.keys(invalidObjects)).toHaveLength(5)
  })
})
