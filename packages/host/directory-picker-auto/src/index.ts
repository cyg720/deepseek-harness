/**
 * Adaptive chooser of the directory-picker seam: resolves the host's
 * situation once at boot (bind host, SSH launch, display session, Linux
 * chooser binary) and mounts the matching interaction — `native` or `browse`
 * — as real Loader entries in the in-memory root tree. Each interaction is a
 * pair: the Host backend serving the seam capability and the client surface
 * occupying ui-workspace's directory-flow holes. Both arrive as ordinary
 * entries, so the surface is discovered exactly as a config-row's would be
 * and one resolved choice still swaps both faces; pinning an interaction
 * remains composing that pair directly instead of this row.
 * @module @deepseek-ai/dsh-host-directory-picker-auto
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】directory-picker 接缝的自适应选择器：启动时一次性解析宿主的处境
 * （绑定主机、SSH 启动、显示会话、Linux 选择器二进制）并挂载匹配的交互——
 * native 或 browse——作为真实 Loader 条目进入内存根树。
 * 【技术维度】Cordis 插件：依赖 webServer（读有效绑定主机）与 loader（挂载条
 * 目）；每个交互是"后端 + 客户端表面"一对（后端承载接缝能力，表面占据
 * ui-workspace 的目录流空洞），两者都作为普通条目被发现与组合。
 * 【产品维度】一次决定两副面孔：有本地显示器与原生选择器的环境用系统对话框，
 * 远程/无头环境自动退化为应用内目录浏览器——无论哪种，固定一个交互就是直接
 * 组合那对包，而非本行。
 * 【逻辑维度】探针（probe.ts）→ 解析（resolve.ts）→ apply：解析后端种类 →
 * 以"后端先、表面后"顺序创建两个 Loader 条目 → 失败回滚 → 返回卸载器。
 * 【关键边界】只做根树内存挂载（write() 是 no-op，绝不持久化回配置文件）；
 * 卸载按逆序移除条目并等待其 fiber 静止；本包是"固定组合词汇"而非可调项——
 * 后端/表面包名是运行时字符串，静态配置门看不到 yml 行，verify-cordis-config
 * 要求组合本选择器的每个应用把两者声明为依赖。
 * 【新手阅读建议】先读 probe.ts 与 resolve.ts 两个纯决策模块，再读 apply 的
 * 挂载/卸载流程，最后看 BACKEND_PACKAGES/SURFACE_PACKAGES 的固定词汇。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type imports carry the `loader` and `webServer` Context merges for the reads below.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { canExecute, hasLinuxChooserBinary } from './probe.ts'
import type { DirectoryPickerBackendKind } from './resolve.ts'
import { resolveDirectoryPickerBackend } from './resolve.ts'

export { canExecute, hasLinuxChooserBinary } from './probe.ts'
export type { DirectoryPickerBackendKind, DirectoryPickerEnv, DirectoryPickerHostFacts } from './resolve.ts'
export { resolveDirectoryPickerBackend } from './resolve.ts'

/** Cordis plugin name. */
export const name = 'directory-picker-auto'
/** Required services: the effective bind host (`webServer`) and the entry tree the backend mounts into (`loader`). */
export const inject = ['webServer', 'loader']

/**
 * Host backend package per resolved kind — fixed composition vocabulary, not a
 * tunable. Exported because the reference is a runtime string the static
 * config gate cannot see in a yml row: `verify-cordis-config` requires every
 * app composing this chooser to declare both values as dependencies.
 */
export const BACKEND_PACKAGES: Record<DirectoryPickerBackendKind, string> = {
  native: '@deepseek-ai/dsh-host-directory-picker-native',
  browse: '@deepseek-ai/dsh-host-directory-picker-browse',
}

/**
 * Client surface package per resolved kind, mounted with its backend so one
 * resolved interaction still composes both faces. Declared as dependencies by
 * every composing app for the same reason as {@link BACKEND_PACKAGES}. Only the
 * specifier is referenced here because the packages belong to the Client
 * program, so no import of them exists on this side.
 */
export const SURFACE_PACKAGES: Record<DirectoryPickerBackendKind, string> = {
  native: '@deepseek-ai/dsh-client-ui-directory-picker-native',
  browse: '@deepseek-ai/dsh-client-ui-directory-picker-browse',
}

/**
 * Resolve the interaction from one boot-time sample and mount its backend and
 * surface as Loader entries; the effect's disposer removes both entries and
 * joins their fibers' teardown, so unloading this plugin returns only after
 * both faces of the mounted interaction (and their dependents) quiesced.
 * @param ctx - cordis context carrying the injected `webServer` and `loader`.
 */
export async function apply(ctx: Context): Promise<void> {
  const backend = resolveDirectoryPickerBackend({
    bindHost: ctx.webServer.host,
    platform: process.platform,
    env: process.env,
    linuxChooser: hasLinuxChooserBinary(process.env.PATH, canExecute),
  })
  await ctx.effect(async () => {
    // Root-tree create: the Loader root is in-memory (write() is a no-op), so
    // the mounted rows can never be persisted back into a config file. The
    // backend lands first: the surface's browser half drives the capability
    // the backend registers.
    const ids: string[] = []
    const unmount = async () => {
      for (const id of [...ids].reverse()) {
        // Tree teardown (group.stop) can have removed the entry already;
        // nothing is left to unmount or await then.
        if (ctx.loader.store[id] === undefined) continue
        // remove() disposes the entry transactionally, so the chooser's unload
        // signals completion only after that face quiesced.
        await ctx.loader.remove(id)
      }
    }
    try {
      for (const name of [BACKEND_PACKAGES[backend], SURFACE_PACKAGES[backend]]) {
        ids.push(await ctx.loader.create({ name }))
      }
    } catch (cause) {
      // Setup owns the entries it created until it returns the disposer: leaving
      // the backend mounted would make a retry collide with its own
      // directoryPicker registration.
      await unmount()
      throw cause
    }
    return unmount
  }, 'directory-picker-auto: interaction entries')
}
