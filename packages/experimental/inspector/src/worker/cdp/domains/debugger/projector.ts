/** CDP projection for realm-neutral scripts and debugger events.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 projector 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeDebuggerEvent, RuntimeDebuggerLocation, RuntimeScript, RuntimeStackTrace } from '../../../../shared/cdp/index.ts'
import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import type { CdpNotification } from '../../protocol.ts'
import type { InspectorRealmSession } from '../../../inspection/realm.ts'
import type { RuntimeDomainSession } from '../runtime/index.ts'
import { cdpScriptId } from './script-registry.ts'

/**
 * Project one common script descriptor to Debugger.scriptParsed.
 * @param realm - Realm session that owns the script.
 * @param script - Realm-neutral script descriptor.
 * @returns A CDP scriptParsed notification.
 * @remarks 中文说明：功能说明：处理 scriptParsedEvent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：script（RuntimeScript）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：CdpNotification；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * scriptParsedEvent(realm, script)，并按返回类型处理结果。
 */
export function scriptParsedEvent(realm: InspectorRealmSession, script: RuntimeScript): CdpNotification {
  return {
    method: 'Debugger.scriptParsed',
    params: {
      scriptId: cdpScriptId(script.scriptKey),
      url: script.url,
      startLine: script.startLine,
      startColumn: script.startColumn,
      endLine: script.endLine,
      endColumn: script.endColumn,
      executionContextId: script.executionContextId
        ?? (realm.context.kind === 'synthetic' ? realm.context.id : 0),
      hash: script.hash,
      buildId: script.buildId ?? '',
      ...(script.sourceMapUrl === undefined ? {} : { sourceMapURL: script.sourceMapUrl }),
      ...(script.isModule === undefined ? {} : { isModule: script.isModule }),
      ...(script.length === undefined ? {} : { length: script.length }),
    },
  }
}

/**
 * Project one common debugger event and all nested Runtime objects to CDP.
 * @param realm - Realm session that emitted the event.
 * @param event - Realm-neutral debugger event.
 * @param runtime - Connection-local Runtime object projector.
 * @returns The corresponding CDP notification.
 * @remarks 中文说明：功能说明：处理 debuggerEvent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（RuntimeDebuggerEvent<RuntimeBackendObjectHandle>）：提供需要处理或投影的事
 * 件数据；必须满足声明的类型及调用时序要求。；参数说明：runtime（RuntimeDomainSession）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：CdpNotification；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 debuggerEvent(realm, event, runtime)，并按返回类型处理结果。
 */
export function debuggerEvent(
  realm: InspectorRealmSession,
  event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>,
  runtime: RuntimeDomainSession,
): CdpNotification {
  switch (event.type) {
    case 'paused':
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scope（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scope)，并按返回类型处理结果。
       */
      return {
        method: 'Debugger.paused',
        params: {
          callFrames: event.callFrames.map(frame => ({
            callFrameId: frame.callFrameId,
            functionName: frame.functionName,
            ...(frame.functionLocation === undefined ? {} : { functionLocation: location(frame.functionLocation) }),
            location: location(frame.location),
            url: frame.url,
            scopeChain: frame.scopeChain.map(scope => ({
              type: scope.type,
              object: runtime.projectRemoteObject(realm, scope.object, 'backtrace'),
              ...(scope.name === undefined ? {} : { name: scope.name }),
              ...(scope.startLocation === undefined ? {} : { startLocation: location(scope.startLocation) }),
              ...(scope.endLocation === undefined ? {} : { endLocation: location(scope.endLocation) }),
            })),
            this: runtime.projectRemoteObject(realm, frame.thisObject, 'backtrace'),
            ...(frame.returnValue === undefined
              ? {}
              : { returnValue: runtime.projectRemoteObject(realm, frame.returnValue, 'backtrace') }),
          })),
          reason: event.reason,
          ...(event.data === undefined ? {} : { data: event.data }),
          ...(event.hitBreakpoints === undefined ? {} : { hitBreakpoints: event.hitBreakpoints }),
          ...(event.asyncStackTrace === undefined ? {} : { asyncStackTrace: stackTrace(event.asyncStackTrace) }),
        },
      }
    case 'resumed':
      return { method: 'Debugger.resumed', params: {} }
    case 'breakpoint-resolved':
      return {
        method: 'Debugger.breakpointResolved',
        params: { breakpointId: event.breakpointId, location: location(event.location) },
      }
    default:
      return assertNever(event)
  }
}

/**
 * 功能说明：处理 location 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （RuntimeDebuggerLocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 location(value)，并按返回类型处理结果。
 */
function location(value: RuntimeDebuggerLocation): Readonly<Record<string, unknown>> {
  return {
    scriptId: cdpScriptId(value.scriptKey),
    lineNumber: value.lineNumber,
    ...(value.columnNumber === undefined ? {} : { columnNumber: value.columnNumber }),
  }
}

/**
 * 功能说明：处理 stackTrace 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （RuntimeStackTrace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stackTrace(value)，并按返回类型处理结果。
 */
function stackTrace(value: RuntimeStackTrace): Readonly<Record<string, unknown>> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  return {
    ...(value.description === undefined ? {} : { description: value.description }),
    callFrames: value.callFrames.map(frame => ({
      functionName: frame.functionName,
      scriptId: frame.scriptKey === undefined ? '0' : cdpScriptId(frame.scriptKey),
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    })),
    ...(value.parent === undefined ? {} : { parent: stackTrace(value.parent) }),
  }
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected debugger event: ${JSON.stringify(value)}`)
}
