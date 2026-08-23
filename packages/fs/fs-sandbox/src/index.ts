/**
 * ================================ 文件注释 ================================
 * 【文件职责】SandboxedFileSystem：dsh-fs Service Definition 的"沙箱强制"实现。
 * 它继承 LocalFileSystem，所有文本存储机制（解析、stat、读写、列举、原子写、编辑
 * 临界区）原样复用本地实现；本包只给两个变更操作加上"按调用策略的围栏"，读取
 * 原样放行（每种模式都允许读）。
 * 【技术维度】围栏是"可信代码里对模型控制路径的策略检查"，不是内核边界：操作仍是
 * 接缝自己的（open/rename），只有目标路径不可信，所以"先规范化再判包含"即可覆盖
 * 整个面。checkedTarget 在委托前立刻重新规范化（捕获并发换掉的符号链接祖先），并
 * 返回这个新鲜目标（检查的身份 = 变更的身份，无 TOCTOU）。三种模式：read-only 拒绝
 * 一切变更；workspace-write 要求目标规范化到可写根或平台临时区（与 Seatbelt 相同的
 * 可写根集合，共用 writableRoots 防止 bash 与 fs 漂移）；danger-full-access 无围栏。
 * 【产品维度】模型文件操作的"安全默认"：配合 ctx.sandboxPolicy 按会话解析模式，
 * 拒绝时抛结构化 FS_SANDBOX_DENIED（进程内围栏精确知道自己拒绝了什么，无需像
 * bash 那样推断文本）；升级重试在工具层（tool-fs），与 bash 一致。
 * 【逻辑维度】按出现顺序：模块注释 → import → Config（复用本地后端配置）→
 * SandboxedFileSystem 类（defaultMode 字段、sandboxMode getter、writeText/editText
 * 围栏委托、checkedTarget 策略判定）。
 * 【关键边界】注册方式：加载本包（替代 dsh-fs-local，连同 ctx.sandboxPolicy）即完成
 * 整体切换，模型侧工具无需改动；残余 TOCTOU（包含复查与系统调用之间祖先符号链接被
 * 换）通过"委托前立即重规范化"收窄，并按本威胁模型接受。
 * 【新手阅读建议】先读模块注释理解威胁模型（containment 而非安全边界），再读
 * checkedTarget 理解三种模式的分支，最后看 writeText/editText 的围栏委托。
 * ==========================================================================
 */
/**
 * `SandboxedFileSystem`: the sandbox-enforcing implementation of the
 * `@deepseek-ai/dsh-fs` Service Definition. It extends `LocalFileSystem` so all
 * text-storage mechanics — resolve, stat, read/stream, list, the atomic
 * write and the read-match-write edit critical section — are the local
 * implementation's, verbatim; this package adds only the per-call POLICY fence
 * on the two mutations. Reads pass through untouched: every mode permits
 * reading.
 *
 * The fence is a policy check in TRUSTED code over a MODEL-CONTROLLED path,
 * NOT a kernel boundary — the operations are the seam's own (open, rename),
 * and only the target path is untrusted, so canonicalize-then-contain is the
 * complete answer to this surface. Kernel-grade isolation of untrusted CODE
 * stays `ctx.shell`'s job (`@deepseek-ai/dsh-bash-sandbox`). This mirrors the
 * `code-runtime` stance: containment, not a security boundary. The residual
 * TOCTOU (an ancestor symlink swapped between the containment re-check and the
 * syscall) is narrowed by re-canonicalizing immediately before delegating and
 * is accepted for this threat model.
 *
 * Per-call policy: `read-only` denies every mutation; `workspace-write` allows
 * a mutation only when the target canonicalizes under the policy's workspace
 * root or a platform temp area (the SAME writable-root set Seatbelt grants,
 * derived from the one `writableRoots` function so bash and fs cannot drift);
 * `danger-full-access` delegates unfenced. A denial throws the structured
 * `FS_SANDBOX_DENIED` — no text inference is needed (unlike bash's kernel
 * stderr), because an in-process fence knows exactly what it refused. The
 * escalation retry lives in the tool layer (`@deepseek-ai/dsh-tool-fs`),
 * exactly as bash's does.
 *
 * @module @deepseek-ai/dsh-fs-sandbox
 */
/**
 * 模块总览：本包是"带沙箱策略的 fs 后端"——继承本地后端 + 变更前策略围栏。
 * 读取不经围栏（所有模式都允许读）；拒绝时抛结构化 FS_SANDBOX_DENIED。
 */

import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-fs-local'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsEditOutcome, FsEditRequest, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { isPathUnder } from './containment.ts'

/**
 * Plugin config: the local backend's knobs verbatim (`cwd` resolution default
 * and `diffBasisMaxBytes` overwrite-presentation bound). The sandbox default
 * (mode + `workspace-write` fallback root) is NOT here — `ctx.sandboxPolicy`
 * resolves each calling session for every enforcing capability.
 */
/**
 * 插件配置：原样复用本地后端的旋钮（cwd 解析基准与 diffBasisMaxBytes 覆盖展示上限）。
 * 沙箱默认（模式 + workspace-write 回退根）不在这里——由 ctx.sandboxPolicy 按每个
 * 调用会话解析。
 */
export type Config = LocalConfig

/**
 * Sandbox-enforcing filesystem backend. Registers as `ctx.fs` (loading it
 * INSTEAD OF `dsh-fs-local`, together with a `ctx.sandboxPolicy`, is the whole
 * swap — the model-facing tools are untouched). Its configured default mode is
 * the capability fact exposed by {@link sandboxMode}; `dsh-tool-fs` resolves
 * each session's mode and cwd into a policy for every mutation, while an
 * approved escalation may stamp a strictly wider mode for one call.
 */
/**
 * 沙箱强制的文件系统后端。注册为 ctx.fs（用本包替代 dsh-fs-local，连同
 * ctx.sandboxPolicy，就是完整的切换——模型侧工具无需改动）。配置的默认模式是
 * sandboxMode 暴露的能力事实；dsh-tool-fs 把每个会话的模式与 cwd 解析成每次
 * 变更的策略，经批准的升级可为单次调用盖一个严格更宽的模式。
 */
export class SandboxedFileSystem extends LocalFileSystem {
  // 依赖注入声明：必须有 sandboxPolicy 服务（提供部署默认模式与会话策略）。
  static inject = ['sandboxPolicy']

  // 部署默认模式：构造时从 ctx.sandboxPolicy 读取。
  private readonly defaultMode: SandboxMode
  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.defaultMode = ctx.sandboxPolicy.defaultMode
  }

  /** The deployment default mode — the capability fact the tool layer reads to advertise escalation. */
  /** 部署默认模式——工具层读取它来诚实宣传升级选项。 */
  override get sandboxMode(): SandboxMode {
    return this.defaultMode
  }

  /**
   * Fence the write by the per-call policy, then delegate to the inherited
   * atomic write. See {@link checkedTarget}.
   * @param target - the resolved target to write.
   * @param content - the full new file content.
   * @param expected - the write intent guarding the write; omit for unconditional.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root; omit to use
   *   the deployment fallback.
   * @returns the write outcome from the inherited backend.
   */
  /**
   * 先用按调用策略围栏写入，再委托给继承的原子写（细节见 checkedTarget）。
   * @param target 要写入的已解析目标。
   * @param content 完整的新文件内容。
   * @param expected 守卫写入的写意图；省略为无条件。
   * @param signal 在原子发布生效前中止。
   * @param sandboxPolicy 本次调用的模式与工作区根；省略用部署回退。
   * @returns 继承后端的写入结果。
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal)
  }

  /**
   * Fence the edit by the per-call policy, then delegate to the inherited
   * atomic edit. See {@link checkedTarget}.
   * @param target - the resolved target to edit.
   * @param edit - the literal search/replace request.
   * @param expected - the version guard; omit for an unconditional edit.
   * @param signal - aborts before atomic publication takes effect.
   * @param sandboxPolicy - the per-call mode and workspace root; omit to use
   *   the deployment fallback.
   * @returns the edit outcome from the inherited backend.
   */
  /**
   * 先用按调用策略围栏编辑，再委托给继承的原子编辑（细节见 checkedTarget）。
   * @param target 要编辑的已解析目标。
   * @param edit 字面查找/替换请求。
   * @param expected 版本守卫；省略为无条件编辑。
   * @param signal 在原子发布生效前中止。
   * @param sandboxPolicy 本次调用的模式与工作区根；省略用部署回退。
   * @returns 继承后端的编辑结果。
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.editText(await this.checkedTarget(target, sandboxPolicy), edit, expected, signal)
  }

  /**
   * Enforce the per-call policy against `target` and return the EXACT target the
   * mutation must use, so the checked identity is the mutated one (no
   * check-here-write-there TOCTOU). `read-only` denies; `workspace-write`
   * re-canonicalizes NOW (`resolve` realpaths the deepest existing ancestor,
   * reflecting a concurrently swapped symlink), requires containment under a
   * writable root, and returns THAT fresh target; `danger-full-access` returns
   * the caller's target unfenced. Throws the structured `FS_SANDBOX_DENIED` on
   * refusal — the tool layer maps it to the model-facing `[sandbox: …]` marker
   * and the escalation hint.
   */
  /**
   * 对 target 执行按调用策略检查，并返回"变更必须使用的确切目标"——被检查的身份
   * 就是被变更的身份（没有"这里检查、那里写入"的 TOCTOU）。read-only 拒绝；
   * workspace-write 此刻立即重新规范化（resolve 会 realpath 最深已存在祖先，反映
   * 并发换掉的符号链接），要求落在可写根之下，并返回那个新鲜目标；
   * danger-full-access 原样返回调用方目标、不加围栏。拒绝时抛结构化 FS_SANDBOX_DENIED
   * ——工具层把它映射成模型可见的 [sandbox: …] 标记与升级提示。
   */
  private async checkedTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget> {
    // 策略解析：显式传入的优先，否则用当前会话的部署策略。
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    const { mode } = policy
    if (mode === 'danger-full-access') return target
    if (mode === 'read-only') {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
    }
    // workspace-write: containment on the FRESH canonical path (catches a
    // symlink ancestor swapped since the tool resolved this target), and the
    // mutation delegates with THIS fresh target — never the stale one.
    // 中文说明：workspace-write 在"新鲜规范路径"上做包含判定（能抓住工具解析后
    // 被换掉的符号链接祖先），变更委托时用这个新鲜目标——绝不用旧的。
    const fresh = await this.resolve(target.displayPath)
    let contained = false
    // 可写根集合（工作区根 + 平台临时区）来自共享的 writableRoots，命中任一即放行。
    for (const root of writableRoots(policy)) {
      if (await isPathUnder(fresh.targetKey, root)) {
        contained = true
        break
      }
    }
    if (!contained) {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
    }
    return fresh
  }
}

// 服务包默认导出服务类本身（packages/AGENTS.md 约定）。
export default SandboxedFileSystem
