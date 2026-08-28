/*
 * ================================ 文件注释 ================================
 * 【文件职责】文件系统 Service Definition（服务定义，ctx.fs）：面向一个"执行世界"的
 * 抽象文件系统。后端拥有稳定目标身份、进程路径与文件 URI、包含关系（containment）、
 * 文本读取、解码、二进制拒绝与原子变更。
 * 【技术维度】FileSystem 是 Cordis Service 抽象基类：约 13 个抽象方法构成能力面；
 * 读取窗口与"观察态策略"放在消费方与策略插件里，而 editText 留在基类（版本检查、
 * 字面匹配与重写共享同一临界区）；事件 'fs/write-intent'/'fs/edit-intent' 是 waterfall
 * （单槽决策，可调用 next() 让权），'fs/observed' 是 emit（同步记录）。
 * 【产品维度】这是"模型读写文件"的抽象层：工具层（tool-fs）只依赖本定义，本地磁盘
 * （fs-local）与沙箱（fs-sandbox）各自实现，模型获得一致的读/写/编辑语义。
 * 【逻辑维度】按出现顺序：export 桶（再导出词汇）→ 声明合并（ctx.fs 与三个事件）→
 * FileSystem 抽象类（sandboxMode、resolve、processPath、fileUrl、contains、stat、lstat、
 * readText、streamText、readBytes、listDir、writeText、editText）。
 * 【关键边界】目标身份必须跨别名稳定（同一文件同一 targetKey）；读取只暴露正则 UTF-8
 * 文本或类型化错误；列举稳定且不读内容；变更原子；可选守卫（预期版本）不改变无守卫
 * 提供者的契约；sandboxMode 只报告"后端默认"，真正的升级检查按调用逐一进行。
 * 【新手阅读建议】先看 declare module 里的三个事件理解决策/观察机制，再按读（resolve
 * → stat → readText）→ 写（writeText）→ 编辑（editText）的顺序读抽象方法。
 * ==========================================================================
 */
/**
 * Filesystem Service Definition for one execution world. Backends own stable target
 * identity, process paths and file URIs, containment, text reads, decoding,
 * binary rejection, and atomic mutations. Read windows and
 * observed-state policy stay in consumer and policy plugins; `editText`
 * remains here so version check, literal match, and rewrite share one critical
 * section.
 * @module @deepseek-ai/dsh-fs
 */
/*
 * 模块总览：本文件是"文件系统能力"的抽象契约，不含任何实现。
 * 实现由 fs-local（本地磁盘）与 fs-sandbox（沙箱）提供；工具层（tool-fs）面向它编程。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsObservation,
  FsTarget,
  FsVersion,
  FsWriteIntent,
  FsWriteOutcome,
} from './types.ts'

// 对外再导出：错误、身份键与版本类型，以及全部词汇类型。
export {
  FsError,
  FsTargetKey,
  FsVersion,
} from './types.ts'
export type {
  FsEditOutcome,
  FsEditRequest,
  FsDirEntry,
  FsErrorCode,
  FsInfo,
  FsObservation,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from './types.ts'

// 声明合并：把 ctx.fs 服务与三个文件系统事件挂到 Cordis 上。
declare module '@deepseek-ai/cordis' {
  interface Context {
    fs: FileSystem
  }

  interface Events {
    /**
     * Single-slot decision for the next {@link FileSystem.writeText}. Calling
     * `next()` yields the bare provider's unconditional write; the first listener
     * that returns an intent owns the decision rather than composing with peers.
     * @param target - the resolved target about to be written.
     * @param actor - the opaque tool-execution context the decider keys off.
     * @mode waterfall
     */
    /*
     * Single-slot decision for the next {@link FileSystem.writeText}.
     * 中文说明：writeText 的下一次"单槽决策"事件（waterfall 链式语义）。
     * 监听器可调用 next() 让权给裸提供者的无条件写；第一个返回意图的监听器
     * 拥有决策权（不与他人组合）。决策者依据不透明的工具执行上下文（actor）做判断。
     * @param target 中文说明：即将写入的已解析目标。
     * @param actor 中文说明：决策器据以识别调用方的工具执行上下文。
     * @mode waterfall
     */
    'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
    /**
     * Single-slot decision for the next {@link FileSystem.editText}. Calling
     * `next()` yields an unconditional edit; the first returned guard wins.
     * @param target - the resolved target about to be edited.
     * @param actor - the opaque tool-execution context the decider keys off.
     * @mode waterfall
     */
    /*
     * Single-slot decision for the next {@link FileSystem.editText}.
     * 中文说明：editText 的下一次"单槽决策"事件（waterfall 语义）。
     * 调用 next() 得到无条件编辑；第一个返回守卫的监听器胜出。
     * @param target 中文说明：即将编辑的已解析目标。
     * @param actor 中文说明：决策器据以识别调用方的工具执行上下文。
     * @mode waterfall
     */
    'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
    /**
     * Record an authoritative positive or negative observation. Listeners must
     * be synchronous recorders: throws fail the tool call and returned promises
     * are not awaited.
     * @param target - the target whose presence or absence was observed.
     * @param observation - present with its version, or confirmed absent.
     * @param actor - the observing tool-execution context; undefined records nothing useful.
     * @mode emit
     */
    /*
     * Record an authoritative positive or negative observation.
     * 中文说明：记录一次权威的"存在/不存在"观察（emit 事件）。监听器必须是
     * 同步记录器：抛错会让工具调用失败，返回的 Promise 不会被 await。
     * actor 为 undefined 时观察无记录价值。
     * @param target 中文说明：被观察的文件系统目标。
     * @param observation 中文说明：目标存在及其版本，或确认不存在。
     * @param actor 中文说明：发起观察的工具执行上下文。
     * @mode emit
     */
    'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void
  }
}

/**
 * Abstract filesystem provider. Targets must preserve identity across aliases;
 * reads expose regular UTF-8 text or typed errors, listings are stable and
 * content-free, and mutations are atomic. Optional guards add stale protection
 * without changing the unguarded provider contract.
 */
/*
 * 抽象文件系统提供者。目标身份必须在别名（符号链接等）下保持稳定；读取只暴露
 * 正则 UTF-8 文本或类型化错误；列举稳定且不含内容；变更原子。可选守卫（预期版本）
 * 增加过期保护，但不改变无守卫提供者的契约。
 */
export abstract class FileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  /**
   * The sandbox mode this backend enforces on mutations BY DEFAULT, or
   * `undefined` when it does not confine at all — the capability fact the tool
   * layer reads to advertise the escalation fields honestly (mirrors
   * `ShellExecutor.sandboxMode`). The base class and the bare local backend
   * report `undefined`; a sandboxing backend (`@deepseek-ai/dsh-fs-sandbox`)
   * overrides it with the deployment default. A session override may make the
   * effective mode narrower or wider, so strict escalation widening is checked
   * per call rather than encoded in this default-relative fact.
   * @returns the configured default mode of a sandboxing backend; `undefined`
   *   for a backend that never confines.
   */
  /*
   * 本后端在变更上"默认"强制执行的沙箱模式；完全不限制时返回 undefined。
   * 这是工具层读取的能力事实，用来诚实宣传升级字段（与 ShellExecutor.sandboxMode 对应）。
   * 基类与裸本地后端返回 undefined；沙箱后端（fs-sandbox）用部署默认值覆盖它。
   * 会话级覆盖可能让实际模式更窄或更宽，所以严格的"升级放宽"检查按调用逐一进行，
   * 而不是编码在这个默认相对的事实里。
   * @returns 沙箱后端的配置默认模式；从不限制的后端返回 undefined。
   */
  get sandboxMode(): SandboxMode | undefined {
    return undefined
  }

  /**
   * Resolve a model/plugin-supplied path into a stable {@link FsTarget}. May perform I/O (a
   * remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence
   * async even though the local backend only normalizes + realpaths.
   *
   * @param path - the path to resolve; relative paths resolve against `opts.cwd`.
   * @param opts - optional cwd override and cancellation signal.
   * @returns the stable target; the same file yields the same `targetKey`.
   */
  /*
   * 把模型/插件提供的路径解析成稳定的 FsTarget。可能执行 I/O（远程/沙箱后端也许要
   * 往返一次才能把路径映射成稳定身份），所以是异步的——本地后端通常只做归一化 +
   * realpath。相对路径以 opts.cwd 为基准。
   * @param path 待解析路径。
   * @param opts 可选的 cwd 覆盖与取消信号。
   * @returns 稳定目标；同一文件得到同一 targetKey。
   */
  abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>

  /**
   * Return the canonical absolute path a subprocess in this filesystem's
   * execution world can open. The path is deliberately separate from
   * {@link FsTarget.targetKey}: consumers may pass this value to another OS
   * capability, but must continue treating the target key as opaque.
   * @param target - the resolved target whose process path is required.
   * @returns an absolute path in the backend's execution world.
   */
  /*
   * 返回该文件系统执行世界里的子进程可打开的规范绝对路径。这条路径与 targetKey
   * 刻意分开：消费者可以把此值传给另一个 OS 能力，但必须继续把目标键视为不透明。
   * @param target 需要进程路径的已解析目标。
   * @returns 后端执行世界里的绝对路径。
   */
  abstract processPath(target: FsTarget): string

  /**
   * Map an absolute path from the harness host into this filesystem's
   * execution world when both paths identify the same file. The base provider
   * exposes no mapping; host-backed or explicitly shared backends override it.
   * @param hostPath - absolute path in the harness host filesystem.
   * @returns the process path for the same file, or undefined when this
   *   execution world cannot read that host file.
   */
  processPathFromHostPath(hostPath: string): string | undefined {
    void hostPath
    return undefined
  }

  /**
   * Return the canonical `file:` URI for a target in this filesystem's
   * execution world. Backends own URI encoding because the host platform may
   * differ from the execution platform.
   * @param target - the resolved target to encode.
   * @returns the target's canonical file URI.
   */
  /*
   * 返回目标在该文件系统执行世界里的规范 file: URI。URI 编码由后端负责，
   * 因为宿主平台可能与执行平台不同。
   * @param target 要编码的已解析目标。
   * @returns 目标的规范 file URI。
   */
  abstract fileUrl(target: FsTarget): string

  /**
   * Test canonical containment without exposing or parsing backend target
   * keys. Both targets must come from this provider.
   * @param parent - canonical directory target.
   * @param child - canonical candidate target.
   * @returns true when `child` is `parent` or a descendant of it.
   */
  /*
   * 测试规范包含关系（containment），不暴露也不解析后端目标键。两个目标都必须
   * 来自本提供者。
   * @param parent 规范目录目标。
   * @param child 规范的候选目标。
   * @returns child 是 parent 本身或其后代时返回 true。
   */
  abstract contains(parent: FsTarget, child: FsTarget): boolean

  /**
   * Return target metadata, or `undefined` when the target does not exist.
   * @param target - the resolved target to stat.
   * @param signal - aborts the metadata round-trip.
   * @returns metadata only, never content; undefined for an absent target.
   */
  /*
   * 返回目标元数据；目标不存在时返回 undefined。
   * @param target 要 stat 的已解析目标。
   * @param signal 中止元数据往返。
   * @returns 只含元数据（绝不含内容）；目标不存在时为 undefined。
   */
  abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>

  /**
   * Return path metadata without following the final path component when it is a
   * symbolic link. This is intentionally path-shaped, not target-shaped:
   * {@link resolve} follows symlinks to produce the stable identity used by
   * normal reads/writes, while `lstat` lets a consumer reject the path itself
   * before that follow happens.
   *
   * `opts.cwd` follows {@link resolve}'s cwd rules. `undefined` means the path is
   * absent.
   * @param path - the path to inspect; relative paths resolve against `opts.cwd`.
   * @param opts - `cwd` overrides the backend's default base for relative paths.
   * @param signal - aborts the metadata round-trip.
   * @returns metadata only, never content; undefined for an absent path.
   */
  /*
   * 返回"路径级"元数据：末级是符号链接时不去跟随它。刻意做成路径形态而非目标形态：
   * resolve 会跟随符号链接产出稳定身份供常规读写使用，而 lstat 让消费者能在跟随
   * 发生之前就拒绝这条路径本身。opts.cwd 规则与 resolve 相同。
   * @param path 要检查的路径；相对路径以 opts.cwd 为基准。
   * @param opts cwd 覆盖相对路径的后端默认基准。
   * @param signal 中止元数据往返。
   * @returns 只含元数据；路径不存在时为 undefined。
   */
  abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>

  /**
   * Read the whole regular text file as a single decoded string.
   * @param target - the resolved target to read.
   * @param signal - aborts the read.
   * @returns the full decoded UTF-8 content.
   */
  /*
   * 把整个常规文本文件读成一个已解码字符串。
   * @param target 要读取的已解析目标。
   * @param signal 中止读取。
   * @returns 完整解码后的 UTF-8 内容。
   */
  abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>

  /**
   * Stream the whole regular text file as decoded text chunks (same text
   * semantics as {@link readText}, for large files). The backend owns
   * cross-chunk UTF-8 decoding and binary rejection so the policy layer never
   * touches raw bytes.
   * @param target - the resolved target to read.
   * @param signal - aborts the stream, including between chunks.
   * @returns the chunk iterable, decoded and validated like {@link readText}.
   */
  /*
   * 以解码文本块的形式流式读取整个常规文本文件（与 readText 文本语义相同，
   * 面向大文件）。跨块 UTF-8 解码与二进制拒绝由后端负责，策略层永远不碰原始字节。
   * @param target 要读取的已解析目标。
   * @param signal 中止流式读取（包括块与块之间）。
   * @returns 与 readText 同样解码与校验的块迭代器。
   */
  abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>

  /**
   * Read the whole regular file as raw bytes with no decoding or binary
   * rejection. The bound lives at this seam so a backend can never buffer an
   * unbounded file: a target known or discovered to exceed `maxBytes` fails
   * with `FS_TOO_LARGE` instead of returning a truncated result.
   * @param target - the resolved target to read.
   * @param signal - aborts the read.
   * @param maxBytes - inclusive byte cap on the complete content.
   * @returns the full raw content, at most `maxBytes` long.
   */
  /*
   * 以原始字节读取整个常规文件，不做解码也不拒绝二进制。上限就设在这个接缝处，
   * 使后端永远不会缓冲无界文件：已知或发现超过 maxBytes 的目标以 FS_TOO_LARGE 失败，
   * 而不是返回截断结果。
   * @param target 要读取的已解析目标。
   * @param signal 中止读取。
   * @param maxBytes 完整内容的字节上限（含）。
   * @returns 完整原始内容，最长不超过 maxBytes。
   */
  abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>

  /**
   * List direct children of a directory in stable name order. Returns resolved
   * child targets plus cheap metadata only; never reads file contents.
   * @param target - the resolved directory target.
   * @param signal - aborts the listing.
   * @returns one entry per direct child, in stable name order.
   */
  /*
   * 以稳定的名字顺序列举目录的直接子项。只返回已解析的子目标与廉价元数据，
   * 绝不读文件内容。
   * @param target 已解析的目录目标。
   * @param signal 中止列举。
   * @returns 每个直接子项一条，按稳定名字顺序。
   */
  abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>

  /**
   * Atomically create or replace UTF-8 text. `expected` guards intent and
   * staleness; omission allows unconditional overwrite.
   * @param target - the resolved target to write.
   * @param content - the full new file content.
   * @param expected - the write intent guarding the write; omit for unconditional.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root this write
   *   runs under; a sandboxing backend fences the write by it, the bare backend
   *   ignores it. Omit to leave the backend its own default.
   * @returns the outcome, including the version the write produced.
   */
  /*
   * 原子创建或替换 UTF-8 文本。expected（写意图）守卫意图与过期性；省略则允许
   * 无条件覆盖。sandboxPolicy 是该次调用的模式与工作区根：沙箱后端按它围栏这次写入，
   * 裸后端忽略；省略则用后端自己的默认。
   * @param target 要写入的已解析目标。
   * @param content 完整的新文件内容。
   * @param expected 守卫写入的写意图；省略为无条件写入。
   * @param signal 在原子发布生效前中止。
   * @param sandboxPolicy 本次写入运行于的模式与工作区根。
   * @returns 写入结果，含写入产生的版本。
   */
  abstract writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome>

  /**
   * Atomically edit literal text. When supplied, the version guard is checked
   * before matching so stale content reports `FS_STALE_VERSION`; omission edits
   * the current content without a freshness precondition.
   * @param target - the resolved target to edit.
   * @param edit - the literal search/replace request.
   * @param expected - the version guard; omit for an unconditional edit.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root this edit runs
   *   under; a sandboxing backend fences the edit by it, the bare backend
   *   ignores it. Omit to leave the backend its own default.
   * @returns the outcome, including the version the edit produced.
   */
  /*
   * 原子编辑字面文本。提供版本守卫时，先检查版本再匹配，过期内容报 FS_STALE_VERSION；
   * 省略则编辑当前内容、无新鲜度前置条件。版本检查、字面匹配与重写共享同一临界区
   * （这正是 editText 留在 Service Definition 的原因）。
   * @param target 要编辑的已解析目标。
   * @param edit 字面查找/替换请求。
   * @param expected 版本守卫；省略为无条件编辑。
   * @param signal 在原子发布生效前中止。
   * @param sandboxPolicy 本次编辑运行于的模式与工作区根。
   * @returns 编辑结果，含编辑产生的版本。
   */
  abstract editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome>
}

// 服务包默认导出服务类本身（packages/AGENTS.md 约定）。
export default FileSystem
