/**
 * ================================ 文件注释 ================================
 * 【文件职责】"仅事件的文件系统观察策略"插件：不注册任何服务，用弱引用
 * 拥有者/目标映射记录每次权威的存在/不存在观察，用单槽意图监听器从该状态推导
 * 写/编辑守卫，由提供者（fs-local）执行原子的新鲜度/不覆盖检查。
 * 【技术维度】核心是 ObservedStateGate：外层 WeakMap（拥有者→内层 Map（targetKey →
 * FsObservation）），拥有者弱持有（会话被回收即释放其状态）。挂三个 fs/* 监听器：
 * write-intent/edit-intent 占用单决策槽（不调用 next()，用 Promise.resolve().then
 * 让抛出变成 rejection），observed 保持同步且不抛。
 * 【产品维度】不加载本插件时，工具保留裸提供者的无条件变更行为；加载后，"先读
 * 后写/编辑"成为默认策略：未见过的写按 createIfAbsent（不覆盖未读文件），未见过的
 * 编辑直接拒绝（要求先读）。
 * 【逻辑维度】按出现顺序：类型再导出 → ObservedStateGate（observed 字段、owner/
 * get/set/clear、writeIntent/editIntent/observe）→ name（插件名）→ apply（挂三个
 * 监听器 + 卸载清理）。
 * 【关键边界】owner 推导失败（无 agent 会话，如直接工具调用）时读写自由进行，但
 * 无法满足"写/编辑前必须先观察"的策略；事件 actor 是弱类型，需结构断言（见
 * oxlint pragma 上方的说明）；observed 必须同步非抛——emit 不 await，且成功变更
 * 已提交。
 * 【新手阅读建议】先看 ObservedStateGate 的 writeIntent/editIntent/observe 三个决策
 * 方法，再看 apply 的监听器接线理解事件如何驱动状态。
 * ==========================================================================
 */
/**
 * Event-only filesystem observation policy; it registers no service. A weak owner/target map
 * records every authoritative presence/absence observation, single-slot intent listeners derive
 * guards from that state, and the provider performs the atomic freshness/no-clobber check. Without
 * this plugin, tools retain the bare provider's unconditional mutation behavior. See the package
 * README for composition rules.
 * @module @deepseek-ai/dsh-fs-observation-policy
 */
/**
 * 模块总览：本插件只"听事件、记状态、给决策"，不注册服务、不做文件操作。
 * 它让"观察过才能写/编辑"成为默认行为（先读后写防覆盖）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsObservation, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { FsObservationActor } from './types.ts'

export type { FsObservationActor } from './types.ts'

/**
 * Per-context observed-file state and the three `fs/*` decisions over it. One
 * instance is created per `apply()` so disposal can drop all state for HMR.
 */
/**
 * 每个上下文一份的"观察文件状态"及基于它的三个 fs/* 决策。每次 apply() 创建一个
 * 实例，便于卸载时丢弃全部状态（HMR 安全）。
 */
class ObservedStateGate {
  /**
   * Observed-file state, keyed first by the owner object (weakly held, so a
   * collected session frees its state), then by {@link FsTarget.targetKey}. An
   * entry's presence is the prior-observation record; its discriminant keeps
   * confirmed absence distinct from an unseen target.
   */
  /**
   * 观察文件状态：先按拥有者对象（弱持有，会话被回收即释放其状态），再按
   * targetKey 索引。条目存在即"先前观察过"的记录；其 kind 判别符把"确认不存在"
   * 与"从未见过"区分开。
   */
  private observed = new WeakMap<object, Map<string, FsObservation>>()

  /**
   * Derive the observed-state owner from the opaque event actor — normally the
   * active agent session. `undefined` when no owner can be derived (e.g. a
   * direct tool call with no agent); such calls read freely but cannot satisfy
   * the write/edit prior-observation policy.
   */
  /**
   * 从不透明事件 actor 推导观察态拥有者——通常是活动代理会话。推导不出时为
   * undefined（如无代理的直接工具调用）；此类调用可以自由读，但无法满足
   * "写/编辑前必须先观察"的策略。
   */
  private owner(actor: object | undefined): object | undefined {
    // tsgolint treats object as assignable to weak FsObservationActor, while tsc still requires the structural cast for property access.
    // See the analyzer-divergence consequence in .agents/notes/implemented/process/2026-07-29-oxlint-linter.md.
    // 中文说明：tsgolint 认为 object 可直接赋值给弱类型 FsObservationActor，而 tsc
    // 仍要求结构断言才能访问属性——两个分析器对此弱类型存在分歧（见 oxlint 备忘）。
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- The analyzers disagree on this weak type.
    return (actor as FsObservationActor | undefined)?.agent?.session
  }

  // 取某拥有者、某目标键的先前观察（无记录返回 undefined）。
  private get(owner: object, targetKey: string): FsObservation | undefined {
    return this.observed.get(owner)?.get(targetKey)
  }

  // 记录某拥有者、某目标键的观察（懒建内层 Map）。
  private set(owner: object, targetKey: string, observation: FsObservation): void {
    let byTarget = this.observed.get(owner)
    if (!byTarget) {
      byTarget = new Map()
      this.observed.set(owner, byTarget)
    }
    byTarget.set(targetKey, observation)
  }

  /** Drop all recorded state (HMR safety / disposal). */
  /** 丢弃全部记录状态（HMR 安全 / 卸载）。 */
  clear(): void {
    this.observed = new WeakMap()
  }

  /**
   * Decide the write intent: unseen or confirmed absent ⇒ `createIfAbsent`;
   * confirmed present ⇒ `replaceIfVersion` at the observed version.
   */
  /**
   * 决策写意图：从未见过或确认不存在 → createIfAbsent（不存在才创建）；
   * 确认存在 → 以观察到的版本做 replaceIfVersion（按版本替换）。
   */
  writeIntent(target: FsTarget, actor: object | undefined): FsWriteIntent {
    const owner = this.owner(actor)
    const prior = owner ? this.get(owner, target.targetKey) : undefined
    return prior?.kind === 'present'
      ? { kind: 'replaceIfVersion', version: prior.version }
      : { kind: 'createIfAbsent' }
  }

  /**
   * Decide the edit version guard: unseen rejects with `FS_NOT_OBSERVED`,
   * confirmed absence rejects with `FS_NOT_FOUND`, and presence supplies the
   * observed version as the CAS basis.
   */
  /**
   * 决策编辑版本守卫：从未见过以 FS_NOT_OBSERVED 拒绝（要求先读），确认不存在以
   * FS_NOT_FOUND 拒绝，确认存在则提供观察到的版本作为 CAS（比较并交换）基础。
   */
  editIntent(target: FsTarget, actor: object | undefined): { version: FsVersion } {
    const owner = this.owner(actor)
    const prior = owner ? this.get(owner, target.targetKey) : undefined
    if (!owner || prior === undefined) {
      throw new FsError(`edit requires reading "${target.displayPath}" first`, 'FS_NOT_OBSERVED')
    }
    if (prior.kind === 'absent') {
      throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    }
    return { version: prior.version }
  }

  /** Record an authoritative present or absent observation for this owner and target. */
  /** 为某拥有者与目标记录一次权威的存在/不存在观察（无拥有者时无记录价值）。 */
  observe(target: FsTarget, observation: FsObservation, actor: object | undefined): void {
    const owner = this.owner(actor)
    if (owner) this.set(owner, target.targetKey, observation)
  }
}

/** Cordis plugin name used by loader diagnostics. */
/** 插件名（供加载器诊断使用）。 */
export const name = 'fs-observation-policy'

/**
 * Register the three `fs/*` listeners. No `inject` — this plugin reads no
 * services; it operates only on its own `WeakMap`. The waterfalls are unbound
 * (the tool dispatches them with no `this`), so the listeners take the raw
 * `(target, actor, next)` arguments.
 */
/**
 * 注册三个 fs/* 监听器。没有 inject——本插件不读任何服务，只操作自己的 WeakMap。
 * waterfall 监听器未绑定 this（工具不带 this 分发），所以监听器直接取原始参数。
 */
export function apply(ctx: Context): void {
  const gate = new ObservedStateGate()

  // 卸载时丢弃全部记录状态：重载插件从干净状态开始（HMR 安全）。WeakMap 本身会被
  // GC，但显式替换让释放对测试立即可观察。
  ctx.effect(() => () => {
    // Drop all recorded state on disposal so a reloaded plugin starts clean
    // (HMR safety). The WeakMap itself would be GC'd, but replacing it makes the
    // release observable and immediate for tests.
    // 中文说明：卸载时丢弃全部记录状态，让重载插件从干净状态开始（HMR 安全）。
    // WeakMap 本身会被 GC，但替换它让释放对测试立即可观察。
    gate.clear()
  }, 'fs-observation-policy observed-state teardown')

  // fs/write-intent: occupy the single decision slot — do NOT call next().
  // Deferred through Promise.resolve().then so the declared Promise return type
  // holds (a throw rejects, never escapes synchronously through the waterfall).
  // 中文说明：write-intent 占用单决策槽——不调用 next()。经 Promise.resolve().then
  // 延迟，使声明的 Promise 返回类型成立（抛出变成 rejection，不会同步穿过瀑布）。
  ctx.on('fs/write-intent', (target, actor) => Promise.resolve().then(() => gate.writeIntent(target, actor)))

  // fs/edit-intent: occupy the single decision slot — do not call next().
  // 中文说明：edit-intent 占用单决策槽——不调用 next()。
  ctx.on('fs/edit-intent', (target, actor) => Promise.resolve().then(() => gate.editIntent(target, actor)))

  // fs/observed must remain synchronous and non-throwing: emit does not await
  // promises, and successful mutations have already committed. WeakMap.set
  // satisfies that contract for both presence and absence.
  // 中文说明：observed 必须保持同步且不抛：emit 不 await Promise，且成功的变更已
  // 提交。WeakMap.set 对存在与不存在两种情况都满足该契约。
  ctx.on('fs/observed', (target, observation, actor) => {
    gate.observe(target, observation, actor)
  })
}
