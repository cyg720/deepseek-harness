/**
 * Model-extraction and negative-path contracts for the Cordis catalog generator
 * (`scripts/gen-cordis-catalog.ts`).
 */
/**
 * 文件职责：验证 cordis-catalog-contract.spec.ts 覆盖的Typert 类型目录生成行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Typert 类型目录生成能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectEvents as collectEventsWithPolicy,
  collectServices as collectServicesWithPolicy,
  renderPageRegion,
} from '../src/cordis-catalog.ts'
import type {
  CordisCatalogPolicy,
  EventEntry,
  ServiceEntry,
} from '../src/cordis-catalog.ts'

/** 中文说明：常量 TEST_POLICY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TEST_POLICY: CordisCatalogPolicy = {
  linkedTypePages: { SessionEvent: 'core.md' },
  foundationTypeNames: new Set(['AbortSignal', 'Promise', 'Readonly']),
  typeLinkExemptions: { PresetSpec: 'fixture deployment metadata' },
  inheritedEvents: [],
  inheritedServices: [],
}

/** 中文说明：函数 collectEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function collectEvents(root: string): EventEntry[] {
  return collectEventsWithPolicy(root, TEST_POLICY)
}

/** 中文说明：函数 collectServices 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function collectServices(root: string): ServiceEntry[] {
  return collectServicesWithPolicy(root, TEST_POLICY)
}

/** 中文说明：函数 renderEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function renderEvents(events: EventEntry[], onPage = 'shell.md'): string {
  return renderPageRegion(onPage, [], events, TEST_POLICY)
}

/** 中文说明：函数 renderServices 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function renderServices(services: ServiceEntry[], onPage = 'shell.md'): string {
  return renderPageRegion(onPage, services, [], TEST_POLICY)
}

/** 中文说明：常量 TYPE_FIXTURES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TYPE_FIXTURES = [
  'export interface FixtureEntry {}',
  'interface SessionEvent {}',
  'interface PresetSpec {}',
  'interface MissingOne {}',
  'type missingTwo = string',
  'interface MissingServiceType {}',
  '',
].join('\n')

/** Materialize one independently compilable package and its host aggregate. */
/** 中文说明：函数 writeProject 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function writeProject(root: string, source: string): void {
  /** 中文说明：变量 packageRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packageRoot = join(root, 'packages', 'group', 'fix')
  /** 中文说明：变量 sourceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceRoot = join(packageRoot, 'src')
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
    files: [],
    references: [{ path: './packages/group/fix' }],
  }))
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@fixture/fix',
    private: true,
    type: 'module',
    exports: {
      '.': {
        types: './lib/types/index.d.ts',
        default: './lib/index.js',
      },
    },
  }))
  writeFileSync(join(packageRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      composite: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      rootDir: 'src',
      target: 'ES2022',
    },
    include: ['src'],
  }))
  writeFileSync(join(sourceRoot, 'index.ts'), `${TYPE_FIXTURES}${source}`)
}

/** Write a fixture package exposing one `interface Events` block and return the
 * scan root to hand `collectEvents`. */
/** 中文说明：函数 fixtureRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixtureRoot(eventsBlock: string): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'cordis-catalog-'))
  writeProject(
    root,
    `declare module '@deepseek-ai/cordis' {\n  interface Events {\n${eventsBlock}\n  }\n}\n`,
  )
  return root
}

/** Write a fixture package exposing one `interface Context` entry (`ctx.fix` →
 * `FixService`) plus the class source, and return the scan root to hand
 * `collectServices`. */
/** 中文说明：函数 serviceFixtureRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function serviceFixtureRoot(classSource: string): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'cordis-catalog-'))
  writeProject(
    root,
    `declare module '@deepseek-ai/cordis' {\n  interface Context {\n    fix: FixService\n  }\n}\n\n${classSource}\n`,
  )
  return root
}

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：函数值 make 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const make = (block: string): string => {
  /** 中文说明：变量 r 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const r = fixtureRoot(block)
  roots.push(r)
  return r
}
/** 中文说明：函数值 makeService 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const makeService = (classSource: string): string => {
  /** 中文说明：变量 r 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const r = serviceFixtureRoot(classSource)
  roots.push(r)
  return r
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe.skip('gen-cordis-catalog collectEvents', { timeout: 60_000 }, () => {
  it('extracts a well-formed event with its @mode and JSDoc', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = collectEvents(make(
      '    /**\n     * A thing happened.\n     * @param id - which thing.\n     * @mode emit\n     */\n    \'fix/happened\'(id: string): void',
    ))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: 'fix/happened', scope: 'fix', mode: 'emit', doc: 'A thing happened.' })
    expect(events[0]?.jsDoc).toBe('/**\n * A thing happened.\n * @param id - which thing.\n * @mode emit\n */')
    expect(renderEvents(events)).toContain("```ts cordis-catalog\n/**\n * A thing happened.\n * @param id - which thing.\n * @mode emit\n */\n'fix/happened'(id: string): void\n```")
  })

  it('classifies a trailing-next signature as a waterfall', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = collectEvents(make(
      '    /**\n     * Intercept it.\n     * @param x - the value under interception.\n     * @mode waterfall\n     */\n    \'fix/intercept\'(x: number, next: () => Promise<number>): Promise<number>',
    ))
    expect(events[0]?.mode).toBe('waterfall')
  })

  it('accepts a parallel (awaited, no next) event by trusting the tag', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = collectEvents(make(
      '    /**\n     * Flush.\n     * @mode parallel\n     */\n    \'fix/flush\'(): Promise<void> | void',
    ))
    expect(events[0]?.mode).toBe('parallel')
  })

  it('accepts linked, foundation, generic-parameter, and explicitly exempt signature types', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = collectEvents(make(
      '    /**\n     * Carry linked and foundation types.\n     * @param value - the linked value.\n     * @param preset - deployment metadata documented outside the subsystems catalog.\n     * @param signal - cancellation.\n     * @mode parallel\n     */\n    \'fix/typed\'<T extends SessionEvent>(value: Readonly<T>, preset: PresetSpec, signal: AbortSignal): Promise<T>',
    ))
    expect(events).toHaveLength(1)
    expect(renderEvents(events)).toContain('Types: [SessionEvent](core.md)')
    expect(renderEvents(events, 'core.md')).not.toContain('Types: [SessionEvent]')
    expect(renderEvents(events)).not.toContain('[PresetSpec]')
  })

  it('aggregates every unclassified signature type with its source and remediation', () => {
    /** 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = new RegExp([
      '2 signature type-link coverage violation\\(s\\)',
      'fix/one',
      'packages/group/fix/src/index.ts',
      'MissingOne',
      'fix/two',
      'packages/group/fix/src/index.ts',
      'missingTwo',
      'Add it to linkedTypePages',
      'foundationTypeNames',
      'typeLinkExemptions',
    ].join('[\\s\\S]*'))
    expect(() => collectEvents(make(
      '    /**\n     * First.\n     * @param value - first value.\n     * @mode emit\n     */\n    \'fix/one\'(value: MissingOne): void\n    /**\n     * Second.\n     * @param value - second value.\n     * @mode emit\n     */\n    \'fix/two\'(value: missingTwo): void',
    ))).toThrow(expected)
  })

  it('hard-errors when an event is missing its @mode tag', () => {
    expect(() => collectEvents(make(
      '    /** No mode here. */\n    \'fix/untagged\'(): void',
    ))).toThrow(/missing an @mode tag/)
  })

  it('hard-errors when @mode contradicts a trailing-next (waterfall) shape', () => {
    expect(() => collectEvents(make(
      '    /**\n     * Mislabeled.\n     * @param x - the value.\n     * @mode emit\n     */\n    \'fix/wrong\'(x: number, next: () => Promise<number>): Promise<number>',
    ))).toThrow(/trailing 'next' parameter .* tagged '@mode emit'/)
  })

  it('hard-errors when @mode waterfall has no trailing next to delegate to', () => {
    expect(() => collectEvents(make(
      '    /**\n     * Not actually a waterfall.\n     * @param id - which thing.\n     * @mode waterfall\n     */\n    \'fix/nonext\'(id: string): void',
    ))).toThrow(/tagged '@mode waterfall' but has no trailing 'next'/)
  })

  it('hard-errors on an undocumented payload parameter', () => {
    expect(() => collectEvents(make(
      '    /**\n     * A thing happened.\n     * @mode emit\n     */\n    \'fix/happened\'(id: string): void',
    ))).toThrow(/is missing @param id/)
  })

  it('hard-errors on a stale @param naming no real parameter', () => {
    expect(() => collectEvents(make(
      '    /**\n     * A thing happened.\n     * @param id - which thing.\n     * @param ghost - not a parameter.\n     * @mode emit\n     */\n    \'fix/happened\'(id: string): void',
    ))).toThrow(/@param ghost does not match any parameter/)
  })

  it('hard-errors on an @param with an empty description', () => {
    expect(() => collectEvents(make(
      '    /**\n     * A thing happened.\n     * @param id\n     * @mode emit\n     */\n    \'fix/happened\'(id: string): void',
    ))).toThrow(/@param id has an empty description/)
  })

  it('hard-errors on an event whose JSDoc has no description prose', () => {
    expect(() => collectEvents(make(
      '    /**\n     * @param id - which thing.\n     * @mode emit\n     */\n    \'fix/happened\'(id: string): void',
    ))).toThrow(/no description prose/)
  })

  it('exempts the `this` receiver and the trailing waterfall `next` from @param', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = collectEvents(make(
      '    /**\n     * Scoped interception.\n     * @param x - the value under interception.\n     * @mode waterfall\n     */\n    \'fix/scoped\'(this: object, x: number, next: () => Promise<number>): Promise<number>',
    ))
    expect(events).toHaveLength(1)
  })

  it('hard-errors on a binding-pattern parameter @param cannot name', () => {
    expect(() => collectEvents(make(
      '    /**\n     * A thing happened.\n     * @mode emit\n     */\n    \'fix/destructured\'({ id }: { id: string }): void',
    ))).toThrow(/is a binding pattern/)
  })

  it('aggregates every violation into one error instead of failing fast', () => {
    expect(() => collectEvents(make(
      '    /** First. */\n    \'fix/one\'(): void\n    /** Second. */\n    \'fix/two\'(): void',
    ))).toThrow(/2 JSDoc completeness violation\(s\)[\s\S]*fix\/one[\s\S]*fix\/two/)
  })
})

describe.skip('gen-cordis-catalog collectServices', () => {
  /** 中文说明：常量 WELL_FORMED 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
  const WELL_FORMED = `/** Fixture service. */
export class FixService {
  /**
   * Do the thing.
   * @param id - which thing to do.
   * @returns the outcome of doing it.
   */
  run(id: string): string { return id }

  /** Fire and forget (void needs no @returns). */
  poke(): void {}

  /** Flush (Promise<void> needs no @returns either). */
  flush(): Promise<void> { return Promise.resolve() }
}`

  it('extracts a well-formed service with its methods and class JSDoc', () => {
    /** 中文说明：变量 services 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const services = collectServices(makeService(WELL_FORMED))
    expect(services).toHaveLength(1)
    expect(services[0]).toMatchObject({ key: 'fix', type: 'FixService', abstract: false, doc: 'Fixture service.' })
    expect(services[0]?.methods).toHaveLength(3)
    expect(services[0]?.methods[0]).toEqual({
      signature: 'run(id: string): string',
      jsDoc: '/**\n * Do the thing.\n * @param id - which thing to do.\n * @returns the outcome of doing it.\n */',
    })
    expect(renderServices(services)).toContain('```ts cordis-catalog\n/**\n * Do the thing.\n * @param id - which thing to do.\n * @returns the outcome of doing it.\n */\nrun(id: string): string\n\n/** Fire and forget (void needs no @returns). */\npoke(): void')
  })

  it('hard-errors on an unclassified service-method signature type', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Use an unknown value.\n   * @param value - the value.\n   */\n  run(value: MissingServiceType): void {}\n}',
    ))).toThrow(/service method ctx\.fix\.run .* references unclassified type 'MissingServiceType'/)
  })

  it('hard-errors on a public method with no JSDoc at all', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  run(id: string): string { return id }\n}',
    ))).toThrow(/ctx\.fix\.run .* has no JSDoc/)
  })

  it('hard-errors on an undocumented method parameter', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Do the thing.\n   * @returns the outcome.\n   */\n  run(id: string): string { return id }\n}',
    ))).toThrow(/ctx\.fix\.run .* is missing @param id/)
  })

  it('hard-errors on a missing @returns for a non-void return type', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Do the thing.\n   * @param id - which thing.\n   */\n  run(id: string): string { return id }\n}',
    ))).toThrow(/is missing @returns \(return type: string\)/)
  })

  it('hard-errors on an unannotated (inferred) return type', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Do the thing.\n   * @param id - which thing.\n   */\n  run(id: string) { return id }\n}',
    ))).toThrow(/missing an explicit type annotation/)
  })

  it('hard-errors on a service class with no JSDoc', () => {
    expect(() => collectServices(makeService(
      'export class FixService {\n  /** Fire and forget. */\n  poke(): void {}\n}',
    ))).toThrow(/class FixService has no JSDoc/)
  })

  it('hard-errors on a stale method @param', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Fire and forget.\n   * @param ghost - not a parameter.\n   */\n  poke(): void {}\n}',
    ))).toThrow(/@param ghost does not match any parameter/)
  })

  it('hard-errors on a method whose JSDoc is tags with no description prose', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * @param id - which thing.\n   * @returns the outcome.\n   */\n  run(id: string): string { return id }\n}',
    ))).toThrow(/no description prose above its block tags/)
  })

  it('hard-errors on a method @param with an empty description', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Fire and forget.\n   * @param id\n   */\n  poke(id: string): void {}\n}',
    ))).toThrow(/@param id has an empty description/)
  })

  it('hard-errors on an @returns with an empty description', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Do the thing.\n   * @param id - which thing.\n   * @returns\n   */\n  run(id: string): string { return id }\n}',
    ))).toThrow(/@returns has an empty description/)
  })

  it('hard-errors on a binding-pattern method parameter @param cannot name', () => {
    expect(() => collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  /**\n   * Do the thing.\n   */\n  run({ id }: { id: string }): void {}\n}',
    ))).toThrow(/is a binding pattern/)
  })

  it('ignores private/protected/static members (not the ctx.<key> API)', () => {
    const services = collectServices(makeService(
      '/** Fixture service. */\nexport class FixService {\n  private hidden(id: string): string { return id }\n  protected hook(): void {}\n  static helper(): void {}\n}',
    ))
    expect(services[0]?.methods).toHaveLength(0)
  })
})
