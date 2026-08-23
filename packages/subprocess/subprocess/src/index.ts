/**
 * ================================ 文件注释 ================================
 * 【文件职责】子进程能力缝（ctx.subprocess）的 Service Definition：执行世界可执行文件
 * 查找、完全指定的受管进程树（原始或收集式 stdio）、以及一个终端进程原语。命令默认值、
 * shell 语义、截止时间、协议帧、终端就绪与展示归消费者。本地实现见 dsh-subprocess-local。
 * 【技术维度】抽象 Service + 模块增强；SENSITIVE_ENV_PATTERN 与 scrubbedParentEnv 提供
 * 统一的"凭据/DSH_* 擦除"基线（导出为普通函数，非服务路由的 spawner 也能共用）。
 * 【产品维度】所有子进程能力（bash/pwsh 执行、PTY 会话、钩子桥）的公共地基：
 * 凭据不隐式泄漏、终止按进程树范围、输出有界可恢复。
 * 【逻辑维度】定义擦除规则 → 声明 ctx.subprocess 服务 → 定义抽象契约
 * （resolveExecutable / spawn / spawnTerminal）。
 * 【关键边界】本缝不应用默认值（完全指定是显式契约）；终止动词唯一（terminate 升级）；
 * 实现只此一个，重复注册会抛错；执行世界与挂载的 FS 提供者共享。
 * 【新手阅读建议】先读 types.ts 的 SubprocessSpawnSpec 与 SubprocessHandle 理解契约形状，
 * 再回到本文件的三个抽象方法，最后对照 subprocess-local 的实现。
 * ==========================================================================
 */

/**
 * Service Definition for the subprocess capability seam (`ctx.subprocess`): execution-world executable lookup,
 * fully specified managed process trees with raw or
 * collected stdio, and one terminal-process primitive. Command defaulting,
 * shell semantics, deadlines, protocol framing, terminal readiness, and
 * presentation belong to consumers. The local implementation lives in
 * `@deepseek-ai/dsh-subprocess-local`.
 * @module @deepseek-ai/dsh-subprocess
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { DSH_ENV_PREFIX } from './types.ts'
import type { SubprocessHandle, SubprocessSpawnSpec } from './types.ts'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from './types.ts'

export { DSH_ENV_PREFIX } from './types.ts'
export type {
  CollectedOutput,
  DshEnvironment,
  DshEnvironmentKey,
  SubprocessCollect,
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessOutputRead,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
  SubprocessStdinMode,
  SubprocessStdio,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from './types.ts'

/**
 * Credential-shaped environment names are NOT forwarded to children (the
 * harness's own `DEEPSEEK_API_KEY`/secrets must not leak into a spawned
 * process implicitly). One heuristic for every in-repo spawner; a
 * deliberately supplied entry survives because explicit env layers merge
 * after the scrub.
 */
/**
 * 凭据形状的环境变量名不会转发给子进程（harness 自身的 DEEPSEEK_API_KEY 等密钥
 * 不能隐式泄漏进被 spawn 的进程）。这是仓库内所有 spawner 共用的一条启发式；
 * 显式提供的条目会存活，因为显式 env 层在擦除之后合并。
 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * The ambient parent environment minus credential-shaped names and minus all
 * `DSH_*` names — the canonical base every harness child starts from. `PATH`,
 * `HOME`, locale, and proxy variables survive, so child CLIs run normally;
 * harness identity never leaks implicitly (a deliberately forwarded
 * credential or current `DSH_*` fact goes through the spec's explicit `env`,
 * which merges after this scrub). Both scrubs match case-insensitively:
 * Windows environment names are case-insensitive, so a parent `dsh_*` entry
 * would otherwise survive and read back as `$env:DSH_*` in the child;
 * deliberate lowercase `dsh_*` names on POSIX are implausible. Exported as a plain function so spawners
 * that cannot route through the service (node-pty backends, SDK-managed
 * transports) share the one scrub definition.
 * @returns a fresh environment object safe to hand to a child spawn.
 */
/**
 * 父进程环境减去"凭据形状名称"与全部 DSH_* 名称后的结果——所有 harness 子进程
 * 的规范起点。PATH、HOME、locale、代理变量保留，子 CLI 正常运行；harness 身份不会
 * 隐式泄漏（刻意转发的凭据或当前 DSH_* 事实走规格的显式 env，在擦除后合并）。
 * 两种擦除都大小写不敏感：Windows 环境名大小写不敏感，否则父进程的 dsh_* 条目会
 * 存活并在子进程里读成 $env:DSH_*；POSIX 上刻意的全小写 dsh_* 名称不现实。
 * 以普通函数导出，让无法经服务路由的 spawner（node-pty 后端、SDK 管理传输）
 * 共享同一份擦除定义。
 * @returns 可直接交给子进程 spawn 的全新环境对象
 */
export function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith(DSH_ENV_PREFIX)) env[key] = value
  }
  return env
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    subprocess: SubprocessRuntime
  }
}

/**
 * Abstract subprocess service. Subclass, implement {@link spawn}, and load the
 * subclass as a plugin — it registers as `ctx.subprocess` (one implementation
 * per context; loading a second throws, which is cordis' standard
 * duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - Executable paths belong to one execution world shared with the mounted
 *   filesystem provider.
 * - {@link spawn} returns immediately with a live handle; `done` resolves at
 *   process close with exit facts and rejects only for spawn-level failures.
 * - Collect-mode readers are offset-based and non-consuming, so independent
 *   readers never consume one another's output; lossy reads report truncation
 *   and the spill file holding the complete stream when one exists. Piped
 *   streams are handed to the caller raw and never buffered here.
 * - {@link SubprocessHandle.terminate} (and the spec's abort signal) escalates
 *   SIGTERM→grace→SIGKILL — the only termination verb — tree-scoped on every
 *   platform. {@link SubprocessHandle.waitForExit} observes whole-tree
 *   liveness, so a consumer-owned teardown ladder can hold each tier on real
 *   quiescence.
 * - Disposal of the service terminates all still-running managed processes
 *   and awaits their exit.
 * - {@link spawnTerminal} owns terminal allocation, text transport,
 *   foreground groups, signalling, and whole-session quiescence behind one
 *   awaited termination method; readiness and persistent-shell policy stay
 *   in the PTY consumer. Its output stream ends after queued terminal output
 *   when the top-level process exits.
 */
/**
 * 抽象的子进程服务。子类实现 spawn 后作为插件加载，即注册为 ctx.subprocess
 * （每个上下文只能有一个实现，加载第二个会抛错——Cordis 标准的重复服务行为）。
 *
 * 实现必须遵守的语义：
 * - 可执行文件路径属于与挂载文件系统提供者共享的同一执行世界。
 * - spawn 立即返回存活句柄；done 在进程关闭时以退出事实 resolve，仅对 spawn 级失败 reject。
 * - 收集模式读取器基于偏移、非消耗式，独立读者不会互相消费输出；丢数据的读取报告
 *   截断与（存在时）持有完整流的溢出文件。管道流原样交给调用方，绝不在此缓冲。
 * - terminate（及规格的 abort 信号）执行 SIGTERM→grace→SIGKILL 升级——唯一的终止
 *   动词，所有平台都按进程树范围执行。waitForExit 观测整树存活，
 *   使消费者自有的拆解梯级能按真实静默逐级等待。
 * - 服务释放时终止所有仍在运行的受管进程并等待其退出。
 * - spawnTerminal 把终端分配、文本传输、前台组、信号与整会话静默收敛到一个
 *   可等待的终止方法之后；就绪与持久 shell 策略留在 PTY 消费者侧。
 */
export abstract class SubprocessRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'subprocess')
  }

  /**
   * Resolve one configured executable in this provider's execution world.
   * Absolute paths are verified; bare names use the provider's scrubbed PATH
   * plus explicit environment overrides. Relative paths containing separators
   * are rejected: the resolution base is undefined, so providers fail loud
   * instead of guessing.
   * @param command - absolute executable path or bare PATH name.
   * @param env - explicit environment entries used for lookup.
   * @param signal - aborts remote or local lookup.
   * @returns a canonical executable path.
   */
  /**
   * 在该提供者的执行世界中解析一个配置好的可执行文件。绝对路径会被验证；裸名称
   * 用提供者擦除过的 PATH 加显式环境覆盖查找；含分隔符的相对路径被拒绝（解析基准
   * 未定义，提供者应响亮失败而不是猜）。
   * @param command 绝对可执行路径或裸 PATH 名称
   * @param env 用于查找的显式环境条目
   * @param signal 中止远程或本地查找
   * @returns 规范化后的可执行路径
   */
  abstract resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string>

  /**
   * Start one managed child process from a fully-specified spec; this seam
   * applies no defaults.
   * @param spec - argv, directory, stdio dispositions, grace, cancellation, and environment.
   * @returns the live process handle (streams/readers, signalling, outcome promise).
   */
  /**
   * 从完全指定的规格启动一个受管子进程；本缝不应用任何默认值。
   * @param spec argv、目录、stdio 配置、宽限期、取消与环境
   * @returns 存活进程句柄（流/读取器、信号、结果 promise）
   */
  abstract spawn(spec: SubprocessSpawnSpec): SubprocessHandle

  /**
   * Allocate a real terminal and start one owned process session. This is the
   * only non-pipe process primitive: implementations own terminal byte I/O,
   * foreground groups, signals, and complete session-tree cleanup.
   * @param spec - fully specified argv, cwd, environment, dimensions, grace, and allocation cancellation.
   * @returns the live terminal handle after allocation succeeds.
   */
  /**
   * 分配一个真实终端并启动一个受管进程会话。这是唯一的非管道进程原语：实现负责
   * 终端字节 I/O、前台组、信号与完整会话树清理。
   * @param spec 完全指定的 argv、cwd、环境、尺寸、宽限期与分配取消
   * @returns 分配成功后返回的存活终端句柄
   */
  abstract spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>
}

export default SubprocessRuntime
