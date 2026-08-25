/**
 * 文件职责：验证 renderer.spec.ts 覆盖的Typert 类型系统行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Typert 类型系统能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */
import { describe, expect, it } from 'vitest'
import type {
  KeywordTypeName,
  MemberModel,
  TypeDeclarationModel,
  TypeGraph,
  TypeNodeModel,
} from '../src/model.ts'
import { childTypeNodeIds } from '../src/model.ts'
import { TypeGraphRenderError, TypeGraphRenderer } from '../src/renderer.ts'

/** 中文说明：变量 location 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const location = { file: 'fixture.ts', line: 1, column: 1 } as const
/** 中文说明：变量 documentation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const documentation = { tags: [] } as const

describe('TypeGraphRenderer defensive and optional shapes', () => {
  it('enumerates direct child edges for every type node kind', () => {
    /** 中文说明：变量 signature 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signature = { typeParameters: [], parameters: [], returns: 'leaf' } as const
    /** 中文说明：变量 cases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cases: readonly (readonly [TypeNodeModel, readonly string[]])[] = [
      [keyword('keyword', 'string'), []],
      [{ id: 'literal', kind: 'literal', value: 1, text: '1' }, []],
      [{ id: 'parenthesized', kind: 'parenthesized', type: 'leaf' }, ['leaf']],
      [{ id: 'reference', kind: 'reference', name: 'Ref', target: { kind: 'standard', name: 'Ref' }, arguments: ['left', 'right'] }, ['left', 'right']],
      [{ id: 'union', kind: 'union', types: ['left', 'right'] }, ['left', 'right']],
      [{ id: 'intersection', kind: 'intersection', types: ['left', 'right'] }, ['left', 'right']],
      [{ id: 'array', kind: 'array', element: 'leaf' }, ['leaf']],
      [{ id: 'tuple', kind: 'tuple', elements: [{ type: 'leaf', optional: false, rest: false }] }, ['leaf']],
      [{ id: 'object', kind: 'object', members: [] }, []],
      [{ id: 'function', kind: 'function', signature }, []],
      [{ id: 'constructor', kind: 'constructor', abstract: false, signature }, []],
      [{ id: 'indexed', kind: 'indexed-access', object: 'left', index: 'right' }, ['left', 'right']],
      [{ id: 'operator', kind: 'operator', operator: 'keyof', type: 'leaf' }, ['leaf']],
      [{ id: 'conditional', kind: 'conditional', check: 'check', extends: 'extends', whenTrue: 'yes', whenFalse: 'no' }, ['check', 'extends', 'yes', 'no']],
      [{ id: 'infer-full', kind: 'infer', parameter: { id: 'infer', name: 'Value', const: false, constraint: 'constraint', default: 'fallback' } }, ['constraint', 'fallback']],
      [{ id: 'infer-empty', kind: 'infer', parameter: { id: 'infer', name: 'Value', const: false } }, []],
      [{ id: 'mapped-full', kind: 'mapped', parameter: { id: 'key', name: 'Key', const: false, constraint: 'constraint', default: 'fallback' }, nameType: 'name', value: 'value', readonly: 'preserve', optional: 'preserve' }, ['constraint', 'fallback', 'name', 'value']],
      [{ id: 'mapped-empty', kind: 'mapped', parameter: { id: 'key', name: 'Key', const: false }, readonly: 'preserve', optional: 'preserve' }, []],
      [{ id: 'template', kind: 'template-literal', head: '', spans: [{ type: 'leaf', text: '' }] }, ['leaf']],
      [{ id: 'query', kind: 'type-query', expression: 'value', arguments: ['leaf'] }, ['leaf']],
      [{ id: 'import', kind: 'import-type', module: 'fixture', arguments: ['leaf'], typeof: false }, ['leaf']],
      [{ id: 'predicate-full', kind: 'predicate', asserts: false, parameter: 'value', type: 'leaf' }, ['leaf']],
      [{ id: 'predicate-empty', kind: 'predicate', asserts: true, parameter: 'value' }, []],
      [{ id: 'this', kind: 'this' }, []],
    ]

    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const [node, expected] of cases) expect(childTypeNodeIds(node)).toEqual(expected)
  })

  it('renders optional source shapes and traverses every optional closure edge', () => {
    /** 中文说明：变量 dependency 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dependency = declaration('dependency', 'Dependency', 'interface')
    /** 中文说明：变量 graph 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const graph: TypeGraph = {
      declarations: [
        dependency,
        declaration('empty-enum', 'EmptyEnum', 'enum'),
        declaration('root', 'Root', 'interface', {
          members: [property('root-member', 'rootValue', 'imported')],
        }),
      ],
      nodes: [
        keyword('string', 'string'),
        { id: 'union', kind: 'union', types: ['string', 'string'] },
        { id: 'array', kind: 'array', element: 'union' },
        {
          id: 'tuple',
          kind: 'tuple',
          elements: [
            { type: 'string', optional: false, rest: false },
            { type: 'string', optional: true, rest: false },
            { type: 'array-of-string', optional: false, rest: true },
          ],
        },
        { id: 'array-of-string', kind: 'array', element: 'string' },
        {
          id: 'mapped',
          kind: 'mapped',
          parameter: {
            id: 'key',
            name: 'Key',
            const: false,
            constraint: 'string',
            default: 'string',
          },
          readonly: 'preserve',
          optional: 'preserve',
        },
        {
          id: 'infer',
          kind: 'infer',
          parameter: {
            id: 'inferred',
            name: 'Value',
            const: false,
            constraint: 'string',
            default: 'string',
          },
        },
        {
          id: 'imported',
          kind: 'import-type',
          module: '@fixture/dependency',
          qualifier: 'Dependency',
          arguments: ['mapped', 'infer'],
          typeof: false,
          target: { kind: 'declaration', symbol: 'dependency' },
        },
        { id: 'empty-object', kind: 'object', members: [] },
      ],
    }
    /** 中文说明：变量 renderer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const renderer = new TypeGraphRenderer(graph)

    expect(renderer.renderType('array')).toBe('(string | string)[]')
    expect(renderer.renderType('tuple')).toBe('[string, string?, ...string[]]')
    expect(renderer.renderType('mapped')).toBe('{ [Key in string]: unknown }')
    expect(renderer.renderType('empty-object')).toBe('{}')
    expect(renderer.renderDeclaration('empty-enum')).toBe('export enum EmptyEnum {\n}')
    expect(renderer.declarationClosureForMembers(['root-member']).map(item => item.name))
      .toEqual(['Dependency'])
  })

  it('fails loudly for every broken graph edge and impossible discriminant', () => {
    /** 中文说明：变量 missingConstraint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingConstraint: TypeNodeModel = {
      id: 'mapped',
      kind: 'mapped',
      parameter: { id: 'key', name: 'Key', const: false },
      readonly: 'preserve',
      optional: 'preserve',
    }
    /** 中文说明：变量 alias 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alias = declaration('alias', 'Alias', 'alias')
    /** 中文说明：变量 renderer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const renderer = new TypeGraphRenderer({
      declarations: [alias],
      nodes: [missingConstraint],
    })

    expect(() => renderer.node('missing')).toThrow(TypeGraphRenderError)
    expect(() => renderer.declaration('missing')).toThrow('missing declaration')
    expect(() => renderer.member('missing')).toThrow('missing member')
    expect(renderer.declarationClosureForTypes(['mapped'])).toEqual([])
    expect(() => renderer.renderType('mapped')).toThrow('has no constraint')
    expect(() => renderer.renderDeclaration('alias')).toThrow('has no type node')

    /** 中文说明：变量 invalidNode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidNode = { id: 'invalid', kind: 'future-node' } as unknown as TypeNodeModel
    /** 中文说明：变量 invalidMember 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidMember = {
      ...property('invalid-member', 'value', 'mapped'),
      kind: 'future-member',
    } as unknown as MemberModel
    /** 中文说明：变量 invalidRenderer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidRenderer = new TypeGraphRenderer({
      declarations: [declaration('invalid-root', 'InvalidRoot', 'interface', { members: [invalidMember] })],
      nodes: [invalidNode],
    })
    expect(() => invalidRenderer.renderType('invalid')).toThrow('unsupported model variant')
    expect(() => invalidRenderer.renderMember(invalidMember)).toThrow('unsupported model variant')
    expect(() => invalidRenderer.declarationClosureForTypes(['invalid'])).toThrow('unsupported model variant')
  })
})

/** 中文说明：函数 keyword 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function keyword(id: string, name: KeywordTypeName): TypeNodeModel {
  return { id, kind: 'keyword', name }
}

/** 中文说明：函数 property 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function property(id: string, name: string, type: string): MemberModel {
  return {
    ...documentation,
    id,
    kind: 'property',
    name,
    type,
    optional: false,
    readonly: false,
    async: false,
    abstract: false,
    static: false,
    visibility: 'public',
    location,
    text: `${name}: unknown`,
  }
}

/** 中文说明：函数 declaration 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function declaration(
  id: string,
  name: string,
  kind: TypeDeclarationModel['kind'],
  options: { readonly members?: readonly MemberModel[] } = {},
): TypeDeclarationModel {
  return {
    ...documentation,
    id,
    package: '@fixture/renderer',
    name,
    kind,
    abstract: false,
    exported: true,
    location,
    text: `export ${kind === 'alias' ? 'type' : kind} ${name}`,
    typeParameters: [],
    extends: [],
    implements: [],
    members: options.members ?? [],
  }
}
