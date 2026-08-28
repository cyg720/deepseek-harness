/**
 * Page-side interpreter for the structured index injection table. The served
 * form renders the same rows into index.html text; a static worker page has
 * no served HTML, so it executes the table directly. Rows execute strictly in
 * table order, so a global row lands before the scripts that read it.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 apply injections
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param row （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(row)，并按返回类型处理结果。
 */
function assertNever(row: never): never {
  throw new Error(`webworker-runtime: unknown index injection row ${JSON.stringify(row)}`)
}

/**
 * Execute every row in table order.
 * @param rows - Injection table from the boot payload.
 * @param loadScript - Executes one script-src row; the tunnel's `loadBundle`,
 * because the row URLs (`/plugins/...`) resolve only through the worker.
 * @remarks 中文说明：功能说明：注册并应用 Index Injections 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：rows（readonly IndexInjection[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：loadScript（(src: string) => Promise<void>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 applyIndexInjections(rows, loadScript)，并按返回类型处理结果。
 */
export async function applyIndexInjections(
  rows: readonly IndexInjection[],
  loadScript: (src: string) => Promise<void>,
): Promise<void> {
  /**
   * 变量说明：row 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const row of rows) {
    switch (row.kind) {
      case 'global':
        (globalThis as Record<string, unknown>)[row.name] = row.value
        break
      case 'script': {
        /**
         * 常量说明：el 用于处理 el 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const el = document.createElement('script')
        el.textContent = row.text
        ;(row.placement === 'head' ? document.head : document.body).append(el)
        break
      }
      case 'script-src':
        await loadScript(row.src)
        break
      case 'script-preload':
        // The worker tunnel has no browser URL to warm without also executing
        // the script; loadScript handles the real request when the row arrives.
        break
      case 'style': {
        /**
         * 常量说明：el 用于处理 el 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const el = document.createElement('style')
        el.textContent = row.text
        document.head.append(el)
        break
      }
      case 'html':
        (row.placement === 'head' ? document.head : document.body).insertAdjacentHTML('beforeend', row.html)
        break
      default:
        assertNever(row)
    }
  }
}
