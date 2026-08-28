/**
 * 文件职责：验证 api/gateway 中 remote event protocol host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import {
  isRemoteJsonValue,
  parseRemoteEventResult,
  parseRemoteStreamClientMessage,
  projectRemoteEventRequest,
  projectRemoteEventRejection,
  restoreRemoteEventRejection,
} from '../src/stream-protocol.ts'

describe('Remote Event result protocol', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('accepts delegation, values, and structured rejections', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(parseRemoteEventResult({
          clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next' },
        })).toEqual({ clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next' } })
        expect(parseRemoteEventResult({
          clientId: 'client-1', eventId: 'event-2', outcome: { kind: 'result' },
        })).toEqual({ clientId: 'client-1', eventId: 'event-2', outcome: { kind: 'result' } })
        expect(parseRemoteEventResult({
          clientId: 'client-1', eventId: 'event-3', outcome: { kind: 'result', value: { accepted: true } },
        })).toEqual({
          clientId: 'client-1', eventId: 'event-3', outcome: { kind: 'result', value: { accepted: true } },
        })
        expect(parseRemoteEventResult({
          clientId: 'client-1',
          eventId: 'event-minimal',
          outcome: { kind: 'rejected', error: { name: 'Error', message: 'offline' } },
        })).toEqual({
          clientId: 'client-1',
          eventId: 'event-minimal',
          outcome: { kind: 'rejected', error: { name: 'Error', message: 'offline' } },
        })
        expect(parseRemoteEventResult({
          clientId: 'client-1',
          eventId: 'event-4',
          outcome: {
            kind: 'rejected',
            error: {
              name: 'ApprovalError',
              message: 'declined',
              code: 'DECLINED',
              details: { retryable: false },
            },
          },
        })).toEqual({
          clientId: 'client-1',
          eventId: 'event-4',
          outcome: {
            kind: 'rejected',
            error: {
              name: 'ApprovalError',
              message: 'declined',
              code: 'DECLINED',
              details: { retryable: false },
            },
          },
        })
      })

    it.each([
      null,
      [],
      {},
      { clientId: '', eventId: 'event-1', outcome: { kind: 'next' } },
      { clientId: 'client-1', eventId: '', outcome: { kind: 'next' } },
      { clientId: 'client-1', eventId: 'event-1', outcome: null },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next' }, extra: true },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next', value: null } },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'result', extra: true } },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'result', value: undefined } },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'unknown' } },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error: null } },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error: { name: '', message: 'bad' } } },
      { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error: { name: 'Error', message: 1 } } },
      {
        clientId: 'client-1',
        eventId: 'event-1',
        outcome: { kind: 'rejected', error: { name: 'Error', message: 'bad', code: 1 } },
      },
      {
        clientId: 'client-1',
        eventId: 'event-1',
        outcome: { kind: 'rejected', error: { name: 'Error', message: 'bad', details: 1n } },
      },
      {
        clientId: 'client-1',
        eventId: 'event-1',
        outcome: { kind: 'rejected', error: { name: 'Error', message: 'bad', extra: true } },
      },
    ])('rejects an invalid result frame: %#', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ (value) => {
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => parseRemoteEventResult(value)).toThrow('api gateway: invalid Remote event')
      })

    it('rejects symbol properties in rejection records', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const error = { name: 'Error', message: 'bad', [Symbol('hidden')]: true }
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => parseRemoteEventResult({
            clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error },
          })).toThrow('api gateway: invalid Remote event rejection')
      })
  })

describe('Remote Event request projection', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('removes only the direct Agent and signal fields', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { kind: 'agent' }
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const nested = { agent, signal: 'payload' }
        /**
     * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const projected = projectRemoteEventRequest({
          agent,
          signal: abort.signal,
          prompt: 'approve?',
          nested,
        }, agent)

        expect(projected).toEqual({
          request: { prompt: 'approve?', nested },
          signal: abort.signal,
        })
        expect(Object.getPrototypeOf(projected.request)).toBeNull()
      })

    it('accepts a null-prototype request and an omitted signal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { kind: 'agent' }
        /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const request = Object.assign(Object.create(null) as Record<string, unknown>, {
          agent,
          accepted: true,
        })
        expect(projectRemoteEventRequest(request, agent)).toEqual({
          request: { accepted: true },
        })
      })

    it('requires the scoped Agent as a direct own field', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { kind: 'agent' }
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest(null, agent))
          .toThrow('must carry its scoped Agent directly')
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest({}, agent))
          .toThrow('must carry its scoped Agent directly')
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest({ agent: {} }, agent))
          .toThrow('must carry its scoped Agent directly')
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest(Object.create({ agent }), agent))
          .toThrow('must carry its scoped Agent directly')
      })

    it('rejects an invalid direct signal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { kind: 'agent' }
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest({ agent, signal: 'abort' }, agent))
          .toThrow('request signal must be an AbortSignal')
      })

    it('rejects non-JSON payload fields', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { kind: 'agent' }
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest({ agent, value: 1n }, agent))
          .toThrow('request is not lossless JSON data')

        /**
     * 常量说明：cycle 用于处理 cycle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest({ agent, cycle }, agent))
          .toThrow('request is not lossless JSON data')
      })

    it('rejects symbol and non-enumerable payload fields', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { kind: 'agent' }
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest({ agent, [Symbol('hidden')]: true }, agent))
          .toThrow('request has a non-JSON property')

        /**
     * 常量说明：hidden 用于处理 hidden 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const hidden = { agent }
        Object.defineProperty(hidden, 'value', { value: true })
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectRemoteEventRequest(hidden, agent))
          .toThrow('request has a non-JSON property')
      })
  })

describe('Remote Event rejection projection', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('preserves stable error fields in both directions', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const reason = Object.assign(new Error('declined'), {
          name: 'ApprovalError',
          code: 'DECLINED',
          details: { retryable: false },
        })
        expect(projectRemoteEventRejection(reason)).toEqual({
          name: 'ApprovalError',
          message: 'declined',
          code: 'DECLINED',
          details: { retryable: false },
        })

        /**
     * 常量说明：restored 用于处理 restored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const restored = restoreRemoteEventRejection({
          name: 'ApprovalError',
          message: 'declined',
          code: 'DECLINED',
          details: { retryable: false },
        }) as Error & { code?: string; details?: unknown }
        expect(restored).toMatchObject({
          name: 'ApprovalError',
          message: 'declined',
          code: 'DECLINED',
          details: { retryable: false },
        })
      })

    it('normalizes arbitrary reasons and omits non-JSON optional fields', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(projectRemoteEventRejection('offline')).toEqual({
          name: 'Error', message: 'offline',
        })
        expect(projectRemoteEventRejection(undefined)).toEqual({
          name: 'Error', message: 'undefined',
        })
        expect(projectRemoteEventRejection({
          name: 1, message: 2, code: 3, details: 1n,
        })).toEqual({
          name: 'Error', message: '[object Object]',
        })

        /**
     * 常量说明：restored 用于处理 restored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const restored = restoreRemoteEventRejection({ name: 'Error', message: 'offline' })
        expect(restored).toMatchObject({ name: 'Error', message: 'offline' })
        expect(restored).not.toHaveProperty('code')
        expect(restored).not.toHaveProperty('details')
      })
  })

describe('Remote Event JSON values', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('accepts lossless JSON values, null-prototype objects, and repeated references', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：shared 用于处理 shared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const shared = { value: 1 }
        /**
     * 常量说明：nullPrototype 用于处理 nullPrototype 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
          enabled: true,
        })
        expect(isRemoteJsonValue({
          null: null,
          string: 'value',
          boolean: true,
          number: 1.5,
          array: [shared, shared],
          nullPrototype,
        })).toBe(true)
      })

    it.each([
      undefined,
      1n,
      Symbol('value'),
      /*
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */ () => undefined,
      NaN,
      Number.POSITIVE_INFINITY,
      -0,
    ])('rejects a non-lossless scalar: %s', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ (value) => {
        expect(isRemoteJsonValue(value)).toBe(false)
      })

    it('rejects cycles and non-plain arrays and objects', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        /**
     * 常量说明：cycle 用于处理 cycle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        expect(isRemoteJsonValue(cycle)).toBe(false)

        /**
     * 类说明：Fixture 用于集中封装 处理 Fixture 相关状态与行为。
     * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
     * 使用场景：由 api/gateway 在对应插件或业务生命周期内创建和调用。
     */
        class Fixture {
          /**
       * 变量说明：value 用于处理 value 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
          value = 1
        }
        expect(isRemoteJsonValue(new Fixture())).toBe(false)

        /**
     * 常量说明：customArray 用于处理 customArray 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const customArray = [1]
        Object.setPrototypeOf(customArray, null)
        expect(isRemoteJsonValue(customArray)).toBe(false)
        expect(isRemoteJsonValue(Object.assign([1], { extra: true }))).toBe(false)

        /**
     * 常量说明：sparse 用于处理 sparse 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sparse = new Array<unknown>(2)
        sparse[1] = 'value'
        expect(isRemoteJsonValue(sparse)).toBe(false)
        /**
     * 常量说明：disguisedSparse 用于处理 disguisedSparse 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const disguisedSparse = Object.assign(new Array<unknown>(2), { extra: true })
        disguisedSparse[1] = 'value'
        expect(isRemoteJsonValue(disguisedSparse)).toBe(false)
        expect(isRemoteJsonValue([undefined])).toBe(false)

        /**
     * 常量说明：symbolic 用于处理 symbolic 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const symbolic = { [Symbol('value')]: true }
        expect(isRemoteJsonValue(symbolic)).toBe(false)
        /**
     * 常量说明：hidden 用于处理 hidden 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const hidden = {}
        Object.defineProperty(hidden, 'value', { value: true })
        expect(isRemoteJsonValue(hidden)).toBe(false)
        expect(isRemoteJsonValue({ nested: undefined })).toBe(false)
      })
  })

describe('Remote stream client protocol', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('rejects the removed logical-stream input message', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => parseRemoteStreamClientMessage(JSON.stringify({
            type: 'input', streamId: 'stream-1', value: { answer: true },
          }))).toThrow('api gateway: invalid Remote stream client message')
      })
  })
