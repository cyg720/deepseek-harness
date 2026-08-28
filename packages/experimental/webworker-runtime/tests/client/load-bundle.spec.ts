// @vitest-environment jsdom
/**
 * 文件职责：验证 experimental/webworker-runtime 中 load bundle spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, expect, it, vi } from 'vitest'
import { WorkerTunnel } from '../../src/client/client.ts'

type StubListener = (event: { data?: unknown }) => void

/**
 * 功能说明：处理 stubWorker 相关流程；使用场景由所在模块及调用位置决定。
 * @returns { worker: Worker sent: { t: string; id: number; url: string }[]
 * deliv…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stubWorker()，并按返回类型处理结果。
 */
function stubWorker(): {
  worker: Worker
  sent: { t: string; id: number; url: string }[]
  deliver: (frame: unknown) => void
} {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listeners: StubListener[] = []
  /**
   * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sent: { t: string; id: number; url: string }[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：type（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：listener（StubListener）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(type, listener)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  return {
    worker: {
      addEventListener: (type: string, listener: StubListener) => {
        if (type === 'message') listeners.push(listener)
      },
      postMessage: (frame: unknown) => { sent.push(frame as { t: string; id: number; url: string }) },
    } as unknown as Worker,
    sent,
    deliver: (frame) => { /**
 * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const listener of listeners) listener({ data: frame }) },
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('loads a combo map through the tunnel and embeds it in the blob script', async () => {
  /**
   * 常量说明：worker、sent、deliver 用于处理 worker、sent、deliver 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { worker, sent, deliver } = stubWorker()
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new WorkerTunnel(worker)
  /**
   * 常量说明：blobs 用于处理 blobs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const blobs: Blob[] = []
  /**
   * 常量说明：revoked 用于处理 revoked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const revoked: string[] = []
  /**
   * 常量说明：NativeURL 用于处理 NativeURL 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const NativeURL = URL
  /**
   * 类说明：StubURL 用于集中封装 处理 StubURL 相关状态与行为。
   * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
   * 使用场景：由 experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
   */
  class StubURL extends NativeURL {
    /**
     * 功能说明：创建 Object URL 相关流程；使用场景由所在模块及调用位置决定。
     * @param blob （Blob）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 createObjectURL(blob)，并按返回类型处理结果。
     */
    static override createObjectURL(blob: Blob): string {
      blobs.push(blob)
      return `blob:fixture-${String(blobs.length)}`
    }

    /**
     * 功能说明：处理 revokeObjectURL 相关流程；使用场景由所在模块及调用位置决定。
     * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 revokeObjectURL(url)，并按返回类型处理结果。
     */
    static override revokeObjectURL(url: string): void {
      revoked.push(url)
    }
  }
  vi.stubGlobal('URL', StubURL)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：nodes（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(nodes)，并按返回类型处理结果。
   */
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    /**
     * 变量说明：node 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const node of nodes) {
      if (typeof node !== 'string') /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
queueMicrotask(() => { node.dispatchEvent(new Event('load')) })
    }
  })

  /**
   * 常量说明：scriptUrl 用于处理 scriptUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scriptUrl = '/plugins/??a/client.js,b/client.js&rev=abc'
  /**
   * 常量说明：mapUrl 用于映射 Url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const mapUrl = '/plugins/??a/client.js.map,b/client.js.map&rev=abc'
  /**
   * 常量说明：loading 用于处理 loading 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const loading = tunnel.loadBundle(scriptUrl)
  expect(sent[0]?.url).toBe(`http://localhost:3000${scriptUrl}`)
  deliver({
    t: 'res',
    id: 1,
    status: 200,
    headers: { 'content-type': 'text/javascript' },
    body: new TextEncoder().encode(`factory();\n//# sourceMappingURL=${mapUrl}\n`).buffer,
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await vi.waitFor(() => { expect(sent).toHaveLength(2) })
  expect(sent[1]?.url).toBe(`http://localhost:3000${mapUrl}`)
  /**
   * 常量说明：map 用于映射 map 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const map = '{"version":3,"sections":[]}'
  deliver({
    t: 'res',
    id: 2,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(map).buffer,
  })
  await loading

  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = await blobs[0]?.text()
  /**
   * 常量说明：encoded 用于处理 encoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const encoded = /sourceMappingURL=data:application\/json;charset=utf-8;base64,([^\s]+)/.exec(source ?? '')?.[1]
  if (encoded === undefined) throw new Error('localized bundle has no inline source map')
  /**
   * 常量说明：decoded 用于处理 decoded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：char（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(char)，并按返回类型处理结果。
   */
  const decoded = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  expect(new TextDecoder().decode(decoded)).toBe(map)
  expect(revoked).toEqual(['blob:fixture-1'])
})
