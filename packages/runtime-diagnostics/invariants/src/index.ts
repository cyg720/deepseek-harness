/**
 * Configurable registry for package-owned runtime invariant contributions.
 * Every workspace package registers checks from a `./invariant` companion;
 * ordinary package entrypoints stay independent of diagnostics.
 *
 * @module @deepseek-ai/dsh-invariants
 */
/*
 * 文件职责：实现 index.ts 承担的运行时不变量诊断配置、注册与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验和系统资源管理。
 * 产品维度：为 Agent 提供可靠的运行时不变量诊断能力。
 * 逻辑维度：解析配置，注册能力，执行核心操作，并在卸载时等待资源停止。
 * 关键边界：安全配置应尽早失败；不得泄露环境凭据；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型与配置，再读主流程，最后关注平台限制和清理。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Inject } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

/** Runtime invariant selection configured on the service plugin. */
/* 中文说明：interface Config 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
export interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}

/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
/* 中文说明：type InvariantFailure 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
export type InvariantFailure = (message: string) => never

/** Install one package's checks into the registration's child context. */
/* 中文说明：interface InvariantInstaller 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
export interface InvariantInstaller {
  /**
   * Install the package contribution.
   * @param ctx - child context owned by this invariant registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (ctx: Context, fail: InvariantFailure): void | Promise<void>
  /** Services the child installer fiber may access. */
  readonly inject?: Inject
}

/** Internal effect shape used to join child startup before a companion loads. */
/* 中文说明：interface PendingInvariantRegistration 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
interface PendingInvariantRegistration extends PromiseLike<() => void> {
  (): void | Promise<void>
}

/** Thrown when a package-owned runtime invariant is violated. */
/* 中文说明：class InvariantError 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
export class InvariantError extends Error {
  /** Stable machine-readable invariant failure code. */
  readonly code = 'INVARIANT' as const
  /** Full npm package name that owns the violated invariant. */
  readonly packageName: string

  /**
   * Construct a package-attributed invariant failure.
   * @param packageName - full npm package name that registered the check.
   * @param message - violated contract, without the standard error prefix.
   */
  constructor(packageName: string, message: string) {
    super(`invariant violated by "${packageName}": ${message}`)
    this.name = 'InvariantError'
    this.packageName = packageName
  }
}

declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Context 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
  interface Context {
    invariants: InvariantRegistry
  }
}

/** Compile and validate one package-filter list. */
/* 中文说明：函数 compilePatterns 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function compilePatterns(field: 'package_allowlist' | 'package_blocklist', values: readonly string[]): RegExp[] {
  /** 中文说明：变量 seen 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Set<string>()
  return values.map((value) => {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`invariants: ${field} entries must be non-blank and have no surrounding whitespace`)
    }
    if (seen.has(value)) {
      throw new Error(`invariants: ${field} contains duplicate regex ${JSON.stringify(value)}`)
    }
    seen.add(value)
    try {
      return new RegExp(value)
    } catch (cause) {
      throw new Error(`invariants: ${field} contains invalid regex ${JSON.stringify(value)}`, { cause })
    }
  })
}

/** Package-owned invariant registry with global and regex-based selection. */
/* 中文说明：class InvariantRegistry 定义本模块所需的数据或行为，用于表达运行时不变量诊断场景。 */
export class InvariantRegistry extends Service {
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(true),
    package_allowlist: z.array(z.string()).default([]),
    package_blocklist: z.array(z.string()).default([]),
  })

  private readonly enabled: boolean
  private readonly ownerCtx: Context
  private readonly packageAllowlist: readonly RegExp[]
  private readonly packageBlocklist: readonly RegExp[]
  private readonly registrations = new Set<string>()

  /**
   * Create and install the invariant registry.
   * @param ctx - Cordis context that owns the service.
   * @param config - global enablement and package-name regex filters.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'invariants')
    this.ownerCtx = ctx
    this.enabled = config.enabled ?? true
    this.packageAllowlist = compilePatterns('package_allowlist', config.package_allowlist ?? [])
    this.packageBlocklist = compilePatterns('package_blocklist', config.package_blocklist ?? [])
  }

  /** Return whether one full package name passes the configured filters. */
  private selected(packageName: string): boolean {
    if (!this.enabled) return false
    if (this.packageAllowlist.length > 0
      && !this.packageAllowlist.some(pattern => pattern.test(packageName))) return false
    return !this.packageBlocklist.some(pattern => pattern.test(packageName))
  }

  /**
   * Register one package's invariant installer. The package name is reserved
   * even when filtering disables its checks. Enabled installers run in a child
   * fiber; failure disposes that fiber and releases the reservation.
   * @param packageName - full npm package name that owns the contribution.
   * @param installer - listener or startup-check installer for the child context.
   * @returns an effect-scoped disposer for the registration.
   */
  register(packageName: string, installer: InvariantInstaller): () => void {
    if (packageName.length === 0 || packageName.trim() !== packageName || /\s/.test(packageName)) {
      throw new Error('invariants: packageName must be non-blank and contain no whitespace')
    }
    if (this.registrations.has(packageName)) {
      throw new Error(`invariants: package "${packageName}" is already registered`)
    }

    // Service method tracing binds `this.ctx` to the caller. This explicit
    // origin keeps registrations and their child fibers owned by the service;
    // companion disposal is covered independently by the returned disposer.
    /** 中文说明：变量 ctx 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = this.ownerCtx
    /** 中文说明：变量 registrations 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registrations = this.registrations
    registrations.add(packageName)

    /** 中文说明：变量 registration 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let registration: PendingInvariantRegistration
    try {
      registration = ctx.effect(async () => {
        if (!this.selected(packageName)) {
          return () => {
            registrations.delete(packageName)
          }
        }

        /** 中文说明：函数值 installInvariant 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
        const installInvariant = (childCtx: Context) => (
          installer(childCtx, (message): never => {
            throw new InvariantError(packageName, message)
          })
        )
        try {
          /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const child = ctx.plugin(installer.inject === undefined
            ? installInvariant
            : Object.assign(installInvariant, { inject: installer.inject }))

          try {
            await child
          } catch (error) {
            await child.dispose()
            throw error
          }

          return async () => {
            try {
              await child.dispose()
            } finally {
              registrations.delete(packageName)
            }
          }
        } catch (error) {
          registrations.delete(packageName)
          throw error
        }
      }, `invariants.register(${JSON.stringify(packageName)})`)
    } catch (error) {
      registrations.delete(packageName)
      throw error
    }
    // Cordis attaches setup thenability and async teardown to this callable;
    // the service contract intentionally exposes only the conventional disposer.
    // oxlint-disable-next-line typescript/no-misused-promises -- the extra runtime shape stays private.
    return registration
  }
}

export default InvariantRegistry
