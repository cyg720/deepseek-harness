/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话标准属性（standard-props）的 provide 通道：提供者名册、
 *   捆绑（bundle）物化（未声明/缺失/重复成员均 fail-loud）、静态无会话投影
 *   与原子性当前会话投影。
 * 【技术维度】单实现原则：SessionRuntime 从 wire 真值驱动它，测试运行时的
 *   会话替身从夹具驱动它，因此物化规则与投影语义在生产与测试台之间不会漂移。
 * 【产品维度】插件通过 provide 通道向会话贡献 hooks/props（如 useSession），
 *   渲染侧无需特例；选中会话变化或名册变化都经同一个投影源发布。
 * 【逻辑维度】provide 注册并立即重建名册（失败回滚）；publishCurrent 在
 *   当前捆绑变化时同步通知；materializeInfo 做单会话物化；
 *   materializeMaybeInfo 做无会话静态投影。
 * 【关键边界】currentProvideInfo 是普通 cell（捆绑持有活跃会话源，禁止
 *   冻结）；订阅者异常被捕获记录，防止饿死后续监听器。
 * 【新手阅读建议】先理解"提供者 -> 名册 -> 捆绑"的三层关系。
 * ==========================================================================
 */
/**
 * The session standard-props provide channel: provider roster, bundle
 * materialization (fail-loud on undeclared/missing/duplicate members), the
 * static no-session projection, and the atomic current-session projection
 * observable. One implementation — SessionRuntime drives it from wire
 * truth, the test runtime's sessions double drives it from fixtures — so
 * the materialization rules and the projection semantics cannot drift
 * between production and the test bench.
 */
/**
 * 会话标准属性 provide 通道：提供者名册、捆绑物化（未声明/缺失/重复成员
 * fail-loud）、静态无会话投影、以及原子性的当前会话投影可观察对象。
 * 只有一个实现——SessionRuntime 用 wire 真值驱动它，测试运行时的会话替身
 * 用夹具驱动它——因此物化规则与投影语义不会在生产与测试台之间漂移。
 */
import type { HostObservable, SessionMaybeProvideInfo, SessionProvideInfo } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionBinding, SessionProvideDescriptor } from './service.ts'

/** The owner-side hooks: how the channel reaches the owner's live bundles and current selection. */
/** 属主侧钩子：通道如何触达属主的活跃捆绑与当前选中。 */
export interface SessionProvideChannelHost {
  /**
   * Re-materialize every already-materialized bundle against the new roster
   * (call {@link SessionProvideChannel.materializeInfo} per live binding).
   * Lazily-materialized sessions pick the new roster up on first resolve.
   */
  /**
   * 按新名册重新物化每个已物化的捆绑（对每个活跃 binding 调用
   * SessionProvideChannel.materializeInfo）。懒物化的会话在首次解析时
   * 拾取新名册。
   */
  rebuildBundles(): void
  /** Resolve the current selection's bundle (the owner's maybe-provide lookup). */
  /** 解析当前选中的捆绑（属主的 maybe-provide 查找）。 */
  resolveCurrent(): SessionMaybeProvideInfo
}

/**
 * Provider roster + materialization + current projection. The channel owns
 * every rule a provider contribution must satisfy; owners keep only their
 * per-session bundle storage and the definition of "current".
 */
/**
 * 提供者名册 + 物化 + 当前投影。通道拥有提供者贡献必须满足的一切规则；
 * 属主只保留每个会话的捆绑存储与"当前"的定义。
 */
export class SessionProvideChannel {
  private readonly providers: SessionProvideDescriptor[] = [] // 提供者名册（按注册顺序）
  private maybeInfoCache: SessionMaybeProvideInfo // 静态无会话投影缓存
  /** Latest published current bundle (identity comparison dedupes republish). */
  /** 最新发布的当前捆绑（身份比较去重，避免重复发布）。 */
  private currentSnapshot: SessionMaybeProvideInfo
  /** Projection subscribers (plain cell: bundles hold live session sources, so no store freeze may touch them). */
  /** 投影订阅者（普通 cell：捆绑持有活跃会话源，因此任何 store 冻结都不得触碰它们）。 */
  private readonly listeners = new Set<() => void>()

  /**
   * Atomic current-session provide projection: selection changes and
   * provider-roster changes publish through this one source, so a roster
   * change under a stable current id republishes the bundle instead of
   * stranding mounted entries.
   */
  /**
   * 原子性的当前会话 provide 投影：选中变化与提供者名册变化都经这一个
   * 源发布，因此当前 id 稳定时的名册变化会重新发布捆绑，而不是让已挂载
   * 的条目搁浅。
   */
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>

  /**
   * @param host - owner-side bundle storage and current-selection resolution.
   */
  /**
   * @param host 属主侧的捆绑存储与当前选中解析。
   */
  constructor(private readonly host: SessionProvideChannelHost) {
    // The runtime's own contribution comes first: useSession rides the same
    // provide channel every plugin uses (no renderer special case).
    // 运行时自身的贡献排在首位：useSession 与所有插件走同一个 provide
    // 通道（渲染器无特例）。
    this.providers.push({
      hooks: ['session'],
      resolve: binding => ({ hooks: { session: binding.session } }),
    })
    this.maybeInfoCache = this.materializeMaybeInfo()
    this.currentSnapshot = this.maybeInfoCache
    this.currentProvideInfo = {
      getSnapshot: () => this.currentSnapshot,
      subscribe: (fn) => {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      },
    }
  }

  /** The static no-session projection under the current roster (declared names present, values undefined). */
  /** 当前名册下的静态无会话投影（声明过的名字都在，值为 undefined）。 */
  get maybeInfo(): SessionMaybeProvideInfo {
    return this.maybeInfoCache
  }

  /**
   * Register a per-session standard-props provider (see
   * SessionRuntime.provide for the product contract). Live bundles rebuild
   * immediately; misdeclared providers fail loud here, at the registration
   * edge, and the registration rolls back — the channel never stays on a
   * roster it cannot materialize.
   * @param descriptor - static member roster plus per-session resolver.
   * @returns disposer removing the provider.
   */
  /**
   * 注册一个按会话的标准属性提供者（产品契约见 SessionRuntime.provide）。
   * 活跃捆绑立即重建；声明错误的提供者在注册边界 fail-loud，注册回滚——
   * 通道绝不停留在无法物化的名册上。
   * @param descriptor 静态成员名册 + 按会话解析器。
   * @returns 移除该提供者的销毁函数。
   */
  provide(descriptor: SessionProvideDescriptor): () => void {
    this.providers.push(descriptor)
    try {
      this.applyRosterChange()
    } catch (error) {
      this.providers.splice(this.providers.indexOf(descriptor), 1)
      // Restore the previous (valid) roster's bundles; cannot rethrow — the
      // pre-push roster materialized successfully before.
      // 恢复先前（有效）名册的捆绑；不可重抛——压入前的名册此前已成功物化。
      this.applyRosterChange()
      throw error
    }
    return () => {
      const at = this.providers.indexOf(descriptor)
      if (at >= 0) this.providers.splice(at, 1)
      this.applyRosterChange()
    }
  }

  /**
   * Re-derive the current selection's bundle and publish it when it changed.
   * Bundles are identity-stable per (scope, roster) materialization, so an
   * identity compare is exact; synchronous notify — call sites (the owner's
   * list subscription, provide()) already sit behind their own batching or
   * registration edges.
   */
  /**
   * 重新推导当前选中的捆绑，并在变化时发布。捆绑按（作用域, 名册）物化
   * 身份稳定，因此身份比较是精确的；同步通知——调用点（属主的列表订阅、
   * provide()）已处于各自的批处理或注册边界之后。
   */
  publishCurrent(): void {
    const next = this.host.resolveCurrent()
    if (next === this.currentSnapshot) return
    this.currentSnapshot = next
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch (error) {
        // Contain subscriber failures: this notify runs inside the list
        // notification, where a throwing render-side subscriber would starve
        // later listeners and abort the projection pass that scheduled it.
        // 隔离订阅者失败：本次通知运行在列表通知内部，抛异常的渲染侧订阅者
        // 会饿死后续监听器并中止调度它的投影过程。
        console.error('sessions.currentProvideInfo subscriber failed:', error)
      }
    }
  }

  /**
   * Materialize the standard-props bundle for one session (fails loud on
   * undeclared, missing, and duplicate member names).
   * @param binding - session assembly handle fed to every resolver.
   * @returns the materialized bundle (identity-stable until the next materialization).
   */
  /**
   * 为一个会话物化标准属性捆绑（未声明、缺失、重复成员名都 fail-loud）。
   * @param binding 喂给每个解析器的会话装配句柄。
   * @returns 物化出的捆绑（直到下次物化前身份稳定）。
   */
  materializeInfo(binding: SessionBinding): SessionProvideInfo {
    const hooks: Record<string, HostObservable<unknown>> = {}
    const props: Record<string, unknown> = {}
    for (const descriptor of this.providers) {
      const contribution = descriptor.resolve(binding)
      const contributedHooks = contribution.hooks ?? {}
      const contributedProps = contribution.props ?? {}
      for (const name of Object.keys(contributedHooks)) {
        if (!(descriptor.hooks ?? []).includes(name)) {
          throw new Error(`sessions.provide: undeclared hook "${name}"`)
        }
      }
      for (const name of Object.keys(contributedProps)) {
        if (!(descriptor.props ?? []).includes(name)) {
          throw new Error(`sessions.provide: undeclared prop "${name}"`)
        }
      }
      for (const name of descriptor.hooks ?? []) {
        const source = contributedHooks[name]
        if (source === undefined) throw new Error(`sessions.provide: missing hook "${name}"`)
        if (Object.hasOwn(hooks, name)) throw new Error(`sessions.provide: duplicate hook "${name}"`)
        hooks[name] = source
      }
      for (const name of descriptor.props ?? []) {
        if (!Object.hasOwn(contributedProps, name)) throw new Error(`sessions.provide: missing prop "${name}"`)
        if (Object.hasOwn(props, name)) throw new Error(`sessions.provide: duplicate prop "${name}"`)
        props[name] = contributedProps[name]
      }
    }
    return {
      sessionId: binding.sessionId,
      hooks,
      props,
      // The useProjection seat: key-addressed bare value faces off the
      // session's projection store (open key space — never a static roster member).
      // useProjection 座位：从会话投影存储取按键寻址的裸值面
      // （开放键空间——绝不是静态名册成员）。
      projections: { faceOf: key => binding.session.projections.faceOf(key) },
    }
  }

  /** Rebuild the static projection and the owner's live bundles, then republish the current one. */
  /** 重建静态投影与属主的活跃捆绑，然后重新发布当前捆绑。 */
  private applyRosterChange(): void {
    this.maybeInfoCache = this.materializeMaybeInfo()
    this.host.rebuildBundles()
    this.publishCurrent()
  }

  /** Build the static no-session kit and reject duplicate declared names. */
  /** 构建静态无会话套件并拒绝重复的声明名。 */
  private materializeMaybeInfo(): SessionMaybeProvideInfo {
    const hooks: Record<string, undefined> = {}
    const props: Record<string, undefined> = {}
    for (const descriptor of this.providers) {
      for (const name of descriptor.hooks ?? []) {
        if (Object.hasOwn(hooks, name)) throw new Error(`sessions.provide: duplicate hook "${name}"`)
        hooks[name] = undefined
      }
      for (const name of descriptor.props ?? []) {
        if (Object.hasOwn(props, name)) throw new Error(`sessions.provide: duplicate prop "${name}"`)
        props[name] = undefined
      }
    }
    return { sessionId: undefined, hooks, props } // no projections face: every key reads absent without a session
    // 没有 projections 面：无会话时每个键都读作缺失。
  }
}
