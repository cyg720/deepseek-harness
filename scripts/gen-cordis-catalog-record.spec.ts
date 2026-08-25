/**
 * Negative-path coverage for the guarded pair auto-record
 * (`maybeRecordPair`): the safety property is that regeneration re-records a
 * pair's `.i18n.yaml` ONLY for a region-confined write over a well-formed,
 * previously-consistent record — every other state is left for the pairing
 * gate to report.
 */
/*
 * 文件职责：验证 gen-cordis-catalog-record.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  localizePageRegion,
  maybeRecordPair,
  REGION_BEGIN,
  REGION_END,
  spliceRegion,
} from './gen-cordis-catalog.ts'
import { blobHash, renderPairMeta } from './translation-pairing.ts'

/** 中文说明：常量 PAGE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PAGE = 'docs/subsystems/fix.md'
/** 中文说明：常量 ZH 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ZH = 'docs/subsystems/fix.zh.md'
/** 中文说明：常量 META 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const META = 'docs/subsystems/fix.i18n.yaml'

/** 中文说明：函数 page 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function page(prose: string, region: string): string {
  return `# Fix\n\n${prose}\n\n${REGION_BEGIN}\n${region}\n${REGION_END}\n`
}

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
afterEach(() => {
  /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Lay out a pair on disk and return { root, before } for a regeneration that already wrote `current`. */
/* 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function setup(options: {
  beforeEn: string
  beforeZh: string
  currentEn: string
  currentZh: string
  meta?: string | null
  omitZhSnapshot?: boolean
}): { root: string; before: Map<string, Buffer> } {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'record-guard-'))
  roots.push(root)
  mkdirSync(join(root, 'docs/subsystems'), { recursive: true })
  writeFileSync(join(root, PAGE), options.currentEn)
  writeFileSync(join(root, ZH), options.currentZh)
  /** 中文说明：变量 meta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const meta = options.meta === undefined
    ? renderPairMeta(PAGE, blobHash(Buffer.from(options.beforeEn)), ZH, blobHash(Buffer.from(options.beforeZh)))
    : options.meta
  if (meta !== null) writeFileSync(join(root, META), meta)
  /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const before = new Map<string, Buffer>([[PAGE, Buffer.from(options.beforeEn)]])
  if (!options.omitZhSnapshot) before.set(ZH, Buffer.from(options.beforeZh))
  return { root, before }
}

describe('maybeRecordPair', () => {
  /** 中文说明：变量 beforeEn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const beforeEn = page('prose.', 'old region')
  /** 中文说明：变量 beforeZh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const beforeZh = page('散文。', 'old region')
  /** 中文说明：变量 currentEn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const currentEn = page('prose.', 'new region')
  /** 中文说明：变量 currentZh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const currentZh = page('散文。', 'new region')

  it('re-records a region-confined write over a consistent record', () => {
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh })
    expect(maybeRecordPair(PAGE, before, root)).toBe(true)
    expect(readFileSync(join(root, META), 'utf8'))
      .toBe(renderPairMeta(PAGE, blobHash(Buffer.from(currentEn)), ZH, blobHash(Buffer.from(currentZh))))
  })

  it('refuses when the pair was already out of sync before the run', () => {
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = renderPairMeta(PAGE, blobHash(Buffer.from('drifted long ago\n')), ZH, blobHash(Buffer.from(beforeZh)))
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: stale })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
    expect(readFileSync(join(root, META), 'utf8')).toBe(stale)
  })

  it('refuses a malformed record even when its hashes are current', () => {
    // A renamed key with preserved hashes must stay the pairing gate's error,
    // never become valid through regeneration.
    /** 中文说明：变量 renamedKeys 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const renamedKeys = [
      '# comment',
      `fixXmd: ${blobHash(Buffer.from(beforeEn))}`,
      `fix.zh.md: ${blobHash(Buffer.from(beforeZh))}`,
      '',
    ].join('\n')
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: renamedKeys })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
    expect(readFileSync(join(root, META), 'utf8')).toBe(renamedKeys)
  })

  it('refuses a record with extra entries', () => {
    /** 中文说明：变量 extra 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const extra = renderPairMeta(PAGE, blobHash(Buffer.from(beforeEn)), ZH, blobHash(Buffer.from(beforeZh)))
      + `other.md: ${blobHash(Buffer.from(beforeEn))}\n`
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: extra })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })

  it('refuses a record with a duplicated expected key', () => {
    // Map#set would collapse the duplicate back to size 2; the parser must
    // reject the repeat instead of letting the guard accept the record.
    /** 中文说明：变量 duplicated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const duplicated = [
      `fix.md: ${blobHash(Buffer.from(beforeEn))}`,
      `fix.md: ${blobHash(Buffer.from(beforeEn))}`,
      `fix.zh.md: ${blobHash(Buffer.from(beforeZh))}`,
      '',
    ].join('\n')
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: duplicated })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
    expect(readFileSync(join(root, META), 'utf8')).toBe(duplicated)
  })

  it('refuses when prose drifted alongside the region write', () => {
    /** 中文说明：变量 proseDrift 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const proseDrift = page('prose, edited by a human.', 'new region')
    const { root, before } = setup({ beforeEn, beforeZh, currentEn: proseDrift, currentZh })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })

  it('refuses a brand-new pair with no record', () => {
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: null })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })

  it('refuses when a side has no pre-write snapshot', () => {
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, omitZhSnapshot: true })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })
})

describe('spliceRegion', () => {
  it('replaces exactly the cordis-surface region', () => {
    /** 中文说明：变量 doc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doc = `# T\n\nprose\n\n${REGION_BEGIN}\nold\n${REGION_END}\ntail\n`
    expect(spliceRegion(doc, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toBe(`# T\n\nprose\n\n${REGION_BEGIN}\nnew\n${REGION_END}\ntail\n`)
  })

  it('fails loud on a page carrying only some other generator\'s region', () => {
    // Another generator's markers satisfy the generic region grammar but must
    // never be overwritten by THIS generator's splice.
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = '# T\n\n<!-- BEGIN GENERATED other-surface (other-gen.ts) — do not edit between markers -->\ntheirs\n<!-- END GENERATED other-surface -->\n'
    expect(() => spliceRegion(foreign, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toThrow('expected exactly 1 cordis-surface region, found 0 BEGIN/0 END')
  })

  it('fails loud on duplicate cordis-surface markers', () => {
    /** 中文说明：变量 doubled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doubled = `${REGION_BEGIN}\na\n${REGION_END}\n${REGION_BEGIN}\nb\n${REGION_END}\n`
    expect(() => spliceRegion(doubled, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toThrow('found 2 BEGIN/2 END')
  })
})

describe('localizePageRegion', () => {
  it('changes only paired Markdown paths for the Chinese generated region', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'cordis-region-locale-'))
    roots.push(root)
    mkdirSync(join(root, 'docs/subsystems'), { recursive: true })
    mkdirSync(join(root, 'packages'), { recursive: true })
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'docs/subsystems/target.md'), '# Target\n')
    writeFileSync(join(root, 'docs/subsystems/target.zh.md'), '# 目标\n')
    writeFileSync(join(root, 'docs/subsystems/excluded.md'), '# Excluded\n')
    writeFileSync(join(root, 'docs/subsystems/excluded.zh.md'), '# 排除\n')
    writeFileSync(join(root, 'packages/outside.md'), '# Outside\n')
    writeFileSync(join(root, 'packages/outside.zh.md'), '# 范围外\n')
    writeFileSync(join(root, 'scripts/translation-pairing.manifest.json'), JSON.stringify({
      excluded: ['docs/subsystems/excluded.md'],
    }))
    /** 中文说明：变量 region 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const region = `${REGION_BEGIN}\n[Target](target.md#api) [Excluded](excluded.md) [Outside](../../packages/outside.md)\n${REGION_END}`

    expect(localizePageRegion(region, 'docs/subsystems/page.md', root)).toBe(region)
    expect(localizePageRegion(region, 'docs/subsystems/page.zh.md', root)).toBe(
      `${REGION_BEGIN}\n[Target](target.zh.md#api) [Excluded](excluded.md) [Outside](../../packages/outside.md)\n${REGION_END}`,
    )
  })
})
