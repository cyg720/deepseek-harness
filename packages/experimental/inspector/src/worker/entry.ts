/** Node Worker bootstrap for the experimental Inspector.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 entry 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { MessagePort, parentPort, workerData } from 'node:worker_threads'
import type { InspectorWorkerBoot, InspectorWorkerControl } from '../shared/bridge/messages/control.ts'
import { parseInspectorHostControl, parseInspectorWorkerConfig } from '../shared/bridge/control-codec.ts'
import { isPlainObject } from '../shared/json.ts'
import { startInspectorWorker } from './server.ts'

if (parentPort === null) throw new Error('experimental inspector: Worker entry loaded on the main thread')
/**
 * 常量说明：controlPort 用于处理 controlPort 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const controlPort = parentPort

/**
 * 常量说明：bootData 用于处理 bootData 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const bootData = workerData as unknown
if (!isPlainObject(bootData)
  || !(bootData.hostSourcePort instanceof MessagePort)) {
  throw new Error('experimental inspector: invalid Worker boot data')
}
/**
 * 常量说明：boot 用于处理 boot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const boot: InspectorWorkerBoot<MessagePort> = {
  hostSourcePort: bootData.hostSourcePort,
  config: parseInspectorWorkerConfig(bootData.config),
}

/**
 * 变量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let runtime: Awaited<ReturnType<typeof startInspectorWorker>> | undefined
/**
 * 变量说明：stopping 用于处理 stopping 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let stopping: Promise<void> | undefined

/**
 * 常量说明：stop 用于停止 stop 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stop()，并按返回类型处理结果。
 */
const stop = (): Promise<void> => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  stopping ??= (async () => {
    await runtime?.close()
    controlPort.postMessage({ type: 'stopped' } satisfies InspectorWorkerControl)
    controlPort.close()
  })()
  return stopping
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */
controlPort.on('message', (message: unknown) => {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    parseInspectorHostControl(message)
    void stop()
  } catch (error) {
    controlPort.postMessage({
      type: 'failure',
      message: error instanceof Error ? error.message : String(error),
    } satisfies InspectorWorkerControl)
  }
})

/**
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */
try {
  runtime = await startInspectorWorker(boot)
  controlPort.postMessage({ type: 'ready', ...runtime.endpoint } satisfies InspectorWorkerControl)
} catch (error) {
  controlPort.postMessage({
    type: 'failure',
    message: error instanceof Error ? error.message : String(error),
  } satisfies InspectorWorkerControl)
  await stop()
}
