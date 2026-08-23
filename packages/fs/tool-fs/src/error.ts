/**
 * ================================ 文件注释 ================================
 * 【文件职责】对"带守卫变更失败"的模型侧补救（remediation）：提供者的 FS_STALE_VERSION
 * 与 FS_NOT_OBSERVED 消息只说清了条件、没说唯一正确的恢复方式（重读/先读），
 * 本文件在模型边界给消息追加补救说明；提供者消息保持机器导向、原样不变。
 * 【技术维度】REMEDIES 是"错误码 → 补救文本"映射；remediateFsError 只处理这两个
 * 错误码，构造携带原 code、链上 cause 的新 FsError，其它错误原样穿透。
 * 【产品维度】让模型在收到"文件已变化/未读先写"错误时立刻知道下一步该做什么
 * （重读文件再重试），减少一次无效重试。
 * 【逻辑维度】按出现顺序：REMEDIES（补救映射表）→ remediateFsError（主入口）。
 * 【关键边界】code 被保留（重试/权限/UI 层继续按它路由）；原错误以 cause 链接；
 * 只对两个可补救码生效，其余原样返回。
 * 【新手阅读建议】看 REMEDIES 表理解两个码各补什么，再看 remediateFsError 的
 * 包装逻辑。
 * ==========================================================================
 */
/**
 * Model-facing remediation for guarded-mutation failures. The provider's
 * `FS_STALE_VERSION` and `FS_NOT_OBSERVED` messages state the condition but
 * not the only correct recovery (re-read / read the file), so this package
 * appends the remedy at the model boundary; provider messages stay
 * machine-oriented and unchanged.
 * @module @deepseek-ai/dsh-tool-fs/src/error
 */
/**
 * 模块总览：这是"错误消息装饰器"——只改消息文本，不动错误码与分类。
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsErrorCode } from '@deepseek-ai/dsh-fs'

/** The remedy appended to each remediable failure code's message. */
/**
 * 每个可补救错误码对应的补救文本：
 * FS_STALE_VERSION（文件自上次观察后已变化，包括目标已消失）→ 重读后重试；
 * FS_NOT_OBSERVED（本会话还没读过）→ 先读再重试。
 */
const REMEDIES: Partial<Record<FsErrorCode, string>> = {
  FS_STALE_VERSION: 're-read the file, then retry',
  FS_NOT_OBSERVED: 'read the file, then retry',
}

/**
 * Append the correct recovery instruction to a guarded-mutation failure's
 * message. `FS_STALE_VERSION` (the file changed since this session's last
 * observation, including a missing target) recovers only by re-reading;
 * `FS_NOT_OBSERVED` (no prior read by this session) by reading. The `FsError`
 * code is preserved so retry/permission/UI layers keep routing on it, and the
 * original error chains as `cause`. Anything else passes through untouched.
 * @param error - the caught value from a write/edit execution.
 * @returns a remediated `FsError` for the two guarded-mutation codes, else the original value.
 */
/**
 * 给带守卫变更失败的报错追加正确恢复指引。两个可补救码各补一句（见 REMEDIES），
 * 保留原 FsError code（重试/权限/UI 层继续按它路由），原错误以 cause 链接；
 * 其它错误原样返回。
 * @param error 写/编辑执行中捕获的值。
 * @returns 两个守卫变更错误码得到补救版 FsError，否则返回原值。
 */
export function remediateFsError(error: unknown): unknown {
  if (!(error instanceof FsError)) return error
  const remedy = REMEDIES[error.code]
  if (!remedy) return error
  return new FsError(`${error.message} — ${remedy}`, error.code, { cause: error })
}
