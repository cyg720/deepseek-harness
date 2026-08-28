/**
 * Tests for the filesystem Service Definition: registration, duplicate-service
 * behavior, disposal, and the branded id factories. The provider primitives and
 * policy live in `dsh-fs-local` and `dsh-fs-observation-policy`; this seam owns only the
 * abstract service contract, so a minimal fake backend exercises it.
 */
/*
 * 文件职责：验证文件系统与工具的 service.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证文件系统与工具操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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

/** A minimal in-memory fake implementing the provider primitives. */
/* 中文说明：类型或类 FakeFileSystem 约束文件或目标数据职责。 */
class FakeFileSystem extends FileSystem {
  files = new Map<string, string>()

  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(path), displayPath: path }
  }
  override processPath(target: FsTarget): string { return String(target.targetKey) }
  override fileUrl(target: FsTarget): string { return `file:///${encodeURIComponent(String(target.targetKey))}` }
  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }
  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(target.targetKey)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(path)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async readText(target: FsTarget): Promise<string> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(target.targetKey)
    if (content === undefined) throw new FsError(`not found: ${target.displayPath}`, 'FS_NOT_FOUND')
    return content
  }
  override async streamText(target: FsTarget): Promise<AsyncIterable<string>> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = await this.readText(target)
    return (async function* () { yield content })()
  }
  override async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    /** 中文说明：测试局部值 bytes，由紧邻初始化决定。 */
    const bytes = new TextEncoder().encode(await this.readText(target))
    if (bytes.length > maxBytes) {
      throw new FsError(`too large: ${target.displayPath}`, 'FS_TOO_LARGE')
    }
    return bytes
  }
  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    if (target.targetKey !== 'skills') throw new FsError(`not a directory: ${target.displayPath}`, 'FS_NOT_DIRECTORY')
    return [
      {
        name: 'alpha.md',
        type: 'file',
        target: { targetKey: FsTargetKey('skills/alpha.md'), displayPath: 'skills/alpha.md' },
        size: 2,
        version: FsVersion('v1'),
      },
    ]
  }
  override async writeText(target: FsTarget, content: string, _expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = this.files.get(target.targetKey) ?? null
    this.files.set(target.targetKey, content)
    return { operation: before !== null ? 'update' : 'create', version: FsVersion('v2'), before, after: content }
  }
  override async editText(target: FsTarget, edit: FsEditRequest): Promise<FsEditOutcome> {
    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = this.files.get(target.targetKey) ?? ''
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = content.split(edit.oldString).join(edit.newString)
    this.files.set(target.targetKey, after)
    return { version: FsVersion('v3'), before: content, after }
  }
}

describe('FileSystem provider seam', () => {
  it('registers as ctx.fs and serves the primitives', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
    const fs = ctx.fs as FakeFileSystem
    expect(fs.sandboxMode).toBeUndefined()
    expect(fs.processPathFromHostPath('/host/file')).toBeUndefined()
    fs.files.set('a.txt', 'hi')
    /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
    const target = await fs.resolve('a.txt')
    expect((await fs.stat(target))?.type).toBe('file')
    expect(await fs.readText(target)).toBe('hi')
  })

  it('throws when a second implementation is loaded (duplicate service)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    await expect(ctx.plugin(FakeFileSystem)).rejects.toThrow()
  })

  it('removes the service when the providing fiber is disposed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(FakeFileSystem)
    expect(ctx.fs).toBeDefined()
    await fiber.dispose()
    expect(ctx.fs).toBeUndefined()
  })

  it('streamText yields the same text readText returns', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
    const fs = ctx.fs as FakeFileSystem
    fs.files.set('a.txt', 'one\ntwo')
    /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
    const target = await fs.resolve('a.txt')
    /** 中文说明：测试局部值 streamed，由紧邻初始化决定。 */
    let streamed = ''
    /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
    for await (const chunk of await fs.streamText(target)) streamed += chunk
    expect(streamed).toBe(await fs.readText(target))
  })

  it('readBytes returns raw content and enforces the byte cap with FS_TOO_LARGE', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
    const fs = ctx.fs as FakeFileSystem
    fs.files.set('a.bin', 'hi')
    /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
    const target = await fs.resolve('a.bin')
    expect(await fs.readBytes(target, undefined, 2)).toEqual(new TextEncoder().encode('hi'))
    await expect(fs.readBytes(target, undefined, 1)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  })

  it('listDir returns child entry targets without reading file content', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
    const fs = ctx.fs as FakeFileSystem
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    const entries = await fs.listDir(await fs.resolve('skills'))
    expect(entries).toEqual([{
      name: 'alpha.md',
      type: 'file',
      target: { targetKey: 'skills/alpha.md', displayPath: 'skills/alpha.md' },
      size: 2,
      version: 'v1',
    }])
  })

  it('stat returns undefined for an absent target', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
    const fs = ctx.fs as FakeFileSystem
    expect(await fs.stat(await fs.resolve('missing.txt'))).toBeUndefined()
  })

  it('lstat returns path metadata before resolving a target', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FakeFileSystem)
    /** 中文说明：测试局部值 fs，由紧邻初始化决定。 */
    const fs = ctx.fs as FakeFileSystem
    fs.files.set('a.txt', 'hi')
    expect(await fs.lstat('a.txt')).toEqual({ version: 'v1', type: 'file', size: 2 })
    expect(await fs.lstat('missing.txt')).toBeUndefined()
  })
})

describe('branded id factories', () => {
  it('FsTargetKey and FsVersion brand a string at compile time (identity at runtime)', () => {
    expect(FsTargetKey('k')).toBe('k')
    expect(FsVersion('v')).toBe('v')
  })
})

describe('FsError', () => {
  it('carries a stable code and HarnessError name', () => {
    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = new FsError('nope', 'FS_NOT_FOUND')
    expect(error.code).toBe('FS_NOT_FOUND')
    expect(error.name).toBe('FsError')
    expect(error).toBeInstanceOf(Error)
  })

  it('chains an underlying cause through ErrorOptions', () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = new Error('EACCES')
    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = new FsError('cannot read', 'FS_ABORTED', { cause: root })
    expect(error.cause).toBe(root)
    expect(error.code).toBe('FS_ABORTED')
  })
})
