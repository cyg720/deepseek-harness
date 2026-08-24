/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, keep the profile patch layer
 * live, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */
/**
 * 文件职责：组合配置补丁、启动完整 Cordis 应用树，并接通信号、热重载和有界退出。
 * 技术维度：使用补丁层组合、Cordis Loader/HMR、环境快照、AbortController 与进程信号。
 * 产品维度：所有 dsh 运行形态都能按相同规则加载用户配置、应用参数并安全响应配置变更。
 * 逻辑维度：准备配置目录，组合 bundle/用户/覆盖层，启动应用，随后安装双用户补丁监听。
 * 关键边界：补丁对象会被 Loader 原地修改，复用前必须克隆；信号可能在启动任意阶段到达。
 * 新手阅读建议：先读 composeProfile 的层级顺序，再沿 runProfile 的启动、服务提供和监听流程阅读。
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
/** 随应用发布的代理预设根目录，源码和构建布局均可用。 */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

/** CLI 名称，用于加载配置并生成统一诊断。 */
const NAME = 'dsh'

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
/**
 * 解析对所有配置生效的主目录用户补丁路径。
 * @returns 当前 DSH_HOME 下补丁文件的绝对路径。
 * @example `homePatchPath()`
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
/** 当前 dsh 安装的 package.json 绝对路径，源码与构建目录采用同一相对层级。 */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
/** 遥测禁用开关要定位的配置行编号。 */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
/** 每个配置补丁树应用到的空根配置文本。 */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
/** 配置目录中供 Loader 锚定基础路径的根配置文件名。 */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
/**
 * 将遥测环境开关解析为禁用指定配置行的补丁。
 * @param disabledEnv DSH_TELEMETRY_DISABLED 原始值。
 * @param hasRow 当前组合是否包含遥测行。
 * @returns 需要禁用时返回补丁，否则返回 undefined。
 * @example `resolveTelemetryPatch('1', true)`
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name`: heal the shared module fallback, then
 * (re)write the empty root config. The root is always rewritten: the whole
 * composition is patch layers, and the vendored Loader's tree write-back (a
 * plugin self-disposing persists the current tree) can bake composed rows
 * into this file — which would duplicate every bundle insert on the next
 * boot. The file exists on disk only because the Loader needs a real include
 * root to anchor `baseUrl` at the profile directory (the config dump anchors
 * on the same file, so both compose over the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
/**
 * 加载指定配置并重写空根文件，避免 Loader 回写污染下一次组合。
 * @param name 配置名称。
 * @param userLayer 是否解析配置自身的用户补丁。
 * @returns 已解析目录、层和补丁的配置对象。
 * @example `prepareProfile('web')`
 */
export function prepareProfile(name: string, userLayer = true): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  /** 从模板和用户层加载出的配置对象。 */
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers (application order) and the row index of its pre-flag composition. */
/** 一个配置按应用顺序拆分的补丁层及其启动器可查询行索引。 */
interface ComposedProfile {
  /** 已加载的配置元数据与用户补丁。 */
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  /** 位于用户层下方、按声明顺序拼接的 bundle 补丁。 */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  /** 应用在配置用户层之后的主目录级用户补丁。 */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  /** 位于用户层之上的命令行覆盖和遥测开关。 */
  overlays: PatchOptions[]
  /**
   * id → row of the composed tree (bundles + user layers + overlays), for the
   * launcher's own row checks.
   */
  /** 组合树中配置行编号到行内容的只读索引。 */
  rows: ReadonlyMap<string, EntryOptions>
}

/** The full patch stack of one composed profile, in application order. */
/**
 * 按最终应用顺序展开一个已组合配置的全部补丁。
 * @param composed 已拆分各层的配置。
 * @returns bundle、配置用户层、主目录用户层和覆盖层组成的新数组。
 * @example `allPatches(composed)`
 */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (the base bundle gates the shell stacks by
 * platform on its own rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then the telemetry switch.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @returns the profile, its patch layers, and the composed row index.
 */
/**
 * 加载配置并组合 bundle、两级用户层、命令行覆盖和遥测开关。
 * @param name 配置名称。
 * @param patchFiles 命令行补丁路径，保持 argv 顺序。
 * @returns 可供启动和热重载使用的分层组合结果。
 * @example `composeProfile('web', ['./extra.yml'])`
 */
function composeProfile(
  name: string,
  patchFiles: readonly string[],
): ComposedProfile {
  /** 已准备空根文件的目标配置。 */
  const profile = prepareProfile(name)
  /** 对所有配置生效的主目录用户补丁。 */
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  /** 命令行提供并按当前目录解析的覆盖补丁。 */
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  /** 按配置层顺序展开的所有 bundle 补丁。 */
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  /** 启动器检查特殊配置行时使用的编号索引。 */
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  /** 可继续追加应用内置预设根和遥测开关的覆盖层副本。 */
  const composedOverlays = [...overlays]
  // The SHIPPED root is the part of the roster only this app can resolve: it
  // sits beside this app's own config, in both the source and built layouts.
  // The writable root the roster appends is `dsh-agent-presets`' own, so a
  // launcher that never reaches this patch still finds a person's presets.
  // 发布预设根由 CLI 解析，用户可写根由预设插件自身提供，两者共同组成完整目录。
  if (rows.has('agent-presets')) {
    composedOverlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  /** 环境变量要求且组合中存在遥测行时生成的强制禁用补丁。 */
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return { profile, bundlePatches, homePatches, overlays: composedOverlays, rows }
}

/** Options for {@link runProfile}. */
/** 启动一个配置所需的环境、配置名、覆盖层和应用参数。 */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  /** 在任何配置行挂载前提供的冻结启动环境快照。 */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  /** 要启动的配置名称。 */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  /** 按命令行顺序应用的额外补丁路径。 */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  /** 通过 cmdlineArgs 服务交给应用插件的内部参数。 */
  args: readonly string[]
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree:
 * a signal aborted this invocation, or an app requested exit (`ctx.appExit`
 * from a fast one-shot) and the root's disposal rejected the in-flight setup
 * await. Either way the failure describes a tree that is exiting as asked,
 * not a broken watch.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
/**
 * 仅在应用仍活跃时重新抛出监听安装错误，正常关闭中的失败则忽略。
 * @param ctx 已启动的根上下文。
 * @param signal 当前调用的信号关闭状态。
 * @param error 监听安装期间捕获的错误。
 * @returns 无返回值；活动应用的真实错误会抛出。
 * @example `suppressShutdownError(ctx, controller.signal, error)`
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
/**
 * 端到端启动一个配置，并返回根上下文与统一关闭控制器。
 * @param options 环境快照、配置名称、覆盖路径和应用参数。
 * @returns 已完成启动的上下文及进程关闭控制器。
 * @example `await runProfile({ environment, profile: 'web', patchFiles: [], args: [] })`
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  /** 启动前解析出的完整配置层。 */
  const composed = composeProfile(options.profile, options.patchFiles)
  /** 启动期间可被信号处理器读取的当前应用上下文持有器。 */
  const app: { current?: Context } = {}
  /** 围绕根 Fiber 释放建立的有界关闭控制器。 */
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  /** 记录本次启动是否已由进程信号请求关闭。 */
  const signalShutdown = new AbortController()
  /** 接收信号退出码并同时标记中止和启动关闭。 */
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted provider can publish before sibling rows finish mounting.
  // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
  // surface — the launcher does not know whether the app considered its work
  // complete; SIGINT is a user interrupt and reports 130.
  // 信号处理覆盖整个启动窗口；SIGTERM 视为正常停止，SIGINT 按用户中断返回 130。
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  /** 配置目录中的空根文件，Loader 用它解析相对模块。 */
  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays
  // above, so a user edit can never displace them. Parsed app arguments are
  // not in here at all — they live in app-provided services that survive a
  // recomposition. BOTH
  // user files are re-read per generation (the HMR watcher hands us only the
  // changed file's patches, which one of the reads duplicates — fresh reads
  // keep the two watchers from stitching in each other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  // 每次重组都重新读取并克隆两级用户层，避免 Loader 的原地修改污染下一代补丁。
  /** 为每次热重载重新读取用户层并深克隆完整补丁栈。 */
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  // 初次启动同样克隆补丁，避免影响后续热重载的源对象。
  /** 完成所有配置行挂载后的根 Cordis 上下文。 */
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve all launch-time
    // environment values from the same immutable provenance snapshot.
    // 在配置行挂载前提供同一份不可变环境来源快照。
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // The command line and bounded exit request are launcher facts available
    // to every app plugin that injects the argument snapshot.
    // 命令行参数和有界退出请求作为启动器事实提供给所有应用插件。
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
    })
  })
  app.current = ctx
  // A surface can dispose the whole tree while boot or this post-boot watcher
  // setup is still in flight — a signal, or a fast one-shot's appExit. Loader
  // presence and fiber state own liveness; the initial check skips a tree
  // that already exited, and the catch below re-checks for an exit that
  // landed mid-setup. Watching is unconditional: a one-shot surface exits
  // through its bounded shutdown, which disposes the watchers before the
  // loop drains.
  // 只有 Loader 与 Fiber 仍有效时安装监听；快速应用退出会通过有界关闭释放监听器。
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live profile patch layer: the web bundle
      // disables the shared module-reload `hmr` row (its reload lifecycle is
      // untested), so when the composition leaves no HMR service, mount a
      // watch-only instance with no module roots — cordis.patch.yml edits stay
      // live on every long-lived surface. A silent skip would break the
      // documented hot-reload contract. HMR injects the timer service, which a
      // bare custom profile may not mount either.
      // 缺少 HMR 时安装仅监听配置的实例，必要时先补 timer 服务，保证用户补丁始终可热更新。
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  return { ctx, shutdown }
}
