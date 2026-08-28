/** Pure terminal-card derivation from raw Tool call and result fields. @module
 * @remarks 文件说明：文件职责：实现 client/ui-tool 中 terminal card model 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-tool
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { TerminalBlockLabels, TerminalBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall, singleResultText, validEscalationFields } from './raw-tool-call.ts'

/**
 * Build the TerminalBlock display copy from the conversation locale seat —
 * the one place the primitive's label surface pairs with this package's
 * dictionary, shared by every terminal render site (chat row, bash row,
 * details panel).
 * @param t - the render site's conversation locale seat.
 * @returns the full label set for {@link TerminalBlockProps}'s `labels`.
 * @remarks 中文说明：功能说明：处理 terminalBlockLabels 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：t（TranslateNS<'conversation'>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TerminalBlockLabels；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * terminalBlockLabels(t)，并按返回类型处理结果。
 */
export function terminalBlockLabels(t: TranslateNS<'conversation'>): TerminalBlockLabels {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
   * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：hidden（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(hidden)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：hidden（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(hidden)，并按返回类型处理结果。
   */
  return {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('copy'),
    copied: t('copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    collapse: t('collapse'),
    expandAria: hidden => t('terminal.expandAria', { n: hidden }),
    expand: hidden => t('terminal.expandRest', { n: hidden }),
  }
}

/**
 * The {@link TerminalBlock} props this derivation owns. Picked off the
 * primitive's props so the two stay in step; `maxLines`/`className` belong to
 * each render site.
 */
export interface TerminalCardModel {
  /**
   * The locale-neutral props {@link TerminalBlock} draws. The render site adds
   * `command` after resolving {@link copy} through its locale seat.
   */
  card: Pick<TerminalBlockProps, 'cwd' | 'output' | 'exitCode' | 'signal' | 'running'>
  /**
   * Verbatim Tool data or semantic `terminal_send` data. Product copy stays
   * unresolved until a render site supplies its locale seat.
   */
  copy:
    | { readonly kind: 'shell'; readonly command: string; readonly description: string | undefined }
    | { readonly kind: 'terminal-send'; readonly text: string; readonly sessionId: string }
}

interface LocalizedTerminalCardModel {
  readonly card: Pick<TerminalBlockProps, 'command' | 'cwd' | 'output' | 'exitCode' | 'signal' | 'running'>
  readonly description: string | undefined
}

/**
 * Resolve locale-owned `terminal_send` copy while preserving Tool-authored
 * shell commands and descriptions verbatim.
 * @param model - locale-neutral terminal card data.
 * @param t - the render site's conversation locale seat.
 * @returns terminal props and description ready for rendering.
 * @remarks 中文说明：功能说明：处理 localizeTerminalCardModel 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：model（TerminalCardModel）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：t（TranslateNS<'conversation'>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：LocalizedTerminalCardModel；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 localizeTerminalCardModel(model, t)，并按返回类型处理结果。
 */
export function localizeTerminalCardModel(
  model: TerminalCardModel,
  t: TranslateNS<'conversation'>,
): LocalizedTerminalCardModel {
  if (model.copy.kind === 'shell') {
    return {
      card: { command: model.copy.command, ...model.card },
      description: model.copy.description,
    }
  }
  return {
    card: {
      command: model.copy.text === '' ? t('terminal.sendInput') : model.copy.text,
      ...model.card,
    },
    description: t('terminal.session', { sessionId: model.copy.sessionId }),
  }
}

/**
 * True when a settled terminal card reports a failing exit — a non-zero code
 * or a terminating signal. The bash tool settles a failing command as a
 * completed call (`isError` stays false: the exit status is result data), so
 * this is the collapsed row's only failure signal; without it the red exit
 * pill would be visible only after expanding the card.
 * @param model - a derived terminal card.
 * @returns whether the card's exit status is a failure.
 * @remarks 中文说明：功能说明：处理 terminalFailed 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：model（TerminalCardModel）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 terminalFailed(model)，
 * 并按返回类型处理结果。
 */
export function terminalFailed(model: TerminalCardModel): boolean {
  /**
   * 常量说明：exitCode、signal、running 用于处理 exitCode、signal、running 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { exitCode, signal, running } = model.card
  return running !== true && ((exitCode !== undefined && exitCode !== 0) || signal !== undefined)
}

/**
 * Resolve a shell call's workdir for display: an absolute path is used as-is,
 * a relative one joins under the session workspace, and an omitted one is the
 * session workspace. Without a session cwd, a relative path stays as authored
 * and an omitted one stays absent.
 * @param workdir - the raw call's workdir, if any.
 * @param sessionCwd - the session workspace root, if the caller knows it.
 * @returns the working directory for the prompt label, or undefined.
 * @remarks 中文说明：功能说明：解析 Terminal Cwd 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：workdir（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionCwd（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveTerminalCwd(workdir, sessionCwd)，并按返回类型处理结果。
 */
function resolveTerminalCwd(workdir: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (workdir === undefined || workdir === '') return sessionCwd
  if (sessionCwd === undefined || sessionCwd === '') return normalizeSegments(workdir)
  return normalizeSegments(resolveWorkspacePath(sessionCwd, workdir))
}

/**
 * Collapse `.` and `..` segments so the prompt label names the directory the
 * command actually ran in. The bash executor resolves the workdir before
 * running, so a joined `/w/app/..` must display as `w`, not as `..`. Separators
 * are preserved as authored (a Windows path keeps its backslashes) because this
 * value is only ever displayed; a `..` that would climb past the root is
 * dropped, which is what a filesystem does with it. A UNC path's `server` and
 * `share` are part of its root, not poppable segments: Windows cannot climb
 * above a share, so `\\\\server\\share` with a `..` stays there.
 * @param path - a joined or absolute path, possibly carrying `.`/`..` segments.
 * @returns the same path with those segments resolved.
 * @remarks 中文说明：功能说明：规范化 Segments 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalizeSegments(path)，
 * 并按返回类型处理结果。
 */
function normalizeSegments(path: string): string {
  if (!/(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path)) return path
  // A UNC path is `\\\\server\\share\\...`: the server and share form the root,
  // so they are split off here and neither is a segment `..` may pop. Its
  // separator is fixed to a backslash, since a joined relative part may have
  // introduced a forward slash that UNC syntax does not use.
  /**
   * 常量说明：unc 用于处理 unc 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const unc = /^[/\\]{2}([^/\\]+)[/\\]+([^/\\]+)/.exec(path)
  if (unc !== null) {
    // Both groups are mandatory in the pattern, so destructuring types them as
    // strings without an assertion.
    /**
     * 常量说明：matched、server、share 用于处理 matched、server、share 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [matched, server, share] = unc
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = `\\\\${String(server)}\\${String(share)}`
    // Rooted: what follows the share hangs off it, so a `..` at the top is
    // dropped rather than kept — Windows cannot climb above a share.
    /**
     * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rest = collapse(path.slice(matched.length), true)
    return rest === '' ? root : `${root}\\${rest}`
  }
  /**
   * 常量说明：backslashed 用于处理 backslashed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const backslashed = path.includes('\\') && !path.includes('/')
  /**
   * 常量说明：separator 用于处理 separator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const separator = backslashed ? '\\' : '/'
  /**
   * 常量说明：rooted 用于处理 rooted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rooted = /^[/\\]/.test(path)
  /**
   * 常量说明：drive 用于处理 drive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? ''
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = collapse(path.slice(drive.length), rooted || drive !== '', separator)
  /**
   * 常量说明：leading 用于处理 leading 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const leading = rooted ? separator : ''
  return drive === '' ? `${leading}${body}` : `${drive}${rooted ? leading : separator}${body}`
}

/**
 * Collapse the `.`/`..` segments of a path body against a known root state.
 * @param body - the path after any drive letter or UNC root.
 * @param rooted - the body hangs off a root, so a `..` at its top is dropped
 *   the way a filesystem drops one; without a root the `..` is kept, since it
 *   stays meaningful against a cwd this function cannot see.
 * @param separator - separator to rejoin with (default `/`).
 * @returns the collapsed body, without leading or trailing separators.
 * @remarks 中文说明：功能说明：处理 collapse 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：body（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：rooted（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：separator（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 collapse(body, rooted,
 * separator)，并按返回类型处理结果。
 */
function collapse(body: string, rooted: boolean, separator = '/'): string {
  /**
   * 常量说明：kept 用于处理 kept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const kept: string[] = []
  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of body.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (kept.length > 0 && kept[kept.length - 1] !== '..') kept.pop()
      else if (!rooted) kept.push(segment)
      continue
    }
    kept.push(segment)
  }
  return kept.join(separator)
}

interface ShellCall {
  kind: 'shell'
  command: string
  description: string | undefined
  workdir: string | undefined
  persistent: boolean
  background: boolean
}

/**
 * 功能说明：处理 shellCall 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param args （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ShellCall | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 shellCall(name, args)，并按返回类型处理结果。
 */
function shellCall(name: string, args: Record<string, unknown>): ShellCall | null {
  if (name !== 'bash' && name !== 'pwsh') return null
  /**
   * 常量说明：command、description、timeoutMs、workdir、background 用于处理
   * command、description、timeoutMs、workdir、background 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { command, description, timeoutMs, workdir, run_in_background: background } = args
  if (typeof command !== 'string' || command.trim() === '') return null
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) return null
  if (workdir !== undefined && typeof workdir !== 'string') return null
  if (background !== undefined && typeof background !== 'boolean') return null
  if (!validEscalationFields(args)) return null
  if (description === undefined) {
    // Standard dsh-tool-bash and dsh-tool-pwsh schemas require `description`;
    // persistent shell providers omit it. Their parameter roots stay open, so
    // unrelated fields do not change their running-card behavior.
    return { kind: 'shell', command, description: undefined, workdir: undefined, persistent: true, background: false }
  }
  if (typeof description !== 'string' || description.trim() === '') return null
  return {
    kind: 'shell',
    command,
    description,
    workdir,
    persistent: false,
    background: background === true,
  }
}

/**
 * Identify a settled root call from the persistent Bash or PowerShell tool.
 * Its result stays on the generic input/output path because the persistent
 * shell can report resets and partial output without one process exit status.
 * @param block - running or settled Tool block.
 * @returns whether the block is a settled persistent-shell call.
 * @remarks 中文说明：功能说明：判断是否为 Settled Persistent Shell Call 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：block（ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isSettledPersistentShellCall(block)，并按返回类型处理结果。
 */
export function isSettledPersistentShellCall(block: ToolCallBlock): boolean {
  if (!('kind' in block) || block.parentCallId !== undefined) return false
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = parsedToolCall(block)
  if (parsed === null) return false
  return shellCall(parsed.name, parsed.args)?.persistent === true
}

interface TerminalSendCall {
  kind: 'terminal-send'
  text: string
  sessionId: string
  background: boolean
}

/**
 * 功能说明：处理 terminalSendCall 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param args （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TerminalSendCall | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 terminalSendCall(name, args)，并按返回类型处理结果。
 */
function terminalSendCall(name: string, args: Record<string, unknown>): TerminalSendCall | null {
  if (name !== 'terminal_send') return null
  /**
   * 常量说明：sessionId、text、submit、background 用于处理
   * sessionId、text、submit、background 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sessionId, text, submit, run_in_background: background } = args
  if (typeof sessionId !== 'string' || sessionId === '' || typeof text !== 'string') return null
  if (submit !== undefined && typeof submit !== 'boolean') return null
  if (background !== undefined && typeof background !== 'boolean') return null
  return {
    kind: 'terminal-send',
    text,
    sessionId,
    background: background === true,
  }
}

/**
 * Parse the marker literals owned by `@deepseek-ai/dsh-shell/render` without
 * importing that Host-only package into the Client dependency graph.
 * @param text - rendered shell result text.
 * @returns output with a trailing exit-code or signal marker extracted.
 * @remarks 中文说明：功能说明：解析 Exit Status 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ output: string;
 * exitCode?: number; signal?: string }；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseExitStatus(text)，并按返回类型处理结果。
 */
function parseExitStatus(text: string): { output: string; exitCode?: number; signal?: string } {
  /**
   * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { output: text.slice(0, signal.index), signal: signal[1] }
  /**
   * 常量说明：exit 用于处理 exit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { output: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { output: text, exitCode: 0 }
}

/**
 * Derive terminal props for supported root shell and terminal-send calls.
 * Standard shell results parse their final status marker; persistent shell
 * results, background calls, errors, malformed input, or child dispatches use
 * the generic path. {@link isSettledPersistentShellCall} lets that generic
 * persistent result remain expandable without inventing one process status.
 * @param block - running or settled Tool block.
 * @param sessionCwd - session workspace root used to resolve workdir.
 * @returns locale-neutral terminal-card data, or null for the generic path.
 * @remarks 中文说明：功能说明：处理 terminalCardModel 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionCwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TerminalCardModel | null；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 terminalCardModel(block, sessionCwd)，并按返回类型处理结果。
 */
export function terminalCardModel(
  block: ToolCallBlock,
  sessionCwd?: string,
): TerminalCardModel | null {
  if (block.parentCallId !== undefined) return null
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = parsedToolCall(block)
  if (parsed === null) return null
  /**
   * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const call = shellCall(parsed.name, parsed.args) ?? terminalSendCall(parsed.name, parsed.args)
  if (call === null || call.background) return null

  /**
   * 常量说明：copy 用于处理 copy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const copy: TerminalCardModel['copy'] = call.kind === 'shell'
    ? { kind: 'shell', command: call.command, description: call.description }
    : { kind: 'terminal-send', text: call.text, sessionId: call.sessionId }
  /**
   * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cwd = resolveTerminalCwd(call.kind === 'shell' ? call.workdir : undefined, sessionCwd)
  if (!('kind' in block)) {
    return {
      copy,
      card: {
        cwd,
        output: undefined,
        exitCode: undefined,
        signal: undefined,
        running: true,
      },
    }
  }
  if (block.isError || (call.kind === 'shell' && call.persistent)) return null
  /**
   * 常量说明：output 用于处理 output 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const output = singleResultText(block)
  if (output === undefined) return null
  /**
   * 常量说明：status 用于处理 status 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const status = call.kind === 'terminal-send' ? { output } : parseExitStatus(output)
  return {
    copy,
    card: {
      cwd,
      output: status.output,
      exitCode: status.exitCode,
      signal: status.signal,
      running: false,
    },
  }
}
