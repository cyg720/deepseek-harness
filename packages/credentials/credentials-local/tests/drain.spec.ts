/**
 * 文件职责：验证本地凭据存储的 drain.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证本地凭据存储在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

// The atomic write is the gated asynchronous hold point inside a queued
// write; gating it makes the dispose-versus-queued-write race fully
// deterministic. The lock helper passes through so the gated operation still
// runs inside its real acquire/release cycle.
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  /** 中文说明：测试局部值 actual，由紧邻初始化决定。 */
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
  let gate: Promise<void> = Promise.resolve()
  return {
    ...actual,
    writeFileAtomic: vi.fn(() => gate),
    __setGate: (next: Promise<void>) => {
      gate = next
    },
  }
})

/** 中文说明：函数 setGate 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setGate(next: Promise<void>): Promise<void> {
  /** 中文说明：测试局部值 mocked，由紧邻初始化决定。 */
  const mocked = await import('@deepseek-ai/dsh-atomic-write') as unknown as { __setGate: (next: Promise<void>) => void }
  mocked.__setGate(next)
}

/** 中文说明：测试局部值 KEY，由紧邻初始化决定。 */
const KEY = credentialRef('DSH_CRED_DRAIN_A')
/** 中文说明：测试局部值 OTHER，由紧邻初始化决定。 */
const OTHER = credentialRef('DSH_CRED_DRAIN_B')
/** 中文说明：测试局部值 RECORD，由紧邻初始化决定。 */
const RECORD = credentialKey('llm-drain', 'alpha')
/** 中文说明：测试局部值 OTHER_RECORD，由紧邻初始化决定。 */
const OTHER_RECORD = credentialKey('llm-drain', 'beta')

/** 中文说明：测试局部值 cleanups，由紧邻初始化决定。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await setGate(Promise.resolve())
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('write-drain teardown', () => {
  it('lets the in-flight write land and fails the queued one after disposal', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-drain-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await fiber
    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = ctx.credentials

    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release!: () => void
    await setGate(new Promise<void>((resolveGate) => {
      release = resolveGate
    }))
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = service.set(KEY, 'one')
    // Let the first task pass its liveness checks and park on the gate, so it
    // is genuinely in-flight when disposal begins.
    await new Promise(resolvePause => setTimeout(resolvePause, 5))
    // Attach the rejection handler up front: the queued write fails while the
    // drain is still awaited, before any later `await expect` could run.
    /** 中文说明：测试局部值 secondRejects，由紧邻初始化决定。 */
    const secondRejects = expect(service.set(OTHER, 'two')).rejects.toThrow(/disposed before the queued/)
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定。 */
    const disposal = fiber.dispose()
    // Give the drain disposer its first turn (set closed) before opening the gate.
    await new Promise(resolvePause => setTimeout(resolvePause, 10))
    release()
    await disposal

    await expect(first).resolves.toBeUndefined()
    await secondRejects
    expect(await service.resolve(KEY)).toEqual({ value: 'one', source: 'file' })
    expect(await service.resolve(OTHER)).toBeUndefined()
  })

  it('fails a queued record write after disposal on the same terms', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-drain-record-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await fiber
    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = ctx.credentials

    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release!: () => void
    await setGate(new Promise<void>((resolveGate) => {
      release = resolveGate
    }))
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = service.modifyRecord(RECORD, () => Promise.resolve({ kind: 'grant', payload: { v: 1 } }))
    await new Promise(resolvePause => setTimeout(resolvePause, 5))
    /** 中文说明：测试局部值 queuedModify，由紧邻初始化决定。 */
    const queuedModify = expect(service.modifyRecord(OTHER_RECORD, () => Promise.resolve({ kind: 'api-key' })))
      .rejects.toThrow(/disposed before the queued/)
    /** 中文说明：测试局部值 queuedDelete，由紧邻初始化决定。 */
    const queuedDelete = expect(service.deleteRecord(OTHER_RECORD)).rejects.toThrow(/disposed before the queued/)
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定。 */
    const disposal = fiber.dispose()
    await new Promise(resolvePause => setTimeout(resolvePause, 10))
    release()
    await disposal

    await expect(first).resolves.toEqual({ kind: 'grant', payload: { v: 1 } })
    await queuedModify
    await queuedDelete
    expect(await service.readRecord(OTHER_RECORD)).toBeUndefined()
  })
})
