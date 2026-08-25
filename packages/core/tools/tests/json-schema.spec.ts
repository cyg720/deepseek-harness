/**
 * 文件职责：验证工具注册与执行的 json-schema.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
  JsonSchemaError,
  validateJsonSchemaValue,
  /** 中文说明：类型或类 JsonSchemaNode 约束服务或测试数据职责。 */
  type JsonSchemaNode,
  /** 中文说明：类型或类 ObjectJsonSchema 约束服务或测试数据职责。 */
  type ObjectJsonSchema,
} from '../src/index.ts'

/** 中文说明：函数 asserted 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function asserted(schema: unknown): JsonSchemaNode {
  assertSupportedJsonSchema(schema)
  return schema
}

/** 中文说明：函数 assertedObject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertedObject(schema: unknown): ObjectJsonSchema {
  assertObjectJsonSchema(schema)
  return schema
}

/** 中文说明：函数 violationsOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function violationsOf(schema: unknown, objectRoot = false): string[] {
  try {
    if (objectRoot) assertObjectJsonSchema(schema)
    else assertSupportedJsonSchema(schema)
  } catch (error: unknown) {
    if (error instanceof JsonSchemaError) return error.violations
    throw error
  }
  throw new Error('expected schema rejection')
}

/** 中文说明：函数 recordWithForgedIntrinsicPrototype 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function recordWithForgedIntrinsicPrototype(
  own: Record<string, unknown>,
  inherited: Record<string, unknown> = {},
  revoked = false,
): Record<string, unknown> {
  /** 中文说明：测试局部值 prototype，由紧邻初始化决定。 */
  const prototype = Object.assign(Object.create(null) as Record<string, unknown>, inherited)
  /** 中文说明：测试局部值 ForgedObject，由紧邻初始化决定。 */
  const ForgedObject = function ForgedObject(): void {}
  Object.defineProperty(ForgedObject, 'name', { value: 'Object' })
  ForgedObject.prototype = prototype
  /** 中文说明：测试局部值 constructor，由紧邻初始化决定。 */
  const constructor = revoked ? Proxy.revocable(ForgedObject, {}) : undefined
  if (constructor !== undefined) constructor.revoke()
  Object.defineProperty(prototype, 'constructor', { value: constructor?.proxy ?? ForgedObject })
  return Object.assign(Object.create(prototype) as Record<string, unknown>, own)
}

describe('the enforced raw JSON Schema subset', () => {
  it('accepts every JSON root and every supported node', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    for (const schema of [
      { type: 'string' },
      { type: 'number' },
      { type: 'integer' },
      { type: 'boolean' },
      { type: 'null' },
      { type: 'array', items: { type: 'string' } },
      {
        type: 'object',
        properties: {
          nested: { type: 'object', properties: {}, additionalProperties: false },
          free: {},
        },
        required: ['nested'],
        additionalProperties: true,
      },
      { oneOf: [{ type: 'string' }, { type: 'number' }] },
      { description: 'any JSON', title: 'JSON', default: null, examples: [1, 'x'] },
    ]) {
      expect(() => { assertSupportedJsonSchema(schema) }, JSON.stringify(schema)).not.toThrow()
    }
  })

  it('retains an object-root guard only at consumers that need it', () => {
    expect(assertedObject({ type: 'object' }).type).toBe('object')
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    for (const schema of [{}, { type: 'string' }, { type: 'array' }, { oneOf: [{ type: 'string' }, { type: 'null' }] }]) {
      expect(violationsOf(schema, true)).toEqual(['schema.type must be "object" (structured output is object-rooted)'])
    }
  })

  it('rejects non-schema nodes, unknown types, and type arrays', () => {
    expect(violationsOf(null)).toEqual(['schema must be a schema object'])
    expect(violationsOf([])).toEqual(['schema must be a schema object'])
    expect(violationsOf('no')).toEqual(['schema must be a schema object'])
    expect(violationsOf({ type: 'tuple' })[0]).toMatch(/type must be one of/)
    expect(violationsOf({ type: ['string', 'null'] }))
      .toEqual(['schema.type must be a single type string (type arrays are not supported)'])
  })

  it('enforces oneOf vocabulary and its minimum branch count', () => {
    expect(violationsOf({ oneOf: [] })).toEqual(['schema.oneOf must be an array of at least two schemas'])
    expect(violationsOf({ oneOf: [{}] })).toEqual(['schema.oneOf must be an array of at least two schemas'])
    expect(violationsOf({ oneOf: 'x' })).toEqual(['schema.oneOf must be an array of at least two schemas'])
    expect(violationsOf({ type: 'string', oneOf: [{}, {}] }))
      .toEqual(['schema cannot declare both type and oneOf'])
    expect(violationsOf({ oneOf: [{ type: 'string' }, { type: 'number' }], items: {} }))
      .toEqual(['schema.items is not supported beside oneOf'])
    expect(violationsOf({ oneOf: [{ type: 'string' }, { type: 'weird' }] })[0])
      .toContain('schema.oneOf[1].type')
    /** 中文说明：测试局部值 sparse，由紧邻初始化决定。 */
    const sparse = new Array<unknown>(2)
    sparse[0] = { type: 'string' }
    expect(violationsOf({ oneOf: sparse }))
      .toEqual(['schema.oneOf must be an array of at least two schemas'])
    /** 中文说明：测试局部值 compensatedSparse，由紧邻初始化决定。 */
    const compensatedSparse = new Array<unknown>(2)
    compensatedSparse[0] = { type: 'string' }
    Object.defineProperty(compensatedSparse, 'extra', { value: true })
    expect(violationsOf({ oneOf: compensatedSparse }))
      .toEqual(['schema.oneOf must be an array of at least two schemas'])
    /** 中文说明：类型或类 ExoticBranches 约束服务或测试数据职责。 */
    class ExoticBranches extends Array<unknown> {}
    expect(violationsOf({ oneOf: new ExoticBranches({ type: 'string' }, { type: 'null' }) }))
      .toEqual(['schema.oneOf must be an array of at least two schemas'])
    /** 中文说明：测试局部值 explosiveArray，由紧邻初始化决定。 */
    const explosiveArray = new Proxy([{ type: 'string' }, { type: 'null' }], {
      getPrototypeOf() { throw new Error('prototype trap') },
    })
    expect(violationsOf({ oneOf: explosiveArray }))
      .toEqual(['schema.oneOf must be an array of at least two schemas'])
  })

  it('rejects unknown and misplaced keywords without accepted-then-ignored behavior', () => {
    /** 中文说明：测试局部值 keyword，由紧邻初始化决定。 */
    for (const keyword of ['anyOf', 'allOf', 'not', 'pattern', 'minimum', 'maxLength', '$ref']) {
      expect(violationsOf({ type: 'object', [keyword]: [] })[0]).toContain(`schema.${keyword} is not a supported keyword`)
    }
    expect(violationsOf({ type: 'object', items: {} }))
      .toEqual(['schema.items is not supported on type "object"'])
    expect(violationsOf({ type: 'array', properties: {} }))
      .toEqual(['schema.properties is not supported on type "array"'])
    expect(violationsOf({ type: 'object', enum: ['x'] }))
      .toEqual(['schema.enum is not supported on type "object"'])
    expect(violationsOf({ type: 'array', const: null }))
      .toEqual(['schema.const is not supported on type "array"'])
    expect(violationsOf({ properties: {}, required: [], additionalProperties: true, items: {}, enum: [], const: null }))
      .toEqual([
        'schema.properties requires type or oneOf',
        'schema.required requires type or oneOf',
        'schema.additionalProperties requires type or oneOf',
        'schema.items requires type or oneOf',
        'schema.enum requires type or oneOf',
        'schema.const requires type or oneOf',
      ])
  })

  it('reports every independent schema violation', () => {
    expect(violationsOf({
      type: 'object',
      pattern: 'x',
      properties: { a: { type: 'weird' }, b: { type: 'string', minimum: 1 } },
    })).toHaveLength(3)
  })

  it('validates object properties, required names, and openness', () => {
    expect(violationsOf({ type: 'object', properties: [] }))
      .toEqual(['schema.properties must be an object of schemas'])
    expect(violationsOf({ type: 'object', properties: { a: 'x' } }))
      .toEqual(['schema.properties.a must be a schema object'])
    expect(violationsOf({ type: 'object', required: 'a' }))
      .toEqual(['schema.required must be an array of strings'])
    expect(violationsOf({ type: 'object', required: [1] }))
      .toEqual(['schema.required must be an array of strings'])
    expect(violationsOf({ type: 'object', properties: {}, required: ['missing'] }))
      .toEqual(['schema.required names "missing" which is not in properties'])
    expect(violationsOf({ type: 'object', additionalProperties: 'yes' }))
      .toEqual(['schema.additionalProperties must be a boolean'])
    expect(violationsOf({ type: 'object', properties: undefined }))
      .toEqual(['schema.properties must be an object of schemas'])
    expect(violationsOf({ type: 'object', properties: undefined, required: ['missing'] }))
      .toEqual([
        'schema.properties must be an object of schemas',
        'schema.required names "missing" which is not in properties',
      ])
    /** 中文说明：测试局部值 sparseRequired，由紧邻初始化决定。 */
    const sparseRequired = new Array<string>(1)
    expect(violationsOf({ type: 'object', required: sparseRequired }))
      .toEqual(['schema.required must be an array of strings'])
  })

  it('requires type-correct scalar enum and const values', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    for (const schema of [
      { type: 'string', enum: ['a'], const: 'a' },
      { type: 'number', enum: [1.5], const: 1.5 },
      { type: 'integer', enum: [1], const: 1 },
      { type: 'boolean', enum: [true], const: true },
      { type: 'null', enum: [null], const: null },
    ]) {
      expect(() => { assertSupportedJsonSchema(schema) }, JSON.stringify(schema)).not.toThrow()
    }

    expect(violationsOf({ type: 'string', enum: [] }))
      .toEqual(['schema.enum must be a non-empty array of string values'])
    expect(violationsOf({ type: 'number', enum: ['1'] }))
      .toEqual(['schema.enum must be a non-empty array of number values'])
    expect(violationsOf({ type: 'integer', enum: [1.5] }))
      .toEqual(['schema.enum must be a non-empty array of integer values'])
    expect(violationsOf({ type: 'number', enum: [Number.NaN] }))
      .toEqual(['schema.enum must be a non-empty array of number values'])
    expect(violationsOf({ type: 'number', const: -0 }))
      .toEqual(['schema.const must be a number value'])
    expect(violationsOf({ type: 'boolean', const: 1 }))
      .toEqual(['schema.const must be a boolean value'])
    expect(violationsOf({ type: 'string', enum: undefined }))
      .toEqual(['schema.enum must be a non-empty array of string values'])
    expect(violationsOf({ type: 'string', enum: ['a'], const: 'b' }))
      .toEqual(['schema.const must be one of schema.enum when both are declared'])
    /** 中文说明：测试局部值 sparseEnum，由紧邻初始化决定。 */
    const sparseEnum = new Array<string>(1)
    expect(violationsOf({ type: 'string', enum: sparseEnum }))
      .toEqual(['schema.enum must be a non-empty array of string values'])
  })

  it('validates annotation types and lossless JSON payloads', () => {
    expect(violationsOf({ description: 1 })).toEqual(['schema.description must be a string'])
    expect(violationsOf({ title: 1 })).toEqual(['schema.title must be a string'])
    /** 中文说明：测试局部值 [key，由紧邻初始化决定。 */
    for (const [key, value] of [
      ['default', undefined],
      ['examples', [undefined]],
      ['default', Number.POSITIVE_INFINITY],
      ['examples', new Date(0)],
    ] as const) {
      expect(violationsOf({ [key]: value })).toEqual([`schema.${key} annotation must be lossless JSON data`])
    }
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(violationsOf({ default: cyclic }))
      .toEqual(['schema.default annotation must be lossless JSON data'])

    /** 中文说明：测试局部值 explosive，由紧邻初始化决定。 */
    const explosive = new Proxy({}, {
      ownKeys() { throw new Error('annotation trap') },
    })
    expect(violationsOf({ examples: explosive }))
      .toEqual(['schema.examples annotation must be lossless JSON data'])
    expect(violationsOf({ default: Object.defineProperty({}, 'hidden', { value: true }) }))
      .toEqual(['schema.default annotation must be lossless JSON data'])
    expect(violationsOf({ default: { [Symbol('hidden')]: true } }))
      .toEqual(['schema.default annotation must be lossless JSON data'])
  })

  it('accepts lossless annotation containers from another JavaScript realm', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = runInNewContext(`({
      type: 'object',
      properties: { value: { type: 'string', enum: ['x'] } },
      required: ['value'],
      default: { x: 1 },
      examples: [[{ ok: true }]],
    })`) as unknown

    expect(() => { assertSupportedJsonSchema(schema) }).not.toThrow()
  })

  it('rejects cyclic/exotic schema structure but permits sibling reuse', () => {
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = { type: 'object' }
    cyclic.properties = { self: cyclic }
    expect(violationsOf(cyclic)).toEqual(['schema.properties.self is circular'])
    /** 中文说明：测试局部值 leaf，由紧邻初始化决定。 */
    const leaf = { type: 'string' }
    expect(() => { assertSupportedJsonSchema({ type: 'object', properties: { a: leaf, b: leaf } }) }).not.toThrow()
    expect(violationsOf({ type: 'object', properties: new Map() }))
      .toEqual(['schema.properties must be an object of schemas'])
    expect(violationsOf({ type: 'object', properties: { at: new Date(0) } }))
      .toEqual(['schema.properties.at must be a schema object'])

    /** 中文说明：测试局部值 forgedSchema，由紧邻初始化决定。 */
    const forgedSchema = recordWithForgedIntrinsicPrototype(
      { type: 'object' },
      { oneOf: [{ type: 'string' }, { type: 'null' }] },
    )
    expect(violationsOf(forgedSchema)).toEqual(['schema must be a schema object'])
    expect(violationsOf(forgedSchema, true)).toEqual(['schema must be a schema object'])
    expect(violationsOf(recordWithForgedIntrinsicPrototype({ type: 'string' }, {}, true)))
      .toEqual(['schema must be a schema object'])
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const prototypeWithoutConstructor = Object.create(null) as object
    expect(violationsOf(Object.create(prototypeWithoutConstructor) as unknown))
      .toEqual(['schema must be a schema object'])
    expect(violationsOf(Object.defineProperty({ type: 'string' }, 'hidden', { value: true })))
      .toEqual(['schema must be a schema object'])
    expect(violationsOf({ type: 'string', [Symbol('hidden')]: true }))
      .toEqual(['schema must be a schema object'])
    expect(violationsOf(new Proxy({}, {
      getPrototypeOf() { throw new Error('prototype trap') },
    }))).toEqual(['schema must be a schema object'])
    expect(violationsOf(new Proxy({}, {
      ownKeys() { throw new Error('keys trap') },
    }))).toEqual(['schema must be a schema object'])
  })

  it('asserts deeply nested raw unions without using the JavaScript call stack', () => {
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    const depth = 5_000
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    let schema: JsonSchemaNode = { type: 'string' }
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < depth; index++) schema = { oneOf: [schema, { type: 'null' }] }

    expect(() => { assertSupportedJsonSchema(schema) }).not.toThrow()
  })

  it('uses own-property semantics for required declarations', () => {
    expect(violationsOf({ type: 'object', properties: {}, required: ['toString'] }))
      .toEqual(['schema.required names "toString" which is not in properties'])
  })
})

describe('validateJsonSchemaValue', () => {
  it('validates scalar, array, object, and null roots', () => {
    expect(validateJsonSchemaValue(asserted({ type: 'string' }), 'x')).toEqual([])
    expect(validateJsonSchemaValue(asserted({ type: 'number' }), 1.5)).toEqual([])
    expect(validateJsonSchemaValue(asserted({ type: 'integer' }), 2)).toEqual([])
    expect(validateJsonSchemaValue(asserted({ type: 'boolean' }), true)).toEqual([])
    expect(validateJsonSchemaValue(asserted({ type: 'null' }), null)).toEqual([])
    expect(validateJsonSchemaValue(asserted({ type: 'array', items: { type: 'string' } }), ['x'])).toEqual([])
    expect(validateJsonSchemaValue(asserted({ type: 'object' }), { x: 1 })).toEqual([])
  })

  it('rejects wrong scalar types and lossy numbers', () => {
    expect(validateJsonSchemaValue(asserted({ type: 'string' }), 1)).toEqual(['"value" must be a string'])
    expect(validateJsonSchemaValue(asserted({ type: 'number' }), '1')).toEqual(['"value" must be a number'])
    expect(validateJsonSchemaValue(asserted({ type: 'number' }), Number.NaN)).toEqual(['"value" must be a finite JSON number'])
    expect(validateJsonSchemaValue(asserted({ type: 'number' }), -0)).toEqual(['"value" must be a finite JSON number'])
    expect(validateJsonSchemaValue(asserted({ type: 'integer' }), 1.5)).toEqual(['"value" must be an integer'])
    expect(validateJsonSchemaValue(asserted({ type: 'boolean' }), 'true')).toEqual(['"value" must be a boolean'])
    expect(validateJsonSchemaValue(asserted({ type: 'null' }), 0)).toEqual(['"value" must be null'])
  })

  it('enforces scalar enum and const together', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = asserted({ type: 'string', enum: ['a', 'b'], const: 'a' })
    expect(validateJsonSchemaValue(schema, 'a')).toEqual([])
    expect(validateJsonSchemaValue(schema, 'c')).toEqual(['"value" must be one of ["a","b"]'])
    expect(validateJsonSchemaValue(schema, 'b')).toEqual(['"value" must be "a"'])
  })

  it('validates object requiredness, nested values, and raw open defaults', () => {
    /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
    const open = asserted({
      type: 'object',
      properties: {
        file: { type: 'string' },
        nested: {
          type: 'object',
          properties: { line: { type: 'integer' } },
          required: ['line'],
          additionalProperties: false,
        },
      },
      required: ['file'],
    })
    expect(validateJsonSchemaValue(open, { file: 'a', extra: [1], nested: { line: 2 } })).toEqual([])
    expect(validateJsonSchemaValue(open, { nested: { line: 1 } }))
      .toEqual(['missing required property "value.file"'])
    expect(validateJsonSchemaValue(open, { file: 1, nested: {} })).toEqual([
      '"value.file" must be a string',
      'missing required property "value.nested.line"',
    ])
    expect(validateJsonSchemaValue(open, { file: 'a', nested: { line: 1, extra: true } }))
      .toEqual(['"value.nested.extra" is not a declared property (additionalProperties: false)'])
    expect(validateJsonSchemaValue(open, 'x')).toEqual(['"value" must be an object'])
  })

  it('treats present undefined as missing when required, then rejects other lossy objects', () => {
    /** 中文说明：测试局部值 required，由紧邻初始化决定。 */
    const required = asserted({ type: 'object', properties: { x: {} }, required: ['x'] })
    expect(validateJsonSchemaValue(required, { x: undefined }))
      .toEqual(['missing required property "value.x"'])
    expect(validateJsonSchemaValue(asserted({ type: 'object' }), { x: undefined }))
      .toEqual(['"value" must be a lossless JSON object'])
    expect(validateJsonSchemaValue(asserted({ type: 'object' }), new Date(0)))
      .toEqual(['"value" must be an object'])
  })

  it('returns a violation instead of throwing for a container with a hostile getter', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = Object.defineProperty({}, 'answer', {
      enumerable: true,
      get() { throw new Error('getter exploded') },
    })
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = asserted({
      type: 'object',
      properties: { answer: { type: 'integer' } },
      required: ['answer'],
    })

    expect(validateJsonSchemaValue(schema, value))
      .toEqual(['"value" must be a lossless JSON value'])
  })

  it('validates dense arrays per index and rejects lossy arrays', () => {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = asserted({ type: 'array', items: { type: 'integer' } })
    expect(validateJsonSchemaValue(schema, [1, 2])).toEqual([])
    expect(validateJsonSchemaValue(schema, runInNewContext('[1, 2]'))).toEqual([])
    expect(validateJsonSchemaValue(schema, [1, 1.5])).toEqual(['"value[1]" must be an integer'])
    expect(validateJsonSchemaValue(schema, 'x')).toEqual(['"value" must be an array'])
    /** 中文说明：测试局部值 sparse，由紧邻初始化决定。 */
    const sparse: number[] = []
    sparse.length = 2
    sparse[0] = 1
    expect(validateJsonSchemaValue(schema, sparse)).toEqual(['"value" must be a dense lossless JSON array'])
  })

  it('validates exact-one oneOf semantics, including overlap', () => {
    /** 中文说明：测试局部值 disjoint，由紧邻初始化决定。 */
    const disjoint = asserted({ oneOf: [{ type: 'string' }, { type: 'number' }] })
    expect(validateJsonSchemaValue(disjoint, 'x')).toEqual([])
    expect(validateJsonSchemaValue(disjoint, null))
      .toEqual(['"value" must match exactly one oneOf branch (matched 0)'])
    /** 中文说明：测试局部值 overlap，由紧邻初始化决定。 */
    const overlap = asserted({ oneOf: [{ type: 'number' }, { type: 'integer' }] })
    expect(validateJsonSchemaValue(overlap, 1))
      .toEqual(['"value" must match exactly one oneOf branch (matched 2)'])
    expect(validateJsonSchemaValue(overlap, 1.5)).toEqual([])
  })

  it('validates deeply nested exact-one unions without using the JavaScript call stack', () => {
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    const depth = 5_000
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    let schema: JsonSchemaNode = { type: 'string' }
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < depth; index++) schema = { oneOf: [schema, { type: 'null' }] }
    assertSupportedJsonSchema(schema)

    expect(validateJsonSchemaValue(schema, 'leaf')).toEqual([])
    expect(validateJsonSchemaValue(schema, 42))
      .toEqual(['"value" must match exactly one oneOf branch (matched 0)'])
  })

  it('an unconstrained schema accepts only lossless JSON values', () => {
    /** 中文说明：测试局部值 anyJson，由紧邻初始化决定。 */
    const anyJson = asserted({})
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [null, true, 1, 'x', [1], { x: null }]) {
      expect(validateJsonSchemaValue(anyJson, value), JSON.stringify(value)).toEqual([])
    }
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [undefined, () => 1, Number.POSITIVE_INFINITY, -0, new Map()]) {
      expect(validateJsonSchemaValue(anyJson, value)).toEqual(['"value" must be a lossless JSON value'])
    }
    /** 中文说明：测试局部值 cyclic，由紧邻初始化决定。 */
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(validateJsonSchemaValue(anyJson, cyclic)).toEqual(['"value" must be a lossless JSON value'])
    /** 中文说明：测试局部值 explosive，由紧邻初始化决定。 */
    const explosive = new Proxy({}, {
      ownKeys() { throw new Error('value trap') },
    })
    expect(validateJsonSchemaValue(anyJson, explosive)).toEqual(['"value" must be a lossless JSON value'])
  })

  it('uses own properties for requiredness, recursion, and closed-object checks', () => {
    expect(validateJsonSchemaValue(
      asserted({ type: 'object', properties: { toString: { type: 'string' } }, required: ['toString'] }),
      {},
    )).toEqual(['missing required property "value.toString"'])
    expect(validateJsonSchemaValue(asserted({ type: 'object', additionalProperties: false }), { toString: 1 }))
      .toEqual(['"value.toString" is not a declared property (additionalProperties: false)'])
    expect(validateJsonSchemaValue(
      asserted({ type: 'object', properties: { constructor: { type: 'string' } } }),
      {},
    )).toEqual([])

    /** 中文说明：测试局部值 inheritedUnion，由紧邻初始化决定。 */
    const inheritedUnion = Object.assign(
      Object.create({ oneOf: [{ type: 'string' }, { type: 'null' }] }) as JsonSchemaNode,
      { type: 'object' as const },
    )
    expect(validateJsonSchemaValue(inheritedUnion, {})).toEqual([])
    expect(validateJsonSchemaValue(inheritedUnion, 'x')).toEqual(['"value" must be an object'])
    expect(validateJsonSchemaValue(
      { type: 'object', properties: undefined } as unknown as JsonSchemaNode,
      {},
    )).toEqual([])
    expect(validateJsonSchemaValue(
      { type: 'object', required: undefined } as unknown as JsonSchemaNode,
      {},
    )).toEqual([])
  })

  it('keeps assertNever as a forged-schema backstop', () => {
    /** 中文说明：测试局部值 forged，由紧邻初始化决定。 */
    const forged = { type: 'tuple' } as unknown as JsonSchemaNode
    expect(() => validateJsonSchemaValue(forged, 1)).toThrow(/tuple/)
  })
})
