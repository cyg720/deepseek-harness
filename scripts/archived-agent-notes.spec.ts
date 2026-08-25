/**
 * 文件职责：验证 archived-agent-notes.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { describe, expect, it } from 'vitest'
import {
  extendArchiveManifest,
  gitBlobHash,
  parseArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  /** 中文说明：type ArchiveManifest 定义本测试所需的数据或行为，用于表达Agent 预设场景。 */
  type ArchiveManifest,
} from './archived-agent-notes.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(): Map<string, Buffer> {
  /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const base = '2026-07-26-example'
  /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = Buffer.from(`# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26\n\nEnglish | [中文](${base}.zh.md)\n\n## Problem\n\nExample.\n`)
  /** 中文说明：变量 zh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zh = Buffer.from(`# Agent Note: 示例\n\nStatus: implemented\nArchived: 2026-07-26\n\n[English](${base}.md) | 中文\n\n## 问题\n\n示例。\n`)
  /** 中文说明：变量 meta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const meta = Buffer.from(`${base}.md: ${gitBlobHash(source)}\n${base}.zh.md: ${gitBlobHash(zh)}\n`)
  return new Map([
    [`process/${base}.md`, source],
    [`process/${base}.zh.md`, zh],
    [`process/${base}.i18n.yaml`, meta],
  ])
}

describe('archived Agent Notes', () => {
  it('recognizes archived paths with POSIX and Windows separators', () => {
    expect(isArchivedAgentNotePath('.agents/notes/archived/process/example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents\\notes\\archived\\process\\example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents/notes/implemented/process/example.md')).toBe(false)
  })

  it('accepts one complete implemented triplet with matching archive metadata', () => {
    expect(validateArchiveArtifacts(fixture())).toEqual([])
  })

  it('rejects incomplete triplets and invalid archive headers', () => {
    /** 中文说明：变量 artifacts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const artifacts = fixture()
    artifacts.delete('process/2026-07-26-example.i18n.yaml')
    artifacts.set(
      'process/2026-07-26-example.md',
      Buffer.from('# Agent Note: Example\n\nStatus: proposed\nArchived: yesterday\n'),
    )
    expect(validateArchiveArtifacts(artifacts).join('\n')).toMatch(/incomplete archived triplet/)
  })

  it('extends the manifest without permitting a sealed change or removal', () => {
    /** 中文说明：变量 artifacts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const artifacts = fixture()
    /** 中文说明：变量 empty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const empty: ArchiveManifest = { version: 1, files: {} }
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = extendArchiveManifest(empty, artifacts)
    expect(first.errors).toEqual([])
    expect(first.added).toHaveLength(3)

    /** 中文说明：变量 sealed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sealed: ArchiveManifest = { version: 1, files: first.files }
    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed = new Map(artifacts)
    changed.set('process/2026-07-26-example.md', Buffer.from('changed'))
    expect(extendArchiveManifest(sealed, changed).errors).toEqual([
      'process/2026-07-26-example.md: sealed content hash changed',
    ])
    changed.delete('process/2026-07-26-example.zh.md')
    expect(extendArchiveManifest(sealed, changed).errors).toContain(
      'process/2026-07-26-example.zh.md: sealed artifact is missing',
    )
  })

  it('rejects replacing manifest seals alongside changed archive content', () => {
    /** 中文说明：变量 artifacts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const artifacts = fixture()
    /** 中文说明：变量 initial 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const initial = extendArchiveManifest({ version: 1, files: {} }, artifacts)
    /** 中文说明：变量 baseline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const baseline: ArchiveManifest = { version: 1, files: initial.files }
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = 'process/2026-07-26-example.md'
    /** 中文说明：变量 changedArtifacts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changedArtifacts = new Map(artifacts)
    changedArtifacts.set(path, Buffer.from('changed'))
    /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacement = extendArchiveManifest({ version: 1, files: {} }, changedArtifacts)
    /** 中文说明：变量 current 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const current: ArchiveManifest = { version: 1, files: replacement.files }

    expect(extendArchiveManifest(current, changedArtifacts).errors).toEqual([])
    expect(validateArchiveManifestExtension(baseline, current)).toEqual([
      `${path}: sealed manifest hash changed`,
    ])
    /** 中文说明：变量 removed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removed: ArchiveManifest = {
      version: 1,
      files: Object.fromEntries(Object.entries(current.files).filter(([candidate]) => candidate !== path)),
    }
    expect(validateArchiveManifestExtension(baseline, removed)).toContain(
      `${path}: sealed manifest entry is missing`,
    )
  })

  it('round-trips the deterministic manifest schema', () => {
    /** 中文说明：变量 content 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = renderArchiveManifest({ 'process/z.md': `sha256:${'a'.repeat(64)}` })
    expect(parseArchiveManifest(content)).toEqual({
      version: 1,
      files: { 'process/z.md': `sha256:${'a'.repeat(64)}` },
    })
  })
})
