/** Baseline-and-delta protocol layered over a reconnecting Remote stream.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 snapshot stream 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { RemoteStream } from './remote-stream.ts'

/** Domain operations for one snapshot stream. */
export interface RemoteSnapshotStreamOptions<Snapshot, Delta> {
  /** Diagnostic stream name used in protocol failures. */
  readonly name: string
  /** Distinguish the opening snapshot from later deltas. */
  readonly isSnapshot: (value: Snapshot | Delta) => value is Snapshot
  /** Atomically replace the domain model from a complete snapshot. */
  readonly replace: (snapshot: Snapshot) => void
  /** Apply one incremental update after the generation snapshot. */
  readonly update: (delta: Delta) => void
  /** Publish a terminal business or protocol failure. */
  readonly failed: (error: unknown) => void
}

/**
 * Consumes generations that each contain exactly one opening snapshot followed by deltas.
 *
 * The previous domain snapshot remains published while the underlying stream retries. A
 * replacement becomes accepted only after the domain owner applies it successfully.
 * @remarks 中文说明：类说明：RemoteSnapshotStream 用于集中封装 处理 RemoteSnapshotStream
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。
 */
export class RemoteSnapshotStream<Snapshot, Delta> {
  /**
   * 变量说明：started 用于处理 started 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private started = false
  /**
   * 变量说明：disposed 用于处理 disposed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private disposed = false
  /**
   * 变量说明：done 用于处理 done 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private done: Promise<void> | undefined

  /**
   * @param stream - reconnecting physical-generation stream.
   * @param options - frame discriminator and domain state destinations.
   * @remarks 中文说明：功能说明：处理 RemoteSnapshotStream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：stream（RemoteStream<Snapshot | Delta>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * ；参数说明：options（RemoteSnapshotStreamOptions<Snapshot,
   * Delta>）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：通过 new RemoteSnapshotStream(stream, options)
   * 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly stream: RemoteStream<Snapshot | Delta>,
    private readonly options: RemoteSnapshotStreamOptions<Snapshot, Delta>,
  ) {}

  /** Start the single consumer; repeated calls are inert.
   * @remarks 中文说明：功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 start()，并按返回类型处理结果。 */
  start(): void {
    if (this.started) return
    this.started = true
    this.done = this.consume()
  }

  /** Replace the active physical generation without discarding the published snapshot.
   * @remarks 中文说明：功能说明：处理 restart 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 restart()，并按返回类型处理结果。 */
  restart(): void {
    this.stream.restart()
  }

  /**
   * Permanently stop the stream and wait for its consumer to become quiescent.
   * @returns when no generation or callback can still run.
   * @remarks 中文说明：功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.stream.dispose()
    await this.done
  }

  /**
   * 功能说明：处理 consume 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consume()，并按返回类型处理结果。
   */
  private async consume(): Promise<void> {
    /**
     * 变量说明：generation 用于处理 generation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let generation = 0
    /**
     * 变量说明：snapshotSeen 用于处理 snapshotSeen 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let snapshotSeen = false
    try {
      for await (const /*
       * 变量说明：item 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ item of this.stream) {
        if (item.generation !== generation) {
          generation = item.generation
          snapshotSeen = false
        }
        if (this.options.isSnapshot(item.value)) {
          if (snapshotSeen) {
            throw new Error(`${this.options.name} emitted more than one opening snapshot`)
          }
          this.options.replace(item.value)
          snapshotSeen = true
          item.accept()
          continue
        }
        if (!snapshotSeen) {
          throw new Error(`${this.options.name} emitted an update before its opening snapshot`)
        }
        this.options.update(item.value)
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (!this.disposed) this.options.failed(error)
    }
  }
}
