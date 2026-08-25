/** Test-owned Remote face: `$on` subscriptions driven by the internal forwarded-event plumbing. */
/*
 * 文件职责：实现 remote.ts 覆盖的客户端运行时测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的客户端运行时测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * Remote service test double for the forwarded-event path. Feature specs need
 * `ctx.remote.$on` to exist (their plugins inject `remote`) and need forwarded
 * host events to reach those subscribers, but not the generated namespaces or
 * the wire — so this double implements subscription and dispatch only.
 *
 * Dispatch is driven the same way production drives it: `client/runtime` owns the
 * host frame sink and hands each decoded `host/remote-event` frame to
 * `$dispatch`. A spec therefore exercises its refresh chains by calling
 * `$dispatch(name, args)` on this double.
 *
 * `$mount` rejects: a spec that reaches a generated namespace through this
 * double has outgrown it and needs the real Client Remote service.
 *
 * One deliberate asymmetry with production: a throwing listener propagates out
 * of the emit instead of being contained and logged, so a spec cannot lean on
 * this double for the containment guarantee `$on` documents — assert that
 * against the real service.
 */
/* 中文说明：class TestRemote 定义本模块所需的数据或行为，用于表达客户端运行时测试支持场景。 */
export class TestRemote {
  private readonly subscriptions = new Map<string, Set<(...args: never[]) => void>>()

  /**
   * Register the double as `ctx.remote`.
   * @param ctx - the spec's root Context.
   */
  constructor(ctx: Context) {
    ctx.provide('remote', this)
  }

  /**
   * Deliver one forwarded host event to its subscribers, standing in for the
   * carrier that owns the frame sink.
   * @param event - forwarded host event name.
   * @param args - the Host argument list, verbatim.
   */
  $dispatch(event: string, args: readonly unknown[]): void {
    /** 中文说明：变量 listeners 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listeners = this.subscriptions.get(event)
    if (listeners === undefined) return
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const listener of [...listeners]) listener(...args as never[])
  }

  /**
   * Subscribe to one forwarded host event.
   * @param event - forwarded host event name.
   * @param listener - receives the Host argument list verbatim.
   * @returns disposer removing this subscription.
   */
  $on(event: string, listener: (...args: never[]) => void): () => void {
    /** 中文说明：变量 listeners 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listeners = this.subscriptions.get(event) ?? new Set()
    this.subscriptions.set(event, listeners)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  /**
   * Generated-namespace mount, unsupported by this double.
   * @returns never; always rejects.
   */
  $mount(): Promise<() => Promise<void>> {
    return Promise.reject(new Error('TestRemote: $mount needs the real Client Remote service'))
  }
}
