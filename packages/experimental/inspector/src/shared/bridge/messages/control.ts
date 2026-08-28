/** Host-to-Worker lifecycle messages and Worker readiness results. */

/** Fully resolved Worker configuration.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 control 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export interface InspectorWorkerConfig {
  readonly host: '127.0.0.1'
  /** First port to bind; zero delegates selection to the operating system. */
  readonly startPort: number
  readonly targetId: string
  readonly clientToken: string
  readonly clientOrigins: readonly string[]
  readonly maxSourceFrameBytes: number
  readonly maxSourceRecordsPerFrame: number
  readonly maxRetainedRequests: number
  readonly maxJournalBytes: number
  readonly clientRuntimeTimeoutMs: number
  readonly maxClientSourceBytes: number
  readonly maxCordisNodes: number
  readonly maxDisconnectedCordisTrees: number
}

/** Structured-clone payload used to start the Inspector Worker. */
export interface InspectorWorkerBoot<Port> {
  readonly config: InspectorWorkerConfig
  readonly hostSourcePort: Port
}

/** Host request to stop accepting traffic and close every Worker-owned resource. */
export interface InspectorWorkerShutdown {
  readonly type: 'shutdown'
}

/** Every control message sent from Host to Worker after boot. */
export type InspectorHostControl = InspectorWorkerShutdown

/** Worker endpoint readiness. */
export interface InspectorWorkerReady {
  readonly type: 'ready'
  readonly host: string
  readonly port: number
  readonly targetId: string
}

/** Worker startup or runtime failure. */
export interface InspectorWorkerFailure {
  readonly type: 'failure'
  readonly message: string
}

/** Worker completed graceful shutdown. */
export interface InspectorWorkerStopped {
  readonly type: 'stopped'
}

/** Every control message sent from Worker to Host. */
export type InspectorWorkerControl = InspectorWorkerReady | InspectorWorkerFailure | InspectorWorkerStopped

/** Browser bootstrap injected by the Host plugin. */
export interface InspectorClientBootstrap {
  readonly endpoint: string
  readonly protocol: string
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly maxRecordsPerFrame: number
  readonly maxFrameBytes: number
  readonly reconnectBaseMs: number
  readonly reconnectMaxMs: number
  readonly queryTimeoutMs: number
  readonly maxRuntimeObjectsPerSession: number
  readonly maxRuntimePropertiesPerResult: number
  readonly maxClientSourceBytes: number
  readonly maxCordisNodes: number
}
