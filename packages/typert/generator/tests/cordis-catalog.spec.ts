/**
 * 文件职责：验证 cordis-catalog.spec.ts 覆盖的Typert 类型目录生成行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Typert 类型目录生成能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  projectCordisCatalog,
  renderInheritedPage,
  renderPageRegion,
  /** 中文说明：type CordisCatalogPolicy 定义本测试所需的数据或行为，用于表达Typert 类型目录生成场景。 */
  type CordisCatalogPolicy,
} from '../src/cordis-catalog.ts'
import {
  CORDIS_CATALOG_POLICY,
  EVENT_SCOPE_PAGE,
  localizePageRegion,
  REGION_BEGIN,
  REGION_END,
  SERVICE_PAGE,
} from '../../../../scripts/gen-cordis-catalog.ts'

/** 中文说明：变量 workspaceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/** One workspace projection shared by both cases: analyzing it twice doubles a multi-minute run. */
/* 中文说明：变量 cached 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let cached: ReturnType<typeof projectCordisCatalog> | undefined
/** 中文说明：函数值 projection 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const projection = (): ReturnType<typeof projectCordisCatalog> =>
  (cached ??= projectCordisCatalog(workspaceRoot, CORDIS_CATALOG_POLICY))

/** 中文说明：常量 SOURCE_LINK_POLICY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SOURCE_LINK_POLICY: CordisCatalogPolicy = {
  linkedTypePages: {},
  foundationTypeNames: new Set(),
  typeLinkExemptions: {},
  inheritedEvents: [{ name: 'ready', summary: 'Ready.', source: 'vendor/cordis/src/events.ts:9' }],
  inheritedServices: [{ name: 'ctx.root', summary: 'Root.', source: 'vendor/cordis/src/context.ts:12' }],
}

describe('Typert-backed Cordis catalog', () => {
  it('omits subsystem source lines while preserving inherited Cordis source lines', () => {
    /** 中文说明：变量 page 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const page = renderPageRegion('fixture.md', [{
      key: 'fixture',
      type: 'Fixture',
      abstract: false,
      doc: 'Fixture.',
      methods: [],
      source: 'packages/fixture/service.ts:24',
    }], [{
      name: 'fixture/ready',
      scope: 'fixture',
      signature: "'fixture/ready'(): void",
      jsDoc: '/** Ready. */',
      mode: 'emit',
      doc: 'Ready.',
      source: 'packages/fixture/events.ts:42',
    }], SOURCE_LINK_POLICY)
    /** 中文说明：变量 inherited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inherited = renderInheritedPage(SOURCE_LINK_POLICY)

    expect(page).toContain('Source: [`packages/fixture/events.ts`](../../packages/fixture/events.ts)')
    expect(page).toContain('Source: [`packages/fixture/service.ts`](../../packages/fixture/service.ts)')
    expect(inherited).toContain('([`vendor/cordis/src/events.ts:9`](../../vendor/cordis/src/events.ts))')
    expect(inherited).toContain('([`vendor/cordis/src/context.ts:12`](../../vendor/cordis/src/context.ts))')
  })

  it('reproduces every committed catalog artifact byte for byte', { timeout: 480_000 }, () => {
    const { projector, model } = projection()
    /** 中文说明：函数值 expected 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const expected = (path: string): string => readFileSync(join(workspaceRoot, path), 'utf8')

    expect(renderInheritedPage(CORDIS_CATALOG_POLICY)).toBe(expected('docs/cordis-api/inherited.md'))
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const page of [...new Set([...Object.values(SERVICE_PAGE), ...Object.values(EVENT_SCOPE_PAGE)])].sort()) {
      /** 中文说明：变量 region 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const region = renderPageRegion(
        page,
        [...model.services].filter(s => SERVICE_PAGE[s.key] === page),
        [...model.events].filter(e => EVENT_SCOPE_PAGE[e.scope] === page),
        CORDIS_CATALOG_POLICY,
      )
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const side of [page, page.replace(/\.md$/, '.zh.md')]) {
        /** 中文说明：变量 rel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const rel = `docs/subsystems/${side}`
        /** 中文说明：变量 committed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const committed = expected(rel)
        /** 中文说明：变量 begin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const begin = committed.indexOf(REGION_BEGIN)
        /** 中文说明：变量 end 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const end = committed.indexOf(REGION_END)
        expect(begin, `${rel} carries the region`).toBeGreaterThanOrEqual(0)
        expect(committed.slice(begin, end + REGION_END.length)).toBe(
          localizePageRegion(region, rel, workspaceRoot),
        )
      }
    }
    expect(projector.renderRuntimeApi(model)).toBe(
      expected('packages/extensions/tool-cordis/src/api-catalog.ts'),
    )
  })

  it('resolves each key to the declaration a caller meets, and drops keys no plugin provides', { timeout: 480_000 }, () => {
    /** 中文说明：函数值 byKey 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const byKey = new Map(projection().model.services.map(service => [service.key, service]))
    // An interface-typed key is described by its Service Definition: that is where
    // the contract and, by repository convention, the member JSDoc live.
    expect(byKey.get('lsp')?.type).toBe('LspService')
    // The Service Definition may sit anywhere in the package, including a nested
    // contract directory (`src/api/`), while the Context merge stays in `src`.
    expect(byKey.get('apiProxy')?.type).toBe('ApiProxy')
    // Two packages describe `ctx.typert` — a merge-extensible interface in
    // type-meta and the implementing class in registry. The class wins: it is the
    // object a caller meets and it carries the documentation.
    expect(byKey.get('typert')?.type).toBe('TypertRegistry')
    // Optional keys are values a launcher installs before the tree mounts. No
    // plugin provides them, so describing one as a service would answer "add the
    // plugin that provides it" for a key where no such plugin exists.
    expect(byKey.has('headlessIo')).toBe(false)
    expect(byKey.has('dshHomePath')).toBe(false)
    expect(byKey.has('launcherEnvironment')).toBe(false)
  })
})
