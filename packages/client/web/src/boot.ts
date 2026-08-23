/**
 * ================================ 文件注释 ================================
 * 【文件职责】web 启动内核：只拥有模块系统、Cordis loader 与一个无框架
 *   启动页；动态 UI 渲染器在所有客户端条目激活后收到挂载点。
 * 【技术维度】模块系统在 Cordis 前构建（bootstrap 例外）；AppWebEntry
 *   编排：创建模块系统 -> 预取一阶段 -> 挂 Loader -> 创建全部图条目 ->
 *   等待静默 -> 审计激活 -> 挂载应用。
 * 【产品维度】浏览器启动的唯一入口：插件失败保持可见于启动页，应用
 *   挂载后内核任务完成。
 * 【逻辑维度】run 为主流程；dispose 拆树；mountApp 经依赖 fiber 挂载
 *   （替换 uiRenderer 会重挂）；prefetchImmediateTier 预取一阶段；
 *   runPluginBoot 挂 Loader 并创建条目；assertEntriesActive 审计激活。
 * 【关键边界】传输钩子（__DSH_TRANSPORT__）拥有 bundle 字节时跳过 HTTP
 *   预取；未激活条目（导入失败/等待缺失服务）整体抛错。
 * 【新手阅读建议】先读 modules 包理解模块系统，再看 run 的编排顺序。
 * ==========================================================================
 */
/**
 * Web boot kernel. It owns only the module system, Cordis loader, and a
 * framework-free boot page. The dynamic UI renderer receives the mount
 * point after every client entry activates.
 * @module @deepseek-ai/dsh-client-web/src/boot
 */
/**
 * web 启动内核。它只拥有模块系统、Cordis loader 与一个无框架启动页。
 * 动态 UI 渲染器在所有客户端条目激活后收到挂载点。
 * @module @deepseek-ai/dsh-client-web/src/boot
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {
  BootManifest, ClientModuleCreateOptions, ClientModuleSystem, DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BootPage } from './boot-page.ts'
import { getStaticModules } from './seed.ts'
import { STATE_LABELS } from './loader-status.ts'
import './base.css'

/** Module transport hook replaced by jsdom tests. */
/** 模块传输钩子（jsdom 测试可替换）。 */
export type BootSeams = Pick<ClientModuleCreateOptions, 'loadBundle'>

/** Browser boot entry consumed by `apps/web`. */
/** 由 apps/web 消费的浏览器启动入口。 */
export class AppWebEntry {
  private readonly container: HTMLElement // 应用挂载点
  private readonly seams: BootSeams | undefined // 测试可替换的传输缝
  private readonly page: BootPage // 无框架启动页
  private ctx: Context | undefined // 根 Cordis 上下文（dispose 时拆除）
  private modules!: ClientModuleSystem // 模块系统（run 时构建）
  private manifest!: BootManifest // 解析后的启动图（run 时填充）

  /**
   * Draw the boot page; {@link run} starts the loader.
   * @param container - Application mount point.
   * @param seams - Optional module transport replacement.
   */
  /**
   * 绘制启动页；run 启动 loader。
   * @param container 应用挂载点。
   * @param seams 可选的模块传输替换。
   */
  constructor(container: HTMLElement, seams?: BootSeams) {
    this.container = container
    this.seams = seams
    this.page = new BootPage(container)
  }

  /**
   * Load and activate every client entry, then hand the mount point to the
   * UI renderer. Plugin failures remain visible on the boot page.
   * @returns Resolves after application mount or failure rendering.
   */
  /**
   * 加载并激活每个客户端条目，然后把挂载点交给 UI 渲染器。插件失败保持
   * 在启动页可见。
   * @returns 应用挂载或失败渲染后解析。
   */
  async run(): Promise<void> {
    try {
      const win = globalThis as DshWindow
      const moduleLoader = win.__ModuleLoader__
      if (moduleLoader === undefined) {
        throw new Error('web boot: window.__ModuleLoader__ bootstrap facade is missing')
      }
      // A pre-injected transport (the worker preview page) owns bundle bytes;
      // its loadBundle is the default and explicit seams still win. The global
      // is `ClientTransportHooks`, owned by @deepseek-ai/dsh-client-connection;
      // this structural slice reads one optional member without adding a
      // package edge.
      // 预注入的传输（worker 预览页）拥有 bundle 字节；其 loadBundle 是默认，
      // 显式 seams 仍优先。该全局是 dsh-client-connection 拥有的
      // ClientTransportHooks；此结构化切片只读一个可选成员，不增加包边。
      const transport = (globalThis as {
        __DSH_TRANSPORT__?: { loadBundle?: ClientModuleCreateOptions['loadBundle'] }
      }).__DSH_TRANSPORT__
      this.modules = moduleLoader.create({
        boot: win.__DSH_BOOT__,
        staticModules: getStaticModules(),
        ...transport?.loadBundle === undefined ? {} : { loadBundle: transport.loadBundle },
        ...this.seams,
      })
      this.manifest = this.modules.manifest

      const prefetching = this.prefetchImmediateTier()
      const ctx = new Context()
      this.ctx = ctx
      await this.runPluginBoot(ctx, prefetching)
      await this.mountApp(ctx)
    } catch (reason) {
      console.error(reason)
      this.page.fail(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /** Dispose the client plugin tree and whichever page owns the mount point. */
  /** 拆除客户端插件树与拥有挂载点的页面。 */
  async dispose(): Promise<void> {
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx !== undefined) await ctx.fiber.dispose()
    this.page.dispose()
  }

  /** Mount through a dependency fiber so replacing uiRenderer remounts the application. */
  /** 经依赖 fiber 挂载，使替换 uiRenderer 会重挂应用。 */
  private async mountApp(ctx: Context): Promise<void> {
    const mounted = ctx.inject(['uiRenderer'], (scope) => {
      scope.effect(() => scope.uiRenderer.mount(this.container), 'web boot: application mount')
    })
    await mounted
  }

  /** Prefetch stage-one bundles; their import path owns any eventual failure. */
  /** 预取一阶段 bundle；其导入路径承担任何最终失败。 */
  private async prefetchImmediateTier(): Promise<void> {
    // A transport carrying loadBundle owns the bundle bytes; HTTP prefetch
    // against its static deployment answers nothing. A transport without
    // loadBundle leaves bundles on HTTP, prefetch included.
    // 携带 loadBundle 的传输拥有 bundle 字节；对其静态部署的 HTTP 预取
    // 什么都答不到。无 loadBundle 的传输让 bundle 留在 HTTP，预取也包括在内。
    const transport = (globalThis as {
      __DSH_TRANSPORT__?: { loadBundle?: unknown }
    }).__DSH_TRANSPORT__
    if (transport?.loadBundle !== undefined) return
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch((_prefetchError: unknown) => {
        // Prefetch only starts transport early; the Loader import retries and reports this bundle failure.
        // 预取只是提前启动传输；Loader 导入会重试并报告该 bundle 失败。
      })))
  }

  /** Mount the Loader, create all graph entries, await quiescence, and audit activation. */
  /** 挂载 Loader、创建全部图条目、等待静默并审计激活。 */
  private async runPluginBoot(ctx: Context, prefetching: Promise<void>): Promise<void> {
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.internal = this.modules as never

    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.page.setState(entry.options.name, STATE_LABELS[entry.fiber.state])
    })

    const rows = this.manifest.plugins.map(row => row.id)
    this.page.setTotal(rows.length)
    await prefetching
    await Promise.all(rows.map(async (name) => {
      this.page.setState(name, 'loading')
      const id = await loader.create({ name })
      if (loader.resolve(id).fiber === undefined) this.page.setState(name, 'failed')
    }))

    await loader.await()
    this.assertEntriesActive(ctx)
  }

  /** Reject entries that failed import/apply or still wait on missing services. */
  /** 拒绝导入/apply 失败或仍在等待缺失服务的条目。 */
  private assertEntriesActive(ctx: Context): void {
    const failures: string[] = []
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      if (entry.fiber === undefined) {
        failures.push(`${name}: import failed (see console for the import error)`)
        continue
      }
      const state = STATE_LABELS[entry.fiber.state]
      if (state === 'active') continue
      if (state === 'pending') {
        const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
        failures.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
      } else {
        failures.push(`${name}: ${state}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(`web boot: ${String(failures.length)} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${failures.join('\n')}`)
    }
  }
}
