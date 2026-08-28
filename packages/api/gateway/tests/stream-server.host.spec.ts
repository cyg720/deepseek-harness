/**
 * 文件职责：验证 api/gateway 中 stream server host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import {
  RemoteStreamMuxServer,
  type RemoteStreamFailureMapper,
  type RemoteStreamOpener,
} from '../src/stream-server.ts'

interface RunningMux {
  readonly http: Server
  readonly mux: RemoteStreamMuxServer
  readonly url: string
}

/**
 * 常量说明：running 用于处理 running 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const running = new Set<RunningMux>()

afterEach(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
    await Promise.all([...running].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ async (entry) => {
        running.delete(entry)
        await entry.mux.close().catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
        await closeHttp(entry.http)
      }))
  })

describe('Remote stream mux server carrier lifecycle', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('sends WebSocket Ping control frames without application messages', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_endpoint（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_endpoint, _payload,
 * signal)，并按返回类型处理结果。
 */ async (_endpoint, _payload, signal) => waitForAbort(signal), 20)
        /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const client = await connect(entry.url)
        /**
     * 常量说明：serverSocket 用于处理 serverSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const serverSocket = acceptedSocket(entry.mux)
        /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const messages = vi.fn()
        client.on('message', messages)

        /**
     * 常量说明：ping 用于处理 ping 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ping = once(client, 'ping')
        /**
     * 常量说明：pong 用于处理 pong 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pong = once(serverSocket, 'pong')
        expect((await ping)[0]).toEqual(Buffer.alloc(0))
        expect((await pong)[0]).toEqual(Buffer.alloc(0))
        expect(messages).not.toHaveBeenCalled()

        /**
     * 常量说明：closingPing 用于处理 closingPing 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const closingPing = vi.spyOn(serverSocket, 'ping')
        client.pause()
        serverSocket.close()
        expect(serverSocket.readyState).toBe(WebSocket.CLOSING)
        await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { setTimeout(resolve, 25) })
        expect(closingPing).not.toHaveBeenCalled()

        /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const closed = once(client, 'close')
        client.resume()
        await closed
      })

    it('rejects binary, malformed, and duplicate logical-stream messages', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_endpoint（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_endpoint, _payload,
 * signal)，并按返回类型处理结果。
 */ async (_endpoint, _payload, signal) => waitForAbort(signal))

        /**
     * 常量说明：binary 用于处理 binary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const binary = await connect(entry.url)
        /**
     * 常量说明：binaryClosed 用于处理 binaryClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const binaryClosed = once(binary, 'close')
        binary.send(Buffer.from('{}'))
        /**
     * 常量说明：binaryEvent 用于处理 binaryEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const binaryEvent = await binaryClosed
        expect(binaryEvent[0]).toBe(1003)

        /**
     * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const malformed = await connect(entry.url)
        /**
     * 常量说明：malformedClosed 用于处理 malformedClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const malformedClosed = once(malformed, 'close')
        malformed.send('not json')
        /**
     * 常量说明：malformedEvent 用于处理 malformedEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const malformedEvent = await malformedClosed
        expect(malformedEvent[0]).toBe(1008)
        expect(String(malformedEvent[1])).toBe('invalid Remote stream request')

        /**
     * 常量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const duplicate = await connect(entry.url)
        /**
     * 常量说明：longId 用于处理 longId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const longId = 'same'.repeat(100)
        duplicate.send(openFrame(longId))
        duplicate.send(openFrame(longId))
        /**
     * 常量说明：duplicateEvent 用于处理 duplicateEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const duplicateEvent = await once(duplicate, 'close')
        expect(duplicateEvent[0]).toBe(1008)
        expect(String(duplicateEvent[1])).toBe('invalid Remote stream request')

        /**
     * 常量说明：noInput 用于处理 noInput 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const noInput = await connect(entry.url)
        noInput.send(openFrame('no-input'))
        noInput.send(JSON.stringify({ type: 'input', streamId: 'no-input', value: 'unexpected' }))
        /**
     * 常量说明：noInputEvent 用于处理 noInputEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const noInputEvent = await once(noInput, 'close')
        expect(noInputEvent[0]).toBe(1008)
        expect(String(noInputEvent[1])).toBe('invalid Remote stream request')
      })

    it('accepts all ws text representations and terminates a carrier error', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_endpoint（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_endpoint, _payload,
 * signal)，并按返回类型处理结果。
 */ async (_endpoint, _payload, signal) => waitForAbort(signal))
        /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const client = await connect(entry.url)
        /**
     * 常量说明：serverSocket 用于处理 serverSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const serverSocket = acceptedSocket(entry.mux)
        /**
     * 常量说明：cancel 用于处理 cancel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cancel = JSON.stringify({ type: 'cancel', streamId: 'absent' })

        serverSocket.emit('message', [Buffer.from(cancel)], false)
        serverSocket.emit('message', Uint8Array.from(Buffer.from(cancel)).buffer, false)

        /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const closed = once(client, 'close')
        serverSocket.emit('error', new Error('fixture carrier failure'))
        await closed
      })

    it('does not send an end frame after clean source cancellation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let opened!: () => void
        /**
     * 常量说明：didOpen 用于处理 didOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didOpen = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { opened = resolve })
        /**
     * 变量说明：returned 用于处理 returned 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let returned!: () => void
        /**
     * 常量说明：didReturn 用于处理 didReturn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didReturn = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { returned = resolve })
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_endpoint（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_endpoint, _payload,
 * signal)，并按返回类型处理结果。
 */ async (_endpoint, _payload, signal) => {
            opened()
            return cleanlyCancelled(signal, returned)
          })
        /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const client = await connect(entry.url)
        /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const frames: unknown[] = []
        client.on('message', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
 */ (data) => {
            if (!Buffer.isBuffer(data)) throw new TypeError('fixture expected a Buffer frame')
            frames.push(JSON.parse(data.toString('utf8')) as unknown)
          })
        client.send(openFrame('cancelled'))
        await didOpen
        client.send(JSON.stringify({ type: 'cancel', streamId: 'cancelled' }))
        await didReturn
        await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { setImmediate(resolve) })
        expect(frames).toEqual([])
        client.close()
        await once(client, 'close')
      })

    it('closes the carrier when ws reports an item write failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 变量说明：release 用于处理 release 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let release!: () => void
        /**
     * 常量说明：released 用于处理 released 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const released = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { release = resolve })
        /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let opened!: () => void
        /**
     * 常量说明：didOpen 用于处理 didOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didOpen = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { opened = resolve })
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => delayedItem(released, opened))
        /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const client = await connect(entry.url)
        client.send(openFrame('write-failure'))
        await didOpen
        /**
     * 常量说明：serverSocket 用于处理 serverSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const serverSocket = acceptedSocket(entry.mux)
        /**
     * 常量说明：mutable 用于处理 mutable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const mutable = serverSocket as unknown as {
          /**
       * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
       * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param callback （(error?: Error) => void）：接收后续状态或事件并执行调用方逻辑；
       * 必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 send(data, callback)，并按返回类型处理结果。
       */
          send(data: unknown, callback: (error?: Error) => void): void
        }
        mutable.send = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_data（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：callback（由 TypeScript
 * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_data, callback)，并按返回类型处理结果。
 */ (_data, callback): void => {
            callback(new Error('fixture ws write failure'))
          }

        /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const closed = once(client, 'close')
        release()
        /**
     * 常量说明：closeEvent 用于关闭 Event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const closeEvent = await closed
        expect(closeEvent[0]).toBe(1011)
        expect(String(closeEvent[1])).toBe('Remote stream failure could not be delivered')
      })

    it('contains an item produced after its socket closes', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 变量说明：release 用于处理 release 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let release!: () => void
        /**
     * 常量说明：released 用于处理 released 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const released = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { release = resolve })
        /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let opened!: () => void
        /**
     * 常量说明：didOpen 用于处理 didOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didOpen = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { opened = resolve })
        /**
     * 变量说明：returned 用于处理 returned 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let returned!: () => void
        /**
     * 常量说明：didReturn 用于处理 didReturn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didReturn = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { returned = resolve })
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => delayedItem(released, opened, returned))
        /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const client = await connect(entry.url)
        client.send(openFrame('late-item'))
        await didOpen
        /**
     * 常量说明：serverSocket 用于处理 serverSocket 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const serverSocket = acceptedSocket(entry.mux)
        client.close()
        await once(client, 'close')
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(serverSocket.readyState).toBe(WebSocket.CLOSED) })
        release()
        await didReturn
      })

    it('terminates active sockets on close and reports a repeated close', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let opened!: () => void
        /**
     * 常量说明：didOpen 用于处理 didOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didOpen = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { opened = resolve })
        /**
     * 变量说明：returned 用于处理 returned 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let returned!: () => void
        /**
     * 常量说明：didReturn 用于处理 didReturn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const didReturn = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { returned = resolve })
        /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const entry = await startMux(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_endpoint（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_payload（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_endpoint, _payload,
 * signal)，并按返回类型处理结果。
 */ async (_endpoint, _payload, signal) => {
            opened()
            return cleanlyCancelled(signal, returned)
          })
        /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const client = await connect(entry.url)
        client.send(openFrame('active'))
        await didOpen

        /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const closed = once(client, 'close')
        await entry.mux.close()
        running.delete(entry)
        await closed
        await didReturn
        await expect(entry.mux.close()).rejects.toThrow()
        await closeHttp(entry.http)
      })
  })

/**
 * 常量说明：mapFailure 用于映射 Failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：映射 Failure 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mapFailure(error)，并按返回类型处理结果。
 */
const mapFailure: RemoteStreamFailureMapper = error => ({
  code: 'internal',
  message: error instanceof Error ? error.message : String(error),
  details: {},
})

/**
 * 功能说明：启动 Mux 相关流程；使用场景由所在模块及调用位置决定。
 * @param open （RemoteStreamOpener）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param heartbeatIntervalMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<RunningMux>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 startMux(open, heartbeatIntervalMs)，并按返回类型处理结果。
 */
async function startMux(open: RemoteStreamOpener, heartbeatIntervalMs = 30_000): Promise<RunningMux> {
  /**
   * 常量说明：mux 用于处理 mux 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const mux = new RemoteStreamMuxServer(open, mapFailure, heartbeatIntervalMs)
  /**
   * 常量说明：http 用于处理 http 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const http = createServer()
  http.on('upgrade', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：socket（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：head（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, socket, head)，
 * 并按返回类型处理结果。
 */ (request, socket, head) => { mux.handleUpgrade(request, socket, head) })
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
          http.off('error', reject)
          resolve()
        })
    })
  /**
   * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('fixture HTTP server has no TCP port')
  /**
   * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entry = { http, mux, url: `ws://127.0.0.1:${String(address.port)}` }
  running.add(entry)
  return entry
}

/**
 * 功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。
 * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<WebSocket>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 connect(url)，并按返回类型处理结果。
 */
async function connect(url: string): Promise<WebSocket> {
  /**
   * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const socket = new WebSocket(url)
  await once(socket, 'open')
  return socket
}

/**
 * 功能说明：处理 acceptedSocket 相关流程；使用场景由所在模块及调用位置决定。
 * @param mux （RemoteStreamMuxServer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WebSocket；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 acceptedSocket(mux)，并按返回类型处理结果。
 */
function acceptedSocket(mux: RemoteStreamMuxServer): WebSocket {
  /**
   * 常量说明：exposed 用于处理 exposed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exposed = mux as unknown as { server: { clients: Set<WebSocket> } }
  /**
   * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const socket = [...exposed.server.clients][0]
  if (socket === undefined) throw new Error('fixture mux has no accepted socket')
  return socket
}

/**
 * 功能说明：打开 Frame 相关流程；使用场景由所在模块及调用位置决定。
 * @param streamId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 openFrame(streamId)，并按返回类型处理结果。
 */
function openFrame(streamId: string): string {
  return JSON.stringify({ type: 'open', streamId, endpoint: 'fixture/follow', payload: {} })
}

/**
 * 功能说明：处理 waitForAbort 相关流程；使用场景由所在模块及调用位置决定。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns AsyncIterable<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 waitForAbort(signal)，并按返回类型处理结果。
 */
async function *waitForAbort(signal: AbortSignal): AsyncIterable<never> {
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
    })
}

/**
 * 功能说明：处理 cleanlyCancelled 相关流程；使用场景由所在模块及调用位置决定。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @param returned （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns AsyncIterable<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cleanlyCancelled(signal, returned)，并按返回类型处理结果。
 */
async function *cleanlyCancelled(signal: AbortSignal, returned: () => void): AsyncIterable<never> {
  try {
    await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
      })
  } finally {
    returned()
  }
}

/**
 * 功能说明：处理 delayedItem 相关流程；使用场景由所在模块及调用位置决定。
 * @param released （Promise<void>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param opened （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param returned （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns AsyncIterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 delayedItem(released, opened, returned)，并按返回类型处理结果。
 */
async function *delayedItem(
  released: Promise<void>,
  opened: () => void,
  returned: () => void = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
): AsyncIterable<string> {
  try {
    opened()
    await released
    yield 'item'
  } finally {
    returned()
  }
}

/**
 * 功能说明：关闭 Http 相关流程；使用场景由所在模块及调用位置决定。
 * @param server （Server）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeHttp(server)，并按返回类型处理结果。
 */
async function closeHttp(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      server.close(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
    })
}
