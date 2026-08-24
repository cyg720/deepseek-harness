/**
 * MessageFeedbackController: the browser-local object layer over one Session's
 * message-feedback sidecar. These specs pin the per-item compare-and-set
 * contract — every mutation sends the version last observed, a conflict
 * reconciles from the authoritative item carried by the reply, mutations
 * serialize per Session, and a disposed controller stops publishing.
 */
/**
 * 文件职责：验证消息反馈的 controller.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止消息反馈用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  MessageFeedbackItem, MessageFeedbackVersion,
} from '@deepseek-ai/dsh-message-feedback/types'
import { MessageFeedbackController, type MessageFeedbackRemote } from '../src/client/controller.ts'

/** 中文说明：测试局部值 SESSION，由紧邻初始化决定。 */
const SESSION = 's-1' as SessionId
/** 中文说明：测试局部值 MSG，由紧邻初始化决定。 */
const MSG = 'm-1' as MessageId
/** 中文说明：测试局部值 OTHER，由紧邻初始化决定。 */
const OTHER = 'm-2' as MessageId

/** 中文说明：测试局部值 version，由紧邻初始化决定。 */
const version = (v: string): MessageFeedbackVersion => v as MessageFeedbackVersion

/** 中文说明：函数 item 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function item(overrides: Partial<MessageFeedbackItem> = {}): MessageFeedbackItem {
  return {
    messageId: MSG,
    rating: 'positive',
    version: version('v1'),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A recording fake Remote whose per-method answers are scripted per call. */
/** 中文说明：类型或类 Script 约束本文件数据或组件职责。 */
type Script = {
  list?: (request: unknown) => Promise<unknown>
  put?: (request: unknown) => Promise<unknown>
  delete?: (request: unknown) => Promise<unknown>
}

/**
 * A recording fake Remote. Scripts return the *business* result; this wraps it
 * in the carrier envelope the generated face uses, so specs stay readable. A
 * script may also return an already-enveloped `{ok:false,error:{code,message,
 * details}}` to exercise a carrier failure.
 */
/** 中文说明：函数 fakeRemote 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fakeRemote(script: Script = {}) {
  /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
  const calls: { method: string; request: unknown }[] = []
  /** 中文说明：测试局部值 isCarrier，由紧邻初始化决定。 */
  const isCarrier = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && 'ok' in v && v.ok === false
      && 'error' in v && 'details' in ((v as { error: object }).error ?? {})
  /** 中文说明：测试局部值 record，由紧邻初始化决定。 */
  const record = (method: 'list' | 'put' | 'delete', real: Script[keyof Script], fallback: unknown) =>
    (request: never): Promise<never> => {
      calls.push({ method, request })
      /** 中文说明：测试局部值 business，由紧邻初始化决定。 */
      const business = real === undefined ? Promise.resolve(fallback) : real(request)
      return business.then(v => (isCarrier(v) ? v : { ok: true, value: v })) as Promise<never>
    }
  /** 中文说明：测试局部值 remote，由紧邻初始化决定。 */
  const remote = {
    list: record('list', script.list, { ok: true, value: { items: [] } }),
    put: record('put', script.put, { ok: true, value: item() }),
    delete: record('delete', script.delete, { ok: true, value: { absent: true } }),
  } as unknown as MessageFeedbackRemote
  return { remote, calls }
}

describe('MessageFeedbackController', () => {
  it('seeds the view from one list read and keys items by message id', async () => {
    /** 中文说明：测试局部值 seeded，由紧邻初始化决定。 */
    const seeded = item({ note: 'good' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [seeded] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(controller.getSnapshot().status).toBe('cold')
    expect(await controller.ensure()).toEqual({ ok: true })

    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = controller.getSnapshot()
    expect(view.status).toBe('ready')
    expect(view.items.get(MSG)).toEqual(seeded)
    expect(calls).toEqual([{ method: 'list', request: { sessionId: SESSION } }])
  })

  it('collapses concurrent loads onto one in-flight read', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    await Promise.all([controller.ensure(), controller.ensure(), controller.refresh()])

    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('sends ifVersion null for a first rating and the observed version afterwards', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = item({ version: version('v1') })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = item({ version: version('v2'), rating: 'negative' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      put: request => Promise.resolve({
        ok: true,
        value: (request as { rating: string }).rating === 'positive' ? first : second,
      }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({ ok: true })
    expect(await controller.rate(MSG, 'negative')).toEqual({ ok: true })

    /** 中文说明：测试局部值 puts，由紧邻初始化决定。 */
    const puts = calls.filter(call => call.method === 'put').map(call => call.request)
    expect(puts[0]).toMatchObject({ messageId: MSG, rating: 'positive', ifVersion: null })
    expect(puts[1]).toMatchObject({ messageId: MSG, rating: 'negative', ifVersion: version('v1') })
    expect(controller.getSnapshot().items.get(MSG)).toEqual(second)
  })

  it('forwards an optional note and omits the field when absent', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    await controller.rate(MSG, 'positive', 'helpful')
    await controller.rate(OTHER, 'negative')

    /** 中文说明：测试局部值 puts，由紧邻初始化决定。 */
    const puts = calls.filter(call => call.method === 'put').map(call => call.request as Record<string, unknown>)
    expect(puts[0]?.note).toBe('helpful')
    expect(puts[1]).not.toHaveProperty('note')
  })

  it('reconciles a version conflict from the authoritative item without refetching', async () => {
    /** 中文说明：测试局部值 authoritative，由紧邻初始化决定。 */
    const authoritative = item({ version: version('v9'), rating: 'negative', note: 'changed elsewhere' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      put: () => Promise.resolve({
        ok: false,
        error: { code: 'version-conflict', current: authoritative },
      }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'version-conflict', message: 'feedback changed elsewhere' },
    })

    expect(controller.getSnapshot().items.get(MSG)).toEqual(authoritative)
    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('drops the local item when a conflict reports the feedback is gone', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
      delete: () => Promise.resolve({
        ok: false,
        error: { code: 'version-conflict', current: null },
      }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toMatchObject({ ok: false, error: { code: 'version-conflict' } })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('deletes with the observed version and removes the item on success', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item({ version: version('v7') })] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toEqual({ ok: true })

    expect(calls.filter(call => call.method === 'delete')[0]?.request)
      .toEqual({ sessionId: SESSION, messageId: MSG, ifVersion: version('v7') })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('treats clearing an unrated message as already satisfied without a call', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.clear(MSG)).toEqual({ ok: true })
    expect(calls.filter(call => call.method === 'delete')).toHaveLength(0)
  })

  it('serializes mutations so each one compares against the committed version', async () => {
    /** 中文说明：测试局部值 inFlight，由紧邻初始化决定。 */
    let inFlight = 0
    /** 中文说明：测试局部值 overlapped，由紧邻初始化决定。 */
    let overlapped = false
    /** 中文说明：测试局部值 versions，由紧邻初始化决定。 */
    const versions = [version('v1'), version('v2')]
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    let index = 0
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      put: async () => {
        inFlight += 1
        if (inFlight > 1) overlapped = true
        await Promise.resolve()
        inFlight -= 1
        /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
        const next = versions[index] ?? version('vN')
        index += 1
        return { ok: true, value: item({ version: next }) }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    await Promise.all([controller.rate(MSG, 'positive'), controller.rate(MSG, 'negative')])

    expect(overlapped).toBe(false)
    /** 中文说明：测试局部值 puts，由紧邻初始化决定。 */
    const puts = calls.filter(call => call.method === 'put').map(call => call.request as Record<string, unknown>)
    expect(puts[0]?.ifVersion).toBeNull()
    expect(puts[1]?.ifVersion).toBe(version('v1'))
  })

  it('publishes an error status when the list read is rejected by the Host', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: SESSION } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'this session is no longer persisted',
    })
  })

  it('settles a transport throw as a result instead of rejecting', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({ list: () => Promise.reject(new Error('socket closed')) })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toEqual({
      ok: false,
      error: { code: 'transport', message: 'socket closed' },
    })
    expect(controller.getSnapshot().status).toBe('error')
  })

  it('settles a mutation transport throw without corrupting the view', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({ put: () => Promise.reject(new Error('socket closed')) })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'transport', message: 'socket closed' },
    })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('notifies subscribers on publication and stops after unsubscribe', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
    const listener = vi.fn()
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = controller.subscribe(listener)

    await controller.ensure()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen = listener.mock.calls.length
    expect(seen).toBeGreaterThan(0)

    unsubscribe()
    await controller.rate(MSG, 'positive')
    expect(listener).toHaveBeenCalledTimes(seen)
  })

  it('contains a throwing subscriber at the observable boundary', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.subscribe(() => { throw new Error('subscriber exploded') })
    /** 中文说明：测试局部值 healthy，由紧邻初始化决定。 */
    const healthy = vi.fn()
    controller.subscribe(healthy)

    await controller.ensure()

    expect(healthy).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refuses mutations and stops publishing once disposed', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()
    /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.dispose()
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = calls.length

    expect(await controller.rate(MSG, 'positive')).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(calls).toHaveLength(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('renders a human explanation for every business failure code', async () => {
    /** 中文说明：测试局部值 codes，由紧邻初始化决定。 */
    const codes = [
      ['session-not-found', 'this session is no longer persisted'],
      ['target-not-found', 'this message is not a persisted assistant message'],
      ['note-blank', 'a note must contain a non-whitespace character'],
      ['note-too-large', 'the note is too long'],
    ] as const
    /** 中文说明：测试局部值 [code，由紧邻初始化决定。 */
    for (const [code, message] of codes) {
      /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
      const { remote } = fakeRemote({
        list: () => Promise.resolve({ ok: false, error: { code, sessionId: SESSION } } as never),
      })
      /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
      const controller = new MessageFeedbackController(remote, SESSION)
      expect(await controller.ensure()).toMatchObject({ ok: false, error: { code } })
      expect(controller.getSnapshot().error).toBe(message)
    }
  })

  it('falls back to the raw code for an unrecognized failure', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: false, error: { code: 'brand-new-code' } } as never),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toMatchObject({ ok: false, error: { code: 'brand-new-code' } })
    expect(controller.getSnapshot().error).toBe('brand-new-code')
  })

  it('publishes nothing when the list settles after disposal', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: async () => {
        await gate
        return { ok: true, value: { items: [item()] } }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = controller.ensure()
    /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.dispose()
    release()

    expect(await pending).toEqual({ ok: true })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('swallows a rejected list that settles after disposal', async () => {
    /** 中文说明：测试局部值 reject，由紧邻初始化决定。 */
    let reject = (): void => {}
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((_resolve, rejectFn) => { reject = () => { rejectFn(new Error('late')) } })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({ list: () => gate })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = controller.ensure()

    controller.dispose()
    reject()

    expect(await pending).toEqual({ ok: true })
    expect(controller.getSnapshot().status).not.toBe('error')
  })

  it('describes a non-Error list rejection with a stable message', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario under test.
    const { remote } = fakeRemote({ list: () => Promise.reject('socket string') })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toEqual({
      ok: false,
      error: { code: 'transport', message: 'message feedback list failed' },
    })
  })

  it('describes a non-Error mutation rejection with a stable message', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario under test.
    const { remote } = fakeRemote({ put: () => Promise.reject('nope') })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'transport', message: 'message feedback mutation failed' },
    })
  })

  it('propagates a failed load to a queued mutation without calling the wire', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: SESSION } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
    expect(calls.filter(call => call.method === 'put')).toHaveLength(0)
  })

  it('keeps a later mutation running after an earlier one settles as a failure', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    let first = true
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      put: () => {
        if (first) {
          first = false
          return Promise.reject(new Error('first blew up'))
        }
        return Promise.resolve({ ok: true, value: item({ rating: 'negative' }) })
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    /** 中文说明：测试局部值 [a, b]，由紧邻初始化决定。 */
    const [a, b] = await Promise.all([
      controller.rate(MSG, 'positive'),
      controller.rate(MSG, 'negative'),
    ])

    expect(a).toMatchObject({ ok: false, error: { code: 'transport' } })
    expect(b).toEqual({ ok: true })
    expect(controller.getSnapshot().items.get(MSG)?.rating).toBe('negative')
  })

  it('ignores a conflict reconciliation that lands after disposal', async () => {
    // The mutate() guard only refuses work admitted after disposal, so this
    // exercises commit()'s own guard: the call is already in flight when the
    // fiber unloads, and its authoritative item must not be published.
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item({ version: version('v1') })] } }),
      put: async () => {
        await gate
        return { ok: false, error: { code: 'version-conflict', current: item({ version: version('v2'), rating: 'negative' }) } }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()
    /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
    const listener = vi.fn()
    controller.subscribe(listener)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = controller.rate(MSG, 'negative')

    controller.dispose()
    release()
    await pending

    // publish() drops its listener set on dispose, so no subscriber is told.
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops a delete conflict reconciliation once disposed mid-flight', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
      delete: async () => {
        await gate
        return { ok: false, error: { code: 'version-conflict', current: null } }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = controller.clear(MSG)

    /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.dispose()
    release()
    await pending

    // The reconciliation still computes, but no subscriber is notified.
    expect(listener).not.toHaveBeenCalled()
  })

  it('leaves the local item untouched when a rating fails for a non-conflict reason', async () => {
    /** 中文说明：测试局部值 existing，由紧邻初始化决定。 */
    const existing = item({ version: version('v3'), rating: 'positive' })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [existing] } }),
      put: () => Promise.resolve({ ok: false, error: { code: 'note-too-large', maxBytes: 8, actualBytes: 9 } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.rate(MSG, 'negative', 'far too long')).toMatchObject({
      ok: false,
      error: { code: 'note-too-large' },
    })
    expect(controller.getSnapshot().items.get(MSG)).toEqual(existing)
  })

  it('leaves the local item untouched when a delete fails for a non-conflict reason', async () => {
    /** 中文说明：测试局部值 existing，由紧邻初始化决定。 */
    const existing = item({ version: version('v4') })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [existing] } }),
      delete: () => Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: SESSION } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
    expect(controller.getSnapshot().items.get(MSG)).toEqual(existing)
  })

  it('preserves a stored note when a rating switch omits one', async () => {
    // Regression: a control that rendered before the first list read holds no
    // item, so it passes note=undefined; that must not erase the stored note.
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = item({ version: version('v1'), rating: 'positive', note: 'keep me' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'negative')).toEqual({ ok: true })

    /** 中文说明：测试局部值 put，由紧邻初始化决定。 */
    const put = calls.filter(c => c.method === 'put')[0]?.request as Record<string, unknown>
    expect(put.note).toBe('keep me')
    expect(put.rating).toBe('negative')
  })

  it('toggle retracts when the committed rating already matches', async () => {
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = item({ version: version('v1'), rating: 'positive' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.toggle(MSG, 'positive')).toEqual({ ok: true })

    expect(calls.filter(c => c.method === 'delete')).toHaveLength(1)
    expect(calls.filter(c => c.method === 'put')).toHaveLength(0)
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('toggle decides from the committed item, not a cold view', async () => {
    // The click lands before any list read: the cold view knows no item, yet the
    // stored rating matches, so the toggle must retract rather than re-put.
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = item({ version: version('v1'), rating: 'positive', note: 'kept' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    expect(controller.getSnapshot().status).toBe('cold')

    expect(await controller.toggle(MSG, 'positive')).toEqual({ ok: true })

    expect(calls.filter(c => c.method === 'delete')).toHaveLength(1)
  })

  it('toggle replaces the opposite rating and carries the note forward', async () => {
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = item({ version: version('v1'), rating: 'positive', note: 'kept' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.toggle(MSG, 'negative')).toEqual({ ok: true })

    /** 中文说明：测试局部值 put，由紧邻初始化决定。 */
    const put = calls.filter(c => c.method === 'put')[0]?.request as Record<string, unknown>
    expect(put).toMatchObject({ rating: 'negative', note: 'kept', ifVersion: version('v1') })
  })

  it('clearNote drops the note and keeps the rating', async () => {
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = item({ version: version('v1'), rating: 'negative', note: 'remove me' })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [stored] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.clearNote(MSG)).toEqual({ ok: true })

    /** 中文说明：测试局部值 put，由紧邻初始化决定。 */
    const put = calls.filter(c => c.method === 'put')[0]?.request as Record<string, unknown>
    expect(put.rating).toBe('negative')
    expect(put).not.toHaveProperty('note')
  })

  it('clearNote is a no-op when there is no note to drop', async () => {
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.clearNote(MSG)).toEqual({ ok: true })
    expect(calls.filter(c => c.method === 'put')).toHaveLength(0)
  })

  it('resync serializes behind an in-flight mutation', async () => {
    // Regression: an unserialized reconnect read could land after a newer put
    // and resurrect the version that put had already replaced.
    /** 中文说明：测试局部值 order，由紧邻初始化决定。 */
    const order: string[] = []
    /** 中文说明：测试局部值 releasePut，由紧邻初始化决定。 */
    let releasePut = (): void => {}
    /** 中文说明：测试局部值 putGate，由紧邻初始化决定。 */
    const putGate = new Promise<void>((r) => { releasePut = r })
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => {
        order.push('list')
        return Promise.resolve({ ok: true, value: { items: [item({ version: version('v1') })] } })
      },
      put: async () => {
        order.push('put:start')
        await putGate
        order.push('put:end')
        return { ok: true, value: item({ version: version('v9'), rating: 'negative' }) }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    /** 中文说明：测试局部值 rating，由紧邻初始化决定。 */
    const rating = controller.rate(MSG, 'negative')
    /** 中文说明：测试局部值 resync，由紧邻初始化决定。 */
    const resync = controller.resync()
    releasePut()
    await Promise.all([rating, resync])

    // The reconnect read runs only after the mutation settled.
    expect(order.indexOf('list', 1)).toBeGreaterThan(order.indexOf('put:end'))
  })

  it('refuses a mutation disposed while its seeding read is in flight', async () => {
    // Dispose only once the seeding list call has actually started, so the
    // mutation is already past the admission check and must be stopped by the
    // second guard that runs after ensure() resolves.
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((r) => { release = r })
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    let started = (): void => {}
    /** 中文说明：测试局部值 listStarted，由紧邻初始化决定。 */
    const listStarted = new Promise<void>((r) => { started = r })
    /** 中文说明：测试局部值 { remote, calls }，由紧邻初始化决定。 */
    const { remote, calls } = fakeRemote({
      list: async () => {
        started()
        await gate
        return { ok: true, value: { items: [] } }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = controller.rate(MSG, 'positive')

    await listStarted
    controller.dispose()
    release()

    expect(await pending).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(calls.filter(c => c.method === 'put')).toHaveLength(0)
  })

  it('renders a carrier failure from the Remote envelope', async () => {
    // The generated face folds transport faults into ok:false with a
    // RemoteFailure, so the controller reads them as values, not rejections.
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({
        ok: false,
        error: { code: 'carrier-closed', message: 'socket closed', details: {} },
      }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.ensure()).toEqual({
      ok: false,
      error: { code: 'carrier-closed', message: 'socket closed' },
    })
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: 'socket closed' })
  })

  it('renders a carrier failure on a mutation without touching the view', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      put: () => Promise.resolve({
        ok: false,
        error: { code: 'carrier-closed', message: 'socket closed', details: {} },
      }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)

    expect(await controller.rate(MSG, 'positive')).toEqual({
      ok: false,
      error: { code: 'carrier-closed', message: 'socket closed' },
    })
    expect(controller.getSnapshot().items.has(MSG)).toBe(false)
  })

  it('renders a carrier failure on a delete', async () => {
    /** 中文说明：测试局部值 { remote }，由紧邻初始化决定。 */
    const { remote } = fakeRemote({
      list: () => Promise.resolve({ ok: true, value: { items: [item()] } }),
      delete: () => Promise.resolve({
        ok: false,
        error: { code: 'carrier-closed', message: 'socket closed', details: {} },
      }),
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new MessageFeedbackController(remote, SESSION)
    await controller.ensure()

    expect(await controller.clear(MSG)).toMatchObject({ ok: false, error: { code: 'carrier-closed' } })
    expect(controller.getSnapshot().items.has(MSG)).toBe(true)
  })
})
