/**
 * ================================ 文件注释 ================================
 * 【文件职责】tool-cordis 上下文门面的浏览器孪生：白名单生命周期安全动词 + 可选
 *             ctx.get 查找 + 已声明服务的属性访问，扣留框架内部件、拒绝 Context
 *             返回值；两个座位（slots/theme）带额外机制。
 * 【技术维度】Proxy 门面；slots 座位自动分配遮蔽优先级并记账（register 必须保持
 *             原型方法，使效果落到调用插件的 Fiber 上）；theme 座位的覆盖源被钉死
 *             为包 ID；服务返回 Context 一律拒绝（host 孪生规则）。
 * 【产品维度】动态插件的浏览器半部只能在白名单内操作：注册 UI/样式、监听事件、
 *             使用声明的服务，越界行为给出可执行的教学错误并上报 agent。
 * 【逻辑维度】白名单与类型 → denyContext/guardedService → guardedSlots/guardedTheme
 *             → dynamicCordisContext 组装门面 → rejectGuard 收尾。
 * 【关键边界】这是 API 纪律而非安全边界：动态包代码与接受其定义的 Host 进程同等
 *             可信；tool.view.cordis 槽位只接受 key:"self" 并绑定当前插件/包。
 * 【新手阅读建议】先读文件头英文注释理解"两座位"设计，再看 dynamicCordisContext
 *             的 get/属性访问分支，最后看 guardedSlots 的优先级与记账。
 * ==========================================================================
 */

/**
 * The browser twin of the tool-cordis context facade: a whitelist of
 * lifecycle-safe verbs plus optional `ctx.get()` lookup and declared-service
 * property access, with
 * framework internals withheld and Context-valued returns denied. Two seats
 * carry extra machinery: `slots`, where the register proxy assigns the
 * shadowing priority and ledgers the registration — invoking the service with
 * the traced receiver so the effect lands on the CALLING plugin's fiber
 * (SlotRegistry.register must stay a prototype method for exactly that
 * reason) — and `theme`, whose override source is pinned to the package id.
 *
 * This is API discipline, not a security boundary: a dynamic package's code is
 * as trusted as the host process that accepted its definition.
 */

import { Context } from '@deepseek-ai/cordis'
import type { DynamicCordisPackage } from '@deepseek-ai/dsh-api-remotes/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Facade verbs beyond declared services (host CTX_VERBS twin). */
// 门面允许的动词白名单（Host CTX_VERBS 的浏览器镜像）：事件/服务/定时器；
// TIMER_VERBS 是需要先声明注入 timer 服务的子集
const CTX_VERBS = new Set([
  'effect', 'on', 'once', 'provide', 'timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce',
])
const TIMER_VERBS = new Set(['timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce'])

/** One package's slot-registration ledger row (contribution projection source). */
/**
 * 一个包的槽位注册账目行：目标槽位与分配的遮蔽优先级（全局唯一，用于把胜出者
 * 匹配回所属包）。
 */
export interface DynamicCordisSlotLedgerRow {
  /** Target slot name. */
  slot: string
  /** The assigned shadowing priority (globally unique — how winners are matched back to packages). */
  priority: number | undefined
}

/** What the facade needs beyond the real ctx to govern one package. */
/**
 * 门面治理单个包所需的额外输入：分派到的包行、账目接收器、组件归属声明、
 * 优先级分配与守卫失败上报。
 */
export interface DynamicCordisGuardEnv {
  /** The dispatched Package row. */
  pkg: DynamicCordisPackage
  /** Ledger sink: every slot registration this package makes. */
  ledger: DynamicCordisSlotLedgerRow[]
  /**
   * Ownership index sink: the component object seated in a slot, so a later
   * render crash reported against the stored entry can be attributed back to
   * this package. Identity is the key — the registry stores the component
   * verbatim — which is why nothing else has to be remembered about the entry.
   * @param component - whatever the package passed as its component.
   */
  claim(component: unknown): void
  /** Allocate one page-local shadowing rank; later registrations sort first. */
  allocatePriority(): number
  /** Report one post-activation guard rejection to the owning Agent. */
  reportFailure(error: Error): void
}

/** Reject any service return that is a cordis Context (host guard twin). */
function denyContext(value: unknown, service: string, env: DynamicCordisGuardEnv): unknown {
  if (value instanceof Context) {
    return rejectGuard(env,
      `service "${service}" returned a cordis Context, which the dynamic facade does not expose. `
      + 'Operate through your own plugin ctx and the services you declared — never another context.',
    )
  }
  return value
}

/**
 * Forward service methods with the traced service as receiver — `this.ctx`
 * inside prototype methods (slots.register) must stay the CALLER's ctx so
 * effects land on the calling plugin's fiber — while denying Context returns.
 */
function guardedService(service: object, name: string, env: DynamicCordisGuardEnv): unknown {
  return new Proxy(service, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown
      if (typeof value !== 'function') return denyContext(value, name, env)
      return (...args: unknown[]): unknown => {
        const result = Reflect.apply(value, target, args) as unknown
        if (result instanceof Promise) return result.then(resolved => denyContext(resolved, name, env))
        return denyContext(result, name, env)
      }
    },
  })
}

/** Erased register options as this facade reads and rewrites them. */
interface ErasedSlotOptions {
  name?: string
  priority?: number
  [key: string]: unknown
}

/**
 * The slots seat: automatic shadowing priority and ledger recording around the
 * traced service's own register.
 */
function guardedSlots(slots: SlotRegistry, env: DynamicCordisGuardEnv): unknown {
  return new Proxy(slots, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown
      if (prop !== 'register') {
        if (typeof value !== 'function') return denyContext(value, 'slots', env)
        return (...args: unknown[]): unknown => denyContext(Reflect.apply(value, target, args), 'slots', env)
      }
      return (rawOptions: unknown, component: unknown): unknown => {
        if (typeof rawOptions !== 'object' || rawOptions === null) {
          return rejectGuard(env, 'slots.register(options, component) needs an options object with a `name`')
        }
        const options = { ...rawOptions as ErasedSlotOptions }
        const slot = options.name
        if (typeof slot !== 'string' || slot.length === 0) {
          return rejectGuard(env, 'slots.register options need a string `name` (the target slot key)')
        }
        if (slot === 'tool.view.cordis') {
          if (options.key !== 'self') {
            return rejectGuard(env, 'tool.view.cordis only accepts key "self"; the runtime binds it to this Package')
          }
          options.key = `${env.pkg.pluginId}.${env.pkg.packageId}`
        }
        // Shadowing kinds get a page-local rank. Later registrations sort first;
        // chain slots keep their own election (select order) untouched.
        const spec = (slots.spec as (key: string) => { kind?: string } | undefined)(slot)
        let priority = options.priority
        if (spec === undefined || spec.kind !== 'chain') {
          priority = env.allocatePriority()
          options.priority = priority
        }
        const register = Reflect.get(target, 'register', target) as unknown as (opts: object, comp: unknown) => () => void
        const dispose = register.call(target, options, component)
        env.ledger.push({ slot, priority })
        // After the registry accepted it: a rejected registration seats no entry,
        // so claiming one would index a component no crash can ever name.
        env.claim(component)
        return dispose
      }
    },
  })
}

/**
 * The theme seat: `overrideTokens`' source is FORCED to the package id — a
 * dynamic package can never impersonate (or evict) another source's layer, and
 * its own layers converge under one identity unload can reason about. The
 * layer's disposer is additionally hung on the calling fiber, because the
 * documented contract is "unload restores" and model code cannot be trusted to
 * keep the returned handle (slots parity — register hangs its own cleanup).
 * Everything else forwards through the generic guard.
 */
function guardedTheme(theme: ThemeRuntime, env: DynamicCordisGuardEnv, ctx: Context): unknown {
  return new Proxy(theme, {
    get(target, prop) {
      if (prop !== 'overrideTokens') {
        const value = Reflect.get(target, prop, target) as unknown
        if (typeof value !== 'function') return denyContext(value, 'theme', env)
        return (...args: unknown[]): unknown => {
          const result = Reflect.apply(value, target, args) as unknown
          if (result instanceof Promise) return result.then(resolved => denyContext(resolved, 'theme', env))
          return denyContext(result, 'theme', env)
        }
      }
      return (source: unknown, tokens: unknown): unknown => {
        // Two-argument shape preserved so the facade matches the documented
        // service signature; the source VALUE is replaced, never trusted.
        if (tokens === undefined && typeof source === 'object' && source !== null) {
          return rejectGuard(env,
            'theme.overrideTokens(source, tokens) takes two arguments; source is replaced with your package id, '
            + 'so pass any string first and the token map second: overrideTokens(\'mine\', { \'--dsw-alias-…\': { light: \'…\', dark: \'…\' } })',
          )
        }
        const method = Reflect.get(target, 'overrideTokens', target)
        const dispose = Reflect.apply(method, target, [`${env.pkg.pluginId}.${env.pkg.packageId}`, tokens]) as () => void
        // Fiber-owned lifetime; the returned handle stays valid for early
        // removal (the service disposer is idempotent per layer identity).
        ctx.effect(() => dispose, 'cordis-client-runner: dynamic theme override layer')
        return dispose
      }
    },
  })
}

/**
 * Build the facade one dynamic plugin's `apply` receives (host sandboxContext
 * twin, browser seats). `ctx.get(name)` performs optional lookup; direct
 * `ctx.serviceName` access is gated by the fiber's `inject` declaration.
 * @param ctx - the plugin's real fiber ctx (loader-created).
 * @param env - package row + ledger sink.
 * @returns the whitelisting proxy standing in for ctx.
 */
/**
 * 构造动态插件 apply 收到的门面 ctx（Host sandboxContext 的浏览器孪生）：
 * ctx.get 做可选查找；直接 ctx.serviceName 访问必须经过 fiber 的 inject 声明闸门；
 * slots/theme 两个座位走专用守卫。
 */
export function dynamicCordisContext(ctx: Context, env: DynamicCordisGuardEnv): Context {
  const declared = new Set(Object.keys(ctx.fiber.inject))
  const denyRead = (prop: string): never => {
    if (ctx.get(prop) !== undefined) {
      return rejectGuard(env,
        `service "${prop}" is not declared by your plugin. Declare it on the plugin you return: `
        + `{ inject: ['${prop}', …], apply(ctx) { … } } — a plain \`function\` has no declaration site, `
        + 'so use the object form. The runtime then parks the package if the provider unloads.',
      )
    }
    return rejectGuard(env,
      `dynamic ctx does not expose "${prop}". Available: ctx.on / ctx.provide / timer helpers after injecting timer, and any service your `
      + 'returned plugin declared in inject (slots and theme are the usual UI seats). Framework internals are withheld '
      + 'by design.',
    )
  }
  const readService = (name: string, requireDeclaration: boolean): unknown => {
    if (requireDeclaration && !declared.has(name)) return denyRead(name)
    const service = denyContext(ctx.get(name), name, env)
    if (service === null || (typeof service !== 'object' && typeof service !== 'function')) return service
    if (name === 'slots') return guardedSlots(service as SlotRegistry, env)
    if (name === 'theme') return guardedTheme(service as ThemeRuntime, env, ctx)
    return guardedService(service, name, env)
  }
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'get') return (name: string): unknown => readService(name, false)
      if (typeof prop !== 'string') return undefined
      // Lazy verb forwarder (host twin): resolve ctx[verb] only when called.
      if (CTX_VERBS.has(prop)) {
        return (...args: unknown[]): unknown => {
          if (TIMER_VERBS.has(prop) && !declared.has('timer')) return denyRead('timer')
          const method = ctx[prop as keyof Context]
          return Reflect.apply(method as (...a: unknown[]) => unknown, ctx, args)
        }
      }
      return readService(prop, true)
    },
    set(_target, prop) {
      return rejectGuard(env, `dynamic ctx is read-only; cannot assign "${String(prop)}"`)
    },
    has: (_target, prop) => prop === 'get'
      || (typeof prop === 'string'
        && ((CTX_VERBS.has(prop) && (!TIMER_VERBS.has(prop) || declared.has('timer'))) || declared.has(prop))),
  }) as unknown as Context
}

function rejectGuard(env: DynamicCordisGuardEnv, message: string): never {
  // 先上报守卫拒绝给 agent，再抛错给包代码
  const error = new Error(message)
  env.reportFailure(error)
  throw error
}
