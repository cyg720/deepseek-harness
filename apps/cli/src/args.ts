/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
 * and `dsh --profile web -h` prints the web app's help, not this one's.
 *
 * `web` is a hardcoded alias for `--profile web`; `plugin` manages a profile's
 * plugin dependencies by forwarding to pnpm.
 * @module @deepseek-ai/dsh/args
 */
/*
 * 文件职责：解析 dsh 启动器自身参数，并把剩余参数原样交给所选应用或 pnpm。
 * 技术维度：使用 Commander 构建命令、别名和子命令，并以判别联合表达解析结果。
 * 产品维度：用户可启动指定配置、查看组合配置或管理插件，同时让各应用拥有自己的参数空间。
 * 逻辑维度：定义调用类型，解析启动/导出选项，注册根命令、web 别名和 plugin 子命令。
 * 关键边界：启动器参数必须位于首个未知参数之前；帮助、版本和错误会直接结束进程。
 * 新手阅读建议：先看 DshInvocation 三种结果，再读 resolveBoot，最后跟随 Commander action 分支。
 */

import { Command, CommanderError } from 'commander'

/** Boot a named profile and hand it the invocation's inner arguments. */
/* 启动指定配置并把内部参数交给应用的调用结果。 */
interface ProfileInvocation {
  /** 判别字段，表示执行配置启动。 */
  mode: 'profile'
  /** 要启动的配置名称。 */
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  /* 按命令行顺序追加在配置层之后的补丁文件。 */
  patches: string[]
  /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
  /* 启动器参数之后原样交给应用插件的参数。 */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
/* 输出组合后的配置树但不启动应用的调用结果。 */
interface DumpConfigInvocation {
  /** 判别字段，表示执行配置导出。 */
  mode: 'dump-config'
  /** 要组合并输出的配置名称。 */
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  /* 为 true 时仅输出内置 bundle 层，不加载用户层与额外补丁。 */
  defaultOnly: boolean
  /** 普通配置导出时按顺序应用的额外补丁。 */
  patches: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
/* 在配置目录中把参数转发给 pnpm 的插件管理调用结果。 */
interface PluginInvocation {
  /** 判别字段，表示执行插件管理。 */
  mode: 'plugin'
  /** 要管理插件的配置名称。 */
  profile: string
  /** Raw pnpm arguments, verbatim. */
  /* 原样传递给 pnpm 的参数。 */
  args: string[]
}

/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
/* dsh 可执行的三种解析结果；帮助、版本和错误不会作为结果返回。 */
export type DshInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation

/** Launcher flags shared by the default command and the `web` alias. */
/* 根启动命令和 web 别名共享的启动器选项。 */
interface BootOptions {
  /** 可重复提供的额外补丁路径。 */
  patch?: string[]
  /** 是否输出包含用户层的完整配置。 */
  dumpConfig?: boolean
  /** 是否仅输出默认 bundle 配置。 */
  dumpDefaultConfig?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
/*
 * 收集一个可重复出现的 --patch 值，不吞掉后续应用参数。
 * @param value 本次出现的补丁路径。
 * @param previous 已收集的补丁路径。
 * @returns 追加当前路径后的新数组。
 * @example `collect('b.yml', ['a.yml'])`
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The launcher's own help text; each app prints its own. */
/* 启动器自己的帮助示例；具体应用另行输出自身选项。 */
const HELP_EXAMPLES = `
Examples:
  dsh --profile web                          boot the web profile (same as: dsh web)
  dsh --profile headless "run the tests"     answer one task, print the result, and exit
  dsh --profile tui --patch ./extra.yml      boot a custom profile with one extra overlay
  dsh --profile tui --resume <session>       arguments after the launcher flags reach the app
  dsh --profile web --help                   the web app's own flags and help
  dsh plugin --profile tui add <package>     install a plugin into the tui profile
`

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
/*
 * 根据已解析的启动选项和剩余参数生成启动或配置导出调用。
 * @param program 负责报告参数错误的 Commander 命令。
 * @param profile 目标配置名称。
 * @param options 启动器已收集的选项。
 * @param args 原样保留的应用参数。
 * @returns 配置启动或配置导出调用。
 * @example `resolveBoot(program, 'web', {}, [])`
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  /** 未提供 --patch 时使用的空补丁列表。 */
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  // 配置导出不会启动应用参数提供方，因此不能接受会改变真实启动结果的应用参数。
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  /** 是否只输出配置自带的 bundle 层。 */
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
/*
 * 把 argv 解析成一种 dsh 调用；帮助、版本或错误会通过进程退出处理。
 * @param argv Node 可执行文件与脚本路径之后的参数。
 * @param version --version 输出的版本字符串。
 * @returns 可交给启动器执行的判别联合。
 * @example `parseDshArgs(['--profile', 'web'], '1.0.0')`
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  /** Commander action 最终写入的解析结果。 */
  let resolved: DshInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  // 显式类型避免 action 回调引用 program 时产生自引用类型推断。
  /** dsh 根命令及其子命令的 Commander 实例。 */
  const program: Command = new Command()
  program
    .name('dsh')
    .version(version, '-V, --version', 'output the version number')
    .description('dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch layers under your own overrides.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. `dsh -h` with no profile still prints this help, below.
    // 首个未知选项起全部属于应用，包括应用自己的 -h；裸 dsh -h 仍显示启动器帮助。
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile\'s app (see: dsh --profile <name> --help)')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      // With the app owning -h, the launcher's own help is what a bare
      // `dsh -h` (no profile to hand it to) must print.
      // 未指定应用配置时没有接收 -h 的应用，因此显示启动器帮助。
      if (options.profile === undefined) {
        if (args.some(argument => argument === '-h' || argument === '--help')) program.help()
        program.error('error: --profile <name> is required')
      }
      /** 已验证为非空的目标配置名称。 */
      const profile = options.profile
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  /*
   * 拒绝在子命令前混入根命令选项。
   * @param command 当前子命令名称，用于错误信息。
   * @returns 无返回值；发现父选项时由 Commander 报错退出。
   * @example `rejectParentOptions('plugin')`
   */
  const rejectParentOptions = (command: string): void => {
    /** 根命令在解析子命令前可能收集到的选项。 */
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  /** web 固定配置的便捷别名命令。 */
  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: dsh web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  /** 将剩余参数转发给 pnpm 的插件管理子命令。 */
  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    /** Commander 错误保留其退出码，其他异常统一按失败退出。 */
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  /* 每次成功解析都会执行 action 写入结果，否则 Commander 已抛出异常。 */
  if (resolved === undefined) throw new Error('dsh: no invocation resolved')
  return resolved
}
