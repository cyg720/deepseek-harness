/**
 * The client slot catalog's judgement, proven on hand-built inputs: the
 * contract checks that must reject an unteachable slot, and the projection
 * facts a registrant depends on (who occupies a seat, what replacing it costs,
 * which owner has to be mounted). Run against the real workspace, the
 * generator's own `--check` covers freshness; these cases pin the rules that
 * make a stale or undocumented contract fail loudly instead of shipping.
 */
/*
 * 文件职责：验证 gen-client-catalog.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { describe, expect, it } from 'vitest'
import { collectSlotEntries, oversizedSlotReports, resolveSlotEntries, validateSlotContracts } from './gen-client-catalog.ts'
import type { SlotDeclaration, SlotRegistration, TypeDeclaration } from './slot-walk.ts'

/** A declaration with every field the catalog needs, overridable per case. */
/* 中文说明：函数 declaration 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function declaration(over: Partial<SlotDeclaration> = {}): SlotDeclaration {
  return {
    key: 'demo.seat',
    kind: 'single',
    scope: 'root',
    jsDoc: '/** A seat. Registering here replaces the shipped entry. */',
    package: '@deepseek-ai/dsh-client-demo',
    source: 'packages/client/demo/src/client/contract/slots.ts:1',
    ...over,
  }
}

/** A registration into `demo.seat`, overridable per case. */
/* 中文说明：函数 registration 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function registration(over: Partial<SlotRegistration> = {}): SlotRegistration {
  return {
    key: 'demo.seat',
    package: '@deepseek-ai/dsh-client-demo',
    component: 'DemoSeat',
    children: [],
    source: 'packages/client/demo/src/client/index.ts:10',
    ...over,
  }
}

/** An exported owner-props declaration the catalog can resolve. */
/* 中文说明：常量 OWNER_TYPES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OWNER_TYPES = new Map<string, TypeDeclaration>([
  ['DemoOwnerProps', {
    name: 'DemoOwnerProps',
    text: '/** Owner share. */\nexport interface DemoOwnerProps {\n  /** Column width. */\n  width: number\n}',
    source: 'packages/client/demo/src/client/contract/slots.ts:20',
  }],
])

describe('client slot contract validation', () => {
  it('accepts a documented slot whose owner props resolve', () => {
    expect(validateSlotContracts(
      [declaration({ ownerType: 'DemoOwnerProps' })],
      [registration()],
      OWNER_TYPES,
    )).toEqual([])
  })

  it('rejects a slot with no registrant-facing prose, naming the writing template', () => {
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = validateSlotContracts([declaration({ jsDoc: '' })], [], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('has no JSDoc prose')
    expect(problems[0]).toContain('ui-settings')
  })

  it.each([
    ['kind', { kind: 'whatever' }],
    ['scope', { scope: 'whatever' }],
  ])('rejects a slot whose %s is not one of the contract literals', (field, over) => {
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = validateSlotContracts([declaration(over)], [], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`no literal '${field}'`)
  })

  it('rejects owner props no exported declaration provides', () => {
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = validateSlotContracts([declaration({ ownerType: 'MissingProps' })], [], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('MissingProps')
  })

  it('rejects the same key declared twice, because a merge would hide one contract', () => {
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = validateSlotContracts(
      [declaration(), declaration({ source: 'packages/client/other/src/client/slots.ts:3' })],
      [],
      new Map(),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('is also declared at')
  })

  it('rejects a registration into an undeclared slot as a scan blind spot', () => {
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = validateSlotContracts([declaration()], [registration({ key: 'ghost.seat' })], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('blind spot')
  })

  it('rejects a children declaration for a slot no merge types', () => {
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = validateSlotContracts([declaration()], [registration({ children: ['ghost.child'] })], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("child slot 'ghost.child'")
  })
})

describe('client slot projection', () => {
  /** 中文说明：变量 kits 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const kits = new Map<string, readonly string[]>([['root', ['useSessions: Hook']]])

  it('warns that a single seat with a shipped occupant is replaced, not shared', () => {
    const [entry] = resolveSlotEntries([declaration()], [registration()], OWNER_TYPES, kits)
    expect(entry?.replaceRisk).toBe('shadows-shipped-ui')
    expect(entry?.occupants).toEqual(['client-demo DemoSeat'])
  })

  it('treats a list seat as additive even when shipped entries exist', () => {
    const [entry] = resolveSlotEntries(
      [declaration({ kind: 'list' })],
      [registration({ id: 'shipped' })],
      OWNER_TYPES,
      kits,
    )
    expect(entry?.replaceRisk).toBe('none')
    expect(entry?.occupants).toEqual(["client-demo DemoSeat id 'shipped'"])
    expect(entry?.registerOptions.map(option => option.name)).toEqual(['id', 'order', 'label'])
  })

  it('names the entry whose mount makes a child seat exist', () => {
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = registration({ key: 'demo.parent', children: ['demo.seat'] })
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = resolveSlotEntries(
      [declaration(), declaration({ key: 'demo.parent' })],
      [parent],
      OWNER_TYPES,
      kits,
    )
    expect(entries.find(entry => entry.key === 'demo.seat')?.declaredBy)
      .toContain("an entry in 'demo.parent' (client-demo)")
    expect(entries.find(entry => entry.key === 'demo.parent')?.declaredBy)
      .toContain('built in')
  })

  it('reports an open keyed domain and the keys already taken', () => {
    const [entry] = resolveSlotEntries(
      [declaration({ kind: 'keyed' })],
      [registration({ entryKey: 'bash' }), registration({ entryKey: 'read' })],
      OWNER_TYPES,
      kits,
    )
    expect(entry?.keyDomain).toContain('open: any string')
    expect(entry?.keyDomain).toContain('already taken: bash, read')
  })

  it('carries owner-props documentation into the entry, not just the type name', () => {
    const [entry] = resolveSlotEntries([declaration({ ownerType: 'DemoOwnerProps' })], [], OWNER_TYPES, kits)
    expect(entry?.ownerProps.join('\n')).toContain('Column width.')
  })

  it('expands owner props one level and only names the shapes they reference', () => {
    // Transitive expansion once dragged the whole session model into four
    // seats; a registrant needs the fields, not the graph behind them.
    /** 中文说明：变量 types 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const types = new Map(OWNER_TYPES)
    types.set('Zone', {
      name: 'Zone',
      text: 'export interface Zone {\n  session: BigSnapshot\n}',
      source: 'packages/client/demo/src/client/contract/slots.ts:30',
    })
    types.set('BigSnapshot', {
      name: 'BigSnapshot',
      text: 'export interface BigSnapshot {\n  turns: number\n}',
      source: 'packages/client/demo/src/client/snapshot.ts:1',
    })
    const [entry] = resolveSlotEntries([declaration({ ownerType: 'Zone' })], [], types, kits)
    expect(entry?.ownerProps.join('\n')).toContain('export interface Zone')
    expect(entry?.ownerProps.join('\n')).not.toContain('export interface BigSnapshot')
    expect(entry?.ownerPropsReferences).toEqual(['BigSnapshot'])
  })

  it('offers a runnable registration whose options match the cardinality', () => {
    const [entry] = resolveSlotEntries([declaration({ kind: 'list' })], [], OWNER_TYPES, kits)
    expect(entry?.example).toContain("ctx.slots.inject('demo.seat'")
    expect(entry?.example).toContain("id: 'my-entry'")
  })
})

describe('the per-slot report budget', () => {
  it('rejects a slot whose report a model could not finish reading', () => {
    // Truncation already bounds one declaration, so the remaining runaway is
    // prose: a contract that grew into a manual costs exactly what narrowing to
    // one slot was supposed to save.
    /** 中文说明：函数值 manual 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const manual = ['/**', ...Array.from({ length: 150 }, (_, i) => ` * Paragraph ${String(i)} about this seat.`), ' */']
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = resolveSlotEntries([declaration({ jsDoc: manual.join('\n') })], [], OWNER_TYPES, new Map())
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = oversizedSlotReports(entries)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("slot 'demo.seat'")
    expect(problems[0]).toContain('tighten')
  })

  it('passes a slot whose report stays within the budget', () => {
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = resolveSlotEntries([declaration({ ownerType: 'DemoOwnerProps' })], [], OWNER_TYPES, new Map())
    expect(oversizedSlotReports(entries)).toEqual([])
  })
})

describe('the real workspace surface', () => {
  it('collects every declared slot with a teachable contract', { timeout: 30_000 }, () => {
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = collectSlotEntries(process.cwd())
    expect(entries.length).toBeGreaterThan(30)
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const entry of entries) {
      expect(entry.summary, `${entry.key} has no summary`).not.toBe('')
      expect(['single', 'list', 'keyed', 'chain']).toContain(entry.kind)
      expect(['root', 'session', 'session-maybe']).toContain(entry.scope)
    }
    // The frame root is the canonical trap: occupied by the shipped app frame,
    // so a dynamic package registering there replaces the whole UI.
    /** 中文说明：函数值 root 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const root = entries.find(entry => entry.key === 'root')
    expect(root?.replaceRisk).toBe('shadows-shipped-ui')
    expect(root?.occupants.join(' ')).toContain('AppFrame')
  })
})
