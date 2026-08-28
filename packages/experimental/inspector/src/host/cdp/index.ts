/** Source-side CDP capability declarations for the Host realm.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 index 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'
import { consoleBridgeCapability } from './console.ts'
import { debuggerBridgeCapability } from './debugger.ts'
import { heapProfilerBridgeCapability } from './heap-profiler.ts'
import { profilerBridgeCapability } from './profiler.ts'
import { runtimeBridgeCapability } from './runtime.ts'
import { sourcesBridgeCapability } from './sources.ts'

/**
 * 常量说明：HOST_BRIDGE_CAPABILITIES 用于处理 HOST_BRIDGE_CAPABILITIES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：capability（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：capability is
 * InspectorSourceCapability；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(capability)，并按返回类型处理结果。
 */
const HOST_BRIDGE_CAPABILITIES: readonly InspectorSourceCapability[] = [
  runtimeBridgeCapability(''),
  consoleBridgeCapability(),
  sourcesBridgeCapability(false),
  debuggerBridgeCapability(),
  profilerBridgeCapability(),
  heapProfilerBridgeCapability(),
].filter((capability): capability is InspectorSourceCapability => capability !== undefined)

/**
 * Collect Host source-bridge capabilities.
 * @param _origin - Unused Host origin supplied for parity with the Client adapter.
 * @param _hasSources - Unused source availability supplied for parity with the Client adapter.
 * @returns No capabilities because the Worker attaches to Host V8 directly.
 * @remarks 中文说明：功能说明：处理 bridgeCapabilities 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：_origin（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：_hasSources（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：readonly
 * InspectorSourceCapability[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 bridgeCapabilities(_origin, _hasSources)，并按返回类型处理结果。
 */
export function bridgeCapabilities(_origin: string, _hasSources: boolean): readonly InspectorSourceCapability[] {
  return HOST_BRIDGE_CAPABILITIES
}
