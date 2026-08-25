// Third-review behaviors: read-modify-write under the writer lock (external
// edits survive an API write), the contained credentials/reference-updated fan-out (a
// broken observer never fails a committed write), and the YAML document
// editor's isolation between entries.
/**
 * 文件职责：验证凭据存储的 review-fixes.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证凭据存储在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

/** Credential documents are seeded owner-only, exactly as the provider creates them. */
/** 中文说明：函数 writeCredentials 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function writeCredentials(file: string, text: string): Promise<void> {
  return writeFile(file, text, { mode: 0o600 })
}

/** 中文说明：测试局部值 ALPHA，由紧邻初始化决定。 */
const ALPHA = credentialRef('DSH_REVIEW_ALPHA')
/** 中文说明：测试局部值 BETA，由紧邻初始化决定。 */
const BETA = credentialRef('DSH_REVIEW_BETA')
/** 中文说明：测试局部值 INNER，由紧邻初始化决定。 */
const INNER = credentialRef('DSH_REVIEW_INNER')

/** 中文说明：测试局部值 cleanups，由紧邻初始化决定。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** 中文说明：函数 tempDir 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function tempDir(): Promise<string> {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-review-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function boot(config: ConstructorParameters<typeof LocalCredentialProvider>[1]): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin(LocalCredentialProvider, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('read-modify-write', () => {
  it('folds an unobserved external edit into a write instead of overwriting it', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    ctx.on('credentials/reference-updated', (ref) => { seen.push(ref) })
    await ctx.credentials.set(ALPHA, 'one')
    // The external edit has landed on disk but no watcher reported it (watch
    // is off — the same blind spot as a debounce window or a missed event).
    await writeCredentials(path, `version: 1\nrefs:\n  ${ALPHA}: one\n  ${BETA}: external\n`)
    await ctx.credentials.set(ALPHA, 'two')
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = await readFile(path, 'utf8')
    expect(text).toContain(`${BETA}: external`)
    expect(text).toContain(`${ALPHA}: two`)
    // The fold published the unobserved entry before the write's own commit.
    expect(seen).toEqual([ALPHA, BETA, ALPHA])
    expect(await ctx.credentials.resolve(BETA)).toEqual({ value: 'external', source: 'file' })
  })

  it('keeps both refs when two providers write the same document concurrently', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await boot({ path, watch: false })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = await boot({ path, watch: false })
    await Promise.all([
      (async () => { for (const value of ['1', '2', '3'] as const) await first.credentials.set(ALPHA, value) })(),
      (async () => { for (const value of ['1', '2', '3'] as const) await second.credentials.set(BETA, value) })(),
    ])
    /** 中文说明：测试局部值 third，由紧邻初始化决定。 */
    const third = await boot({ path, watch: false })
    expect(await third.credentials.resolve(ALPHA)).toEqual({ value: '3', source: 'file' })
    expect(await third.credentials.resolve(BETA)).toEqual({ value: '3', source: 'file' })
  })

  it('creates the credentials directory owner-only', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = join(dir, 'home')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path: join(home, '.credentials.yaml'), watch: false })
    await ctx.credentials.set(ALPHA, 'one')
    if (process.platform !== 'win32') expect((await stat(home)).mode & 0o777).toBe(0o700)
  })

  it('holds every writer of the document to the record-mutation lock wait', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 holder，由紧邻初始化决定。 */
    const holder = await boot({ path, watch: false })
    /** 中文说明：测试局部值 contender，由紧邻初始化决定。 */
    const contender = await boot({ path, watch: false })
    /** 中文说明：测试局部值 doomed，由紧邻初始化决定。 */
    const doomed = credentialKey('llm-pi-ai', 'doomed')
    /** 中文说明：测试局部值 slowKey，由紧邻初始化决定。 */
    const slowKey = credentialKey('llm-pi-ai', 'slow')
    await holder.credentials.modifyRecord(doomed, () => Promise.resolve({ kind: 'api-key', key: 'x' }))
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    // The mutation holds the cross-process writer lock across a stand-in for
    // an OAuth refresh round trip — longer than withFileLock's 2s default.
    /** 中文说明：测试局部值 slow，由紧邻初始化决定。 */
    const slow = holder.credentials.modifyRecord(slowKey, async () => {
      entered.resolve(undefined)
      await new Promise(resolve => setTimeout(resolve, 2_400))
      return { kind: 'api-key', key: 'slow' }
    })
    await entered.promise
    // The other two writer paths — a reference write and a record delete —
    // share that file and that lock, so they must wait the refresh out rather
    // than fail at the file-work default.
    await Promise.all([
      contender.credentials.set(ALPHA, 'waited'),
      contender.credentials.deleteRecord(doomed),
    ])
    await slow
    /** 中文说明：测试局部值 reread，由紧邻初始化决定。 */
    const reread = await boot({ path, watch: false })
    expect(await reread.credentials.resolve(ALPHA)).toEqual({ value: 'waited', source: 'file' })
    expect(await reread.credentials.readRecord(doomed)).toBeUndefined()
    expect(await reread.credentials.readRecord(slowKey)).toEqual({ kind: 'api-key', key: 'slow' })
  })
})

describe('contained update fan-out', () => {
  it('does not fail a committed set when a listener throws, and later listeners still run', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    ctx.on('credentials/reference-updated', () => {
      throw new Error('observer boom')
    })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = vi.fn()
    ctx.on('credentials/reference-updated', second)
    await expect(ctx.credentials.set(ALPHA, 'one')).resolves.toBeUndefined()
    expect(second).toHaveBeenCalledWith(ALPHA)
    expect(await ctx.credentials.resolve(ALPHA)).toEqual({ value: 'one', source: 'file' })
  })

  it('contains an async listener rejection', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path: join(dir, '.credentials.yaml'), watch: false })
    // An unknown-returning function keeps the typed surface legal while the
    // runtime value is still the rejected promise the containment must handle.
    /** 中文说明：测试局部值 boom，由紧邻初始化决定。 */
    const boom = (): unknown => Promise.reject(new Error('async observer boom'))
    ctx.on('credentials/reference-updated', boom)
    await expect(ctx.credentials.set(ALPHA, 'one')).resolves.toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('rethrows an invariant-coded failure after the commit and the remaining listeners', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    ctx.on('credentials/reference-updated', () => {
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = vi.fn()
    ctx.on('credentials/reference-updated', second)
    await expect(ctx.credentials.set(ALPHA, 'one')).rejects.toThrow(/forged relation/)
    // Harness-fatal by design — but the write itself committed first.
    expect(second).toHaveBeenCalledWith(ALPHA)
    expect(await readFile(path, 'utf8')).toContain(`${ALPHA}: one`)
    expect(await ctx.credentials.resolve(ALPHA)).toEqual({ value: 'one', source: 'file' })
  })
})

describe('document editor', () => {
  it('leaves a sibling multi-line value untouched while patching one entry', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 wrapped，由紧邻初始化决定。 */
    const wrapped = `version: 1\nrefs:\n  DSH_REVIEW_WRAPPED: |-\n    line1\n    line2\n  ${ALPHA}: a\n`
    await writeCredentials(path, wrapped)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    await ctx.credentials.set(ALPHA, 'b')
    expect(await readFile(path, 'utf8'))
      .toBe(`version: 1\nrefs:\n  DSH_REVIEW_WRAPPED: |-\n    line1\n    line2\n  ${ALPHA}: b\n`)
    expect(await ctx.credentials.resolve(credentialRef('DSH_REVIEW_WRAPPED')))
      .toEqual({ value: 'line1\nline2', source: 'file' })
  })

  it('stores a value that looks like another entry without creating one', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    // The stored text must stay a value: a quoted-scalar write that leaked its
    // own structure would silently mint a credential nobody stored.
    await ctx.credentials.set(ALPHA, `${INNER}: injected`)
    /** 中文说明：测试局部值 reread，由紧邻初始化决定。 */
    const reread = await boot({ path, watch: false })
    expect(await reread.credentials.resolve(ALPHA)).toEqual({ value: `${INNER}: injected`, source: 'file' })
    expect(await reread.credentials.resolve(INNER)).toBeUndefined()
  })
})
