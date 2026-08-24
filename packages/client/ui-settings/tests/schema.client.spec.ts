/**
 * 文件职责：验证设置系统的 schema.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止设置系统显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import type { SchemaNode } from '../src/client/schema.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'

/** 中文说明：测试局部值 service，由紧邻初始化决定。 */
const service = new SettingsSchemaService(new Context())
/** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
const wire = (schema: Schema): unknown => JSON.parse(JSON.stringify(schema.toJSON()))

describe('SettingsSchemaService validation', () => {
  it('rehydrates a serialized envelope into a working validator', () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = service.rehydrate(wire(Schema.object({ name: Schema.string().required() })))
    expect(service.validate(root, { name: 'ok' })).toBeUndefined()
    expect(service.validate(root, { name: 42 })).toContain('name')
  })

  it('stringifies non-Error validation throws', () => {
    /** 中文说明：测试局部值 hostile，由紧邻初始化决定。 */
    const hostile = (() => {
      throw 'plain-string failure'
    }) as unknown as SchemaNode
    expect(service.validate(hostile, {})).toBe('plain-string failure')
  })
})

describe('SettingsSchemaService path operations', () => {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = { providers: { openai: { baseURL: 'https://x' } }, models: [{ id: 'a' }] }

  it('reads nested object and array paths', () => {
    expect(service.getPath(root, [])).toBe(root)
    expect(service.getPath(root, ['providers', 'openai', 'baseURL'])).toBe('https://x')
    expect(service.getPath(root, ['models', '0', 'id'])).toBe('a')
    expect(service.getPath(root, ['providers', 'missing', 'x'])).toBeUndefined()
    expect(service.getPath(root, ['providers', 'openai', 'baseURL', 'deep'])).toBeUndefined()
  })

  it('reports presence by key existence rather than value truthiness', () => {
    expect(service.hasPath({ flag: false }, ['flag'])).toBe(true)
    expect(service.hasPath({ nested: { key: undefined } }, ['nested', 'key'])).toBe(true)
    expect(service.hasPath({}, ['missing'])).toBe(false)
    expect(service.hasPath({ leaf: 'x' }, ['leaf', 'deeper'])).toBe(false)
    expect(service.hasPath({ models: ['a'] }, ['models', '0'])).toBe(true)
    expect(service.hasPath({ models: ['a'] }, ['models', '1'])).toBe(false)
    expect(service.hasPath({ root: true }, [])).toBe(true)
    expect(service.hasPath(undefined, [])).toBe(false)
  })

  it('sets nested paths immutably and materializes missing containers', () => {
    /** 中文说明：测试局部值 draft，由紧邻初始化决定。 */
    const draft = {}
    /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
    const next = service.setPath(draft, ['providers', 'openai', 'baseURL'], 'https://y')
    expect(draft).toEqual({})
    expect(next).toEqual({ providers: { openai: { baseURL: 'https://y' } } })
    /** 中文说明：测试局部值 withArray，由紧邻初始化决定。 */
    const withArray = service.setPath(next, ['models', '0'], { id: 'a' })
    expect(withArray).toEqual({ providers: { openai: { baseURL: 'https://y' } }, models: [{ id: 'a' }] })
    /** 中文说明：测试局部值 replaced，由紧邻初始化决定。 */
    const replaced = service.setPath(withArray, ['models', '0', 'id'], 'b')
    expect(replaced.models).toEqual([{ id: 'b' }])
    expect((withArray as { models: unknown[] }).models).toEqual([{ id: 'a' }])
    expect(() => service.setPath({}, [], 'x')).toThrow(/non-empty path/)
  })

  it('deletes nested paths immutably and splices array indexes', () => {
    /** 中文说明：测试局部值 draft，由紧邻初始化决定。 */
    const draft = { providers: { openai: { baseURL: 'https://x', apiKey: 'k' } }, models: ['a', 'b'] }
    /** 中文说明：测试局部值 withoutKey，由紧邻初始化决定。 */
    const withoutKey = service.deletePath(draft, ['providers', 'openai', 'apiKey'])
    expect(withoutKey).toEqual({ providers: { openai: { baseURL: 'https://x' } }, models: ['a', 'b'] })
    expect(draft.providers.openai.apiKey).toBe('k')
    /** 中文说明：测试局部值 withoutModel，由紧邻初始化决定。 */
    const withoutModel = service.deletePath(withoutKey, ['models', '0'])
    expect(withoutModel.models).toEqual(['b'])
    expect(service.deletePath(draft, ['providers', 'missing', 'x'])).toBe(draft)
    expect(() => service.deletePath({}, [])).toThrow(/non-empty path/)
  })

  it('deletes keys through array intermediates immutably', () => {
    /** 中文说明：测试局部值 draft，由紧邻初始化决定。 */
    const draft = { models: [{ id: 'a', contextWindow: 1 }] }
    /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
    const next = service.deletePath(draft, ['models', '0', 'contextWindow'])
    expect(next).toEqual({ models: [{ id: 'a' }] })
    expect(draft.models[0]).toEqual({ id: 'a', contextWindow: 1 })
  })
})

describe('SettingsSchemaService node traversal', () => {
  /** 中文说明：测试局部值 rootSchema，由紧邻初始化决定。 */
  const rootSchema = Schema.object({
    providers: Schema.dict(Schema.object({ baseURL: Schema.string() })),
    models: Schema.array(Schema.object({ id: Schema.string() })),
    leaf: Schema.string(),
  })

  it('resolves object, dict, and array positions', () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = service.rehydrate(wire(rootSchema))
    expect(service.nodeAtPath(root, [])).toBe(root)
    expect(service.nodeAtPath(root, ['providers', 'openai'])?.type).toBe('object')
    expect(service.nodeAtPath(root, ['providers', 'openai', 'baseURL'])?.type).toBe('string')
    expect(service.nodeAtPath(root, ['models', '0', 'id'])?.type).toBe('string')
    expect(service.nodeAtPath(root, ['missing'])).toBeUndefined()
    expect(service.nodeAtPath(root, ['missing', 'deeper'])).toBeUndefined()
    expect(service.nodeAtPath(root, ['leaf', 'below'])).toBeUndefined()
  })

  it('tolerates structural nodes missing their relation maps', () => {
    expect(service.nodeAtPath({ type: 'object' } as SchemaNode, ['x'])).toBeUndefined()
    expect(service.nodeAtPath({ type: 'dict' } as SchemaNode, ['x'])).toBeUndefined()
  })
})
