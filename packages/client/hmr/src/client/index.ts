/**
 * ================================ 文件注释 ================================
 * 【文件职责】client-hmr 的浏览器半边：客户端插件条目的热更新驱动——监听
 *   Host 的系统 SSE 通道（GET /plugins/events），收到 rebuilt 帧时重载
 *   bundle 并在原位换掉 cordis fiber。
 * 【技术维度】懒 CJS 表语义：invalidate -> prefetch -> 注册表先拆除 ->
 *   排空旧 fiber -> 移除属主 <style> 标签 -> entry.refresh() 物化新工厂；
 *   级联零触碰（下游 fiber 以提供者 uid 键控激活纪元）。
 * 【产品维度】开发模式下改代码即热换插件 bundle，无需整页刷新；普通包
 *   （react 家族、cordis、shell、纯库）不是图条目，其改动仍整页刷新。
 * 【逻辑维度】reload 执行热换六步；handle 把帧串行入队；apply 订阅 SSE
 *   并挂 EventSource 生命周期。
 * 【关键边界】invalidate 必须先于 prefetch（活跃工厂会让 prefetch 空操作、
 *   重注册是响亮重复）；失败不回滚（无回滚策略）；自重载（本插件自身是
 *   图条目）由旧闭包继续运行。
 * 【新手阅读建议】先读 modules 包的懒 CJS 模型与图条目概念。
 * ==========================================================================
 */
/**
 * client-hmr, browser half: hot-reload driver for client plugin entries.
 *
 * Listens on the host's system SSE channel (`GET /plugins/events`); on a
 * `rebuilt` frame it reloads the entry's bundle and swaps the cordis
 * fiber in place. Every graph entry is a plugin bundle
 * — `immediately` rows differ only in stage-one prefetch (a boot
 * optimization), so all rostered plugin packages share these reload semantics;
 * normal packages (react family, cordis, shell, pure libs) are not entries
 * and shell changes still mean a page reload. Cascade is zero-touch:
 * downstream fibers key their activation epoch on provider fiber uids
 * (vendor/cordis/src/fiber.ts `_refresh`), so replacing a provider fiber
 * re-cascades natively — reloading a data-layer plugin (connection/runtime)
 * cascades into its UI dependents with no HMR-side bookkeeping.
 *
 * Reload order (lazy CJS table): invalidate (drop the stale factory and
 * materialized record) → prefetch (load and register the fresh
 * factory) → registry-first teardown → drain old fiber unload → remove
 * owned `<style data-plugin>` tags → `entry.refresh()` materializes the new
 * factory. Invalidate MUST precede prefetch: a live factory makes prefetch
 * a no-op, and re-executing a bundle over an undeleted registration is a
 * loud duplicate. The swap is safe because execution is pure registration
 * under the lazy model — every module side effect (CSS injection included)
 * lives in the factory closure and runs at materialization, inside
 * refresh(). That also keeps the CSS ordering guarantee: owned styles are
 * removed after the old fiber's disposers drained (SlotCore one-owner
 * unregister) and before materialization re-injects tags under the same
 * stable tag ids.
 *
 * Failure window: if prefetch rejects after invalidate, the module is left
 * unregistered while the OLD fiber keeps running untouched (teardown never
 * started) — degraded but recoverable, the next rebuilt frame retries from
 * scratch. Consistent with the no-rollback policy below. Known dev-only
 * race: a rebuilt frame overlapping a still-in-flight boot arrival shares
 * that arrival's task and may materialize the pre-rebuild bytes; the next
 * rebuilt frame self-heals.
 *
 * Why not the naive `entry.fiber.dispose()` → `entry.refresh()` path:
 * 1. `Entry.fiber` is never cleared on dispose (vendor/loader/src/config/
 *    entry.ts assigns it only in `_init`), so `refresh()` hits its
 *    `if (this.fiber) return` guard and no-ops.
 * 2. A bare `fiber.dispose()` lands in Loader's self-dispose branch
 *    (vendor/loader/src/index.ts `internal/plugin` case 4: the registry
 *    still holds the runtime at emit time), which flags the entry
 *    `disabled: true` — permanently.
 * vendor/hmr's reload skeleton documents the fix: delete the runtime record
 * FIRST (`registry.delete` → case 4 returns early, the entry stays enabled),
 * then rebuild. `entry.fiber` is additionally cleared so
 * `entry.refresh()` re-imports and re-plugins through the Loader's own
 * `_init` (entry-resolved config, automatic `fiber.entry` rebinding) instead
 * of hand-rolling `registry.plugin`. Client entries have exactly one fiber
 * per runtime, so `registry.delete` never collaterally disposes siblings.
 *
 * Self-reload: this plugin is itself a graph entry, so a rebuilt frame may
 * name it. The in-flight reload keeps running in the old bundle's closure
 * (its EventSource closes with the old fiber's effects); the new bundle's
 * apply opens a fresh channel. Frames arriving during the gap are lost —
 * acceptable for the dev channel, the next rebuild renotifies.
 *
 * Failure policy: no rollback. An import failure leaves the entry
 * fiberless (the next rebuilt frame retries from scratch); an apply failure
 * leaves a FAILED fiber for the shell's status projection. Both log loudly.
 */
/**
 * client-hmr 的浏览器半边：客户端插件条目的热更新驱动。
 *
 * 监听 Host 的系统 SSE 通道（GET /plugins/events）；收到 rebuilt 帧时重载
 * 条目 bundle 并在原位换掉 cordis fiber。每个图条目都是插件 bundle——
 * immediately 行只在一阶段预取上不同（启动优化），因此所有名册内插件包
 * 共享这些重载语义；普通包（react 家族、cordis、shell、纯库）不是条目，
 * shell 改动仍意味着整页刷新。级联零触碰：下游 fiber 以提供者 fiber uid
 * 键控其激活纪元（vendor/cordis/src/fiber.ts _refresh），因此替换提供者
 * fiber 会原生重新级联——重载数据层插件（connection/runtime）无需任何
 * HMR 侧记账即级联进其 UI 依赖者。
 *
 * 重载顺序（懒 CJS 表）：invalidate（丢弃陈旧工厂与物化记录）-> prefetch
 * （加载并注册新工厂）-> 注册表先拆除 -> 排空旧 fiber 卸载 -> 移除属主
 * <style data-plugin> 标签 -> entry.refresh() 物化新工厂。invalidate 必须
 * 先于 prefetch：活跃工厂使 prefetch 空操作，而在未删除的注册上重执行
 * bundle 是响亮重复。交换安全是因为懒模型下执行只是纯注册——每个模块
 * 副作用（含 CSS 注入）都活在工厂闭包里、在物化时（refresh() 内）运行。
 * 这也保持 CSS 顺序保证：属主样式在旧 fiber 销毁器排空后（SlotCore 单属主
 * 注销）移除，并在物化以相同稳定标签 id 重新注入前完成。
 *
 * 失败窗口：若 prefetch 在 invalidate 后拒绝，模块保持未注册而旧 fiber
 * 不受触碰地继续运行（拆除从未开始）——降级但可恢复，下一个 rebuilt 帧
 * 从头重试。与下面的无回滚策略一致。已知仅开发期竞争：与仍在途的启动
 * 到达重叠的 rebuilt 帧共享该到达的任务，可能物化重建前的字节；下一个
 * rebuilt 帧自愈。
 *
 * 为何不用朴素的 entry.fiber.dispose() -> entry.refresh() 路径：
 * 1. Entry.fiber 在 dispose 时从不清除（vendor/loader/src/config/entry.ts
 *    只在 _init 中赋值），因此 refresh() 撞上其 if (this.fiber) return
 *    守卫而空操作。
 * 2. 裸 fiber.dispose() 落入 Loader 的自销毁分支（vendor/loader/src/index.ts
 *    internal/plugin case 4：发射时注册表仍持有 runtime），把条目永久标记
 *    disabled: true。
 * vendor/hmr 的重载骨架记录了修复：先删除 runtime 记录（registry.delete
 * -> case 4 提前返回，条目保持启用），再重建。entry.fiber 也额外清除，
 * 使 entry.refresh() 经 Loader 自己的 _init（条目解析配置、自动
 * fiber.entry 重绑定）重新导入与重新插装，而非手写 registry.plugin。
 * 客户端条目每个 runtime 恰好一个 fiber，因此 registry.delete 从不会
 * 连带销毁兄弟。
 *
 * 自重载：本插件自身是图条目，因此 rebuilt 帧可能命名它。在途重载在旧
 * bundle 闭包中继续运行（其 EventSource 随旧 fiber 的 effect 关闭）；新
 * bundle 的 apply 打开新通道。间隙期间到达的帧丢失——对开发通道可接受，
 * 下次重建会再通知。
 *
 * 失败策略：无回滚。导入失败使条目无 fiber（下一个 rebuilt 帧从头重试）；
 * apply 失败给 shell 状态投影留下 FAILED fiber。两者都响亮记录。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import type { PluginsEventFrame } from '../events.ts'
import { EVENTS_ENDPOINT } from '../events.ts'

export type { PluginsEventFrame } from '../events.ts'
export { EVENTS_ENDPOINT } from '../events.ts'

/** Cordis plugin name. */
/** Cordis 插件名。 */
export const name = 'client-hmr'

/** Required services: the vendored Loader (entry governance) and the client module system (boot provide, service name `modules`). */
/** 必需服务：vendored Loader（条目治理）与客户端模块系统（启动提供，服务名 modules）。 */
export const inject = ['loader', 'modules']

/** Find the loader entry whose module specifier is `id` (entry tree ids are random; the package name lives in `options.name`). */
/** 查找模块说明符为 id 的 loader 条目（条目树 id 是随机的；包名在 options.name）。 */
function findEntry(loader: Loader, id: string): Entry | undefined {
  for (const entry of loader.entries()) {
    if (entry.options.name === id) return entry
  }
  return undefined
}

/** Remove every `<style data-plugin>` tag owned by `id` (attribute compared verbatim — no CSS-selector escaping pitfalls). */
/** 移除 id 拥有的每个 <style data-plugin> 标签（属性逐字比较——无 CSS 选择器转义陷阱）。 */
function removeOwnedStyles(id: string): void {
  for (const el of document.querySelectorAll('style[data-plugin]')) {
    if (el.getAttribute('data-plugin') === id) el.remove()
  }
}

/**
 * Mount the HMR driver: subscribe to the system SSE channel and hot-swap
 * rebuilt entries.
 * @param ctx - plugin context with `loader` and `modules` available.
 */
/**
 * 挂载 HMR 驱动：订阅系统 SSE 通道并热换重建条目。
 * @param ctx 含可用 loader 与 modules 的插件上下文。
 */
export function apply(ctx: Context): void {
  // Both are declared injections (typed Context merges: `modules` from the
  // client module loader package, `loader` from the vendored Loader).
  // 两者都是已声明注入（类型化 Context 合并：modules 来自客户端模块加载
  // 包，loader 来自 vendored Loader）。
  const modLoader = ctx.modules
  const loader: Loader = ctx.loader

  async function reload(id: string): Promise<void> {
    const entry = findEntry(loader, id)
    if (entry === undefined) {
      ctx.logger.warn(`client-hmr: rebuilt frame for unknown entry "${id}" (not in the loader tree)`)
      return
    }
    // Invalidate first (drop stale factory + record — a live factory makes
    // prefetch a no-op and re-registration a loud duplicate), then run the
    // async half while the old fiber still serves: script loading registers
    // the fresh factory with zero side effects (lazy CJS — module bodies run
    // at materialization, not execution).
    // 先 invalidate（丢弃陈旧工厂 + 记录——活跃工厂使 prefetch 空操作且
    // 重注册是响亮重复），然后在旧 fiber 仍服务时运行异步半边：脚本加载
    // 以零副作用注册新工厂（懒 CJS——模块体在物化而非执行时运行）。
    modLoader.invalidate(id)
    await modLoader.prefetch(id)

    const oldFiber = entry.fiber
    if (oldFiber !== undefined) {
      // Registry-first teardown (see module comment): the runtime record must
      // be gone before the fiber's disposer emits internal/plugin, or the
      // Loader flags the entry disabled.
      // 注册表先拆除（见模块注释）：runtime 记录必须在 fiber 销毁器发射
      // internal/plugin 前消失，否则 Loader 会把条目标记禁用。
      const runtime = oldFiber.runtime
      if (runtime !== null) entry.ctx.registry.delete(runtime.callback)
      // Drain the unload: effect disposers (slots, subscriptions) must finish
      // before the new bundle executes and the new apply re-registers.
      // 排空卸载：effect 销毁器（槽位、订阅）必须在新 bundle 执行与新
      // apply 重新注册前完成。
      while (oldFiber.inertia !== undefined) await oldFiber.inertia
      delete entry.fiber
    }
    // Old owned styles go before materialization re-injects them (the CSS
    // idempotency guard keys on stable tag ids).
    // 旧属主样式先走，物化再重新注入（CSS 幂等守卫以稳定标签 id 为键）。
    removeOwnedStyles(id)
    // Re-init through the entry: fiber cleared above, so refresh() re-imports
    // — materializing the prefetched factory (CSS injects here) — and
    // re-plugins under the entry context. Import failures are logged by
    // Entry._init and leave the entry fiberless (retryable).
    // 经条目重新初始化：fiber 已在上方清除，因此 refresh() 重新导入——
    // 物化预取工厂（CSS 在此注入）——并在条目上下文下重新插装。导入失败
    // 由 Entry._init 记录并让条目保持无 fiber（可重试）。
    await entry.refresh()
    // Surface apply failures loudly (no rollback, FAILED state stays).
    // 响亮浮现 apply 失败（无回滚，FAILED 状态保留）。
    await entry.fiber?.await()
  }

  // Serialize reloads: frames can arrive faster than a swap completes, and
  // interleaved dispose/execute chains would corrupt the single-slot handoff.
  // 串行化重载：帧到达可能快于交换完成，交错的销毁/执行链会破坏单槽交接。
  let queue: Promise<void> = Promise.resolve()
  const handle = (frame: PluginsEventFrame): void => {
    switch (frame.type) {
      case 'rebuilt':
        queue = queue.then(() => reload(frame.id)).catch((error: unknown) => {
          ctx.logger.error(`client-hmr: reload of "${frame.id}" failed`)
          ctx.logger.error(error)
        })
        break
      case 'graph':
        // Connect-time snapshot, unused. The loader's cached graph rev
        // goes stale after rebuilds — harmless, since prefetch hits the
        // network anyway (host serves bundles no-cache); graph rev refresh
        // lands with the reconnect-handshake mechanism.
        // 连接时快照，未使用。loader 缓存的图 rev 在重建后会陈旧——无害，
        // 因为 prefetch 反正走网络（Host 无缓存地提供 bundle）；图 rev 的
        // 刷新随重连握手机制落地。
        break
      default:
        // Merge-extensible frame union: unknown frame types from newer hosts
        // are ignored by design.
        // 合并可扩展帧联合：更新 Host 的未知帧类型按设计忽略。
        break
    }
  }

  ctx.effect(() => {
    const source = new EventSource(EVENTS_ENDPOINT)
    source.addEventListener('message', (event: MessageEvent<string>) => {
      let frame: PluginsEventFrame
      try {
        frame = JSON.parse(event.data) as PluginsEventFrame
      } catch {
        // Wire boundary: a malformed dev-channel frame is dropped loudly.
        // 线上边界：畸形开发通道帧被响亮丢弃。
        ctx.logger.warn(`client-hmr: unparseable event frame: ${event.data}`)
        return
      }
      handle(frame)
    })
    return () => { source.close() }
  }, 'client-hmr: event source')
}
