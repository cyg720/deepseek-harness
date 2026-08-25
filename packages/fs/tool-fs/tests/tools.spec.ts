/**
 * Consumer API tests over a fake provider and the real policy collaborator: schemas,
 * validation, formatting, typed errors, intent dispatch, and observation-driven authorization.
 */
/**
 * 文件职责：验证文件系统与工具的 tools.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证文件系统与工具操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolResult } from '@deepseek-ai/dsh-tools'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { STREAM_MIN_SIZE } from '../src/read.ts'
import { formatReadOutput } from '../src/read-render.ts'
import type { FileReadOutcome } from '../src/read-render.ts'
import { sessionCwd } from '../src/session-cwd.ts'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/** An in-memory fake provider; a test can arm a rejection on any primitive. */
/** 中文说明：类型或类 FakeFs 约束文件或目标数据职责。 */
class FakeFs extends FileSystem {
  files = new Map<string, string>()
  rejectWith?: FsError
  writeIntents: (FsWriteIntent | undefined)[] = []
  editIntents: ({ version: FsVersion } | undefined)[] = []

  private throwIfArmed(): void {
    if (this.rejectWith) throw this.rejectWith
  }

  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(`key:${path}`), displayPath: `/abs/${path}` }
  }
  override processPath(target: FsTarget): string { return String(target.targetKey) }
  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }
  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }
  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    this.throwIfArmed()
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(target.targetKey)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(`key:${path}`)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async readText(target: FsTarget): Promise<string> {
    return this.files.get(target.targetKey) ?? ''
  }
  override async streamText(target: FsTarget): Promise<AsyncIterable<string>> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(target.targetKey) ?? ''
    return (async function* () { yield content })()
  }
  override async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    /** 中文说明：测试局部值 bytes，由紧邻初始化决定。 */
    const bytes = new TextEncoder().encode(this.files.get(target.targetKey) ?? '')
    if (bytes.length > maxBytes) {
      throw new FsError(`too large: ${target.displayPath}`, 'FS_TOO_LARGE')
    }
    return bytes
  }
  override async listDir(_target: FsTarget): Promise<FsDirEntry[]> {
    return []
  }
  override async writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    this.throwIfArmed()
    this.writeIntents.push(expected)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = this.files.get(target.targetKey) ?? null
    this.files.set(target.targetKey, content)
    return { operation: before !== null ? 'update' : 'create', version: FsVersion('v2'), before, after: content }
  }
  override async editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }): Promise<FsEditOutcome> {
    this.throwIfArmed()
    this.editIntents.push(expected)
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(target.targetKey) ?? ''
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = content.split(edit.oldString).join(edit.newString)
    this.files.set(target.targetKey, after)
    return { version: FsVersion('v3'), before: content, after }
  }
}

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeFs)
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
  const fs = ctx.fs as FakeFs
  return { ctx, fs }
}

/** 中文说明：测试局部值 callCounter，由紧邻初始化决定。 */
let callCounter = 0
/** 中文说明：函数 call 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function call(ctx: Context, name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent: agent as never } : {},
  })
}

/** 中文说明：函数 text 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('session cwd resolution', () => {
  /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
  const execution = (cwd?: string) => cwd === undefined
    ? {}
    : { agent: { session: { header: { cwd } } } }

  it('retains ordinary spelling but resolves the cwd before parent traversal', () => {
    /** 中文说明：测试局部值 cwd，由紧邻初始化决定。 */
    const cwd = process.cwd()
    /** 中文说明：测试局部值 throughParent，由紧邻初始化决定。 */
    const throughParent = `${cwd}${sep}..`
    expect(sessionCwd(execution() as never, 'file.txt')).toBeUndefined()
    expect(sessionCwd(execution(cwd) as never, 'file.txt')).toBe(cwd)
    expect(sessionCwd(execution(throughParent) as never, 'file.txt')).toBe(realpathSync.native(throughParent))

    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-fs-session-cwd-'))
    /** 中文说明：测试局部值 physical，由紧邻初始化决定。 */
    const physical = join(root, 'physical')
    /** 中文说明：测试局部值 link，由紧邻初始化决定。 */
    const link = join(root, 'link')
    try {
      mkdirSync(physical)
      symlinkSync(physical, link, process.platform === 'win32' ? 'junction' : 'dir')
      expect(sessionCwd(execution(link) as never, 'child.txt')).toBe(link)
      expect(sessionCwd(execution(link) as never, `..${sep}parent.txt`)).toBe(realpathSync.native(link))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('registration', () => {
  it('registers read, write, and edit', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(ctx.tools.schemas().map(s => s.name).sort()).toEqual(['edit', 'read', 'write'])
  })

  it('declares read parallel-safe while write/edit remain exclusive', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: CallId('read-safe'), name: 'read', arguments: { file_path: 'a.txt' } }))
      .toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: CallId('write-exclusive'), name: 'write', arguments: { file_path: 'a.txt', content: 'x' } }))
      .toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: CallId('edit-exclusive'), name: 'edit', arguments: { file_path: 'a.txt', old_string: 'x', new_string: 'y' } }))
      .toEqual({ kind: 'exclusive' })
  })

  it('registers prompt sections for each tool', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('Use the read tool')
    expect(prompt).toContain('Use the write tool')
    expect(prompt).toContain('Use the edit tool')
  })

  it('stays pending until ctx.fs exists (inject)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolFs) // no fs provider
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('unregisters everything on fiber disposal (HMR safety)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeFs)
    await ctx.plugin(FsPolicy)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(ToolFs)
    // Each tool contributes BOTH a schema and a prompt section; disposal must
    // withdraw both, not just the schemas.
    expect(ctx.tools.schemas()).toHaveLength(3)
    /** 中文说明：测试局部值 sectionNames，由紧邻初始化决定。 */
    const sectionNames = (a: { sections: { name: string }[] }) => a.sections.map(s => s.name).sort()
    expect(sectionNames(await ctx.systemPrompt.assemble())).toEqual(['deployment:persona', 'harness:identity', 'tool:edit', 'tool:read', 'tool:write'])
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
    // Only the system-prompt plugin's own built-in sections remain.
    expect(sectionNames(await ctx.systemPrompt.assemble())).toEqual(['deployment:persona', 'harness:identity'])
  })
})

describe('read tool', () => {
  it('formats line-numbered content with a footer', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:a.txt', 'hello\nworld')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected read success')
    expect(result.value).toEqual({
      path: '/abs/a.txt',
      offset: 1,
      lines: [{ number: 1, text: 'hello' }, { number: 2, text: 'world' }],
      totalLines: 2,
    })
    expect(text(result)).toBe(`<path>/abs/a.txt</path>
<type>file</type>
<content>
1: hello
2: world

(End of file - total 2 lines)
</content>`)
  })

  it('returns an explicit empty canonical line window for an empty file', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:empty.txt', '')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'empty.txt' })
    if (result.isError) throw new Error('expected empty read success')
    expect(result.value).toEqual({ path: '/abs/empty.txt', offset: 1, lines: [], totalLines: 0 })
    expect(text(result)).toContain('(End of file - total 0 lines)')
  })

  it('rejects a non-positive offset via arg validation', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt', offset: 0 })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('offset must be a positive integer')
  })

  it('rejects a fractional offset and a zero/negative limit', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 args，由紧邻初始化决定。 */
    for (const args of [
      { file_path: 'a.txt', offset: 1.5 },
      { file_path: 'a.txt', limit: 0 },
      { file_path: 'a.txt', limit: -3 },
    ]) {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await call(ctx, 'read', args)
      expect(result.isError, JSON.stringify(args)).toBe(true)
      expect(text(result)).toMatch(/must be a positive integer/)
    }
  })

  it('rejects a non-JSON numeric offset before tool-specific validation', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt', offset: Number.NaN })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('tool execution arguments must be losslessly JSON-serializable')
  })

  it('rejects a limit above the cap', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt', limit: 99999 })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('less than or equal to 2000')
  })

  it('rejects a blank file_path', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: '   ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('file_path must be a non-empty string')
  })

  it('records observed state so a follow-up edit by the same session is authorized', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', 'hello')
    expect((await call(ctx, 'read', { file_path: 'a.txt' }, { session })).isError).toBe(false)
    /** 中文说明：测试局部值 edited，由紧邻初始化决定。 */
    const edited = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }, { session })
    expect(edited.isError).toBe(false)
    expect(fs.editIntents).toEqual([{ version: 'v1' }])
  })

  it('propagates FS_NOT_FOUND for an absent file', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'missing.txt' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
  })

  it('rejects a non-regular target', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:d', '')
    fs.stat = async () => ({ version: FsVersion('v1'), type: 'directory' })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'd' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_NOT_REGULAR_FILE' } })
  })

  it('streams a large file (size at/above the cap) instead of reading whole', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:big.txt', 'alpha\nbeta')
    /** 中文说明：测试局部值 readSpy，由紧邻初始化决定。 */
    const readSpy = vi.spyOn(fs, 'readText')
    /** 中文说明：测试局部值 streamSpy，由紧邻初始化决定。 */
    const streamSpy = vi.spyOn(fs, 'streamText')
    fs.stat = async () => ({ version: FsVersion('v1'), type: 'file', size: STREAM_MIN_SIZE })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'big.txt' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('1: alpha')
    expect(streamSpy).toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('streams when the backend reports no size (never buffers a size-less file)', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:a.txt', 'alpha')
    /** 中文说明：测试局部值 streamSpy，由紧邻初始化决定。 */
    const streamSpy = vi.spyOn(fs, 'streamText')
    fs.stat = async () => ({ version: FsVersion('v1'), type: 'file' }) // no size
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(result.isError).toBe(false)
    expect(streamSpy).toHaveBeenCalled()
  })

  it('surfaces a byte-capped read as a truncated footer', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    // Many long lines so the window hits the byte cap before EOF.
    fs.files.set('key:big.txt', Array.from({ length: 2000 }, () => 'y'.repeat(100)).join('\n'))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'big.txt' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Output capped.')
  })

  it('attaches the structured window as presentation meta, and presentResult narrows it into a read card', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:a.ts', 'const x = 1\nconst y = 2')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.ts' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected read success')
    // The extension drives the lang hint; the window rides on persisted meta.
    expect(result.meta).toEqual({
      path: '/abs/a.ts',
      offset: 1,
      lines: [{ number: 1, text: 'const x = 1' }, { number: 2, text: 'const y = 2' }],
      totalLines: 2,
      lang: 'ts',
    })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = ctx.tools.get('read')?.presentResult?.({ file_path: 'a.ts' }, result)
    expect(view).toEqual({
      card: 'read',
      path: '/abs/a.ts',
      offset: 1,
      lines: [{ number: 1, text: 'const x = 1' }, { number: 2, text: 'const y = 2' }],
      totalLines: 2,
      lang: 'ts',
      content: [{ type: 'text', text: '1: const x = 1\n2: const y = 2\n\n(End of file - total 2 lines)' }],
    })
  })

  it('omits the lang hint in meta for an extension that maps to no language', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:notes', 'plain')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'notes' })
    if (result.isError) throw new Error('expected read success')
    expect(result.meta).toEqual({ path: '/abs/notes', offset: 1, lines: [{ number: 1, text: 'plain' }], totalLines: 1 })
  })
})

describe('formatReadOutput footer variants', () => {
  /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
  const base: FileReadOutcome = { offset: 1, lines: [{ number: 1, text: 'x' }], totalLines: 1 }

  it('reports a byte-capped read', () => {
    /** 中文说明：测试局部值 out，由紧邻初始化决定。 */
    const out = formatReadOutput('/f', { ...base, totalLines: 99, truncatedByBytes: true })
    expect(out).toContain('(Output capped. Showing lines 1-1. Use offset=2 to continue.)')
  })

  it('reports a more-remaining page', () => {
    /** 中文说明：测试局部值 out，由紧邻初始化决定。 */
    const out = formatReadOutput('/f', { ...base, totalLines: 99 })
    expect(out).toContain('(Showing lines 1-1 of 99. Use offset=2 to continue.)')
  })

  it('reports end-of-file', () => {
    expect(formatReadOutput('/f', base)).toContain('(End of file - total 1 lines)')
  })

  it('renders an empty file as just the footer', () => {
    /** 中文说明：测试局部值 out，由紧邻初始化决定。 */
    const out = formatReadOutput('/f', { ...base, lines: [], totalLines: 0 })
    expect(out).toContain('(End of file - total 0 lines)')
    expect(out).not.toContain(': ')
  })
})

describe('write tool', () => {
  it('formats a create result and uses createIfAbsent (unobserved, with the gate)', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'hi' }, { session: { header: {} } })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected write success')
    expect(result.value).toEqual({ path: '/abs/a.txt', operation: 'create', before: null, after: 'hi' })
    expect(text(result)).toContain('Created file')
    expect(fs.writeIntents).toEqual([{ kind: 'createIfAbsent' }])
  })

  it('rejects a blank file_path', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: '   ', content: 'hi' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('file_path must be a non-empty string')
  })

  it('propagates a backend FsError as an isError result carrying its code and remedy', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.rejectWith = new FsError('blocked', 'FS_STALE_VERSION')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'hi' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'FsError', code: 'FS_STALE_VERSION' } })
    expect(text(result)).toContain('re-read the file, then retry')
  })
})

describe('edit tool', () => {
  it('formats a single-replacement success after a read', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', 'a')
    await call(ctx, 'read', { file_path: 'a.txt' }, { session })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'a', new_string: 'b' }, { session })
    if (result.isError) throw new Error('expected edit success')
    expect(result.value).toEqual({ path: '/abs/a.txt', before: 'a', after: 'b' })
    expect(text(result)).toBe('The file /abs/a.txt has been updated successfully.')
  })

  it('formats the replace_all success message distinctly', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', 'a a a')
    await call(ctx, 'read', { file_path: 'a.txt' }, { session })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'a', new_string: 'b', replace_all: true }, { session })
    expect(text(result)).toBe('The file /abs/a.txt has been updated. All occurrences were successfully replaced.')
  })

  it('rejects identical old/new strings', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'x', new_string: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('must differ')
  })

  it('rejects an empty old_string', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: '', new_string: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('old_string must be a non-empty string')
  })

  it('rejects a blank file_path', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: '  ', old_string: 'a', new_string: 'b' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('file_path must be a non-empty string')
  })

  it('propagates FS_NOT_OBSERVED when the file was never read (the gate decides)', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    fs.files.set('key:a.txt', 'hello')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'a', new_string: 'b' }, { session: { header: {} } })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
  })
})

describe('tool-owned presentation (pure presentCall)', () => {
  // presentCall is a pure display function of args (no I/O); it drives the
  // card's title/kind and the `locations` a UI follows along to.
  /** 中文说明：测试局部值 presentCall，由紧邻初始化决定。 */
  const presentCall = async (name: string, args: unknown) => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    return ctx.tools.get(name)?.presentCall?.(args)
  }

  /** 中文说明：测试局部值 presentResult，由紧邻初始化决定。 */
  const presentResult = async (name: string, args: unknown, result: ToolResult) => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    return ctx.tools.get(name)?.presentResult?.(args, result)
  }

  it('read: generic card titled by file with the read window, read kind, location with the offset line', async () => {
    expect(await presentCall('read', { file_path: 'src/a.ts', offset: 12, limit: 40 })).toEqual({
      card: 'generic', title: 'Read src/a.ts (12 - 51)', kind: 'read',
      locations: [{ path: 'src/a.ts', line: 12 }],
    })
  })

  it('read: bare title and line-1 location when offset/limit are unset', async () => {
    expect(await presentCall('read', { file_path: 'a.txt' })).toEqual({
      card: 'generic', title: 'Read a.txt', kind: 'read', locations: [{ path: 'a.txt', line: 1 }],
    })
  })

  it('read: completed presentation is a read card carrying the structured window with the envelope stripped', async () => {
    // The structured line data rides on persisted meta (the raw output object is
    // not on the wire); presentResult narrows it and appends the stripped text as
    // the no-capability `content` fallback.
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = { path: '/tmp/a.ts', offset: 1, lines: [{ number: 1, text: 'hello' }], totalLines: 1, lang: 'ts' }
    expect(await presentResult('read', { file_path: 'a.ts' }, {
      content: [{ type: 'text', text: '<path>/tmp/a.ts</path>\n<type>file</type>\n<content>\n1: hello\n\n(End of file - total 1 lines)\n</content>' }],
      isError: false,
      meta,
    })).toEqual({
      card: 'read',
      path: '/tmp/a.ts',
      offset: 1,
      lines: [{ number: 1, text: 'hello' }],
      totalLines: 1,
      lang: 'ts',
      content: [{ type: 'text', text: '1: hello\n\n(End of file - total 1 lines)' }],
    })
    // A window whose extension maps to no language omits `lang` from the card.
    expect(await presentResult('read', { file_path: 'notes' }, {
      content: [{ type: 'text', text: '<path>/tmp/notes</path>\n<type>file</type>\n<content>\nbody\n</content>' }],
      isError: false,
      meta: { path: '/tmp/notes', offset: 1, lines: [{ number: 1, text: 'body' }], totalLines: 1 },
    })).toEqual({
      card: 'read',
      path: '/tmp/notes',
      offset: 1,
      lines: [{ number: 1, text: 'body' }],
      totalLines: 1,
      content: [{ type: 'text', text: 'body' }],
    })
    // Malformed envelope text with valid meta still declines (the fallback text is unavailable).
    expect(await presentResult('read', { file_path: 'a.ts' }, {
      content: [{ type: 'text', text: 'malformed replay' }],
      isError: false,
      meta,
    })).toBeUndefined()
    // Valid envelope but absent/malformed meta declines to the generic fallback.
    expect(await presentResult('read', { file_path: 'a.ts' }, {
      content: [{ type: 'text', text: '<path>/tmp/a.ts</path>\n<type>file</type>\n<content>\n1: hello\n</content>' }],
      isError: false,
    })).toBeUndefined()
    expect(await presentResult('read', { file_path: 'a.ts' }, {
      content: [{ type: 'text', text: '<path>/tmp/a.ts</path>\n<type>file</type>\n<content>\n1: hello\n</content>' }],
      isError: false,
      meta: { path: '/tmp/a.ts', lines: 'nope', totalLines: 1 },
    })).toBeUndefined()
  })

  it('read: completed presentation declines errors and non-single-text content', async () => {
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    const envelope = '<path>/tmp/a.txt</path>\n<type>file</type>\n<content>\nbody\n</content>'
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = { path: '/tmp/a.txt', offset: 1, lines: [{ number: 1, text: 'body' }], totalLines: 1 }
    expect(await presentResult('read', { file_path: 'a.txt' }, {
      content: [{ type: 'text', text: envelope }],
      isError: true,
      meta,
    })).toBeUndefined()
    expect(await presentResult('read', { file_path: 'a.txt' }, {
      content: [{ type: 'text', text: envelope }, { type: 'text', text: 'second' }],
      isError: false,
      meta,
    })).toBeUndefined()
    expect(await presentResult('read', { file_path: 'a.txt' }, {
      content: [{ type: 'reasoning', text: envelope }],
      isError: false,
      meta,
    })).toBeUndefined()
  })

  it('read: "from line N" window when only offset is set', async () => {
    expect(await presentCall('read', { file_path: 'a.txt', offset: 5 })).toEqual({
      card: 'generic', title: 'Read a.txt (from line 5)', kind: 'read', locations: [{ path: 'a.txt', line: 5 }],
    })
  })

  it('write: diff card (new-file style, oldText null), location', async () => {
    expect(await presentCall('write', { file_path: 'out.txt', content: 'hello' })).toEqual({
      card: 'diff', title: 'Write out.txt',
      diffs: [{ path: 'out.txt', oldText: null, newText: 'hello' }],
      locations: [{ path: 'out.txt' }],
    })
  })

  it('read: a limit with no offset windows from line 1', async () => {
    expect(await presentCall('read', { file_path: 'a.txt', limit: 10 })).toEqual({
      card: 'generic', title: 'Read a.txt (1 - 10)', kind: 'read', locations: [{ path: 'a.txt', line: 1 }],
    })
  })

  it('edit: an empty old_string maps to oldText null (a whole-file replace diff)', async () => {
    // presentCall runs on replay of raw logged args, which parseEditArgs does not
    // gate — an empty old_string must still produce a valid diff (oldText null).
    expect(await presentCall('edit', { file_path: 'a.txt', old_string: '', new_string: 'seed' })).toEqual({
      card: 'diff', title: 'Edit a.txt',
      diffs: [{ path: 'a.txt', oldText: null, newText: 'seed' }],
      locations: [{ path: 'a.txt' }],
    })
  })
})

describe('result-time contextual diff (meta + presentResult)', () => {
  // An edit records the applied contextual hunk on `tool/result` meta, and the tool's
  // presentResult narrows it back into a replayable `diff` result card.
  /** 中文说明：测试局部值 withContext，由紧邻初始化决定。 */
  const withContext = 'a\nb\nc\nOLD\nd\ne\nf\n'

  it('edit: execute attaches the applied hunk as meta { diffs }', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', withContext)
    await call(ctx, 'read', { file_path: 'a.txt' }, { session })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'OLD', new_string: 'NEW' }, { session })
    expect(result.isError).toBe(false)
    expect(result.meta).toEqual({
      diffs: [{ path: 'a.txt', oldText: 'a\nb\nc\nOLD\nd\ne\nf', newText: 'a\nb\nc\nNEW\nd\ne\nf' }],
    })
  })

  it('edit: presentResult turns the meta into a diff result card', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', withContext)
    await call(ctx, 'read', { file_path: 'a.txt' }, { session })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'OLD', new_string: 'NEW' }, { session })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = ctx.tools.get('edit')?.presentResult?.({ file_path: 'a.txt', old_string: 'OLD', new_string: 'NEW' }, result)
    expect(view).toEqual({
      card: 'diff', title: 'Edit a.txt',
      diffs: [{ path: 'a.txt', oldText: 'a\nb\nc\nOLD\nd\ne\nf', newText: 'a\nb\nc\nNEW\nd\ne\nf' }],
    })
  })

  it('write OVERWRITE: execute attaches a contextual hunk; presentResult renders a diff card', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', withContext)
    await call(ctx, 'read', { file_path: 'a.txt' }, { session })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'a\nb\nc\nNEW\nd\ne\nf\n' }, { session })
    expect(result.isError).toBe(false)
    expect(result.meta).toEqual({ diffs: [{ path: 'a.txt', oldText: 'a\nb\nc\nOLD\nd\ne\nf', newText: 'a\nb\nc\nNEW\nd\ne\nf' }] })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = ctx.tools.get('write')?.presentResult?.({ file_path: 'a.txt', content: 'x' }, result)
    expect(view).toEqual({ card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: 'a\nb\nc\nOLD\nd\ne\nf', newText: 'a\nb\nc\nNEW\nd\ne\nf' }] })
  })

  it('write CREATE: an empty applied-diff projection still falls back to the whole-file diff card', async () => {
    // A create has no prior content, yet the completed replacement view must
    // remain a diff instead of clobbering the pending new-file diff with text.
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'new.txt', content: 'fresh\n' }, { session })
    expect(result.isError).toBe(false)
    expect(result.meta).toEqual({ diffs: [] })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = ctx.tools.get('write')?.presentResult?.({ file_path: 'new.txt', content: 'fresh\n' }, result)
    expect(view).toEqual({ card: 'diff', title: 'Write new.txt', diffs: [{ path: 'new.txt', oldText: null, newText: 'fresh\n' }] })
  })

  it('write OVERWRITE with identical content: an empty applied-diff projection falls back to a whole-file diff', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { header: {} }
    fs.files.set('key:a.txt', 'same\n')
    await call(ctx, 'read', { file_path: 'a.txt' }, { session })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'same\n' }, { session })
    expect(result.isError).toBe(false)
    expect(result.meta).toEqual({ diffs: [] })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = ctx.tools.get('write')?.presentResult?.({ file_path: 'a.txt', content: 'same\n' }, result)
    expect(view).toEqual({ card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'same\n' }] })
  })

  it('presentResult returns undefined on an error result (nothing applied)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 errorResult，由紧邻初始化决定。 */
    const errorResult = { content: [{ type: 'text' as const, text: 'Error: boom' }], isError: true }
    expect(ctx.tools.get('edit')?.presentResult?.({ file_path: 'a.txt', old_string: 'x', new_string: 'y' }, errorResult)).toBeUndefined()
    expect(ctx.tools.get('write')?.presentResult?.({ file_path: 'a.txt', content: 'y' }, errorResult)).toBeUndefined()
  })

  it('edit presentResult returns undefined on malformed meta (defensive narrowing)', async () => {
    // edit has no whole-file fallback (only a literal replacement), so a malformed
    // meta yields the generic "updated successfully" rendering.
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 badMeta，由紧邻初始化决定。 */
    const badMeta = { content: [{ type: 'text' as const, text: 'ok' }], isError: false, meta: { diffs: 'nope' } }
    expect(ctx.tools.get('edit')?.presentResult?.({ file_path: 'a.txt', old_string: 'x', new_string: 'y' }, badMeta)).toBeUndefined()
  })

  it('write presentResult falls back to a whole-file diff on malformed meta (never leaks the result text)', async () => {
    // write always renders a diff card so the completed update can't clobber the
    // pending diff with the model-facing text; a malformed meta falls back to the
    // args-derived whole-file diff, same as a create.
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 badMeta，由紧邻初始化决定。 */
    const badMeta = { content: [{ type: 'text' as const, text: 'ok' }], isError: false, meta: { diffs: 'nope' } }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = ctx.tools.get('write')?.presentResult?.({ file_path: 'a.txt', content: 'y' }, badMeta)
    expect(view).toEqual({ card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'y' }] })
  })
})

describe('read caps are plugin config', () => {
  /** 中文说明：函数 setupWith 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function setupWith(config: ToolFs.Config) {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeFs)
    await ctx.plugin(FsPolicy)
    await ctx.plugin(ToolFs, config)
    return { ctx, fs: ctx.fs as FakeFs }
  }

  it('a configured readLimit is both the default and the cap, and the schema names it', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupWith({ readLimit: 2 })
    fs.files.set('key:a.txt', 'one\ntwo\nthree\nfour')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(text(result)).toContain('(Showing lines 1-2 of 4. Use offset=3 to continue.)')
    /** 中文说明：测试局部值 overCap，由紧邻初始化决定。 */
    const overCap = await call(ctx, 'read', { file_path: 'a.txt', limit: 3 })
    expect(overCap.isError).toBe(true)
    expect(text(overCap)).toContain('less than or equal to 2')
    /** 中文说明：测试局部值 readSchema，由紧邻初始化决定。 */
    const readSchema = ctx.tools.schemas().find(s => s.name === 'read')
    expect(JSON.stringify(readSchema)).toContain('Defaults to 2.')
  })

  it('a configured readMaxLineLength truncates lines at the configured length', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupWith({ readMaxLineLength: 4 })
    fs.files.set('key:a.txt', 'abcdefgh')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(text(result)).toContain('1: abcd... (line truncated to 4 chars)')
  })

  it('a configured readMaxBytes caps the window at the configured bytes', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupWith({ readMaxBytes: 9 })
    fs.files.set('key:a.txt', 'aaaa\nbbbb\ncccc')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected read success')
    expect(result.value).toMatchObject({ totalLines: 3 })
    expect(text(result)).toContain('Output capped.')
    expect(text(result)).not.toContain('cccc')
  })

  it('a configured readStreamMinSize routes smaller files to the streaming path', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupWith({ readStreamMinSize: 5 })
    fs.files.set('key:a.txt', 'alpha\nbeta')
    /** 中文说明：测试局部值 readSpy，由紧邻初始化决定。 */
    const readSpy = vi.spyOn(fs, 'readText')
    /** 中文说明：测试局部值 streamSpy，由紧邻初始化决定。 */
    const streamSpy = vi.spyOn(fs, 'streamText')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'read', { file_path: 'a.txt' })
    expect(result.isError).toBe(false)
    expect(streamSpy).toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['readLimit', { readLimit: 0 }],
    ['readLimit', { readLimit: 2.5 }],
    ['readMaxLineLength', { readMaxLineLength: -1 }],
    ['readMaxBytes', { readMaxBytes: Number.NaN }],
    ['readStreamMinSize', { readStreamMinSize: 0 }],
  ] as const)('rejects a non-positive or fractional %s at load', async (name, config) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeFs)
    await expect(ctx.plugin(ToolFs, config)).rejects.toThrow(new RegExp(`tool-fs: ${name} must be a positive integer`))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in ToolFs).toBe(false)
  })
})

describe('sandbox escalation API (write/edit)', () => {
  /** A confining fake `ctx.fs`: reports a default mode, records each per-call policy, and can arm a sandbox denial. */
  /** 中文说明：类型或类 SandboxingFakeFs 约束文件或目标数据职责。 */
  class SandboxingFakeFs extends FakeFs {
    stamped: (SandboxExecutionPolicy | undefined)[] = []
    override get sandboxMode(): SandboxMode {
      return 'workspace-write'
    }
    override async writeText(
      target: FsTarget,
      content: string,
      expected?: FsWriteIntent,
      _signal?: AbortSignal,
      sandboxPolicy?: SandboxExecutionPolicy,
    ): Promise<FsWriteOutcome> {
      this.stamped.push(sandboxPolicy)
      return super.writeText(target, content, expected)
    }
    override async editText(
      target: FsTarget,
      edit: FsEditRequest,
      expected?: { version: FsVersion },
      _signal?: AbortSignal,
      sandboxPolicy?: SandboxExecutionPolicy,
    ): Promise<FsEditOutcome> {
      this.stamped.push(sandboxPolicy)
      return super.editText(target, edit, expected)
    }
  }

  /** 中文说明：函数 setupConfining 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function setupConfining(opts: { approval?: boolean } = {}) {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write' })
    await ctx.plugin(SandboxingFakeFs)
    await ctx.plugin(FsPolicy)
    if (opts.approval === true) await ctx.plugin(ApprovalService)
    await ctx.plugin(ToolFs)
    return { ctx, fs: ctx.fs as SandboxingFakeFs }
  }

  /** A fake agent whose session records appends (the approval audit trail), mid-turn, carrying the given events for the fold. */
  /** 中文说明：函数 escalationAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function escalationAgent(events: Array<{ type: string; data?: Record<string, unknown> }> = []): object {
    return {
      id: 'agent-fs-esc',
      session: {
        header: { version: 0, id: 'sess-fs-esc', createdAt: 0, cwd: '/session-project' },
        events: [{ type: 'turn/start' }, ...events],
        append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }) },
      },
    }
  }

  /** 中文说明：函数 fsSchema 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function fsSchema(ctx: Context, name: 'write' | 'edit') {
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = ctx.tools.schemas().find(s => s.name === name)
    if (!schema) throw new Error(`${name} tool not registered`)
    return schema as unknown as { parameters: { properties: Record<string, { enum?: string[] }> } }
  }

  it('fails load when a confining filesystem has no shared sandbox-policy resolver', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SandboxingFakeFs)
    await expect(ctx.plugin(ToolFs)).rejects.toThrow('tool-fs: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  })

  it('advertises no escalation fields under a non-confining backend', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(ctx.fs.sandboxMode).toBeUndefined()
    /** 中文说明：测试局部值 name，由紧邻初始化决定。 */
    for (const name of ['write', 'edit'] as const) {
      /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
      const props = fsSchema(ctx, name).parameters.properties
      expect(props['sandbox_permissions']).toBeUndefined()
      expect(props['justification']).toBeUndefined()
    }
  })

  it('advertises the closed target vocabulary on write and edit under a confining backend', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setupConfining()
    /** 中文说明：测试局部值 name，由紧邻初始化决定。 */
    for (const name of ['write', 'edit'] as const) {
      /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
      const props = fsSchema(ctx, name).parameters.properties
      expect(props['sandbox_permissions']?.enum).toEqual(['workspace-write', 'danger-full-access'])
      expect(props['justification']).toBeDefined()
    }
  })

  it('a plain write stamps the default mode with the calling session root', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupConfining()
    await call(ctx, 'write', { file_path: 'a.txt', content: 'x' }, escalationAgent())
    expect(fs.stamped).toEqual([{ mode: 'workspace-write', workspaceRoot: resolve('/session-project') }])
  })

  it('a standing session override folds onto the stamp', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupConfining()
    await call(ctx, 'write', { file_path: 'a.txt', content: 'x' }, escalationAgent([{ type: 'sandbox/mode', data: { mode: 'read-only' } }]))
    expect(fs.stamped).toEqual([{ mode: 'read-only', workspaceRoot: resolve('/session-project') }])
  })

  it('a denied write maps to the shared marker plus the escalation hint (isError)', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupConfining()
    fs.rejectWith = new FsError('denied', 'FS_SANDBOX_DENIED')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'x' }, escalationAgent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(text(result)).toContain('retry this exact operation once with sandbox_permissions')
  })

  it('a non-FS_SANDBOX_DENIED provider error passes through unchanged', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupConfining()
    fs.rejectWith = new FsError('boom', 'FS_IO_ERROR')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'x' }, escalationAgent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('boom')
    expect(text(result)).not.toContain('[sandbox:')
  })

  it('an approved escalation stamps the granted mode onto that write', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupConfining({ approval: true })
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
    // Pass a signal so the escalation ask forwards it to the approval request
    // (the request rides the tool-execution abort signal).
    await ctx.tools.execute({
      callId: CallId('call-fs-esc-grant'),
      name: 'write',
      arguments: { file_path: 'a.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'the test needs it' },
      agent: escalationAgent() as never,
      signal: new AbortController().signal,
    })
    expect(fs.stamped).toEqual([{ mode: 'danger-full-access', workspaceRoot: resolve('/session-project') }])
  })

  it('a rejected escalation fails closed with its own text and never mutates', async () => {
    /** 中文说明：测试局部值 { ctx, fs }，由紧邻初始化决定。 */
    const { ctx, fs } = await setupConfining({ approval: true })
    ctx.on('approval/request', () => Promise.resolve('rejected' as const))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y', sandbox_permissions: 'danger-full-access', justification: 'the test needs it' }, escalationAgent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the user rejected escalating this operation to "danger-full-access"')
    expect(fs.stamped).toEqual([])
  })

  it('escalation without an approval service fails closed', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setupConfining()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'why' }, escalationAgent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no approval service is composed')
  })

  it('escalation with an approval service but no agent fails closed', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setupConfining({ approval: true })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'x', sandbox_permissions: 'danger-full-access', justification: 'why' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no agent to route it through')
  })

  it('rejects the escalation argument pairing (one field without the other)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setupConfining()
    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = await call(ctx, 'write', { file_path: 'a.txt', content: 'x', sandbox_permissions: 'workspace-write' }, escalationAgent())
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('sandbox_permissions requires a justification')
  })

  it('sandbox_permissions under a non-confining backend fails closed (unadvertised field still reaches execute)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await call(ctx, 'write', { file_path: 'a.txt', content: 'x', sandbox_permissions: 'workspace-write', justification: 'why' }, escalationAgent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not available in this composition')
  })
})
