/**
 * Property-based tests for the tool-schema DSL (the property-testing Agent Note), including
 * the property-testing ↔ runtime-validation composition: generated args that satisfy a ParameterSchemaSpec must
 * pass validateArgs, and targeted corruptions must be rejected. This closes the
 * validator/InferArgs drift risk noted in the arg-validation Agent Note.
 */
/**
 * 文件职责：验证当前模块的关键行为与边界场景（properties.spec.ts）。
 * 技术维度：TypeScript、Vitest、属性测试或可控测试替身。
 * 产品维度：防止用户可见流程在重构后发生回归。
 * 逻辑维度：构造输入，调用被测模块，再断言结果或错误。
 * 关键边界：随机数据必须可复现，异步资源必须及时释放。
 * 新手阅读建议：先读辅助函数，再按 describe/it 阅读核心与异常场景。
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { isJsonValue } from '@deepseek-ai/dsh-session'
import { parameterSchemaSpecToJsonSchema, validateArgs } from '@deepseek-ai/dsh-tools'
import type { ParameterPropertySpec, ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Remove parameter-only requiredness before nesting a schema as an array item. */
/** 中文说明：函数 asValueSchema 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function asValueSchema(prop: ParameterPropertySpec): ValueSchemaSpec {
  const { required: _required, ...schema } = prop
  return schema
}

// A leaf prop arbitrary (no nesting) with optional required/enum.
/** 中文说明：函数 leafPropArb 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function leafPropArb(): fc.Arbitrary<ParameterPropertySpec> {
  return fc.oneof(
    fc.record({ required: fc.boolean() }).map(({ required }): ParameterPropertySpec => ({ type: 'string', ...required ? { required: true } : {} })),
    fc.record({ required: fc.boolean() }).map(({ required }): ParameterPropertySpec => ({ type: 'number', ...required ? { required: true } : {} })),
    fc.record({ required: fc.boolean() }).map(({ required }): ParameterPropertySpec => ({ type: 'integer', ...required ? { required: true } : {} })),
    fc.record({ required: fc.boolean() }).map(({ required }): ParameterPropertySpec => ({ type: 'boolean', ...required ? { required: true } : {} })),
    fc.record({ required: fc.boolean() }).map(({ required }): ParameterPropertySpec => ({ type: 'null', ...required ? { required: true } : {} })),
    fc.record({ required: fc.boolean() }).map(({ required }): ParameterPropertySpec => ({ type: 'json', ...required ? { required: true } : {} })),
    fc.record({ values: fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }), required: fc.boolean() })
      .map(({ values, required }): ParameterPropertySpec => ({ type: 'string', enum: values, ...required ? { required: true } : {} })),
    fc.record({ value: fc.string(), required: fc.boolean() })
      .map(({ value, required }): ParameterPropertySpec => ({ type: 'string', const: value, ...required ? { required: true } : {} })),
    fc.record({ required: fc.boolean() })
      .map(({ required }): ParameterPropertySpec => ({
        oneOf: [{ type: 'string' }, { type: 'null' }],
        ...required ? { required: true } : {},
      })),
  )
}

/** A prop arbitrary up to `depth` levels of nesting (objects and arrays). */
/** 中文说明：函数 propArb 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function propArb(depth: number): fc.Arbitrary<ParameterPropertySpec> {
  if (depth <= 0) return leafPropArb()
  return fc.oneof(
    { weight: 3, arbitrary: leafPropArb() },
    {
      weight: 1,
      arbitrary: fc.record({ properties: specArb(depth - 1), required: fc.boolean(), additionalProperties: fc.boolean() })
        .map(({ properties, required, additionalProperties }): ParameterPropertySpec => ({
          type: 'object',
          additionalProperties,
          properties,
          ...required ? { required: true } : {},
        })),
    },
    {
      weight: 1,
      arbitrary: fc.record({ items: propArb(depth - 1), required: fc.boolean() })
        .map(({ items, required }): ParameterPropertySpec => ({
          type: 'array',
          items: asValueSchema(items),
          ...required ? { required: true } : {},
        })),
    },
  )
}

/** 中文说明：函数 specArb 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function specArb(depth: number): fc.Arbitrary<ParameterSchemaSpec> {
  return fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), propArb(depth), { maxKeys: 4 })
}

/** Generate a value that satisfies a prop (used to build valid args). */
/** 中文说明：函数 valueForProp 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function valueForProp(prop: ParameterPropertySpec): fc.Arbitrary<unknown> {
  if ('oneOf' in prop) return fc.oneof(...prop.oneOf.map(valueForProp))
  if ('const' in prop) return fc.constant(prop.const)
  switch (prop.type) {
    case 'string': return prop.enum ? fc.constantFrom(...prop.enum) : fc.string()
    case 'number': return fc.double({ noNaN: true, noDefaultInfinity: true }).filter(value => !Object.is(value, -0))
    case 'integer': return fc.integer()
    case 'boolean': return fc.boolean()
    case 'null': return fc.constant(null)
    case 'object': return prop.properties ? validArgsForSpec(prop.properties) : fc.constant({})
    case 'array': return prop.items ? fc.array(valueForProp(prop.items), { maxLength: 3 }) : fc.constant([])
    case 'json': return fc.jsonValue().filter(value => isJsonValue(value))
  }
}

/** Generate args satisfying every required key of a spec (optionals included randomly). */
/** 中文说明：函数 validArgsForSpec 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function validArgsForSpec(spec: ParameterSchemaSpec): fc.Arbitrary<Record<string, unknown>> {
  /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = Object.entries(spec)
  return fc.tuple(...entries.map(([key, prop]) =>
    fc.tuple(
      fc.constant(key),
      // required keys are always present; optional keys are present ~half the time
      prop.required === true
        ? valueForProp(prop).map(v => ({ include: true, value: v }))
        : fc.oneof(
          valueForProp(prop).map(v => ({ include: true, value: v })),
          fc.constant({ include: false, value: undefined }),
        ),
    ),
  )).map((pairs) => {
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out: Record<string, unknown> = {}
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [key, { include, value }] of pairs) if (include) out[key] = value
    return out
  })
}

/** Collect the `required: true` keys at the top level of a spec. */
/** 中文说明：函数 requiredKeys 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function requiredKeys(spec: ParameterSchemaSpec): string[] {
  return Object.entries(spec).filter(([, p]) => p.required === true).map(([k]) => k)
}

describe('schema DSL properties', () => {
  it('JSON Schema `required` equals the required:true keys at every level', () => {
    fc.assert(fc.property(specArb(2), (spec) => {
      /** 中文说明：函数值 checkLevel 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const checkLevel = (s: ParameterSchemaSpec, json: { required?: string[]; properties: Record<string, unknown> }) => {
        expect(new Set(json.required ?? [])).toEqual(new Set(requiredKeys(s)))
        /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
        for (const [key, prop] of Object.entries(s)) {
          /** 中文说明：变量 propJson 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const propJson = json.properties[key] as Record<string, unknown>
          if ('type' in prop && prop.type === 'object' && prop.properties) {
            checkLevel(prop.properties, propJson as { required?: string[]; properties: Record<string, unknown> })
          }
        }
      }
      checkLevel(spec, parameterSchemaSpecToJsonSchema(spec))
    }))
  })

  it('conversion is total (never throws) for any spec', () => {
    fc.assert(fc.property(specArb(3), (spec) => {
      expect(() => parameterSchemaSpecToJsonSchema(spec)).not.toThrow()
    }))
  })

  it('validateArgs is total (never throws) for any spec and any input', () => {
    fc.assert(fc.property(specArb(2), fc.anything(), (spec, args) => {
      expect(() => validateArgs(spec, args)).not.toThrow()
    }))
  })

  it('the property-testing ↔ runtime-validation composition: args satisfying the spec pass validateArgs', () => {
    fc.assert(fc.property(
      specArb(2).chain(spec => fc.tuple(fc.constant(spec), validArgsForSpec(spec))),
      ([spec, args]) => {
        expect(validateArgs(spec, args)).toEqual([])
      },
    ))
  })

  it('the property-testing ↔ runtime-validation composition: dropping a required key is always rejected', () => {
    fc.assert(fc.property(
      specArb(1)
        .filter(spec => requiredKeys(spec).length > 0)
        .chain(spec => fc.tuple(fc.constant(spec), validArgsForSpec(spec))),
      ([spec, args]) => {
        /** 中文说明：变量 required 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const required = requiredKeys(spec)
        /** 中文说明：变量 victim 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const victim = required[0]!
        /** 中文说明：函数值 broken 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const broken = Object.fromEntries(Object.entries(args).filter(([k]) => k !== victim))
        /** 中文说明：变量 violations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const violations = validateArgs(spec, broken)
        expect(violations.some(v => v.includes(`"${victim}"`))).toBe(true)
      },
    ))
  })

  it('the property-testing ↔ runtime-validation composition: a non-object top level is always rejected', () => {
    fc.assert(fc.property(
      specArb(1),
      fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.anything())),
      (spec, notAnObject) => {
        expect(validateArgs(spec, notAnObject).length).toBeGreaterThan(0)
      },
    ))
  })
})
