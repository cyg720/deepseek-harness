/** Unit coverage for unpublished Session preparation ownership and sharing. */
/*
 * 文件职责：验证 preparations.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { observeQueuedAbort, SessionPreparations } from '../src/preparations.ts'

/** 中文说明：interface PreparedSource 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
interface PreparedSource {
  readonly session: Session
  readonly label: string
}

/** 中文说明：函数 prepared 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function prepared(label: string): PreparedSource {
  return { session: Session.create(SessionId(label)), label }
}

/** 中文说明：函数 committed 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function committed(source: PreparedSource): Promise<{ source: PreparedSource; state: string }> {
  return Promise.resolve({ source, state: source.label })
}

describe('SessionPreparations inspection', () => {
  it('shares in-flight and ready sources, then invalidates them', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(2)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('shared-inspection')
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：函数值 load 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const load = vi.fn(() => gate.promise)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = preparations.inspect(id, load)
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = preparations.inspect(id, load, new AbortController().signal)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)

    expect(preparations.has(id)).toBe(true)
    gate.resolve(source)
    await expect(first).resolves.toBe(source)
    await expect(second).resolves.toBe(source)
    await expect(preparations.inspect(id, load)).resolves.toBe(source)
    expect(load).toHaveBeenCalledOnce()

    preparations.invalidate(id)
    preparations.invalidate(id)
    expect(preparations.has(id)).toBe(false)
  })

  it('keeps a shared load alive when its first observer cancels', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('cancelled-first-observer')
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：函数值 load 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const load = vi.fn(() => gate.promise)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('first observer cancelled')
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = preparations.inspect(id, load, controller.signal)
    /** 中文说明：变量 joined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const joined = preparations.inspect(id, load)

    controller.abort(reason)
    await expect(first).rejects.toBe(reason)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    gate.resolve(source)
    await expect(joined).resolves.toBe(source)
    await expect(preparations.inspect(id, load)).resolves.toBe(source)
    expect(load).toHaveBeenCalledOnce()
  })

  it('evicts completed loads whose observers cancelled before readiness', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 firstId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstId = SessionId('cancelled-ready-first')
    /** 中文说明：变量 secondId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondId = SessionId('cancelled-ready-second')
    /** 中文说明：变量 firstGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstGate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：变量 secondGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondGate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：变量 firstController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstController = new AbortController()
    /** 中文说明：变量 secondController 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondController = new AbortController()
    /** 中文说明：函数值 first 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const first = preparations.inspect(firstId, () => firstGate.promise, firstController.signal)
    /** 中文说明：函数值 second 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const second = preparations.inspect(secondId, () => secondGate.promise, secondController.signal)

    firstController.abort(new Error('first observer cancelled'))
    secondController.abort(new Error('second observer cancelled'))
    await expect(first).rejects.toThrow('first observer cancelled')
    await expect(second).rejects.toThrow('second observer cancelled')

    firstGate.resolve(prepared(firstId))
    await firstGate.promise
    secondGate.resolve(prepared(secondId))
    await secondGate.promise
    await Promise.resolve()

    expect(preparations.has(firstId)).toBe(false)
    expect(preparations.has(secondId)).toBe(true)
  })

  it('removes failed and invalidated in-flight loads without changing their observers', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 failedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedId = SessionId('failed-inspection')
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('load failed')
    await expect(preparations.inspect(failedId, () => Promise.reject(failure))).rejects.toBe(failure)
    expect(preparations.has(failedId)).toBe(false)

    /** 中文说明：变量 invalidatedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidatedId = SessionId('invalidated-inspection')
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：函数值 inspection 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const inspection = preparations.inspect(invalidatedId, () => gate.promise)
    preparations.invalidate(invalidatedId)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(invalidatedId)
    gate.resolve(source)
    await expect(inspection).resolves.toBe(source)
    expect(preparations.has(invalidatedId)).toBe(false)

    /** 中文说明：变量 rejectedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rejectedId = SessionId('invalidated-rejection')
    /** 中文说明：变量 rejectedGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rejectedGate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：函数值 rejected 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const rejected = preparations.inspect(rejectedId, () => rejectedGate.promise)
    preparations.invalidate(rejectedId)
    rejectedGate.reject(failure)
    await expect(rejected).rejects.toBe(failure)
  })

  it('removes a load that throws before returning its promise', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('synchronous-load-failure')
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('synchronous load failure')

    await expect(preparations.inspect(id, () => { throw failure })).rejects.toBe(failure)
    expect(preparations.has(id)).toBe(false)
  })

  it('evicts ready entries while leaving reserved entries alone', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 reservedA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reservedA = await preparations.reserve(
      SessionId('reserved-a'),
      () => Promise.resolve(prepared('reserved-a')),
      committed,
    )
    /** 中文说明：变量 reservedB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reservedB = await preparations.reserve(
      SessionId('reserved-b'),
      () => Promise.resolve(prepared('reserved-b')),
      committed,
    )
    expect(reservedA).toBeDefined()
    expect(reservedB).toBeDefined()

    await preparations.inspect(SessionId('ready-c'), () => Promise.resolve(prepared('ready-c')))
    preparations.release(reservedA!, true)
    expect(preparations.has(SessionId('reserved-b'))).toBe(true)
    expect(preparations.has(SessionId('ready-c'))).toBe(false)
    expect(preparations.has(SessionId('reserved-a'))).toBe(true)

    preparations.discard(reservedB!)
    preparations.invalidate(SessionId('reserved-a'))
  })

  it('discards only the exact ready source and retains exclusive reservations', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 ready 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ready = prepared('discard-ready')
    expect(preparations.discardReady(ready.session.id, ready)).toBe('missing')
    await preparations.inspect(ready.session.id, () => Promise.resolve(ready))
    expect(preparations.discardReady(ready.session.id, prepared('different'))).toBe('missing')
    expect(preparations.discardReady(ready.session.id, ready)).toBe('discarded')

    /** 中文说明：变量 reserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reserved = await preparations.reserve(
      ready.session.id,
      () => Promise.resolve(ready),
      committed,
    )
    expect(preparations.discardReady(ready.session.id, ready)).toBe('retained')
    preparations.release(reserved!, false)
  })
})

describe('SessionPreparations borrowing', () => {
  it('returns a detached lease when loading invalidates its own entry', async () => {
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    const id = SessionId('borrow-invalidated-load')
    const source = prepared(id)

    const lease = await preparations.borrow(id, () => {
      preparations.invalidate(id)
      return Promise.resolve(source)
    })

    expect(lease.source).toBe(source)
    expect(preparations.has(id)).toBe(false)
    expect(() => { lease[Symbol.dispose]() }).not.toThrow()
  })

  it('releases pins after cancellation while loading and after readiness', async () => {
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    const loadingId = SessionId('borrow-cancelled-loading')
    const loading = Promise.withResolvers<PreparedSource>()
    const loadingAbort = new AbortController()
    const pending = preparations.borrow(loadingId, () => loading.promise, loadingAbort.signal)
    loadingAbort.abort(new Error('cancelled while loading'))
    await expect(pending).rejects.toThrow('cancelled while loading')
    loading.resolve(prepared(loadingId))
    await loading.promise
    await Promise.resolve()

    const readyId = SessionId('borrow-cancelled-ready')
    const ready = prepared(readyId)
    await preparations.inspect(readyId, () => Promise.resolve(ready))
    const readyAbort = new AbortController()
    readyAbort.abort(new Error('cancelled while ready'))
    await expect(preparations.borrow(readyId, () => Promise.resolve(ready), readyAbort.signal))
      .rejects.toThrow('cancelled while ready')

    await preparations.inspect(SessionId('borrow-eviction'), () => Promise.resolve(prepared('borrow-eviction')))
    expect(preparations.has(loadingId)).toBe(false)
  })

  it('makes borrowed lease disposal idempotent across ready, invalidated, and reserved entries', async () => {
    const preparations = new SessionPreparations<PreparedSource, string>(3)

    const ready = prepared('borrow-ready-release')
    const readyLease = await preparations.borrow(ready.session.id, () => Promise.resolve(ready))
    readyLease[Symbol.dispose]()
    readyLease[Symbol.dispose]()

    const invalidated = prepared('borrow-invalidated-release')
    const invalidatedLease = await preparations.borrow(
      invalidated.session.id,
      () => Promise.resolve(invalidated),
    )
    preparations.invalidate(invalidated.session.id)
    invalidatedLease[Symbol.dispose]()

    const reserved = prepared('borrow-reserved-release')
    const reservation = await preparations.reserve(
      reserved.session.id,
      () => Promise.resolve(reserved),
      committed,
    )
    expect(reservation).toBeDefined()
    const reservedLease = await preparations.borrow(
      reserved.session.id,
      () => Promise.resolve(prepared('unused')),
    )
    reservedLease[Symbol.dispose]()
    preparations.release(reservation!, false)
  })
})

describe('SessionPreparations reservation', () => {
  it('waits for an existing reservation, republishes the exact Session, and attaches once', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(2)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('reservation-wait')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    /** 中文说明：函数值 first 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const first = await preparations.reserve(id, () => Promise.resolve(source), committed)
    expect(first).toBeDefined()
    expect(preparations.reservationFor(source.session)).toBe(first)
    expect(() => preparations.reservationFor(Session.create(id))).toThrow(/cannot publish/)
    expect(() => { preparations.assertWritable(id) }).toThrow(/is reserved/)

    /** 中文说明：变量 secondSettled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let secondSettled = false
    /** 中文说明：函数值 secondPromise 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const secondPromise = preparations.reserve(id, () => Promise.resolve(prepared('unused')), committed)
      .then((reservation) => {
        secondSettled = true
        return reservation
      })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    preparations.release(first!, true)
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await secondPromise
    expect(second?.source).toBe(source)
    preparations.attach(second!)
    expect(preparations.reservationFor(source.session)).toBeUndefined()
    expect(() => { preparations.attach(second!) }).toThrow(/no longer reserved/)
    preparations.discard(second!)
    preparations.release(second!, true)
    expect(() => { preparations.assertWritable(id) }).not.toThrow()
  })

  it('supports abortable reservation waits without cancelling the held reservation', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('abortable-reservation-wait')
    /** 中文说明：函数值 first 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const first = await preparations.reserve(id, () => Promise.resolve(prepared(id)), committed)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = { kind: 'cancelled' }
    /** 中文说明：函数值 waiting 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const waiting = preparations.reserve(id, () => Promise.resolve(prepared('unused')), committed, controller.signal)

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    controller.abort(reason)
    await expect(waiting).rejects.toBe(reason)
    expect(preparations.reservationFor(first!.source.session)).toBe(first)
    preparations.release(first!, false)
    expect(preparations.has(id)).toBe(false)
  })

  it('removes a failed commit and wakes another waiter as invalidated', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('failed-commit')
    /** 中文说明：变量 commitStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitStarted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 commitGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitGate = Promise.withResolvers<{ source: PreparedSource; state: string }>()
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('commit failed')
    /** 中文说明：函数值 first 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const first = preparations.reserve(id, () => Promise.resolve(source), () => {
      commitStarted.resolve(undefined)
      return commitGate.promise
    })
    await commitStarted.promise
    expect(() => { preparations.assertWritable(id) }).toThrow(/is reserved/)
    /** 中文说明：函数值 second 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const second = preparations.reserve(id, () => Promise.resolve(prepared('unused')), committed)

    commitGate.reject(failure)
    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBeUndefined()
    expect(preparations.has(id)).toBe(false)
  })

  it('returns a post-commit cancellation to the ready pool', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('post-commit-cancel')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancel after commit')

    await expect(preparations.reserve(id, () => Promise.resolve(source), async (value) => {
      controller.abort(reason)
      return { source: value, state: value.label }
    }, controller.signal)).rejects.toBe(reason)

    expect(preparations.takeReady(id)).toBe(source)
    expect(preparations.takeReady(id)).toBeUndefined()
  })

  it('does not revive an invalidated commit after post-commit cancellation', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('invalidated-commit-cancel')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    /** 中文说明：变量 commitStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitStarted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 commitGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitGate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancel invalidated commit')
    /** 中文说明：函数值 reservation 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reservation = preparations.reserve(id, () => Promise.resolve(source), async (value) => {
      commitStarted.resolve(undefined)
      await commitGate.promise
      return { source: value, state: value.label }
    }, controller.signal)

    await commitStarted.promise
    preparations.invalidate(id)
    controller.abort(reason)
    commitGate.resolve(undefined)
    await expect(reservation).rejects.toBe(reason)
    expect(preparations.has(id)).toBe(false)
  })

  it('does not reserve an entry invalidated while its commit succeeds', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('invalidated-successful-commit')
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    /** 中文说明：变量 commitStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitStarted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 commitGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitGate = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 reservation 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reservation = preparations.reserve(id, () => Promise.resolve(source), async (value) => {
      commitStarted.resolve(undefined)
      await commitGate.promise
      return { source: value, state: value.label }
    })

    await commitStarted.promise
    preparations.invalidate(id)
    commitGate.resolve(undefined)

    await expect(reservation).resolves.toBeUndefined()
    expect(preparations.has(id)).toBe(false)
  })

  it('returns undefined when a load is invalidated before reservation', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('invalidated-reservation')
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：函数值 reservation 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reservation = preparations.reserve(id, () => gate.promise, committed)
    preparations.invalidate(id)
    gate.resolve(prepared(id))
    await expect(reservation).resolves.toBeUndefined()
  })

  it('skips pending adoption and accepts a ready source exactly once', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('take-ready')
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<PreparedSource>()
    /** 中文说明：函数值 inspection 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const inspection = preparations.inspect(id, () => gate.promise)
    expect(preparations.takeReady(id)).toBeUndefined()
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared(id)
    gate.resolve(source)
    await inspection
    expect(preparations.takeReady(id)).toBe(source)
    expect(preparations.takeReady(id)).toBeUndefined()
  })

  it('rejects publication while only an inspection exists', async () => {
    /** 中文说明：变量 preparations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparations = new SessionPreparations<PreparedSource, string>(1)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = prepared('inspection-publication')
    await preparations.inspect(source.session.id, () => Promise.resolve(source))
    expect(() => preparations.reservationFor(source.session)).toThrow(/cannot publish/)
  })
})

describe('observeQueuedAbort', () => {
  it('relays fulfillment and rejection exactly', async () => {
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    await expect(observeQueuedAbort(Promise.resolve('value'), signal)).resolves.toBe('value')
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = { kind: 'failed' }
    /** 中文说明：变量 rejected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rejected = Promise.withResolvers<never>()
    rejected.reject(failure)
    await expect(observeQueuedAbort(rejected.promise, signal)).rejects.toBe(failure)
  })

  it('rejects promptly with an exact abort reason and ignores later settlement', async () => {
    /** 中文说明：变量 operation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const operation = Promise.withResolvers<string>()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = { kind: 'aborted' }
    /** 中文说明：变量 observed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const observed = observeQueuedAbort(operation.promise, controller.signal)
    controller.abort(reason)
    await expect(observed).rejects.toBe(reason)
    operation.resolve('late')
    await Promise.resolve()
  })

  it('observes a pre-aborted signal through the default start predicate', async () => {
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort('pre-aborted')
    await expect(observeQueuedAbort(new Promise<never>(() => {}), controller.signal))
      .rejects.toBe('pre-aborted')
  })

  it('lets an operation that already started own cancellation settlement', async () => {
    /** 中文说明：变量 operation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const operation = Promise.withResolvers<string>()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：函数值 observed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const observed = observeQueuedAbort(operation.promise, controller.signal, () => true)
    controller.abort(new Error('too late'))
    operation.resolve('owned')
    await expect(observed).resolves.toBe('owned')
  })
})
