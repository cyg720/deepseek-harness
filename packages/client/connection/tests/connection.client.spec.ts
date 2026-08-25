/*
 * 文件职责：验证 ConnectionController 的描述加载、双事件流连接、重试、超时和停止行为。
 * 技术维度：Vitest、可控 FakeApiClient、延迟 Promise、AbortSignal 与短重试计时配置。
 * 产品维度：确保客户端在网络波动和宿主描述失败时能报告正确状态并可靠恢复或停止。
 * 逻辑维度：为模拟 API 安排帧、失败或阻塞，启动控制器，观察回调与状态，最后停止循环。
 * 关键边界：测试计时值刻意很短；所有后台循环必须在用例结束前停止；警告和错误需恢复。
 * 新手阅读建议：先看 FAST 与 subscribedFrame，再从成功连接场景读到失败、超时和停止场景。
 */
/**
 * ConnectionController: stream pumping into sinks, the strict readiness
 * handshake (describe + both streams' onOpen, timeout-guarded), generation
 * abort on loss, backoff reconnection, state transitions, and sink-exception
 * isolation. Real (short) timers — the timeout and backoff are configurable,
 * so tests run them at millisecond scale.
 */
/* 文件职责：验证连接控制器生命周期。技术维度：可控 API、取消信号与短计时器。产品维度：确保断线后正确恢复或停止。逻辑维度：安排响应后观察状态回调。关键边界：后台循环必须停止。新手阅读建议：从成功场景读到超时场景。 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import type { ConnectionState } from '../src/client/connection.ts'
import { ConnectionController } from '../src/client/connection.ts'
import { FakeApiClient, deferred, ok } from './fake-api.client.ts'

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `SID` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const SID = 'fk-c1' as SessionId
/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `FAST` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const FAST = { backoffBaseMs: 10, backoffFactor: 1, backoffMaxMs: 10, streamOpenTimeoutMs: 500 }

/** 中文说明：测试辅助函数 `subscribedFrame`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function subscribedFrame(lastSeq = 0) {
  return { type: 'session/subscribed', sessionId: SID, lastSeq } as const
}

describe('connection lifecycle', () => {
  it('announces connected after describe + both streams open, then pumps frames to sinks', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `muxSeen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxSeen: string[] = []
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `descriptions` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const descriptions: boolean[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onMuxEnvelope: envelope => muxSeen.push(envelope.payload.type),
      onConnected: (description) => {
        connected++
        descriptions.push(description.canOpenPath)
      },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.pushMux(subscribedFrame())
      await vi.waitFor(() => { expect(muxSeen).toEqual(['session/subscribed']) })
      expect(api.callsOf('host.describe')).toHaveLength(1)
      expect(descriptions).toEqual([true])
    } finally {
      controller.stop()
    }
  })

  it('reconnects with a fresh generation when a stream fails, and stop() ends the loop', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.failStreams(new Error('stream torn'))
      await vi.waitFor(() => { expect(connected).toBe(2) }) // new generation after backoff
      expect(api.openMuxCount).toBe(1) // the dead generation's stream is gone, exactly one live
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
    // stop() aborts the live generation (streams tear down) and no reconnect follows.
    await vi.waitFor(() => { expect(api.openMuxCount).toBe(0) })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(api.openMuxCount).toBe(0)
  })

  it('treats describe failure as generation failure and retries', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `gate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `describeCalls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls === 1 ? Promise.reject(new Error('host down')) : gate.promise
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(2) }) // retried after backoff
      expect(connected).toBe(0) // never announced during the failed generation
      gate.resolve(ok({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true }))
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('treats a host.describe business error as generation failure', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `describeCalls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls += 1
      if (describeCalls === 1) {
        return Promise.resolve({
          rpcId: 'bad-describe' as never,
          result: {
            ok: false as const,
            error: { code: 'internal' as const, message: 'not ready', details: {} },
          },
        })
      }
      return Promise.resolve(ok({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true }))
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(2) })
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('converges stream/error frames into reconnect instead of dispatching them', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `muxSeen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const muxSeen: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onMuxEnvelope: envelope => muxSeen.push(envelope.payload.type),
      onConnected: () => { connected++ },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.pushMux({ type: 'stream/error', error: { code: 'internal', message: 'impl broke', details: {} } })
      await vi.waitFor(() => { expect(connected).toBe(2) }) // treated as loss → reconnect
      expect(muxSeen).toEqual([]) // never forwarded to the business sink
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('isolates sink exceptions from the pump', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `seen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const seen: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `errorSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onMuxEnvelope: (envelope) => {
        seen.push(envelope.payload.type)
        throw new Error('business layer bug')
      },
      onConnected: () => { connected++ },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.pushMux(subscribedFrame(1))
      api.pushMux(subscribedFrame(2))
      await vi.waitFor(() => { expect(seen).toHaveLength(2) }) // second frame still pumped
      expect(connected).toBe(1) // no reconnect triggered by the sink throw
    } finally {
      controller.stop()
      errorSpy.mockRestore()
    }
  })

  it('holds onConnected until both streams establish even after describe succeeds', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    api.holdStreamOpen = true // describe resolves immediately; stream establishment is in the case's hand
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(api.callsOf('host.describe')).toHaveLength(1) })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(connected).toBe(0) // describe alone must not announce
      api.releaseStreamOpens()
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
    }
  })

  it('rejects a generation whose streams end during readiness and retries', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `firstDescribe` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const firstDescribe = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `describeCalls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls === 1
        ? firstDescribe.promise
        : Promise.resolve(ok({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true }))
    }
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `states` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const states: ConnectionState[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(api.openMuxCount).toBe(1) })
      api.endStreams()
      firstDescribe.resolve(ok({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true }))

      await vi.waitFor(() => { expect(describeCalls).toBe(2) })
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('proceeds as connected via the timeout guard when a carrier never fires onOpen', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    api.suppressStreamOpen = true // misbehaving carrier: streams open but onOpen never fires
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, { ...FAST, streamOpenTimeoutMs: 20 })
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) }) // handshake resolved by the guard, not wedged
    } finally {
      controller.stop()
    }
  })

  it('emits deduplicated connected/reconnecting state transitions', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `states` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const states: ConnectionState[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['connected'])
      api.failStreams(new Error('torn'))
      await vi.waitFor(() => { expect(connected).toBe(2) })
      expect(states).toEqual(['connected', 'reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('does not announce a generation stopped synchronously by its connected state sink', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `states` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const states: ConnectionState[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: (state) => {
        states.push(state)
        if (state === 'connected') controller.stop()
      },
    }, FAST)

    controller.start()
    await vi.waitFor(() => { expect(states).toEqual(['connected']) })
    await vi.waitFor(() => { expect(api.openMuxCount).toBe(0) })
    expect(connected).toBe(0)
  })

  it('deduplicates consecutive reconnecting emissions across two straight failures', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `gate` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `describeCalls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls <= 2 ? Promise.reject(new Error('down')) : gate.promise
    }
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `states` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const states: ConnectionState[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：记录调用并隔离外部输出的 Vitest 测试替身；变量 `warnSpy` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(3) })
      gate.resolve(ok({ version: '0', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true }))
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected']) // two failures, one reconnecting emission
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('runs with no sinks at all (every callback slot optional)', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, {}, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(api.callsOf('host.describe')).toHaveLength(1) })
      api.pushMux(subscribedFrame()) // pumped with sink undefined: dropped silently
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      controller.stop()
    }
  })

  it('start() is idempotent (one loop, one stream set)', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = new FakeApiClient()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `connected` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let connected = 0
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `controller` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(api.openMuxCount).toBe(1)
      expect(api.callsOf('host.describe')).toHaveLength(1)
    } finally {
      controller.stop()
    }
  })
})
