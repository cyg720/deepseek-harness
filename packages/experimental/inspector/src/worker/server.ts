/** Inspector Worker assembly over one Host source port and one loopback endpoint.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 server 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { MessagePort } from 'node:worker_threads'
import type { InspectorWorkerBoot } from '../shared/bridge/messages/control.ts'
import type { WorkerToSourceFrame } from '../shared/bridge/messages/observation.ts'
import { createCordisRuntimeTreeReader } from '../shared/cordis/reader.ts'
import { NetworkDomain } from './cdp/domains/network/session.ts'
import { NetworkStore } from './inspection/network-store.ts'
import { CordisDomBackend } from './cdp/domains/dom/index.ts'
import { ClientRuntimeRouter } from './bridge/runtime-rpc.ts'
import { ClientSourceRouter } from './bridge/source-rpc.ts'
import { CordisTreeStore } from './inspection/cordis-store.ts'
import { InspectorEndpoint, type InspectorEndpointInfo } from './bridge/endpoint.ts'
import { InspectorQueryRouter } from './inspection/query-router.ts'
import { InspectorRealmRegistry } from './inspection/realm-store.ts'
import { HostInspectorRealm } from './realms/host/index.ts'
import { InspectorSourceRegistry, type SourceConnection } from './bridge/hub.ts'

/** Live Worker runtime. */
export interface InspectorWorkerRuntime {
  readonly endpoint: InspectorEndpointInfo
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): Promise<void>
}

/**
 * Assemble and start the Worker-owned source registry, Runtime router, Network domain, and endpoints.
 * @param boot - Validated Worker configuration and transferred Host source port.
 * @returns The listening endpoint and quiescent shutdown owner.
 * @remarks 中文说明：功能说明：启动 Inspector Worker 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：boot（InspectorWorkerBoot<MessagePort>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：Promise<InspectorWorkerRuntime>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 startInspectorWorker(boot)，并按返回类型处理结果。
 */
export async function startInspectorWorker(boot: InspectorWorkerBoot<MessagePort>): Promise<InspectorWorkerRuntime> {
  /**
   * 常量说明：networkStore 用于处理 networkStore 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const networkStore = new NetworkStore({
    maxRetainedRequests: boot.config.maxRetainedRequests,
    maxJournalBytes: boot.config.maxJournalBytes,
  })
  /**
   * 常量说明：network 用于处理 network 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const network = new NetworkDomain(networkStore)
  /**
   * 常量说明：cordisTrees 用于处理 cordisTrees 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const cordisTrees = new CordisTreeStore({
    maxNodes: boot.config.maxCordisNodes,
    maxDisconnectedTrees: boot.config.maxDisconnectedCordisTrees,
  })
  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sources = new InspectorSourceRegistry(
    [networkStore, cordisTrees],
    boot.config.maxSourceFrameBytes,
    boot.config.maxSourceRecordsPerFrame,
  )
  /**
   * 常量说明：clientRuntime 用于处理 clientRuntime 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const clientRuntime = new ClientRuntimeRouter(sources, boot.config.clientRuntimeTimeoutMs)
  /**
   * 常量说明：clientSources 用于处理 clientSources 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const clientSources = new ClientSourceRouter(
    sources,
    boot.config.clientRuntimeTimeoutMs,
    boot.config.maxClientSourceBytes,
    boot.config.maxSourceFrameBytes,
  )
  /**
   * 常量说明：realms 用于处理 realms 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const realms = new InspectorRealmRegistry(new HostInspectorRealm('Host'), clientRuntime, clientSources)
  /**
   * 常量说明：cordisDom 用于处理 cordisDom 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cordisDom = new CordisDomBackend(cordisTrees)
  /**
   * 常量说明：cordisReader 用于处理 cordisReader 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const cordisReader = createCordisRuntimeTreeReader(() => cordisTrees.readTree())
  /**
   * 常量说明：queries 用于处理 queries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const queries = new InspectorQueryRouter(cordisReader, boot.config.maxSourceFrameBytes)
  /**
   * 常量说明：unsubscribeQueries 用于处理 unsubscribeQueries 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  const unsubscribeQueries = sources.subscribeEvents((event) => {
    if (event.type === 'closed') queries.disconnect(event.source)
  })
  /**
   * 常量说明：hostQueries 用于处理 hostQueries 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const hostQueries = queries.open({
    send: (frame) => { boot.hostSourcePort.postMessage(frame) },
    close: () => { boot.hostSourcePort.close() },
  })
  /**
   * 常量说明：hostConnection 用于处理 hostConnection 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（WorkerToSourceFrame）：提供本次调用
   * 所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const hostConnection: SourceConnection = {
    kind: 'host',
    send: (frame: WorkerToSourceFrame) => {
      boot.hostSourcePort.postMessage(frame)
      if (frame.t === 'source/accepted') hostQueries.accept(frame.sourceId, frame.generation)
    },
    close: () => { boot.hostSourcePort.close() },
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  boot.hostSourcePort.on('message', (value: unknown) => {
    if (!hostQueries.receive(value)) sources.receive(hostConnection, value)
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  boot.hostSourcePort.on('close', () => {
    hostQueries.close()
    sources.disconnect(hostConnection, 'Host source disconnected')
  })
  boot.hostSourcePort.start()

  /**
   * 常量说明：endpointOwner 用于处理 endpointOwner 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const endpointOwner = new InspectorEndpoint(
    boot.config,
    sources,
    network,
    realms,
    cordisDom,
    cordisReader,
    queries,
  )
  /**
   * 常量说明：endpoint 用于处理 endpoint 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const endpoint = await endpointOwner.start()
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closed: Promise<void> | undefined
  return {
    endpoint,
    /**
     * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
     */
    close(): Promise<void> {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      closed ??= (async () => {
        await endpointOwner.close()
        network.close()
        networkStore.dispose()
        cordisDom.close()
        realms.close()
        clientRuntime.close()
        clientSources.close()
        hostQueries.close()
        sources.close()
        unsubscribeQueries()
        queries.close()
        boot.hostSourcePort.close()
      })()
      return closed
    },
  }
}
