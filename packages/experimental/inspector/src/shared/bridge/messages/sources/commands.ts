/** Operations and values exchanged with a Client realm's read-only source catalog.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 commands 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeScriptKey } from '../../../cdp/ids.ts'
import type { RuntimeScript } from '../../../cdp/index.ts'

/** Script metadata that excludes the Worker-owned execution-context id. */
export type ClientScriptDescriptor = Omit<RuntimeScript, 'executionContextId'>

/** Content stored for one Client script. */
export type ClientSourceContentKind = 'source' | 'source-map'

/** Read-only operation accepted by the Client source catalog. */
export type ClientSourceCommand =
  | { readonly op: 'list-scripts' }
  | {
    readonly op: 'get-content-chunk'
    readonly scriptKey: RuntimeScriptKey
    readonly content: ClientSourceContentKind
    readonly offset: number
    readonly maxBytes: number
  }

/** Successful result of one Client source operation. */
export type ClientSourceResult =
  | { readonly op: 'list-scripts'; readonly scripts: readonly ClientScriptDescriptor[] }
  | {
    readonly op: 'get-content-chunk'
    readonly scriptKey: RuntimeScriptKey
    readonly content: ClientSourceContentKind
    readonly available: false
  }
  | {
    readonly op: 'get-content-chunk'
    readonly scriptKey: RuntimeScriptKey
    readonly content: ClientSourceContentKind
    readonly available: true
    readonly offset: number
    readonly nextOffset: number
    readonly data: string
    readonly eof: boolean
  }

/** Deliberate failure returned by the Client source catalog. */
export interface ClientSourceError {
  readonly code: 'invalid-request' | 'script-not-found' | 'load-failed' | 'result-too-large' | 'internal-error'
  readonly message: string
}
