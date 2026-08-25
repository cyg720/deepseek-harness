/**
 * Tests for the LOCAL spill backend: `saveText` writes a session-scoped file and
 * returns a locator + byte length + retrieval hint, filename sanitization
 * neutralizes traversal, the configured `root` is honored (and the private
 * default when omitted), and a storage failure rejects. The Cordis-free
 * `store.ts` helpers are exercised directly for the naming/encoding edge cases.
 */
/**
 * 文件职责：验证 spill-local.spec.ts 覆盖的大结果落盘行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的大结果落盘能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SaveTextSpill } from '@deepseek-ai/dsh-spill'
import LocalSpillStore, { encodeSegment, privateRoot, saveTextFile, sessionDir } from '@deepseek-ai/dsh-spill-local'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-spill-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 request 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function request(overrides: Partial<SaveTextSpill> = {}): SaveTextSpill {
  return {
    owner: { sessionId: SessionId('sess-1') },
    source: { toolName: 'web_fetch', callId: CallId('call-1'), label: 'result' },
    suggestedName: 'web_fetch.txt',
    content: 'the full body',
    ...overrides,
  }
}

describe('encodeSegment', () => {
  it('keeps the safe set literal', () => {
    expect(encodeSegment('web_fetch.txt')).toBe('web_fetch.txt')
    expect(encodeSegment('a-B_9.z')).toBe('a-B_9.z')
  })

  it('escapes separators and tilde (dots are literal except as whole-segment tokens)', () => {
    // `.` is in the safe set, so `..` inside a longer string stays literal; the
    // traversal defense is that separators escape, keeping the result ONE segment.
    expect(encodeSegment('../etc/passwd')).toBe('..~002Fetc~002Fpasswd')
    expect(encodeSegment('a/b')).toBe('a~002Fb')
    expect(encodeSegment('~')).toBe('~007E')
  })

  it('escapes the whole-segment dot tokens', () => {
    expect(encodeSegment('.')).toBe('~002E')
    expect(encodeSegment('..')).toBe('~002E~002E')
  })

  it('encodes the empty string to a non-empty segment', () => {
    expect(encodeSegment('')).toBe('~')
  })
})

describe('sessionDir', () => {
  it('is a stable per-session hash under the root', () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = sessionDir('/spill', 'sess-1')
    expect(dir).toBe(sessionDir('/spill', 'sess-1'))
    expect(dirname(dir)).toBe(normalize('/spill'))
    expect(basename(dir)).toMatch(/^session-[0-9a-f]{12}$/)
    expect(sessionDir('/spill', 'sess-2')).not.toBe(dir)
  })
})

describe('saveTextFile', () => {
  it('writes the content under the session dir and reports bytes', async () => {
    /** 中文说明：变量 saved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const saved = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'héllo' })
    expect(readFileSync(saved.path, 'utf8')).toBe('héllo')
    expect(saved.bytes).toBe(Buffer.byteLength('héllo', 'utf8'))
    expect(dirname(saved.path)).toBe(sessionDir(root, 'sess-1'))
    expect(basename(saved.path)).toMatch(/^[0-9a-f]{12}-r\.txt$/)
  })

  it('sanitizes a traversal-shaped suggested name into one segment', async () => {
    /** 中文说明：变量 saved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const saved = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: '../../evil', content: 'x' })
    // The separators escaped, so the whole name is one leaf under the session dir.
    expect(dirname(saved.path)).toBe(sessionDir(root, 'sess-1'))
    expect(saved.path.includes('/..')).toBe(false)
  })

  it('creates the session directory and file with owner-only POSIX permissions', async () => {
    /** 中文说明：变量 saved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const saved = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'x' })
    /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directory = statSync(dirname(saved.path))
    /** 中文说明：变量 file 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const file = statSync(saved.path)
    expect(directory.isDirectory()).toBe(true)
    expect(file.isFile()).toBe(true)
    if (process.platform !== 'win32') {
      expect(directory.mode & 0o777).toBe(0o700)
      expect(file.mode & 0o777).toBe(0o600)
    }
  })

  it('gives distinct paths to two saves of the same name', async () => {
    /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const a = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'a' })
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'b' })
    expect(a.path).not.toBe(b.path)
  })
})

describe('privateRoot', () => {
  it('is a stable absolute directory under the temp dir', () => {
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = privateRoot()
    expect(isAbsolute(first)).toBe(true)
    expect(privateRoot()).toBe(first)
  })
})

describe('LocalSpillStore service', () => {
  it('registers as ctx.spillStore and saves under the configured root', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LocalSpillStore, { root })
    /** 中文说明：变量 ref 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ref = await ctx.spillStore.saveText(request())
    expect(dirname(ref.locator)).toBe(sessionDir(root, 'sess-1'))
    expect(readFileSync(ref.locator, 'utf8')).toBe('the full body')
    expect(ref.bytes).toBe(Buffer.byteLength('the full body', 'utf8'))
    expect(ref.retrievalHint).toBe('Use read with offset/limit, or grep this path to search within it.')
  })

  it('resolves a relative configured root to absolute', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LocalSpillStore, { root: '.' })
    expect(isAbsolute((ctx.spillStore as LocalSpillStore).root)).toBe(true)
  })

  it('falls back to the private root when none is configured', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LocalSpillStore, {})
    expect((ctx.spillStore as LocalSpillStore).root).toBe(privateRoot())
  })

  it('rejects when the root is not writable (missing parent, exclusive open)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    // A file (not a dir) as the root makes mkdir under it fail — a real storage error.
    /** 中文说明：变量 filePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const filePath = (await saveTextFile({ root, sessionId: 's', suggestedName: 'f', content: 'x' })).path
    await ctx.plugin(LocalSpillStore, { root: filePath })
    await expect(ctx.spillStore.saveText(request())).rejects.toThrow()
  })
})
