/**
 * @deepseek-ai/dsh-cmdline — the command line a dsh launcher hands to the app
 * it boots.
 *
 * The launcher parses only its own flags (`--profile`, `--patch`, the config
 * dumps) and hands everything after them to the tree verbatim through the
 * {@link CmdlineArgs} service, so an app owns its flag family, its `--help`
 * text, and its parse errors instead of the launcher knowing them.
 *
 * Any app plugin can inject `cmdlineArgs` and call {@link parseCmdline}. A
 * provider may publish the parsed values as its own service from its program's
 * commander action, and ordinary rows
 * can inject that service and read it from lazily resolved config —
 * `port: !!js ctx.webStartup.port ?? 3080` — so a flag beats the value written
 * beside it. No row has launcher-level command-line status.
 * @module @deepseek-ai/dsh-cmdline
 */
/*
 * 文件职责：在启动器与应用插件树之间传递内部命令行参数和受控退出请求，并用Commander解析应用自有选项。
 * 技术维度：使用Cordis上下文服务、不可变参数快照和Commander退出覆盖将终端输出与进程关闭解耦。
 * 产品维度：让不同Profile应用拥有各自的参数、帮助和错误文本，而启动器只处理profile与patch等外层选项。
 * 逻辑维度：provideCmdline发布宿主事实，parseCmdline检查服务和action，配置输出/退出后解析不可变argv。
 * 关键边界：程序必须至少声明一个action；help、version和解析错误只请求受控退出，不直接结束进程。
 * 新手阅读建议：先看CmdlineArgs与AppExit，再读provideCmdline，最后跟踪parseCmdline如何配置Commander。
 */

import type { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'

/**
 * The invocation's inner arguments: everything after the launcher's own flags,
 * verbatim and in argv order. `dsh --profile tui --resume abc` yields
 * `['--resume', 'abc']`.
 */
export interface CmdlineArgs {
  /**
   * Read the inner arguments.
   * @returns the arguments in argv order; empty when the invocation carried none.
   */
  /* 读取启动器传入的不可变内部参数快照；无参数时返回空数组。 */
  get(): readonly string[]
}

/** Request bounded process exit; the launcher wires it to its shutdown controller. */
export interface AppExit {
  /**
   * Request exit once the tree has been disposed.
   * @param code - the process exit code.
   */
  /* 请求在插件树释放后以指定状态码退出进程。 */
  (code: number): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The invocation's inner arguments; provided by a launcher before the tree mounts. */
    cmdlineArgs?: CmdlineArgs
    /** Bounded process-exit request; provided by a launcher before the tree mounts. */
    appExit?: AppExit
  }
}

/** The launcher facts an app needs. */
/* 应用从启动器接收的不可变参数和受控退出函数。 */
export interface CmdlineHost {
  /** The invocation's inner arguments, in argv order. */
  /* 调用的内部参数，保持argv顺序。 */
  args: readonly string[]
  /** Bounded process-exit request. */
  /* 受插件树清理约束的进程退出请求。 */
  exit: AppExit
}

/**
 * Provide the command line and the exit request on a host context before any
 * tree entry mounts. Both are launcher facts, not config: an embedding host
 * with no command line provides an empty argument list.
 * @param ctx - the host context the tree will mount under.
 * @param host - the invocation's arguments and its exit request.
 */
export function provideCmdline(ctx: Context, host: CmdlineHost): void {
  // 冻结的参数副本，阻止调用者之后修改原数组影响已挂载应用。
  const snapshot: readonly string[] = Object.freeze([...host.args])
  ctx.provide('cmdlineArgs', { get: () => snapshot })
  ctx.provide('appExit', host.exit)
}

/** The process streams commander output is written to; production writes to the process. */
/* Commander输出使用的可替换进程流，生产指向真实stdout/stderr，测试可注入记录器。 */
export const internals: { stdout: { write(chunk: string): unknown }; stderr: { write(chunk: string): unknown } } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/**
 * Parse the launcher's immutable argument snapshot with an app's commander
 * program. Commander runs the program's own synchronous action handler on a
 * successful parse; app code there publishes its service and rejects an
 * invalid invocation with `program.error(...)`. This helper has no Loader-row
 * or service ownership semantics.
 *
 * Help, version, and rejected arguments — from the grammar or from an action
 * — are terminal for the process: commander writes the text and the helper
 * requests `ctx.appExit`. The action never runs on help, version, or a
 * grammar rejection; an action must reject before it publishes, because
 * statements before its `program.error(...)` have already run.
 * @param ctx - plugin context carrying `cmdlineArgs` and `appExit`.
 * @param program - the app's commander program, with its flags, description,
 * actions, and any subcommands already declared.
 * @throws when the launcher did not provide the command line and exit request,
 * or when no command in the program declares an action.
 */
export function parseCmdline(ctx: Context, program: Command): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value and the plugin only needs to inject cmdlineArgs.
  // 从全局服务存储读取的启动器参数提供者。
  const args = ctx.get('cmdlineArgs')
  // 从全局服务存储读取的受控退出请求。
  const exit = ctx.get('appExit')
  if (args === undefined || exit === undefined) {
    throw new Error(`${program.name()}: the launcher must provide ctx.cmdlineArgs and ctx.appExit before the tree mounts`)
  }
  if (!hasAction(program)) {
    throw new Error(`${program.name()}: no command in the program declares an action; parseCmdline runs the invoked command's action on a successful parse, and app code there publishes its service`)
  }
  configureExitAndOutput(program)
  try {
    program.parse(args.get(), { from: 'user' })
  } catch (error) {
    // exitOverride turns help, version, a parse error, and the action's own
    // program.error() into a CommanderError; commander has already written the
    // text through the output configured above.
    if (!isCommanderError(error)) throw error
    exit(error.exitCode)
  }
}

/**
 * Whether any command in the tree declares an action handler.
 *
 * The `Command` type cannot express the action precondition, so the handler is
 * read structurally (as {@link isCommanderError} reads commander's control-flow
 * errors): without this guard, a program that forgot its action would parse
 * successfully, publish nothing, and surface only as dependent rows pending on
 * the absent service.
 * @param command - the command whose tree is inspected.
 * @returns true when the command or any registered subcommand has an action.
 */
/* 递归判断Commander程序或任一子命令是否声明了action处理器。 */
function hasAction(command: Command): boolean {
  if (typeof (command as unknown as { _actionHandler?: unknown })._actionHandler === 'function') return true
  return command.commands.some(hasAction)
}

/**
 * Route every command's exit and output through the launcher adapter.
 *
 * Commander copies `exitOverride` and output configuration into a subcommand
 * only at registration, so a root-only override would let an
 * already-registered subcommand's rejection write to the process streams and
 * call `process.exit` directly, bypassing `ctx.appExit`.
 * @param command - the root of the command tree to configure.
 */
/* 为Commander根程序和全部子命令配置退出覆盖及可替换输出流。 */
function configureExitAndOutput(command: Command): void {
  command
    .exitOverride()
    .configureOutput({
      writeOut: text => void internals.stdout.write(text),
      writeErr: text => void internals.stderr.write(text),
    })
  for (const child of command.commands) configureExitAndOutput(child)
}

/**
 * Whether a thrown value is commander's own control-flow error (help, version,
 * a parse error, or `program.error`).
 *
 * Detected structurally, not with `instanceof`: an out-of-tree plugin brings
 * its own commander copy, whose `CommanderError` class is a different identity
 * from this package's, and an identity check there would rethrow a printed
 * help as a fatal load failure.
 * @param error - the thrown value.
 * @returns true when the value carries commander's error code and exit code.
 */
/* 以结构方式判断未知值是否为Commander帮助、版本或解析控制流错误。 */
function isCommanderError(error: unknown): error is { code: string; exitCode: number } {
  if (typeof error !== 'object' || error === null) return false
  // 只读取稳定错误码和退出码字段的结构候选。
  const candidate = error as { code?: unknown; exitCode?: unknown }
  return typeof candidate.code === 'string' && candidate.code.startsWith('commander.')
    && typeof candidate.exitCode === 'number'
}
