/**
 * 文件职责：验证凭据授权的 authorization.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证凭据授权在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import AuthorizationService, {
  AuthorizationDeclinedError,
  /** 中文说明：类型或类 AuthorizationFlow 约束服务或测试数据职责。 */
  type AuthorizationFlow,
  /** 中文说明：类型或类 AuthorizationInteraction 约束服务或测试数据职责。 */
  type AuthorizationInteraction,
  /** 中文说明：类型或类 AuthorizationSession 约束服务或测试数据职责。 */
  type AuthorizationSession,
} from '@deepseek-ai/dsh-authorization'
import { MemoryCredentials } from './memory.ts'

/** 中文说明：测试局部值 KEY，由紧邻初始化决定。 */
const KEY = credentialKey('llm-pi-ai', 'openai-codex')
/** 中文说明：测试局部值 OTHER，由紧邻初始化决定。 */
const OTHER = credentialKey('llm-pi-ai', 'anthropic')

/** A context with the record store the seam confirms commits against. */
/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  return ctx
}

/** An interaction that answers every prompt with the same string. */
/** 中文说明：函数 surface 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function surface(answer = 'typed'): AuthorizationInteraction & {
  notices: unknown[]
  prompts: unknown[]
} {
  /** 中文说明：测试局部值 notices，由紧邻初始化决定。 */
  const notices: unknown[] = []
  /** 中文说明：测试局部值 prompts，由紧邻初始化决定。 */
  const prompts: unknown[] = []
  return {
    notices,
    prompts,
    notify: (notice) => { notices.push(notice) },
    prompt: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve(answer)
    },
  }
}

/** A flow that commits `key` through the record store and then resolves. */
/** 中文说明：函数 committingFlow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function committingFlow(
  ctx: Context,
  key = KEY,
  run?: (session: AuthorizationSession) => Promise<void>,
): AuthorizationFlow {
  return {
    key,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }, { id: 'api-key', label: 'Paste a key' }],
    async run(session) {
      await run?.(session)
      await ctx.credentials.modifyRecord(key, () =>
        Promise.resolve({ kind: 'grant', payload: { token: 'granted' } }))
    },
  }
}

describe('AuthorizationService registry', () => {
  it('lists a registered flow and drops it when the registration is disposed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.authorization.registerFlow(committingFlow(ctx))

    expect(ctx.authorization.list()).toEqual([{
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }, { id: 'api-key', label: 'Paste a key' }],
      inFlight: false,
    }])
    expect(ctx.authorization.describe(KEY)?.label).toBe('ChatGPT (Codex)')
    expect(ctx.authorization.describe(OTHER)).toBeUndefined()

    dispose()

    expect(ctx.authorization.list()).toEqual([])
    expect(ctx.authorization.describe(KEY)).toBeUndefined()
  })

  it('refuses a second flow for the same key', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))

    expect(() => ctx.authorization.registerFlow(committingFlow(ctx)))
      .toThrow(/already registered/)
  })

  it('withdraws an attempt still running when its flow leaves', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    let started: (() => void) | undefined
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.authorization.registerFlow(committingFlow(ctx, KEY, session =>
      new Promise((_resolve, reject) => {
        started?.()
        session.signal.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
      })))

    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = ctx.authorization.begin({ key: KEY, interaction: surface() })
    await running
    dispose()

    await expect(attempt).resolves.toEqual({ status: 'cancelled' })
  })
})

describe('AuthorizationService.begin', () => {
  it('runs the flow, confirms the committed record, and reports the settlement', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = vi.fn()
    ctx.on('authorization/settled', settled)

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })

    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'granted' } })
    expect(settled).toHaveBeenCalledWith(KEY, 'authorized')
  })

  it('runs the flow first method when the caller names none, and the named one when it does', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, (session) => {
      seen.push(session.method)
      return Promise.resolve()
    }))

    await ctx.authorization.begin({ key: KEY, interaction: surface() })
    await ctx.authorization.begin({ key: KEY, method: 'api-key', interaction: surface() })

    expect(seen).toEqual(['oauth', 'api-key'])
  })

  it('carries notices and prompts between the flow and the calling surface', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 answers，由紧邻初始化决定。 */
    const answers: string[] = []
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, async (session) => {
      session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start' })
      answers.push(await session.prompt({ kind: 'text', message: 'Paste the code' }))
    }))
    /** 中文说明：测试局部值 ui，由紧邻初始化决定。 */
    const ui = surface('code-123')

    await ctx.authorization.begin({ key: KEY, interaction: ui })

    expect(ui.notices).toEqual([{ message: 'Continue in your browser', url: 'https://auth.example/start' }])
    expect(ui.prompts).toEqual([{ kind: 'text', message: 'Paste the code' }])
    expect(answers).toEqual(['code-123'])
  })

  it('refuses a key no flow claims', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow(/no authorization flow is registered/)
  })

  it('refuses a method the flow does not offer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))

    await expect(ctx.authorization.begin({ key: KEY, method: 'device', interaction: surface() }))
      .rejects.toThrow(/offers no method "device"/)
  })

  it('refuses a second attempt while one is running, and admits one after it settles', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    // Only the first attempt blocks; the later ones must be free to complete,
    // which is what shows the key was released rather than merely idle-looking.
    /** 中文说明：测试局部值 held，由紧邻初始化决定。 */
    const held = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    let first = true
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, () => {
      if (!first) return Promise.resolve()
      first = false
      started.resolve(undefined)
      return held.promise
    }))

    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = ctx.authorization.begin({ key: KEY, interaction: surface() })
    await started.promise
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(true)
    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow(/already running/)

    held.resolve(undefined)
    await expect(attempt).resolves.toEqual({ status: 'authorized' })
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
  })

  it('never starts a flow whose caller withdrew before begin', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 ran，由紧邻初始化决定。 */
    const ran = vi.fn()
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = vi.fn()
    ctx.on('authorization/settled', settled)
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, () => {
      ran()
      return new Promise(() => {})
    }))

    await expect(ctx.authorization.begin({
      key: KEY,
      interaction: surface(),
      signal: AbortSignal.abort(),
    })).resolves.toEqual({ status: 'cancelled' })

    expect(ran).not.toHaveBeenCalled()
    // Nothing occupied the key, so nothing settled on it either.
    expect(settled).not.toHaveBeenCalled()
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })

  it('still reports an unknown method to a caller that already withdrew', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))

    await expect(ctx.authorization.begin({
      key: KEY,
      method: 'device',
      interaction: surface(),
      signal: AbortSignal.abort(),
    })).rejects.toThrow(/offers no method "device"/)
  })

  it('reports a caller that withdraws mid-flight as cancelled', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, session =>
      new Promise((_resolve, reject) => {
        session.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        controller.abort()
      })))

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface(), signal: controller.signal }))
      .resolves.toEqual({ status: 'cancelled' })
  })

  it('withdraws a running attempt through cancel(), and ignores cancel() for an idle key', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, session =>
      new Promise((_resolve, reject) => {
        session.signal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
        started.resolve(undefined)
      })))
    ctx.authorization.cancel(OTHER)

    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = ctx.authorization.begin({ key: KEY, interaction: surface() })
    await started.promise
    ctx.authorization.cancel(KEY)

    await expect(attempt).resolves.toEqual({ status: 'cancelled' })
  })

  it('settles a withdrawn attempt even when its flow never reacts to the signal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 orphan，由紧邻初始化决定。 */
    const orphan = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, () => {
      started.resolve(undefined)
      return orphan.promise
    }))

    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = ctx.authorization.begin({ key: KEY, interaction: surface() })
    await started.promise
    ctx.authorization.cancel(KEY)

    await expect(attempt).resolves.toEqual({ status: 'cancelled' })
    // The key is free again immediately, rather than at the mercy of a flow
    // that may never settle.
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
    // The orphan's own failure is nobody's to await, and must not surface as an
    // unhandled rejection.
    orphan.reject(new Error('gave up long after the human left'))
    await expect(orphan.promise).rejects.toThrow('gave up long after the human left')
  })

  it('propagates a flow failure to its caller and settles the key as failed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, () =>
      Promise.reject(new Error('the token endpoint said no'))))
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = vi.fn()
    ctx.on('authorization/settled', settled)

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow('the token endpoint said no')

    expect(settled).toHaveBeenCalledWith(KEY, 'failed')
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })

  it('refuses a flow that resolves without committing its record', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Forgetful',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => Promise.resolve(),
    })

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow(/resolved without committing a credential record/)
  })
})

describe('commit confirmation', () => {
  it('refuses a re-auth that left only the record of an earlier attempt', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    await ctx.credentials.modifyRecord(KEY, () =>
      Promise.resolve({ kind: 'grant', payload: { token: 'stale' } }))
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Forgetful',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      // A commit for another key is not this flow's commit either.
      async run() {
        await ctx.credentials.modifyRecord(OTHER, () =>
          Promise.resolve({ kind: 'grant', payload: { token: 'other' } }))
      },
    })

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow(/without committing a credential record in this attempt/)
    // Refused, not cleaned up: the stale record still belongs to its owner.
    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'stale' } })
  })

  it('refuses a flow that deleted its record instead of committing one', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    await ctx.credentials.modifyRecord(KEY, () =>
      Promise.resolve({ kind: 'grant', payload: { token: 'stale' } }))
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Destructive',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => ctx.credentials.deleteRecord(KEY),
    })

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow(/deleted its credential record/)
  })
})

describe('declined prompts', () => {
  it('reports an attempt whose prompt the human declined as cancelled, not failed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    }))
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = vi.fn()
    ctx.on('authorization/settled', settled)
    /** 中文说明：测试局部值 declining，由紧邻初始化决定。 */
    const declining: AuthorizationInteraction = {
      notify: () => undefined,
      prompt: () => Promise.reject(new AuthorizationDeclinedError()),
    }

    await expect(ctx.authorization.begin({ key: KEY, interaction: declining }))
      .resolves.toEqual({ status: 'cancelled' })

    expect(settled).toHaveBeenCalledWith(KEY, 'cancelled')
  })

  it('reads a decline through a flow that rewraps the rejection on its way out', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, session =>
      session.prompt({ kind: 'text', message: 'Paste the code' }).then(
        () => undefined,
        () => {
          throw new Error('sign-in aborted')
        })))
    /** 中文说明：测试局部值 declining，由紧邻初始化决定。 */
    const declining: AuthorizationInteraction = {
      notify: () => undefined,
      prompt: () => Promise.reject(new AuthorizationDeclinedError()),
    }

    await expect(ctx.authorization.begin({ key: KEY, interaction: declining }))
      .resolves.toEqual({ status: 'cancelled' })
  })

  it('keeps a prompt failure that is not a decline a flow failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    }))
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = vi.fn()
    ctx.on('authorization/settled', settled)
    /** 中文说明：测试局部值 broken，由紧邻初始化决定。 */
    const broken: AuthorizationInteraction = {
      notify: () => undefined,
      prompt: () => Promise.reject(new Error('the transport dropped')),
    }

    await expect(ctx.authorization.begin({ key: KEY, interaction: broken }))
      .rejects.toThrow('the transport dropped')

    expect(settled).toHaveBeenCalledWith(KEY, 'failed')
  })
})

describe('notice containment', () => {
  it('loses the notice, never the attempt, when the surface cannot render it', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx, KEY, (session) => {
      session.notify({ message: 'Continue in your browser' })
      return Promise.resolve()
    }))
    /** 中文说明：测试局部值 broken，由紧邻初始化决定。 */
    const broken: AuthorizationInteraction = {
      notify: () => {
        throw new Error('page connection closed')
      },
      prompt: () => Promise.resolve('unused'),
    }

    await expect(ctx.authorization.begin({ key: KEY, interaction: broken }))
      .resolves.toEqual({ status: 'authorized' })
  })
})

describe('the settled fan-out', () => {
  it('keeps a throwing listener from changing a finished attempt, and later listeners still run', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))
    ctx.on('authorization/settled', () => {
      throw new Error('watcher boom')
    })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = vi.fn()
    ctx.on('authorization/settled', second)

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })

    expect(second).toHaveBeenCalledWith(KEY, 'authorized')
  })

  it('contains an async listener rejection', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))
    // An unknown-returning function keeps the typed surface legal while the
    // runtime value is still the rejected promise the containment must handle.
    /** 中文说明：测试局部值 boom，由紧邻初始化决定。 */
    const boom = (): unknown => Promise.reject(new Error('async watcher boom'))
    ctx.on('authorization/settled', boom)

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('rethrows an invariant-coded listener failure after the remaining listeners', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    ctx.authorization.registerFlow(committingFlow(ctx))
    ctx.on('authorization/settled', () => {
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = vi.fn()
    ctx.on('authorization/settled', second)

    await expect(ctx.authorization.begin({ key: KEY, interaction: surface() }))
      .rejects.toThrow(/forged relation/)
    // Harness-fatal by design — but the record itself committed first.
    expect(second).toHaveBeenCalledWith(KEY, 'authorized')
    expect(await ctx.credentials.readRecord(KEY)).toEqual({ kind: 'grant', payload: { token: 'granted' } })
  })
})
