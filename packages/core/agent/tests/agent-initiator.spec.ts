/**
 * 文件职责：验证Agent 服务的 agent-initiator.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent 服务在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { runInNewContext } from 'node:vm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

/** 中文说明：测试辅助函数 agent 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function agent(id: string): Agent {
  return { id: SessionId(id) } as Agent
}

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness(): Promise<{
  ctx: Context
  service: AgentRegistry
  dispose: () => Promise<void>
}> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定，仅在当前场景使用。 */
  const fiber = await ctx.plugin(AgentRegistry)
  return {
    ctx,
    service: ctx.agents,
    dispose: fiber.dispose,
  }
}

/** Fail a lifecycle regression promptly instead of waiting for Vitest's suite timeout. */
/** 中文说明：测试辅助函数 promptly 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function promptly<T>(task: Promise<T>): Promise<T> {
  /** 中文说明：测试局部值 timeout，由紧邻初始化决定，仅在当前场景使用。 */
  const timeout = Promise.withResolvers<never>()
  /** 中文说明：测试局部值 timer，由紧邻初始化决定，仅在当前场景使用。 */
  const timer = setTimeout(() => { timeout.reject(new Error('initiator teardown did not settle promptly')) }, 1000)
  try {
    return await Promise.race([task, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

describe('AgentRegistry initiator scope', () => {
  it('reports an absent initiator and requires an active boundary', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    expect(service.currentInitiator()).toBeUndefined()
    expect(() => service.requireInitiator()).toThrow('no initiating agent is active')
    await dispose()
  })

  it('preserves exact synchronous and Promise return identities across await', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('identity')
    /** 中文说明：测试局部值 value，由紧邻初始化决定，仅在当前场景使用。 */
    const value = { result: true }
    expect(service.withInitiator(initiator, () => {
      expect(service.requireInitiator()).toBe(initiator)
      return value
    })).toBe(value)

    /** 中文说明：测试局部值 promise，由紧邻初始化决定，仅在当前场景使用。 */
    const promise = service.withInitiator(initiator, async () => {
      expect(service.requireInitiator()).toBe(initiator)
      await Promise.resolve()
      expect(service.requireInitiator()).toBe(initiator)
      return value
    })
    expect(service.withInitiator(initiator, () => promise)).toBe(promise)
    await expect(promise).resolves.toBe(value)
    expect(service.currentInitiator()).toBeUndefined()
    await dispose()
  })

  it('tracks a branded Promise without calling its overridable then property', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('overridden-then')
    /** 中文说明：测试局部值 release，由紧邻初始化决定，仅在当前场景使用。 */
    const release = Promise.withResolvers<boolean>()
    void Object.defineProperty(release.promise, 'then', {
      value: () => { throw new Error('overridden then called') },
    })

    /** 中文说明：测试局部值 pending，由紧邻初始化决定，仅在当前场景使用。 */
    const pending = service.withInitiator(initiator, () => release.promise)
    expect(pending).toBe(release.promise)

    /** 中文说明：测试局部值 disposed，由紧邻初始化决定，仅在当前场景使用。 */
    let disposed = false
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    release.resolve(true)
    await new Promise<void>((resolve, reject) => {
      void Promise.prototype.then.call(pending, resolve, reject)
    })
    await disposal
    expect(disposed).toBe(true)
  })

  it('preserves a settled branded Promise when its species blocks observer construction', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('invalid-species')
    /** 中文说明：测试局部值 promise，由紧邻初始化决定，仅在当前场景使用。 */
    const promise = Promise.resolve()
    /** 中文说明：测试局部值 constructor，由紧邻初始化决定，仅在当前场景使用。 */
    const constructor = {}
    Object.defineProperty(constructor, Symbol.species, {
      get: () => { throw new Error('invalid species') },
    })
    void Object.defineProperty(promise, 'constructor', { value: constructor })

    expect(service.withInitiator(initiator, () => promise)).toBe(promise)
    await dispose()
  })

  it('isolates overlapping initiators', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 a，由紧邻初始化决定，仅在当前场景使用。 */
    const a = agent('a')
    /** 中文说明：测试局部值 b，由紧邻初始化决定，仅在当前场景使用。 */
    const b = agent('b')
    /** 中文说明：测试局部值 bothStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const bothStarted = Promise.withResolvers<boolean>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定，仅在当前场景使用。 */
    const release = Promise.withResolvers<boolean>()
    /** 中文说明：测试局部值 starts，由紧邻初始化决定，仅在当前场景使用。 */
    let starts = 0
    /** 中文说明：测试局部值 run，由紧邻初始化决定，仅在当前场景使用。 */
    const run = (initiator: Agent): Promise<void> => service.withInitiator(initiator, async () => {
      expect(service.requireInitiator()).toBe(initiator)
      starts += 1
      if (starts === 2) bothStarted.resolve(true)
      await release.promise
      expect(service.requireInitiator()).toBe(initiator)
    })

    /** 中文说明：测试局部值 pending，由紧邻初始化决定，仅在当前场景使用。 */
    const pending = [run(a), run(b)]
    await bothStarted.promise
    expect(service.currentInitiator()).toBeUndefined()
    release.resolve(true)
    await Promise.all(pending)
    await dispose()
  })

  it('restores nested and explicitly cleared boundaries', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 parent，由紧邻初始化决定，仅在当前场景使用。 */
    const parent = agent('parent')
    /** 中文说明：测试局部值 child，由紧邻初始化决定，仅在当前场景使用。 */
    const child = agent('child')

    service.withInitiator(parent, () => {
      expect(service.requireInitiator()).toBe(parent)
      service.withInitiator(child, () => { expect(service.requireInitiator()).toBe(child) })
      expect(service.requireInitiator()).toBe(parent)
      service.withoutInitiator(() => {
        expect(service.currentInitiator()).toBeUndefined()
        expect(() => service.requireInitiator()).toThrow('no initiating agent is active')
      })
      expect(service.requireInitiator()).toBe(parent)
    })
    expect(service.currentInitiator()).toBeUndefined()
    await dispose()
  })

  it('restores the parent after synchronous throws and rejected operations', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 parent，由紧邻初始化决定，仅在当前场景使用。 */
    const parent = agent('parent')
    /** 中文说明：测试局部值 child，由紧邻初始化决定，仅在当前场景使用。 */
    const child = agent('child')
    /** 中文说明：测试局部值 syncError，由紧邻初始化决定，仅在当前场景使用。 */
    const syncError = new Error('sync failure')
    /** 中文说明：测试局部值 asyncError，由紧邻初始化决定，仅在当前场景使用。 */
    const asyncError = new Error('async failure')

    service.withInitiator(parent, () => {
      expect(() => service.withInitiator(child, () => { throw syncError })).toThrow(syncError)
      expect(service.requireInitiator()).toBe(parent)
    })
    await expect(service.withInitiator(child, async () => {
      await Promise.resolve()
      throw asyncError
    })).rejects.toBe(asyncError)
    expect(service.currentInitiator()).toBeUndefined()
    await dispose()
  })

  it('stops new boundaries, drains active Promises, and invalidates retained references', async () => {
    /** 中文说明：测试局部值 { ctx, service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, service, dispose } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('draining')
    /** 中文说明：测试局部值 release，由紧邻初始化决定，仅在当前场景使用。 */
    const release = Promise.withResolvers<boolean>()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定，仅在当前场景使用。 */
    const pending = service.withInitiator(initiator, async () => {
      await release.promise
      expect(service.requireInitiator()).toBe(initiator)
    })
    /** 中文说明：测试局部值 disposed，由紧邻初始化决定，仅在当前场景使用。 */
    let disposed = false
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = dispose().then(() => { disposed = true })
    await Promise.resolve()

    expect(() => service.withInitiator(initiator, () => 1)).toThrow('agent initiator scope is disposed')
    expect(() => service.withoutInitiator(() => 1)).toThrow('agent initiator scope is disposed')
    expect(disposed).toBe(false)
    expect(ctx.get('agents')).toBeUndefined()
    release.resolve(true)
    await pending
    await disposal
    expect(() => service.currentInitiator()).toThrow('agent initiator scope is disposed')
    expect(() => service.requireInitiator()).toThrow('agent initiator scope is disposed')
  })

  it('drains cross-realm Promise boundaries before disposal', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('cross-realm')
    /** 中文说明：测试局部值 release，由紧邻初始化决定，仅在当前场景使用。 */
    const release = Promise.withResolvers<boolean>()
    /** 中文说明：测试局部值 operation，由紧邻初始化决定，仅在当前场景使用。 */
    const operation = runInNewContext(
      '(async () => { await release; inspect() })',
      {
        release: release.promise,
        inspect: () => { expect(service.requireInitiator()).toBe(initiator) },
      },
    ) as () => Promise<void>
    /** 中文说明：测试局部值 pending，由紧邻初始化决定，仅在当前场景使用。 */
    const pending = service.withInitiator(initiator, operation)
    expect(pending).not.toBeInstanceOf(Promise)

    /** 中文说明：测试局部值 disposed，由紧邻初始化决定，仅在当前场景使用。 */
    let disposed = false
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    release.resolve(true)
    await pending
    await disposal
    expect(disposed).toBe(true)
  })

  it('does not self-deadlock when a boundary returns service disposal', async () => {
    /** 中文说明：测试局部值 { service, dispose }，由紧邻初始化决定，仅在当前场景使用。 */
    const { service, dispose } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('service-disposer')

    /** 中文说明：测试局部值 returned，由紧邻初始化决定，仅在当前场景使用。 */
    const returned = service.withInitiator(initiator, dispose)
    await promptly(returned)

    expect(() => service.currentInitiator()).toThrow('agent initiator scope is disposed')
  })

  it('does not self-deadlock when nested boundaries return ancestor disposal', async () => {
    /** 中文说明：测试局部值 { ctx, service }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, service } = await harness()
    /** 中文说明：测试局部值 parent，由紧邻初始化决定，仅在当前场景使用。 */
    const parent = agent('parent-disposer')
    /** 中文说明：测试局部值 child，由紧邻初始化决定，仅在当前场景使用。 */
    const child = agent('child-disposer')
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let disposal: Promise<void> | undefined

    /** 中文说明：测试局部值 returned，由紧邻初始化决定，仅在当前场景使用。 */
    const returned = service.withInitiator(parent, () => service.withInitiator(child, () => {
      disposal = ctx.fiber.dispose()
      return disposal
    }))
    expect(returned).toBe(disposal)

    await promptly(returned)
    expect(() => service.currentInitiator()).toThrow('agent initiator scope is disposed')
  })

  it('excludes an asynchronous teardown initiator while draining unrelated boundaries', async () => {
    /** 中文说明：测试局部值 { ctx, service }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx, service } = await harness()
    /** 中文说明：测试局部值 initiator，由紧邻初始化决定，仅在当前场景使用。 */
    const initiator = agent('async-disposer')
    /** 中文说明：测试局部值 unrelated，由紧邻初始化决定，仅在当前场景使用。 */
    const unrelated = agent('unrelated')
    /** 中文说明：测试局部值 release，由紧邻初始化决定，仅在当前场景使用。 */
    const release = Promise.withResolvers<boolean>()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定，仅在当前场景使用。 */
    const pending = service.withInitiator(unrelated, async () => {
      await release.promise
      expect(service.requireInitiator()).toBe(unrelated)
    })

    /** 中文说明：测试局部值 returned，由紧邻初始化决定，仅在当前场景使用。 */
    const returned = service.withInitiator(initiator, async () => {
      await Promise.resolve()
      await ctx.fiber.dispose()
    })
    /** 中文说明：测试局部值 disposed，由紧邻初始化决定，仅在当前场景使用。 */
    let disposed = false
    void returned.then(() => { disposed = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(disposed).toBe(false)

    release.resolve(true)
    await pending
    await promptly(returned)

    expect(() => service.currentInitiator()).toThrow('agent initiator scope is disposed')
  })
})
