/**
 * Display metadata is presentation, never capability: every way of getting it
 * wrong degrades to "this preset has no display text" rather than to a
 * preset that cannot be discovered or mounted. It also cannot carry identity
 * — `id` is the directory and `trust` is the root, so neither is readable
 * from the file a user can write.
 */
/*
 * 文件职责：验证 metadata.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { METADATA_FILE, readPresetMetadata, renderPresetMetadata } from '../src/metadata.ts'

/** Every temp preset directory created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A preset directory holding exactly the given metadata text. */
/* 中文说明：函数 presetDir 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function presetDir(content?: string): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-preset-meta-'))
  tempDirs.push(dir)
  await mkdir(dir, { recursive: true })
  if (content !== undefined) await writeFile(join(dir, METADATA_FILE), content)
  return dir
}

describe('reading display metadata', () => {
  it('reads a name and a description', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: 标准模式\ndescription: 完整的编码 agent。\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '标准模式', description: '完整的编码 agent。' })
  })

  it('treats an absent file as no metadata', async () => {
    // The common case: every preset authored by duplicating another starts
    // without one, and a picker simply falls back to the id.
    expect(await readPresetMetadata(await presetDir())).toEqual({})
  })

  it('treats malformed YAML as no metadata', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: [unclosed\n')

    // Display text is not worth failing discovery over — the composition
    // beside it still mounts.
    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it.each([
    ['a list', '- name: x\n'],
    ['a scalar', 'just a string\n'],
    ['an empty document', ''],
  ])('treats %s as no metadata', async (_label, content) => {
    expect(await readPresetMetadata(await presetDir(content))).toEqual({})
  })

  it('ignores fields that are not text', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: 42\ndescription:\n  nested: true\n')

    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it('ignores blank text rather than showing an empty name', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: "   "\ndescription: ""\n')

    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it('trims surrounding whitespace', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: "  极简模式  "\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '极简模式' })
  })

  it('reads a declared order', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: 标准模式\norder: 1\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '标准模式', order: 1 })
  })

  it('ignores an order that is not a finite number', async () => {
    expect(await readPresetMetadata(await presetDir('order: first\n'))).toEqual({})
    expect(await readPresetMetadata(await presetDir('order: .inf\n'))).toEqual({})
  })

  it('cannot carry identity or trust', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir('name: mine\nid: standard\ntrust: system\n')

    // A locally authored preset writing `trust: system` must not become a
    // shipped one; identity comes from the directory and the root it sits in.
    expect(await readPresetMetadata(dir)).toEqual({ name: 'mine' })
  })
})

describe('rendering display metadata', () => {
  it('round-trips through a read', async () => {
    /** 中文说明：变量 rendered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = renderPresetMetadata({ name: '创造模式', description: '可以改自己的组装。' })
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await presetDir(rendered)

    expect(await readPresetMetadata(dir)).toEqual({ name: '创造模式', description: '可以改自己的组装。' })
  })

  it('stores a declared order', () => {
    expect(renderPresetMetadata({ name: '标准模式', order: 1 })).toBe('name: 标准模式\norder: 1\n')
  })

  it('omits an absent field rather than writing it blank', () => {
    expect(renderPresetMetadata({ name: '极简模式' })).toBe('name: 极简模式\n')
    // Description without a name is legal too: the picker falls back to the id.
    expect(renderPresetMetadata({ description: '只做检索。' })).toBe('description: 只做检索。\n')
  })

  it('renders nothing when there is nothing to store', () => {
    // Clearing both fields removes the file; an empty document would read as
    // an intentional blank name.
    expect(renderPresetMetadata({})).toBeUndefined()
    expect(renderPresetMetadata({ name: '  ', description: '' })).toBeUndefined()
  })
})
