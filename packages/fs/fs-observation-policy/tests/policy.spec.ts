/** Event-level policy tests; no filesystem provider is needed because the plugin performs no I/O. */
/*
 * 文件职责：验证文件系统与工具的 policy.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证文件系统与工具操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsObservation, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import type { FsObservationActor } from '@deepseek-ai/dsh-fs-observation-policy'

/** 中文说明：函数 target 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function target(path: string): FsTarget {
  return { targetKey: FsTargetKey(path), displayPath: path }
}
/** 中文说明：测试局部值 ownerExec，由紧邻初始化决定。 */
const ownerExec = (session: object): FsObservationActor => ({ agent: { session } })
/** 中文说明：测试局部值 present，由紧邻初始化决定。 */
const present = (version: string): FsObservation => ({ kind: 'present', version: FsVersion(version) })
/** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
const absent: FsObservation = { kind: 'absent' }

/** Dispatch the write-intent waterfall with the bare default thunk. */
/* 中文说明：函数 writeIntent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function writeIntent(ctx: Context, t: FsTarget, actor: object | undefined): Promise<FsWriteIntent | undefined> {
  return ctx.waterfall('fs/write-intent', t, actor, () => undefined)
}
/** Dispatch the edit-intent waterfall with the bare default thunk. */
/* 中文说明：函数 editIntent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function editIntent(ctx: Context, t: FsTarget, actor: object | undefined): Promise<{ version: FsVersion } | undefined> {
  return ctx.waterfall('fs/edit-intent', t, actor, () => undefined)
}

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = await ctx.plugin(FsPolicy)
  return { ctx, fiber }
}

describe('registration / disposal', () => {
  it('registers no service API (it is a plugin, not ctx.fsPolicy)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect((ctx as Context & { fsPolicy?: unknown }).fsPolicy).toBeUndefined()
  })

  it('mounts with no inject (reads no services)', async () => {
    // It mounts immediately even with nothing else in the context.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(FsPolicy)
    // The listener is live: an unobserved write decides createIfAbsent.
    expect(await writeIntent(ctx, target('a.txt'), undefined)).toEqual({ kind: 'createIfAbsent' })
  })
})

describe('write-intent decision', () => {
  it('an unobserved target decides createIfAbsent', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(await writeIntent(ctx, target('a.txt'), ownerExec({}))).toEqual({ kind: 'createIfAbsent' })
  })

  it('a no-owner actor decides createIfAbsent', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(await writeIntent(ctx, target('a.txt'), undefined)).toEqual({ kind: 'createIfAbsent' })
    expect(await writeIntent(ctx, target('a.txt'), {})).toEqual({ kind: 'createIfAbsent' })
  })

  it('an actor with an agent but no session has no owner (createIfAbsent)', async () => {
    // The middle optional-chain rung: agent present, session undefined ⇒ owner
    // undefined ⇒ unobservable, so a write can only be a blind create.
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    expect(await writeIntent(ctx, target('a.txt'), { agent: {} })).toEqual({ kind: 'createIfAbsent' })
  })

  it('an observed target decides replaceIfVersion at the observed version', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), present('v7'), exec)
    expect(await writeIntent(ctx, target('a.txt'), exec)).toEqual({ kind: 'replaceIfVersion', version: 'v7' })
  })

  it('a target observed absent decides createIfAbsent', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), absent, exec)
    expect(await writeIntent(ctx, target('a.txt'), exec)).toEqual({ kind: 'createIfAbsent' })
  })
})

describe('edit-intent decision', () => {
  it('rejects an unread edit with FS_NOT_OBSERVED', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    await expect(editIntent(ctx, target('a.txt'), ownerExec({}))).rejects.toMatchObject({
      code: 'FS_NOT_OBSERVED',
      message: 'edit requires reading "a.txt" first',
    })
  })

  it('rejects an edit with no owner (cannot prove prior observation)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    await expect(editIntent(ctx, target('a.txt'), undefined)).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
  })

  it('rejects an edit whose actor has an agent but no session (no owner)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    await expect(editIntent(ctx, target('a.txt'), { agent: {} })).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
  })

  it('returns the observed version as the CAS basis after an observation', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), present('v3'), exec)
    expect(await editIntent(ctx, target('a.txt'), exec)).toEqual({ version: 'v3' })
  })

  it('rejects editing a target observed absent with FS_NOT_FOUND', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), absent, exec)
    await expect(editIntent(ctx, target('a.txt'), exec)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })
})

describe('observed-state is the prior-observation record', () => {
  it('a read observation authorizes an in-place write at that version', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), present('v0'), exec) // a read
    expect(await writeIntent(ctx, target('a.txt'), exec)).toEqual({ kind: 'replaceIfVersion', version: 'v0' })
  })

  it('a write/edit observation refreshes the basis, so the next edit needs no re-read', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    // A create records v1; the follow-up edit guards against v1 with no read.
    ctx.emit('fs/observed', target('a.txt'), present('v1'), exec)
    expect(await editIntent(ctx, target('a.txt'), exec)).toEqual({ version: 'v1' })
    // The edit records v2; a second edit guards against v2.
    ctx.emit('fs/observed', target('a.txt'), present('v2'), exec)
    expect(await editIntent(ctx, target('a.txt'), exec)).toEqual({ version: 'v2' })
  })

  it('a no-owner observation records nothing', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    ctx.emit('fs/observed', target('a.txt'), present('v0'), undefined)
    // Still unobserved for any owner.
    await expect(editIntent(ctx, target('a.txt'), ownerExec({}))).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
  })

  it('supports present → absent → present transitions for one owner', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = target('a.txt')
    ctx.emit('fs/observed', a, present('v1'), exec)
    expect(await writeIntent(ctx, a, exec)).toEqual({ kind: 'replaceIfVersion', version: 'v1' })

    ctx.emit('fs/observed', a, absent, exec)
    expect(await writeIntent(ctx, a, exec)).toEqual({ kind: 'createIfAbsent' })
    await expect(editIntent(ctx, a, exec)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })

    ctx.emit('fs/observed', a, present('v2'), exec)
    expect(await editIntent(ctx, a, exec)).toEqual({ version: 'v2' })
  })
})

describe('multi-owner isolation', () => {
  it('owner A observing does not grant owner B edit authority', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = ownerExec({})
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), present('v0'), a)
    await expect(editIntent(ctx, target('a.txt'), b)).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    expect(await editIntent(ctx, target('a.txt'), a)).toEqual({ version: 'v0' })
  })

  it('each owner records its own observed version independently', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = ownerExec({})
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), present('v0'), a) // A observed v0
    // B never observed → createIfAbsent; A still holds v0 → replaceIfVersion.
    expect(await writeIntent(ctx, target('a.txt'), b)).toEqual({ kind: 'createIfAbsent' })
    expect(await writeIntent(ctx, target('a.txt'), a)).toEqual({ kind: 'replaceIfVersion', version: 'v0' })
  })
})

describe('single-slot, first-wins', () => {
  it('fully decides the slot without calling next() (the bare default is unreached)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 defaultRan，由紧邻初始化决定。 */
    let defaultRan = false
    /** 中文说明：测试局部值 intent，由紧邻初始化决定。 */
    const intent = await ctx.waterfall('fs/write-intent', target('a.txt'), ownerExec({}), () => {
      defaultRan = true
      return undefined
    })
    expect(intent).toEqual({ kind: 'createIfAbsent' })
    expect(defaultRan).toBe(false)
  })

  it('a SECOND decider registered AFTER fs-observation-policy is not reached (first-wins short-circuit)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 secondRan，由紧邻初始化决定。 */
    let secondRan = false
    // Registered after fs-observation-policy, so it dispatches second; fs-observation-policy does
    // not call next(), so this never runs. (A decider registered BEFORE — or with
    // prepend — would instead win: first-wins is by convention, not enforced.)
    ctx.on('fs/edit-intent', () => {
      secondRan = true
      return Promise.resolve(undefined)
    })
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    ctx.emit('fs/observed', target('a.txt'), present('v0'), exec)
    await editIntent(ctx, target('a.txt'), exec)
    expect(secondRan).toBe(false)
  })

  it('a SECOND write-intent decider registered AFTER fs-observation-policy is not reached', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    /** 中文说明：测试局部值 secondRan，由紧邻初始化决定。 */
    let secondRan = false
    ctx.on('fs/write-intent', () => {
      secondRan = true
      return Promise.resolve(undefined)
    })
    await writeIntent(ctx, target('a.txt'), ownerExec({}))
    expect(secondRan).toBe(false)
  })
})

describe('disposal releases recorded state (HMR safety)', () => {
  it('a fresh plugin after disposal starts with no inherited state', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = ownerExec({})
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(FsPolicy)
    ctx.emit('fs/observed', target('a.txt'), present('v0'), exec)
    expect(await editIntent(ctx, target('a.txt'), exec)).toEqual({ version: 'v0' })
    await fiber.dispose()

    await ctx.plugin(FsPolicy)
    // Same owner object, but state was released on disposal.
    await expect(editIntent(ctx, target('a.txt'), exec)).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
  })

  it('no listeners remain after disposal (the gate no longer decides)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(FsPolicy)
    await fiber.dispose()
    // With no listener, the waterfall falls through to the bare default.
    expect(await writeIntent(ctx, target('a.txt'), ownerExec({}))).toBeUndefined()
  })
})
