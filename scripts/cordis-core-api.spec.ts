/** Tests for the generated Cordis core API reference. */
/**
 * 中文说明：
 * - 文件职责：验证 Cordis 核心 API 文档生成器从固定 vendor 声明渲染完整页面并拒绝缺失 JSDoc。
 * - 技术维度：使用 Vitest、临时目录、同步文件 API、TypeScript 源码解析和 Markdown 字符串断言。
 * - 产品维度：确保开发者查看的 Cordis API 参考完整、可读，公共类缺少契约时门禁失败。
 * - 逻辑维度：第一例渲染五页并检查关键章节，第二例构造无 JSDoc 类并断言拒绝。
 * - 关键边界：页面清单与 vendored 声明固定绑定；临时目录必须在每例后清理。
 * - 新手阅读建议：先看 CORDIS_CORE_API_PAGES 对应五页，再看最小 Service 源码如何触发失败。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CORDIS_CORE_API_PAGES,
  renderCordisCoreApiPage,
  renderCordisCoreApiPages,
  type CordisCoreApiPage,
} from './cordis-core-api.ts'

/** 当前测试创建且等待清理的临时根目录。 */
const roots: string[] = []

/** 中文：每个用例后删除并清空临时目录。 */
afterEach(() => {
  /** 当前待删除的临时根目录。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文：Cordis 核心 API 文档生成测试组。 */
describe('Cordis core API generation', () => {
  /** 中文：渲染五个固定页面并检查关键类型、方法和契约段落；无参数和返回值。 */
  it('renders the five detailed pages from pinned vendor declarations', () => {
    /** 输出路径到生成 Markdown 的映射。 */
    const pages = renderCordisCoreApiPages()
    expect([...pages.keys()]).toEqual(CORDIS_CORE_API_PAGES.map(page => page.out))
    expect(pages.get('docs/cordis-api/context.md')).toContain('### ctx.extend(meta?)')
    expect(pages.get('docs/cordis-api/events.md')).toContain('## DispatchMode')
    expect(pages.get('docs/cordis-api/fiber.md')).toContain('## EffectMeta')
    expect(pages.get('docs/cordis-api/registry.md')).toContain('## Plugin')
    expect(pages.get('docs/cordis-api/service.md')).toContain('### Service.resolveConfig')

    /** fiber API 页文本，用于检查 effect 的说明和返回值。 */
    const fiber = pages.get('docs/cordis-api/fiber.md') ?? ''
    expect(fiber).toContain('```\n\nRegister a cleanup-aware effect on this fiber.')
    expect(fiber).toContain('- `execute` — the effect body; see `Effect` for accepted shapes.')
    expect(fiber).toContain('**Returns** a disposer that tears the effect down and settles once done.')
  })

  /** 中文：公共类没有源码 JSDoc 时单页渲染必须失败；无参数和返回值。 */
  it('rejects a public core class without source JSDoc', () => {
    /** 当前用例的临时仓库根目录。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-core-api-'))
    roots.push(root)
    mkdirSync(join(root, 'vendor/cordis/src'), { recursive: true })
    writeFileSync(join(root, 'vendor/cordis/src/service.ts'), 'export class Service {\n  run(): string { return "ok" }\n}\n')
    /** 指向临时无注释 Service 类的单页生成描述。 */
    const page: CordisCoreApiPage = {
      out: 'docs/cordis-api/service.md',
      title: 'Service',
      intro: 'Service API.',
      sections: [{ kind: 'class', file: 'vendor/cordis/src/service.ts', symbol: 'Service' }],
    }
    expect(() => renderCordisCoreApiPage(page, root)).toThrow('class Service')
  })
})
