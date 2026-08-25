/**
 * Negative-path tests for the persistence log catalog generator
 * (`scripts/gen-persistence-catalog.ts`).
 */
/*
 * 文件职责：验证Session 持久状态的 gen-persistence-catalog.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证Session 持久状态在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  annotateSurface,
  collectEventEnvelopeTypes,
  collectLogEvents,
  collectSurfaceEventTypes,
  render,
} from '../../../../scripts/gen-persistence-catalog.ts'

/** Create a fixture scan root; `files` maps `packages/…`-relative paths to source. */
/* 中文说明：函数 fixtureRoot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fixtureRoot(files: Record<string, string>): string {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = mkdtempSync(join(tmpdir(), 'persistence-catalog-'))
  /** 中文说明：测试局部值 [rel，由紧邻初始化决定。 */
  for (const [rel, source] of Object.entries(files)) {
    /** 中文说明：测试局部值 abs，由紧邻初始化决定。 */
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  return root
}

/** 中文说明：测试局部值 roots，由紧邻初始化决定。 */
const roots: string[] = []
/** 中文说明：测试局部值 make，由紧邻初始化决定。 */
const make = (files: Record<string, string>): string => {
  /** 中文说明：测试局部值 r，由紧邻初始化决定。 */
  const r = fixtureRoot(files)
  roots.push(r)
  return r
}

/** A merge-form declaration file wrapping `members` in the session module. */
/* 中文说明：测试局部值 merge，由紧邻初始化决定。 */
const merge = (members: string): string =>
  `declare module '@deepseek-ai/dsh-session/types' {\n  interface SessionEventMap {\n${members}\n  }\n}\n`

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

/** The manifest that marks a fixture package as the owning session package. */
/* 中文说明：测试局部值 OWNER_MANIFEST，由紧邻初始化决定。 */
const OWNER_MANIFEST = '{ "name": "@deepseek-ai/dsh-session" }\n'

describe('gen-persistence-catalog collectLogEvents', () => {
  it('extracts a documented member of the owning top-level interface', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = collectLogEvents(make({
      'packages/core/fix/package.json': OWNER_MANIFEST,
      'packages/core/fix/src/types.ts':
        'export interface SessionEventMap {\n  /** A thing was recorded. */\n  \'fix/happened\': { turn: number }\n}\n',
    }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'fix/happened',
      scope: 'fix',
      doc: 'A thing was recorded.',
      payload: '{ turn: number }',
      declaration: '/** A thing was recorded. */\n\'fix/happened\': { turn: number }',
      source: 'packages/core/fix/src/types.ts:3',
    })
  })

  it('hard-errors on a top-level interface outside the owning package', () => {
    expect(() => collectLogEvents(make({
      'packages/group/alien/package.json': '{ "name": "@deepseek-ai/dsh-alien" }\n',
      'packages/group/alien/src/types.ts':
        'export interface SessionEventMap {\n  /** Not the real vocabulary. */\n  \'alien/event\': { turn: number }\n}\n',
    }))).toThrow(/top-level interface SessionEventMap .* is outside @deepseek-ai\/dsh-session \(package @deepseek-ai\/dsh-alien\)/)
  })

  it('hard-errors on a non-exported top-level interface even in the owning package', () => {
    expect(() => collectLogEvents(make({
      'packages/core/fix/package.json': OWNER_MANIFEST,
      'packages/core/fix/src/helper.ts':
        'interface SessionEventMap {\n  /** A local helper, not the vocabulary. */\n  \'fix/local\': { turn: number }\n}\nexport const use: SessionEventMap | null = null\n',
    }))).toThrow(/is not exported; the owning vocabulary is the single exported declaration/)
  })

  it('hard-errors when the owning interface is exported from two files', () => {
    expect(() => collectLogEvents(make({
      'packages/core/fix/package.json': OWNER_MANIFEST,
      'packages/core/fix/src/a.ts': 'export interface SessionEventMap {\n  /** First home. */\n  \'fix/a\': { turn: number }\n}\n',
      'packages/core/fix/src/b.ts': 'export interface SessionEventMap {\n  /** Second home. */\n  \'fix/b\': { turn: number }\n}\n',
    }))).toThrow(/is already declared at packages\/core\/fix\/src\/a\.ts:1; the owning vocabulary has exactly one home/)
  })

  it('hard-errors on an extends clause (inherited keys would escape the catalog)', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts':
        'interface Extra { \'fix/hidden\': { turn: number } }\ndeclare module \'@deepseek-ai/dsh-session/types\' {\n  interface SessionEventMap extends Extra {\n    /** Declared directly. */\n    \'fix/direct\': { turn: number }\n  }\n}\n',
    }))).toThrow(/uses extends; inherited keys would join keyof SessionEventMap without a catalog row/)
  })

  it('extracts a member declaration-merged via the session module', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    /** Merged event source record. */\n    \'fix/merged\': { id: string }'),
    }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: 'fix/merged', doc: 'Merged event source record.' })
  })

  it('collapses a newline-separated multi-line payload to a valid one-line fragment', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge(
        '    /** Wide payload. */\n    \'fix/wide\': {\n      /** Alpha values. */\n      alpha: string[]\n      range: { start: number; end: number }\n      count: number\n    }',
      ),
    }))
    expect(events[0]?.payload).toBe('{ alpha: string[]; range: { start: number; end: number }; count: number }')
    expect(events[0]?.declaration).toBe(
      '/** Wide payload. */\n\'fix/wide\': {\n  /** Alpha values. */\n  alpha: string[]\n  range: { start: number; end: number }\n  count: number\n}',
    )
  })

  it('hard-errors on a member with no description prose', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    \'fix/undocumented\': { turn: number }'),
    }))).toThrow(/no description prose/)
  })

  it('hard-errors on an @mode tag (a log event has no dispatch mode)', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    /**\n     * Documented, but mistagged.\n     * @mode emit\n     */\n    \'fix/tagged\': { turn: number }'),
    }))).toThrow(/carries an @mode tag/)
  })

  it('hard-errors on an extra-indented @mode tag (does not leak into prose)', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    /**\n     * Documented, but mistagged.\n     *   @mode emit\n     */\n    \'fix/indented\': { turn: number }'),
    }))).toThrow(/carries an @mode tag/)
  })

  it('hard-errors on a method-form member (it still joins keyof SessionEventMap)', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    /** Documented, wrong shape. */\n    \'fix/method\'(turn: number): void'),
    }))).toThrow(/not a property signature with an explicit payload type/)
  })

  it('hard-errors on a property member with no payload type annotation', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    /** Documented, no payload. */\n    \'fix/bare\''),
    }))).toThrow(/not a property signature with an explicit payload type/)
  })

  it('hard-errors on a non-literal member name', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    /** Not a literal. */\n    unquoted: { turn: number }'),
    }))).toThrow(/non-literal name/)
  })

  it('hard-errors when the same event is declared twice', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/a.ts': merge('    /** First. */\n    \'fix/dup\': { turn: number }'),
      'packages/group/fix/src/b.ts': merge('    /** Second. */\n    \'fix/dup\': { turn: number }'),
    }))).toThrow(/already declared at packages\/group\/fix\/src\/a\.ts/)
  })

  it('aggregates every violation into one error instead of failing fast', () => {
    expect(() => collectLogEvents(make({
      'packages/group/fix/src/types.ts': merge('    \'fix/one\': { turn: number }\n    \'fix/two\': { turn: number }'),
    }))).toThrow(/2 JSDoc completeness violation\(s\)[\s\S]*fix\/one[\s\S]*fix\/two/)
  })
})

describe('gen-persistence-catalog collectEventEnvelopeTypes', () => {
  /** 中文说明：测试局部值 declarations，由紧邻初始化决定。 */
  const declarations = `/** Event keys. */
export type SessionEventType = keyof SessionEventMap
/** Surface-producing event keys. */
export type SurfaceEventType = 'fix/message'
/** Surface placement. */
export type SurfaceOp = 'append'
/** One persisted event. */
export type SessionEvent<T extends SessionEventType = SessionEventType> = { type: T }
`

  it('extracts the envelope declarations with their complete JSDoc in canonical order', () => {
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    const entries = collectEventEnvelopeTypes(make({
      'packages/core/fix/package.json': OWNER_MANIFEST,
      'packages/core/fix/src/types.ts': declarations,
    }))
    expect(entries.map(entry => entry.name)).toEqual([
      'SessionEventType',
      'SurfaceEventType',
      'SurfaceOp',
      'SessionEvent',
    ])
    expect(entries[3]).toMatchObject({
      declaration: '/** One persisted event. */\nexport type SessionEvent<T extends SessionEventType = SessionEventType> = { type: T }',
      source: 'packages/core/fix/src/types.ts:8',
    })
  })

  it('hard-errors when an envelope declaration is missing', () => {
    expect(() => collectEventEnvelopeTypes(make({
      'packages/core/fix/package.json': OWNER_MANIFEST,
      'packages/core/fix/src/types.ts': declarations.replace('/** Surface placement. */\nexport type SurfaceOp = \'append\'\n', ''),
    }))).toThrow(/missing event-envelope declaration\(s\): SurfaceOp/)
  })

  it('hard-errors on duplicate, unexported, undocumented, or mistagged envelope declarations', () => {
    /** 中文说明：测试局部值 violations，由紧邻初始化决定。 */
    const violations = new RegExp([
      '4 JSDoc completeness violation\\(s\\)',
      '[\\s\\S]*not exported',
      '[\\s\\S]*@mode tag',
      '[\\s\\S]*SurfaceOp.*no description prose',
      '[\\s\\S]*SessionEvent.*already declared',
    ].join(''))
    expect(() => collectEventEnvelopeTypes(make({
      'packages/core/fix/package.json': OWNER_MANIFEST,
      'packages/core/fix/src/types.ts': declarations
        .replace('/** Event keys. */\nexport type SessionEventType', '/** Event keys.\n * @mode emit\n */\ntype SessionEventType')
        .replace('/** Surface placement. */\n', '')
        + '/** Duplicate event. */\nexport type SessionEvent = { type: never }\n',
    }))).toThrow(violations)
  })
})

describe('gen-persistence-catalog collectSurfaceEventTypes', () => {
  it('parses the literal union', () => {
    /** 中文说明：测试局部值 types，由紧邻初始化决定。 */
    const types = collectSurfaceEventTypes(make({
      'packages/core/fix/src/types.ts': 'export type SurfaceEventType = \'fix/a\' | \'fix/b\'\n',
    }))
    expect(types).toEqual(['fix/a', 'fix/b'])
  })

  it('hard-errors when no union is declared', () => {
    expect(() => collectSurfaceEventTypes(make({
      'packages/core/fix/src/types.ts': 'export const unrelated = 1\n',
    }))).toThrow(/no SurfaceEventType union found/)
  })

  it('hard-errors when the union is declared more than once', () => {
    expect(() => collectSurfaceEventTypes(make({
      'packages/core/fix/src/a.ts': 'export type SurfaceEventType = \'fix/a\'\n',
      'packages/core/fix/src/b.ts': 'export type SurfaceEventType = \'fix/b\'\n',
    }))).toThrow(/declared more than once/)
  })

  it('hard-errors on a non-string-literal union member', () => {
    expect(() => collectSurfaceEventTypes(make({
      'packages/core/fix/src/types.ts': 'export type SurfaceEventType = \'fix/a\' | number\n',
    }))).toThrow(/non-string-literal member/)
  })
})

describe('gen-persistence-catalog annotateSurface + render', () => {
  /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
  const entry = (name: string) => ({
    name,
    scope: name.split('/')[0] ?? name,
    payload: '{ turn: number }',
    doc: `Records ${name}.`,
    declaration: `/** Records ${name}. */\n'${name}': { turn: number }`,
    source: 'packages/core/fix/src/types.ts:3',
  })

  /** 中文说明：测试局部值 envelopeTypes，由紧邻初始化决定。 */
  const envelopeTypes = [
    'SessionEventType',
    'SurfaceEventType',
    'SurfaceOp',
    'SessionEvent',
  ].map(name => ({
    name: name as 'SessionEventType' | 'SurfaceEventType' | 'SurfaceOp' | 'SessionEvent',
    declaration: `/** ${name}. */\nexport type ${name} = never`,
    source: 'packages/core/fix/src/types.ts:1',
  }))

  it('badges union members surface and everything else log-only', () => {
    /** 中文说明：测试局部值 annotated，由紧邻初始化决定。 */
    const annotated = annotateSurface([entry('fix/message'), entry('fix/marker')], ['fix/message'])
    expect(annotated.map(e => [e.name, e.surface])).toEqual([['fix/message', true], ['fix/marker', false]])
  })

  it('hard-errors on a union member naming no declared event', () => {
    expect(() => annotateSurface([entry('fix/marker')], ['fix/ghost']))
      .toThrow(/'fix\/ghost' name no declared log event/)
  })

  it('renders badges, declaration fences, and the generated-file header', () => {
    /** 中文说明：测试局部值 out，由紧邻初始化决定。 */
    const out = render(annotateSurface([entry('fix/message'), entry('fix/marker')], ['fix/message']), envelopeTypes)
    expect(out).toContain('Generated by scripts/gen-persistence-catalog.ts')
    expect(out).toContain('# Session Persistence Event Catalog')
    expect(out).toContain('```ts persistence-catalog\n/** SessionEventType. */\nexport type SessionEventType = never')
    expect(out).toContain('#### `fix/message` — surface')
    expect(out).toContain('#### `fix/marker` — log-only')
    expect(out).toContain('```ts persistence-catalog\n/** Records fix/marker. */\n\'fix/marker\': { turn: number }\n```')
  })
})
