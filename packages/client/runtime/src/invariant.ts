/**
 * ================================ 文件注释 ================================
 * 【文件职责】本包（dsh-client-runtime）的运行时不变量（invariant）伴侣
 *   插件：向 invariants 服务注册"slots/changed 事件必须发生在版本号更新
 *   之后"这一 owned 关系检查。
 * 【技术维度】Cordis 插件（companion）：导出 name/inject/apply 三元组，
 *   在 internal/dispatch 全局钩子上拦截事件分发做断言；违规即 fail。
 * 【产品维度】把"事件必须紧随其对应变更"的时序契约固化成可执行检查，
 *   尽早暴露排序或丢失变更的 bug，而不是让界面出现脏状态。
 * 【逻辑维度】install 定义检查逻辑（识别 slots/changed、校验 key、比对
 *   版本号）；apply 向 invariants 服务注册该安装器。
 * 【关键边界】只针对 'slots/changed' 事件；key 必须是非空字符串；
 *   版本号为 0 视为"变更尚未发生"。
 * 【新手阅读建议】先读 packages/invariants 理解 fail 的语义。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-runtime`.
 * @module @deepseek-ai/dsh-client-runtime/invariant
 */
/**
 * 本包自有的不变量伴侣插件：注册"slots/changed 必须先于其变更的版本号
 * 更新"这条 owned 关系检查。
 */

/* jscpd:ignore-start */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof SlotMap & string` is the declare-merge key pattern: SlotMap is empty
 * in this compilation unit (intersection reads `never`) but consumers merge
 * keys in; the rule fires on the empty-map view, not on real redundancy. */
import type { Context } from '@deepseek-ai/cordis'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-runtime' // 注册到 invariants 服务时使用的包名标识

/** Cordis companion plugin name. */
/** Cordis 伴侣插件的插件名。 */
export const name = 'client-runtime-invariant'
/** Service required before the companion can register. */
/** 注册伴侣插件前必须先存在的服务。 */
export const inject = ['invariants']

/**
 * Owned relation: every 'slots/changed'(key) emission must observe the
 * mutation already applied — SlotCore bumps the key's version synchronously
 * before the service re-emits, so a zero version at dispatch time means the
 * event fired without (or ahead of) its mutation.
 */
/**
 * owned 关系：每次 'slots/changed'(key) 分发都必须能观察到变更已应用——
 * SlotCore 在服务重发事件前会同步提升该键的版本号，因此分发时版本为 0
 * 意味着事件在没有（或先于）对应变更的情况下触发。
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'slots/changed') return
    const key: unknown = args[0] // 事件负载中的插槽键
    if (typeof key !== 'string' || key === '') {
      fail("'slots/changed' dispatched without a slot key argument")
      return
    }
    const slots = ctx.get('slots')
    // Event payloads carry keys as plain strings; getVersion is statically
    // keyed, so restore the SlotMap-key type after the runtime string check.
    // 事件负载中的键是普通字符串，而 getVersion 是静态键控的，
    // 因此在运行时字符串校验后把类型恢复为 SlotMap 的键类型。
    if (slots !== undefined && slots.getVersion(key as keyof SlotMap & string) === 0) {
      fail(`'slots/changed' fired for "${key}" before any mutation bumped its version — emission must follow the applied mutation`)
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 注册本包的不变量伴侣。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 设置成功后已安装注册项的销毁函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
