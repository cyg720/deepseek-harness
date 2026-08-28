/** Host controller that owns the Inspector Worker and Host observation source.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 controller 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { MessageChannel, Worker, type MessagePort, type WorkerOptions } from 'node:worker_threads'
import type { InspectorClientBootstrap, InspectorWorkerBoot, InspectorWorkerConfig } from '../../shared/bridge/messages/control.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../shared/bridge/version.ts'
import type { InspectorConnection } from '../../shared/bridge/publisher.ts'
import { installFetchObserver, NETWORK_TOPICS, type FetchObserver } from '../inspection/network.ts'
import { HostInspectorSource } from './transport.ts'
import { InspectorWorkerLifecycle } from './lifecycle.ts'

/**
 * 常量说明：DEFAULT_MAX_REQUEST_BODY_BYTES 用于处理 DEFAULT_MAX_REQUEST_BODY_BYTES
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024
/**
 * 常量说明：DEFAULT_MAX_RESPONSE_BODY_BYTES 用于处理
 * DEFAULT_MAX_RESPONSE_BODY_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024
/**
 * 常量说明：DEFAULT_MAX_BODY_CHUNK_BYTES 用于处理 DEFAULT_MAX_BODY_CHUNK_BYTES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_BODY_CHUNK_BYTES = 48 * 1024
/**
 * 常量说明：DEFAULT_MAX_JOURNAL_BYTES 用于处理 DEFAULT_MAX_JOURNAL_BYTES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_JOURNAL_BYTES = 256 * 1024 * 1024
/**
 * 常量说明：DEFAULT_MAX_RETAINED_REQUESTS 用于处理 DEFAULT_MAX_RETAINED_REQUESTS
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_RETAINED_REQUESTS = 2_000
/**
 * 常量说明：DEFAULT_MAX_SOURCE_FRAME_BYTES 用于处理 DEFAULT_MAX_SOURCE_FRAME_BYTES
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_SOURCE_FRAME_BYTES = 128 * 1024
/**
 * 常量说明：DEFAULT_MAX_SOURCE_RECORDS_PER_FRAME 用于处理
 * DEFAULT_MAX_SOURCE_RECORDS_PER_FRAME 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_SOURCE_RECORDS_PER_FRAME = 128
/**
 * 常量说明：DEFAULT_MAX_QUEUED_RECORDS 用于处理 DEFAULT_MAX_QUEUED_RECORDS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_QUEUED_RECORDS = 2_048
/**
 * 常量说明：DEFAULT_MAX_QUEUED_BYTES 用于处理 DEFAULT_MAX_QUEUED_BYTES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_QUEUED_BYTES = 16 * 1024 * 1024
/**
 * 常量说明：DEFAULT_STARTUP_TIMEOUT_MS 用于处理 DEFAULT_STARTUP_TIMEOUT_MS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
/**
 * 常量说明：DEFAULT_STOP_TIMEOUT_MS 用于处理 DEFAULT_STOP_TIMEOUT_MS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_STOP_TIMEOUT_MS = 5_000
/**
 * 常量说明：DEFAULT_CLIENT_RECONNECT_BASE_MS 用于处理
 * DEFAULT_CLIENT_RECONNECT_BASE_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_CLIENT_RECONNECT_BASE_MS = 250
/**
 * 常量说明：DEFAULT_CLIENT_RECONNECT_MAX_MS 用于处理
 * DEFAULT_CLIENT_RECONNECT_MAX_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_CLIENT_RECONNECT_MAX_MS = 5_000
/**
 * 常量说明：DEFAULT_CLIENT_RUNTIME_TIMEOUT_MS 用于处理
 * DEFAULT_CLIENT_RUNTIME_TIMEOUT_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_CLIENT_RUNTIME_TIMEOUT_MS = 30_000
/**
 * 常量说明：DEFAULT_QUERY_TIMEOUT_MS 用于处理 DEFAULT_QUERY_TIMEOUT_MS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_QUERY_TIMEOUT_MS = 10_000
/**
 * 常量说明：DEFAULT_MAX_CLIENT_RUNTIME_OBJECTS 用于处理
 * DEFAULT_MAX_CLIENT_RUNTIME_OBJECTS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_CLIENT_RUNTIME_OBJECTS = 10_000
/**
 * 常量说明：DEFAULT_MAX_CLIENT_RUNTIME_PROPERTIES 用于处理
 * DEFAULT_MAX_CLIENT_RUNTIME_PROPERTIES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_CLIENT_RUNTIME_PROPERTIES = 2_000
/**
 * 常量说明：DEFAULT_MAX_CLIENT_SOURCE_BYTES 用于处理
 * DEFAULT_MAX_CLIENT_SOURCE_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_CLIENT_SOURCE_BYTES = 8 * 1024 * 1024
/**
 * 常量说明：DEFAULT_MAX_CORDIS_NODES 用于处理 DEFAULT_MAX_CORDIS_NODES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_CORDIS_NODES = 2_048
/**
 * 常量说明：DEFAULT_MAX_DISCONNECTED_CORDIS_TREES 用于处理
 * DEFAULT_MAX_DISCONNECTED_CORDIS_TREES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_MAX_DISCONNECTED_CORDIS_TREES = 8

/** User-facing Host options; every memory and lifecycle bound is configurable. */
export interface InspectorOptions {
  /** Loopback address used by the Worker HTTP and WebSocket endpoint. */
  readonly host?: '127.0.0.1'
  /** First port to bind; occupied ports advance until one is available. */
  readonly port?: number
  /** Additional exact browser origins admitted to the Client ingest socket. */
  readonly clientOrigins?: readonly string[]
  /** Whether to observe calls made through the current global fetch function. */
  readonly captureFetch?: boolean
  /** Maximum request-body prefix retained for one fetch. */
  readonly maxRequestBodyBytes?: number
  /** Maximum response-body prefix retained for one fetch. */
  readonly maxResponseBodyBytes?: number
  /** Maximum raw bytes encoded into one body observation. */
  readonly maxBodyChunkBytes?: number
  /** Maximum total request and response body bytes retained by the Worker. */
  readonly maxJournalBytes?: number
  /** Maximum active and completed fetch requests retained by the Worker. */
  readonly maxRetainedRequests?: number
  /** Maximum encoded bytes accepted in one source transport frame. */
  readonly maxSourceFrameBytes?: number
  /** Maximum observation records accepted in one source batch. */
  readonly maxSourceRecordsPerFrame?: number
  /** Maximum records waiting in one producer queue. */
  readonly maxQueuedRecords?: number
  /** Maximum encoded bytes waiting in one producer queue. */
  readonly maxQueuedBytes?: number
  /** Maximum time allowed for the Worker to become ready. */
  readonly startupTimeoutMs?: number
  /** Grace period before a stopping Worker is terminated. */
  readonly stopTimeoutMs?: number
  /** Initial upper bound for randomized Client reconnect delay. */
  readonly clientReconnectBaseMs?: number
  /** Maximum upper bound for randomized Client reconnect delay. */
  readonly clientReconnectMaxMs?: number
  /** Deadline for one Worker-to-Client Runtime or Sources request. */
  readonly clientRuntimeTimeoutMs?: number
  /** Deadline for one non-CDP semantic query. */
  readonly queryTimeoutMs?: number
  /** Maximum live object handles retained per Client Runtime session. */
  readonly maxClientRuntimeObjects?: number
  /** Maximum descriptors returned by one Client property request. */
  readonly maxClientRuntimeProperties?: number
  /** Maximum encoded bytes read for one Client script or source map. */
  readonly maxClientSourceBytes?: number
  /** Maximum Context and Fiber nodes retained in one realm snapshot. */
  readonly maxCordisNodes?: number
  /** Disconnected Cordis snapshots retained after their live realm closes. */
  readonly maxDisconnectedCordisTrees?: number
}

/** Fully resolved options used by one running Inspector. */
export interface InspectorSpec {
  readonly host: '127.0.0.1'
  readonly port: number
  readonly clientOrigins: readonly string[]
  readonly captureFetch: boolean
  readonly maxRequestBodyBytes: number
  readonly maxResponseBodyBytes: number
  readonly maxBodyChunkBytes: number
  readonly maxJournalBytes: number
  readonly maxRetainedRequests: number
  readonly maxSourceFrameBytes: number
  readonly maxSourceRecordsPerFrame: number
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly startupTimeoutMs: number
  readonly stopTimeoutMs: number
  readonly clientReconnectBaseMs: number
  readonly clientReconnectMaxMs: number
  readonly clientRuntimeTimeoutMs: number
  readonly queryTimeoutMs: number
  readonly maxClientRuntimeObjects: number
  readonly maxClientRuntimeProperties: number
  readonly maxClientSourceBytes: number
  readonly maxCordisNodes: number
  readonly maxDisconnectedCordisTrees: number
}

/** Addresses and browser bootstrap of one bound Worker. */
export interface InspectorEndpoint {
  readonly httpUrl: string
  readonly webSocketDebuggerUrl: string
  readonly devtoolsFrontendUrl: string
  readonly client: InspectorClientBootstrap
}

/** Running Host-side Inspector owner. */
export interface InspectorHandle {
  readonly endpoint: InspectorEndpoint
  readonly source: InspectorConnection
  /** Stop capture and wait for the Worker to release every socket and V8 session.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): Promise<void>
}

/**
 * Resolve and validate all deployment-varying Inspector choices.
 * @param options - Partial caller configuration.
 * @returns A complete immutable configuration.
 * @remarks 中文说明：功能说明：解析 Inspector Options 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（InspectorOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorSpec；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveInspectorOptions(options)，并按返回类型处理结果。
 */
export function resolveInspectorOptions(options: InspectorOptions = {}): InspectorSpec {
  /**
   * 常量说明：spec 用于处理 spec 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const spec: InspectorSpec = {
    host: options.host ?? '127.0.0.1',
    port: natural(options.port ?? 0, 'port', true),
    clientOrigins: [...(options.clientOrigins ?? [])],
    captureFetch: options.captureFetch ?? true,
    maxRequestBodyBytes: natural(options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES, 'maxRequestBodyBytes'),
    maxResponseBodyBytes: natural(options.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES, 'maxResponseBodyBytes'),
    maxBodyChunkBytes: natural(options.maxBodyChunkBytes ?? DEFAULT_MAX_BODY_CHUNK_BYTES, 'maxBodyChunkBytes'),
    maxJournalBytes: natural(options.maxJournalBytes ?? DEFAULT_MAX_JOURNAL_BYTES, 'maxJournalBytes'),
    maxRetainedRequests: natural(options.maxRetainedRequests ?? DEFAULT_MAX_RETAINED_REQUESTS, 'maxRetainedRequests'),
    maxSourceFrameBytes: natural(options.maxSourceFrameBytes ?? DEFAULT_MAX_SOURCE_FRAME_BYTES, 'maxSourceFrameBytes'),
    maxSourceRecordsPerFrame: natural(options.maxSourceRecordsPerFrame ?? DEFAULT_MAX_SOURCE_RECORDS_PER_FRAME, 'maxSourceRecordsPerFrame'),
    maxQueuedRecords: natural(options.maxQueuedRecords ?? DEFAULT_MAX_QUEUED_RECORDS, 'maxQueuedRecords'),
    maxQueuedBytes: natural(options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES, 'maxQueuedBytes'),
    startupTimeoutMs: natural(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS, 'startupTimeoutMs'),
    stopTimeoutMs: natural(options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS, 'stopTimeoutMs'),
    clientReconnectBaseMs: natural(options.clientReconnectBaseMs ?? DEFAULT_CLIENT_RECONNECT_BASE_MS, 'clientReconnectBaseMs'),
    clientReconnectMaxMs: natural(options.clientReconnectMaxMs ?? DEFAULT_CLIENT_RECONNECT_MAX_MS, 'clientReconnectMaxMs'),
    clientRuntimeTimeoutMs: natural(options.clientRuntimeTimeoutMs ?? DEFAULT_CLIENT_RUNTIME_TIMEOUT_MS, 'clientRuntimeTimeoutMs'),
    queryTimeoutMs: natural(options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 'queryTimeoutMs'),
    maxClientRuntimeObjects: natural(options.maxClientRuntimeObjects ?? DEFAULT_MAX_CLIENT_RUNTIME_OBJECTS, 'maxClientRuntimeObjects'),
    maxClientRuntimeProperties: natural(options.maxClientRuntimeProperties ?? DEFAULT_MAX_CLIENT_RUNTIME_PROPERTIES, 'maxClientRuntimeProperties'),
    maxClientSourceBytes: natural(options.maxClientSourceBytes ?? DEFAULT_MAX_CLIENT_SOURCE_BYTES, 'maxClientSourceBytes'),
    maxCordisNodes: natural(options.maxCordisNodes ?? DEFAULT_MAX_CORDIS_NODES, 'maxCordisNodes'),
    maxDisconnectedCordisTrees: natural(
      options.maxDisconnectedCordisTrees ?? DEFAULT_MAX_DISCONNECTED_CORDIS_TREES,
      'maxDisconnectedCordisTrees',
      true,
    ),
  }
  if (spec.port > 65_535) throw new Error('inspector: port must not exceed 65535')
  /**
   * 常量说明：largestEncodedChunk 用于处理 largestEncodedChunk 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const largestEncodedChunk = Math.ceil(spec.maxBodyChunkBytes / 3) * 4 + 4_096
  if (largestEncodedChunk > spec.maxSourceFrameBytes) {
    throw new Error('inspector: maxSourceFrameBytes cannot carry one base64 body chunk')
  }
  if (spec.clientReconnectMaxMs < spec.clientReconnectBaseMs) {
    throw new Error('inspector: clientReconnectMaxMs must be at least clientReconnectBaseMs')
  }
  /**
   * 变量说明：origin 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const origin of spec.clientOrigins) {
    if (new URL(origin).origin !== origin) throw new Error(`inspector: client origin must be canonical: ${origin}`)
  }
  return spec
}

/**
 * Start the Worker, create the Host source, and install full fetch capture by default.
 * @param options - Partial caller configuration.
 * @returns The ready endpoint and its quiescent shutdown handle.
 * @remarks 中文说明：功能说明：启动 Inspector 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（InspectorOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<InspectorHandle>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 startInspector(options)，并按返回类型处理结果。
 */
export async function startInspector(options: InspectorOptions = {}): Promise<InspectorHandle> {
  /**
   * 常量说明：spec 用于处理 spec 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const spec = resolveInspectorOptions(options)
  /**
   * 常量说明：channel 用于处理 channel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const channel = new MessageChannel()
  /**
   * 常量说明：clientProtocol 用于处理 clientProtocol 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const clientProtocol = `dsh-inspector-v${String(INSPECTOR_PROTOCOL_VERSION)}-${randomBytes(32).toString('base64url')}`
  /**
   * 常量说明：config 用于处理 config 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const config: InspectorWorkerConfig = {
    host: spec.host,
    startPort: spec.port,
    targetId: randomUUID(),
    clientToken: clientProtocol,
    clientOrigins: spec.clientOrigins,
    maxSourceFrameBytes: spec.maxSourceFrameBytes,
    maxSourceRecordsPerFrame: spec.maxSourceRecordsPerFrame,
    maxRetainedRequests: spec.maxRetainedRequests,
    maxJournalBytes: spec.maxJournalBytes,
    clientRuntimeTimeoutMs: spec.clientRuntimeTimeoutMs,
    maxClientSourceBytes: spec.maxClientSourceBytes,
    maxCordisNodes: spec.maxCordisNodes,
    maxDisconnectedCordisTrees: spec.maxDisconnectedCordisTrees,
  }
  /**
   * 常量说明：boot 用于处理 boot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const boot: InspectorWorkerBoot<MessagePort> = { config, hostSourcePort: channel.port2 }
  /**
   * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const worker = spawnWorker(boot)
  /**
   * 常量说明：lifecycle 用于处理 lifecycle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lifecycle = new InspectorWorkerLifecycle(worker)
  /**
   * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let source: HostInspectorSource
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    source = new HostInspectorSource(channel.port1, {
      label: 'Host',
      topics: ['*', ...NETWORK_TOPICS],
      maxQueuedRecords: spec.maxQueuedRecords,
      maxQueuedBytes: spec.maxQueuedBytes,
      maxRecordsPerFrame: spec.maxSourceRecordsPerFrame,
      maxFrameBytes: spec.maxSourceFrameBytes,
      queryTimeoutMs: spec.queryTimeoutMs,
    })
  } catch (error) {
    channel.port1.close()
    await lifecycle.terminate()
    throw error
  }

  /**
   * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  const ready = await lifecycle.waitForReady(spec.startupTimeoutMs).catch(async (error: unknown) => {
    source.close()
    await lifecycle.terminate()
    throw error
  })
  /**
   * 常量说明：authority 用于处理 authority 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const authority = `${ready.host}:${String(ready.port)}`
  /**
   * 常量说明：endpoint 用于处理 endpoint 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const endpoint: InspectorEndpoint = {
    httpUrl: `http://${authority}/`,
    webSocketDebuggerUrl: `ws://${authority}/devtools/page/${ready.targetId}`,
    devtoolsFrontendUrl: `devtools://devtools/bundled/devtools_app.html?ws=${authority}/devtools/page/${ready.targetId}&panel=elements&noJavaScriptCompletion=true`,
    client: {
      endpoint: `ws://${authority}/ingest`,
      protocol: clientProtocol,
      maxQueuedRecords: spec.maxQueuedRecords,
      maxQueuedBytes: spec.maxQueuedBytes,
      maxRecordsPerFrame: spec.maxSourceRecordsPerFrame,
      maxFrameBytes: spec.maxSourceFrameBytes,
      reconnectBaseMs: spec.clientReconnectBaseMs,
      reconnectMaxMs: spec.clientReconnectMaxMs,
      queryTimeoutMs: spec.queryTimeoutMs,
      maxRuntimeObjectsPerSession: spec.maxClientRuntimeObjects,
      maxRuntimePropertiesPerResult: spec.maxClientRuntimeProperties,
      maxClientSourceBytes: spec.maxClientSourceBytes,
      maxCordisNodes: spec.maxCordisNodes,
    },
  }
  /**
   * 变量说明：fetchObserver 用于请求 Observer 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let fetchObserver: FetchObserver | undefined
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    fetchObserver = spec.captureFetch
      ? installFetchObserver(source, {
        maxRequestBodyBytes: spec.maxRequestBodyBytes,
        maxResponseBodyBytes: spec.maxResponseBodyBytes,
        maxChunkBytes: spec.maxBodyChunkBytes,
      })
      : undefined
  } catch (error) {
    source.close()
    await lifecycle.terminate()
    throw error
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  lifecycle.markRunning((error) => {
    /**
     * 变量说明：closeError 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      source.close()
    } catch (closeError) {
      console.error('dsh inspector: Host source cleanup after Worker failure failed', closeError)
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：stopError（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(stopError)，并按返回类型处理结果。
     */
    void fetchObserver?.stop().catch((stopError: unknown) => {
      console.error('dsh inspector: fetch cleanup after Worker failure failed', stopError)
    })
    console.error('dsh inspector: Worker stopped unexpectedly', error)
  })

  /**
   * 变量说明：closing 用于处理 closing 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closing: Promise<void> | undefined
  return {
    endpoint,
    source,
    /**
     * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
     */
    close(): Promise<void> {
      closing ??= closeInspector(lifecycle, source, fetchObserver, spec.stopTimeoutMs)
      return closing
    },
  }
}

/**
 * 功能说明：处理 spawnWorker 相关流程；使用场景由所在模块及调用位置决定。
 * @param boot （InspectorWorkerBoot<MessagePort>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Worker；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 spawnWorker(boot)，并按返回类型处理结果。
 */
function spawnWorker(boot: InspectorWorkerBoot<MessagePort>): Worker {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options: WorkerOptions = {
    workerData: boot,
    transferList: [boot.hostSourcePort],
    execArgv: [],
  }
  if (!import.meta.url.endsWith('.ts')) {
    return new Worker(new URL('./worker.js', import.meta.url), options)
  }
  /**
   * 常量说明：workerEntry 用于处理 workerEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const workerEntry = new URL('../../worker/entry.ts', import.meta.url)
  /**
   * 常量说明：tsxEsmApiEntry 用于处理 tsxEsmApiEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const tsxEsmApiEntry = import.meta.resolve('tsx/esm/api')
  /**
   * 常量说明：bootstrap 用于处理 bootstrap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bootstrap = [
    `import { register } from ${JSON.stringify(tsxEsmApiEntry)}`,
    'register()',
    `await import(${JSON.stringify(workerEntry.href)})`,
  ].join('\n')
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
    ...options,
    env: sourceWorkerEnv(),
  })
}

/**
 * 功能说明：处理 sourceWorkerEnv 相关流程；使用场景由所在模块及调用位置决定。
 * @returns NodeJS.ProcessEnv；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sourceWorkerEnv()，并按返回类型处理结果。
 */
function sourceWorkerEnv(): NodeJS.ProcessEnv {
  /**
   * 常量说明：env 用于处理 env 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const env: NodeJS.ProcessEnv = {}
  if (process.platform === 'win32') {
    env.TMP = tmpdir()
    env.TEMP = tmpdir()
  }
  if (process.env.TSX_TSCONFIG_PATH !== undefined) env.TSX_TSCONFIG_PATH = process.env.TSX_TSCONFIG_PATH
  return env
}

/**
 * 功能说明：关闭 Inspector 相关流程；使用场景由所在模块及调用位置决定。
 * @param lifecycle （InspectorWorkerLifecycle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param source （HostInspectorSource）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fetchObserver （FetchObserver | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param timeoutMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeInspector(lifecycle, source, fetchObserver,
 * timeoutMs)，并按返回类型处理结果。
 */
async function closeInspector(
  lifecycle: InspectorWorkerLifecycle,
  source: HostInspectorSource,
  fetchObserver: FetchObserver | undefined,
  timeoutMs: number,
): Promise<void> {
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures: unknown[] = []
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    await fetchObserver?.stop()
  } catch (error) {
    failures.push(error)
  }
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    source.close()
  } catch (error) {
    failures.push(error)
  }
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    await lifecycle.stop(timeoutMs)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) throw new AggregateError(failures, 'inspector: shutdown failed')
}

/**
 * 功能说明：处理 natural 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param zero （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 natural(value, name, zero)，并按返回类型处理结果。
 */
function natural(value: number, name: string, zero = false): number {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    throw new Error(`inspector: ${name} must be ${zero ? 'a non-negative' : 'a positive'} safe integer`)
  }
  return value
}
