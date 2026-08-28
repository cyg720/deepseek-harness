/** Client-face process fixture used by Host-side protocol integration tests.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 client source client
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { parentPort, workerData } from 'node:worker_threads'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import WebSocket from 'ws'
import { ClientInspectorSource } from '../../src/client/bridge/transport.ts'
import { ClientSourceCatalog } from '../../src/client/cdp/sources.ts'
import { publishCordisTree } from '../../src/client/inspection/cordis.ts'
import { inspectorId } from '../../src/shared/bridge/ids.ts'
import type { InspectorClientBootstrap } from '../../src/shared/bridge/messages/control.ts'
import type { InspectorJsonValue } from '../../src/shared/json.ts'
import { createInspectorService } from '../../src/shared/service.ts'

interface ClientFixtureInput {
  readonly bootstrap: InspectorClientBootstrap
  readonly label: string
  readonly sourceCatalog?: {
    readonly sourceText: string
    readonly sourceMap: string
    readonly sourceUrl: string
    readonly sourceMapUrl: string
  }
}

interface ClientFixtureRequest {
  readonly id: number
  readonly op:
    | 'add-fiber'
    | 'close'
    | 'disconnect'
    | 'get-tree'
    | 'log-cordis'
    | 'log-value'
    | 'publish'
    | 'refresh-tree'
    | 'remove-fiber'
    | 'set-global'
  readonly name?: string
  readonly value?: InspectorJsonValue
  readonly marker?: string
  readonly topic?: string
}

/**
 * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const port = parentPort
if (port === null) throw new Error('Inspector Client fixture requires a Worker parent port')
/**
 * 常量说明：input 用于处理 input 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const input = workerData as ClientFixtureInput
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
console.log = () => {}

/**
 * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const context = new Context()
/**
 * 常量说明：childFiber 用于处理 childFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
* 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
* @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
* @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
*/
const childFiber = context.plugin({ name: 'client-child', apply() {} })
await childFiber.await()
Reflect.set(globalThis, '__cordisClientProbe', context)
Reflect.set(globalThis, '__cordisClientFiberProbe', childFiber)

/**
 * 常量说明：sourceCatalog 用于处理 sourceCatalog 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const sourceCatalog = input.sourceCatalog === undefined
  ? undefined
  : new ClientSourceCatalog([{
    scriptKey: inspectorId<'RuntimeScriptKey'>('bundle', 'scriptKey'),
    url: input.sourceCatalog.sourceUrl,
    hash: 'test',
    sourceMapUrl: input.sourceCatalog.sourceMapUrl,
    isModule: false,
    loadSource: async () => input.sourceCatalog!.sourceText,
    loadSourceMap: async () => input.sourceCatalog!.sourceMap,
  }])
/**
 * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const source = new ClientInspectorSource(input.bootstrap, input.label, sourceCatalog)
/**
 * 常量说明：disposeCordis 用于处理 disposeCordis 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const disposeCordis = publishCordisTree(context, source, {
  maxNodes: input.bootstrap.maxCordisNodes,
  maxBytes: input.bootstrap.maxFrameBytes - 4_096,
})
/**
 * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const service = createInspectorService(source)
/**
 * 变量说明：addedFiber 用于处理 addedFiber 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let addedFiber: Fiber | undefined

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（ClientFixtureRequest）：提供本
 * 次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */
port.on('message', (message: ClientFixtureRequest) => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  void dispatch(message).then(
    (value) => {
      port.postMessage({ type: 'response', id: message.id, ok: true, value })
      if (message.op === 'close') port.close()
    },
    (error: unknown) => {
      port.postMessage({
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  )
})
port.postMessage({ type: 'ready', fiberUid: childFiber.uid })

/**
 * 功能说明：分发 dispatch 相关流程；使用场景由所在模块及调用位置决定。
 * @param message （ClientFixtureRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 dispatch(message)，并按返回类型处理结果。
 */
async function dispatch(message: ClientFixtureRequest): Promise<unknown> {
  switch (message.op) {
    case 'publish':
      source.publish(requiredString(message.topic, 'topic'), message.value ?? null)
      return undefined
    case 'set-global':
      Reflect.set(globalThis, requiredString(message.name, 'name'), message.value)
      return undefined
    case 'log-value':
      console.log(message.value, requiredString(message.marker, 'marker'))
      return undefined
    case 'log-cordis':
      console.log(context, childFiber, requiredString(message.marker, 'marker'))
      return undefined
    case 'get-tree':
      return await service.cordis.getTree()
    case 'disconnect': {
      /**
       * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const socket = Reflect.get(source, 'socket') as WebSocket | undefined
      socket?.terminate()
      return undefined
    }
    case 'refresh-tree':
      context.emit('internal/status', childFiber.ctx.fiber, childFiber.ctx.fiber.state)
      return undefined
    case 'add-fiber':
      /**
      * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
      * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
      * @example 在完成前置校验后调用 apply()，并按返回类型处理结果。
      */
      addedFiber = context.plugin({ name: 'dynamic-client-child', apply() {} }).ctx.fiber
      await addedFiber.await()
      return addedFiber.uid
    case 'remove-fiber':
      await addedFiber?.dispose()
      addedFiber = undefined
      return undefined
    case 'close':
      await addedFiber?.dispose()
      disposeCordis()
      source.close()
      await context.fiber.dispose()
      return undefined
  }
}

/**
 * 功能说明：处理 requiredString 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param field （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requiredString(value, field)，并按返回类型处理结果。
 */
function requiredString(value: string | undefined, field: string): string {
  if (value === undefined) throw new Error(`Inspector Client fixture ${field} is required`)
  return value
}
