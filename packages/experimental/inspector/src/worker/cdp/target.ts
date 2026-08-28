/** Minimal page-target CDP methods required to expose Network, Console, and Sources together.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 target 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { CdpRequest } from './protocol.ts'

/** Sentinel distinguishing an unowned method from an owned method returning undefined.
 * @remarks 中文说明：常量说明：CDP_METHOD_NOT_HANDLED 用于处理 CDP_METHOD_NOT_HANDLED
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const CDP_METHOD_NOT_HANDLED = Symbol('CDP_METHOD_NOT_HANDLED')

/** Page-target identity used by discovery and scaffold responses. */
export interface CdpTargetDescriptor {
  readonly targetId: string
  readonly title: string
}

/**
 * Handle one Worker-local identity or page scaffold method.
 * @param request - Parsed CDP request.
 * @param target - Synthetic page-target identity.
 * @returns A response result or the unowned-method sentinel.
 * @remarks 中文说明：功能说明：处理 Scaffold 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：target（CdpTargetDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：object | typeof CDP_METHOD_NOT_HANDLED；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 handleScaffold(request, target)，并按返回类型处理结果。
 */
export function handleScaffold(
  request: CdpRequest,
  target: CdpTargetDescriptor,
): object | typeof CDP_METHOD_NOT_HANDLED {
  /**
   * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frame = {
    id: 'dsh-inspector-host-frame',
    loaderId: 'dsh-inspector-loader',
    url: 'dsh://host',
    domainAndRegistry: '',
    securityOrigin: 'dsh://host',
    mimeType: 'text/html',
    secureContextType: 'Secure',
    crossOriginIsolatedContextType: 'NotIsolated',
    gatedAPIFeatures: [],
  }
  switch (request.method) {
    case 'Page.enable':
    case 'Page.disable':
    case 'Page.setLifecycleEventsEnabled':
    case 'Target.setDiscoverTargets':
    case 'Target.setAutoAttach':
    case 'Log.enable':
    case 'Log.disable':
    case 'Console.enable':
    case 'Console.disable':
      return {}
    case 'Page.getFrameTree':
      return { frameTree: { frame, childFrames: [] } }
    case 'Page.getResourceTree':
      return { frameTree: { frame, resources: [] } }
    case 'Page.getNavigationHistory':
      return {
        currentIndex: 0,
        entries: [{ id: 1, url: frame.url, userTypedURL: frame.url, title: target.title, transitionType: 'typed' }],
      }
    case 'Target.getTargetInfo':
      return {
        targetInfo: {
          targetId: target.targetId,
          type: 'page',
          title: target.title,
          url: frame.url,
          attached: true,
          canAccessOpener: false,
        },
      }
    case 'Browser.getVersion':
      return {
        protocolVersion: '1.3',
        product: 'dsh-experimental-inspector/0',
        revision: '@experimental',
        userAgent: 'dsh-experimental-inspector',
        jsVersion: process.versions.v8,
      }
    default:
      return CDP_METHOD_NOT_HANDLED
  }
}
