/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */
/*
 * 文件职责：实现 dsh plugin 命令，调用 pnpm 管理配置依赖并同步 bundle 层清单。
 * 技术维度：使用同步子进程、包清单解析、路径规格重写和安装后状态对账。
 * 产品维度：用户可为单个配置安装、移除或升级插件，bundle 插件会自动加入启动层。
 * 逻辑维度：初始化配置，锚定相对路径，运行 pnpm，成功后扫描依赖并更新配置清单。
 * 关键边界：pnpm 必须可执行；模板 bundle 不由依赖对账删除；Windows 通过 shell 运行 cmd shim。
 * 新手阅读建议：先看 runPlugin 主流程，再分别阅读 anchorPathSpec 与 reconcilePlugins 两个辅助步骤。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './profile-boot.ts'

/** CLI 名称，用于读取清单和生成诊断。 */
const NAME = 'dsh'

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
/*
 * 判断已解析依赖是否在包清单中声明配置补丁。
 * @param packageName 依赖包名。
 * @param profileDir 作为模块解析锚点的配置目录。
 * @returns 包声明 dsh.bundle.patch 时为 true。
 * @example `exportsPatch('@scope/plugin', profileDir)`
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  /** 解析出的 bundle 包目录。 */
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
    // pnpm 虽成功但包仍不可解析时按普通依赖处理。
  }
  /** 目标依赖包的 package.json 清单。 */
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
/*
 * 按安装后的真实依赖状态同步配置的 bundle 层列表。
 * @param before pnpm 运行前的配置清单。
 * @param profileDir pnpm 已更新的配置目录。
 * @returns 无返回值；列表变化时写回清单。
 * @example `reconcilePlugins(before, profileDir)`
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  /** pnpm 操作完成后的配置清单。 */
  const after = readProfileManifest(NAME, profileDir)
  /** 操作前由依赖管理的包名集合。 */
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  /** 操作后的依赖包名，顺序用于追加新 bundle。 */
  const dependencies = Object.keys(after.dependencies ?? {})
  /** 当前配置声明的 bundle 启动层列表。 */
  const plugins = after.dsh?.profile?.bundles ?? []
  /** 是否需要把调整后的 bundle 列表写回清单。 */
  let changed = false
  for (const packageName of dependencies) {
    /** 当前依赖是否导出可用的配置补丁。 */
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  /** 操作后仍存在的依赖集合，用于识别移除或不再导出 bundle 的包。 */
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    // 只有依赖管理的条目可移除，模板自带的 dsh-base 等 bundle 不属于依赖。
    /** 该 bundle 是否曾经或当前由依赖列表管理。 */
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    /** 该包当前是否仍安装且继续声明 bundle。 */
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
/*
 * 将相对文件依赖规格改写为相对于用户调用目录的绝对规格。
 * @param argument 原始 pnpm 参数。
 * @param cwd 用户执行 dsh 时的目录。
 * @returns 已锚定的路径规格，非相对路径参数保持原样。
 * @example `anchorPathSpec('file:../plugin', cwd)`
 */
function anchorPathSpec(argument: string, cwd: string): string {
  /** 相对裸路径或 file/link 规格的匹配结果。 */
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  // 裸路径保持裸形式，file/link 前缀也保留，避免改变 pnpm 的链接或复制语义。
  /** 原规格的 file: 或 link: 前缀；裸路径为空字符串。 */
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
/*
 * 执行一次插件管理：必要时初始化配置，转发 pnpm，然后同步 bundle 列表。
 * @param profile 目标配置名称。
 * @param args 要传给 pnpm 的参数。
 * @returns pnpm 退出码；找不到 pnpm 时返回 127。
 * @example `runPlugin('web', ['add', '@scope/plugin'])`
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  /** 目标配置的绝对目录。 */
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  /** pnpm 修改依赖前的配置清单，用于对账。 */
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  // Windows 的 pnpm 由 .cmd 包装，子进程加固后必须通过 shell 才能执行。
  /** 同步 pnpm 子进程的执行结果。 */
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    /** 子进程启动错误的系统错误码。 */
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  /** pnpm 的退出状态；意外缺失时按一般失败处理。 */
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    // 补充配置目录，帮助用户定位 pnpm 工作区诊断及 git 依赖构建许可。
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
  }
  return exitCode
}
