// One-shot boot upgrade of the pre-release flat layout: a key stored by an
// earlier build must survive the versioned-document change without a hand
// edit, byte for byte, while everything the recognizer cannot prove flat
// keeps the loud rejection local.spec exercises.
/**
 * 文件职责：验证本地凭据存储的 migration.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证本地凭据存储在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { LocalCredentialProvider, renderFlatLayoutMigration } from '../src/index.ts'

/** Credential documents are seeded owner-only, exactly as the provider creates them. */
/** 中文说明：函数 writeCredentials 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function writeCredentials(file: string, text: string): Promise<void> {
  return writeFile(file, text, { mode: 0o600 })
}

/** 中文说明：测试局部值 cleanups，由紧邻初始化决定。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** 中文说明：函数 tempDir 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function tempDir(): Promise<string> {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-migration-'))
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

// Every spelling an earlier build accepted: plain, quoted, block-scalar, a
// comment header, an interior blank line, and a key that happens to spell a
// section name of the versioned layout.
/** 中文说明：测试局部值 FLAT，由紧邻初始化决定。 */
const FLAT = [
  '# keys stored before the versioned layout',
  'DSH_CRED_TEST: stored',
  '',
  '# annotates the quoted entry',
  "DSH_CRED_OTHER: 'quoted value'",
  'DSH_CRED_BLOCK: |',
  '  first line',
  '  second line',
  'records: tricky',
].join('\n') + '\n'

/** 中文说明：测试局部值 MIGRATED，由紧邻初始化决定。 */
const MIGRATED = [
  'version: 1',
  'refs:',
  '  # keys stored before the versioned layout',
  '  DSH_CRED_TEST: stored',
  '',
  '  # annotates the quoted entry',
  "  DSH_CRED_OTHER: 'quoted value'",
  '  DSH_CRED_BLOCK: |',
  '    first line',
  '    second line',
  '  records: tricky',
].join('\n') + '\n'

describe('flat-layout boot migration', () => {
  it('upgrades the flat document in place, byte for byte, and serves its keys', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, FLAT)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe(MIGRATED)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toEqual({ value: 'stored', source: 'file' })
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_OTHER')))
      .toEqual({ value: 'quoted value', source: 'file' })
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_BLOCK')))
      .toEqual({ value: 'first line\nsecond line\n', source: 'file' })
    expect(await ctx.credentials.resolve(credentialRef('records'))).toEqual({ value: 'tricky', source: 'file' })
  })

  it('a second boot reads the migrated document without touching it', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, FLAT)
    await boot({ path, watch: false })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe(MIGRATED)
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toEqual({ value: 'stored', source: 'file' })
  })

  it('yields to a concurrent migrator under the writer lock', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, FLAT)
    /** 中文说明：测试局部值 winner，由紧邻初始化决定。 */
    const winner = 'version: 1\nrefs:\n  DSH_CRED_TEST: winner\n'
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release!: () => void
    /** 中文说明：测试局部值 held，由紧邻初始化决定。 */
    const held = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：测试局部值 acquired，由紧邻初始化决定。 */
    let acquired!: () => void
    /** 中文说明：测试局部值 holding，由紧邻初始化决定。 */
    const holding = new Promise<void>((resolve) => { acquired = resolve })
    /** 中文说明：测试局部值 holder，由紧邻初始化决定。 */
    const holder = withFileLock(path, async () => {
      acquired()
      await held
    })
    await holding
    // The boot sees the flat text, then waits for the lock; the "other
    // process" completes the migration in the meantime.
    /** 中文说明：测试局部值 booting，由紧邻初始化决定。 */
    const booting = boot({ path, watch: false })
    await writeCredentials(path, winner)
    release()
    await holder
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await booting
    expect(await readFile(path, 'utf8')).toBe(winner)
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toEqual({ value: 'winner', source: 'file' })
  })

  it('leaves an empty flow mapping alone', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, '{}\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe('{}\n')
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toBeUndefined()
  })

  it('leaves a comment-only document alone', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, '# nothing stored yet\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, watch: false })
    expect(await readFile(path, 'utf8')).toBe('# nothing stored yet\n')
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST'))).toBeUndefined()
  })

  it('renders a final newline for a document that lacks one', () => {
    expect(renderFlatLayoutMigration('DSH_CRED_TEST: bare')).toBe('version: 1\nrefs:\n  DSH_CRED_TEST: bare\n')
  })
})
