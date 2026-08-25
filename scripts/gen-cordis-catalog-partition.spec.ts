/**
 * Acceptance-path coverage for the cordis-surface partition backstops
 * (`walkPartitionProblems` + the AST scan helpers): a declared Context key or
 * Events member the rendering projection cannot see must carry a named walk
 * exemption, an exemption must stay live in both directions, and the scan
 * itself must reach nested (`src/**`) and Events-only merge files.
 */
/*
 * 文件职责：验证 gen-cordis-catalog-partition.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ts from 'typescript'
import { contextKeyMap, contextMergeFiles, eventNameList } from './cordis-walk.ts'
import { walkPartitionProblems } from './gen-cordis-catalog.ts'
import type { WalkPartitionInput, WalkPartitionMaps } from './gen-cordis-catalog.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A consistent baseline the red cases mutate one facet at a time. */
/* 中文说明：函数 baseline 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function baseline(): { input: WalkPartitionInput; maps: WalkPartitionMaps } {
  return {
    input: {
      renderedKeys: new Map([['llm', 'packages/llm/llm/src/index.ts:10']]),
      renderedScopes: new Set(['llm']),
      renderedEventNames: new Set(['llm/request']),
      declaredKeys: new Map([
        ['llm', 'packages/llm/llm/src/index.ts'],
        ['theme', 'packages/client/ui-theme/src/client/index.ts'],
      ]),
      declaredEvents: new Map([
        ['llm/request', 'packages/llm/llm/src/index.ts'],
        ['theme/change', 'packages/client/ui-theme/src/client/index.ts'],
      ]),
    },
    maps: {
      servicePage: { llm: 'llm-streaming.md' },
      serviceWalkExemptions: { theme: 'client-side — packages/client/ui-theme/README.md owns the surface' },
      eventScopePage: { llm: 'llm-streaming.md' },
      eventWalkExemptions: { 'theme/change': 'client-face — packages/client/ui-theme/README.md owns the surface' },
    },
  }
}

describe('walkPartitionProblems', () => {
  it('accepts a partition where every declared key and event is rendered or exempted', () => {
    const { input, maps } = baseline()
    expect(walkPartitionProblems(input, maps)).toEqual([])
  })

  it('rejects a declared event that is neither rendered nor exempted, naming its file', () => {
    const { input, maps } = baseline()
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = walkPartitionProblems(input, { ...maps, eventWalkExemptions: {} })
    expect(problems).toEqual([
      expect.stringContaining("event 'theme/change' (packages/client/ui-theme/src/client/index.ts) is declared in an Events merge but invisible"),
    ])
  })

  it('rejects an event exemption whose event the projection renders', () => {
    const { input, maps } = baseline()
    // A projection that renders theme/change necessarily renders the theme
    // scope too; the fixture models that and maps the scope so the only
    // violation is the stale exemption.
    /** 中文说明：变量 rendered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = {
      ...input,
      renderedScopes: new Set(['llm', 'theme']),
      renderedEventNames: new Set(['llm/request', 'theme/change']),
    }
    /** 中文说明：变量 mapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mapped = { ...maps, eventScopePage: { llm: 'llm-streaming.md', theme: 'client-modules.md' } }
    expect(walkPartitionProblems(rendered, mapped)).toEqual([
      expect.stringContaining("event 'theme/change' is rendered by the projection but still listed in EVENT_WALK_EXEMPTIONS"),
    ])
  })

  it('rejects rendered surface the independent scan cannot see, naming the scan as the defect', () => {
    const { input, maps } = baseline()
    /** 中文说明：变量 blind 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blind = {
      ...input,
      declaredKeys: new Map([['theme', 'packages/client/ui-theme/src/client/index.ts']]),
      declaredEvents: new Map([['theme/change', 'packages/client/ui-theme/src/client/index.ts']]),
    }
    expect(walkPartitionProblems(blind, maps)).toEqual([
      expect.stringContaining('ctx.llm is rendered by the projection but the independent scan finds no Context merge declaring it'),
      expect.stringContaining("event 'llm/request' is rendered by the projection but the independent scan finds no Events merge declaring it"),
    ])
  })

  it('rejects an event exemption no Events merge declares', () => {
    const { input, maps } = baseline()
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = { ...maps, eventWalkExemptions: { ...maps.eventWalkExemptions, 'gone/away': 'nothing owns this' } }
    expect(walkPartitionProblems(input, stale)).toEqual([
      expect.stringContaining("EVENT_WALK_EXEMPTIONS names 'gone/away' but no Events merge declares it"),
    ])
  })

  it('rejects a declared Context key that is neither rendered nor exempted', () => {
    const { input, maps } = baseline()
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = walkPartitionProblems(input, { ...maps, serviceWalkExemptions: {} })
    expect(problems).toEqual([
      expect.stringContaining('ctx.theme (packages/client/ui-theme/src/client/index.ts) is declared in a Context merge but invisible'),
    ])
  })

  it('rejects an unmapped rendered service with its source pointer, and stale page maps both ways', () => {
    const { input, maps } = baseline()
    /** 中文说明：变量 problems 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const problems = walkPartitionProblems(input, {
      ...maps,
      servicePage: { ghost: 'core.md' },
      eventScopePage: { specter: 'core.md' },
    })
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('service ctx.llm (packages/llm/llm/src/index.ts:10) has no SERVICE_PAGE entry'),
      expect.stringContaining("event scope 'llm/*' has no EVENT_SCOPE_PAGE entry"),
      expect.stringContaining("SERVICE_PAGE maps 'ctx.ghost' but the projection discovers no such service"),
      expect.stringContaining("EVENT_SCOPE_PAGE maps 'specter/*' but the projection discovers no such scope"),
    ]))
    expect(problems).toHaveLength(4)
  })
})

describe('cordis-walk scan reach', () => {
  it('finds Context keys and Events names in nested Events-only merge files', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'cordis-walk-'))
    roots.push(root)
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = join(root, 'packages/client/ui-x/src/client')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.ts'), [
      "declare module '@deepseek-ai/cordis' {",
      '  interface Events {',
      "    'x/changed'(): void",
      '  }',
      '}',
      'export {}',
      '',
    ].join('\n'))
    /** 中文说明：变量 merges 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const merges = contextMergeFiles(root, 'packages/*/*/src/**/*.ts')
    expect(merges.map(m => m.rel)).toEqual(['packages/client/ui-x/src/client/index.ts'])
    /** 中文说明：变量 only 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const only = merges[0]
    if (!only) throw new Error('scan returned no merge')
    expect(eventNameList(only.body, only.sf)).toEqual(['x/changed'])
    expect([...contextKeyMap(only.body, only.sf).keys()]).toEqual([])
  })

  it('yields every merge block of a multi-block file, double-quoted heads, and .tsx sources', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'cordis-walk-'))
    roots.push(root)
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = join(root, 'packages/client/ui-x/src')
    mkdirSync(dir, { recursive: true })
    // The Typert analyzer reads every cordis module block in a file; the
    // backstop must not stop at the first one, skip the double-quoted legal
    // form, or ignore .tsx sources.
    writeFileSync(join(dir, 'split.ts'), [
      "declare module '@deepseek-ai/cordis' {",
      '  interface Context {',
      '    first: FirstService',
      '  }',
      '}',
      'declare module "@deepseek-ai/cordis" {',
      '  interface Events {',
      "    'second/changed'(): void",
      '  }',
      '}',
      'export {}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'view.tsx'), [
      "declare module '@deepseek-ai/cordis' {",
      '  interface Context {',
      '    fromTsx: TsxService',
      '  }',
      '}',
      'export {}',
      '',
    ].join('\n'))
    /** 中文说明：变量 merges 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const merges = contextMergeFiles(root, ['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx'])
    expect(merges.map(m => m.rel)).toEqual([
      'packages/client/ui-x/src/split.ts',
      'packages/client/ui-x/src/split.ts',
      'packages/client/ui-x/src/view.tsx',
    ])
    /** 中文说明：函数值 keys 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const keys = merges.flatMap(m => [...contextKeyMap(m.body, m.sf).keys()])
    /** 中文说明：函数值 events 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const events = merges.flatMap(m => eventNameList(m.body, m.sf))
    expect(keys).toEqual(['first', 'fromTsx'])
    expect(events).toEqual(['second/changed'])
  })

  it('reads string-literal and identifier member names from an Events merge', () => {
    /** 中文说明：变量 sf 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sf = ts.createSourceFile('x.ts', [
      "declare module '@deepseek-ai/cordis' {",
      '  interface Events {',
      "    'scope/list'(items: string[]): void",
      '    plain(): void',
      '  }',
      '  interface Context {',
      '    thing: ThingService',
      '  }',
      '}',
      '',
    ].join('\n'), ts.ScriptTarget.Latest, true)
    /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const body = sf.statements[0] && ts.isModuleDeclaration(sf.statements[0]) && sf.statements[0].body
      && ts.isModuleBlock(sf.statements[0].body)
      ? sf.statements[0].body
      : null
    if (!body) throw new Error('fixture did not parse to a module block')
    expect(eventNameList(body, sf)).toEqual(['scope/list', 'plain'])
    expect([...contextKeyMap(body, sf)]).toEqual([['thing', 'ThingService']])
  })
})
