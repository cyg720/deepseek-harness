/**
 * The per-workspace write identity: a deterministic `S-1-4-x-y` SID derived
 * from the canonical workspace path, whose ACEs form that workspace's write
 * allowlist. Every confined execution of the same workspace — across
 * sessions, server restarts, and calls — carries the SAME write SID, so the
 * workspace-root ACE materializes once per workspace per machine (the
 * grant's exact-ACE skip then makes every later provision O(1)) instead of
 * once per session. The SID's power is defined solely by the ACEs that name
 * it (which exist only on the workspace tree and the session's private temp
 * directory), and only tokens minted for that workspace carry it — the SID
 * string itself is not a secret. Temporary directories use a separate,
 * per-directory identity from {@link tempWriteSid}; sharing the workspace
 * identity with temp would let sibling sessions write one another's temp
 * trees.
 *
 * The input MUST be the canonical workspace path (`realpathSync.native` on
 * Windows — the sandbox-policy `resolveWorkspaceRoot` already applies it):
 * canonicalization converges case/alias spellings, so two spellings of one
 * workspace derive one SID; an as-spelled fallback path would mint a second
 * identity for the same directory (self-healing, at the cost of one extra
 * tree propagation). Renaming the workspace directory derives a new SID —
 * the old standing ACEs are inert residue, and the next session re-propagates
 * once.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/workspace-sid
 */
/*
 * 文件职责：实现 workspace-sid.ts 承担的沙箱安全与权限隔离配置、协议与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验、事件日志与异步资源管理。
 * 产品维度：为 Agent 提供可靠的沙箱安全与权限隔离能力。
 * 逻辑维度：解析输入，注册能力，执行核心操作，并在结束时释放所拥有的资源。
 * 关键边界：权限和配置失败必须显式；模型可见状态必须记录；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型和常量，再读主流程，最后关注平台限制、恢复和清理。
 */

import { createHash } from 'node:crypto'

/**
 * Derive the workspace's write SID (`S-1-4-x-y`; subauthorities 30-bit,
 * matching the workspace-capability shape the token and ACE layers carry).
 * @param workspaceRoot - the canonical workspace path.
 * @returns the SDDL string form.
 */
/*
 * 中文说明：函数 workspaceWriteSid 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param workspaceRoot 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function workspaceWriteSid(workspaceRoot: string): string {
  /** 中文说明：变量 digest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const digest = createHash('sha256').update(workspaceRoot, 'utf8').digest()
  /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1
  /** 中文说明：变量 second 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1
  return `S-1-4-${first}-${second}`
}

/**
 * Derive one private temp directory's write SID. The random directory path
 * is the capability identity; a fixed third subauthority domain-separates
 * the result from every two-subauthority workspace SID.
 * @param tempDir - the private temp directory's absolute path.
 * @returns the SDDL string form.
 */
/*
 * 中文说明：函数 tempWriteSid 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param tempDir 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function tempWriteSid(tempDir: string): string {
  /** 中文说明：变量 digest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const digest = createHash('sha256').update('temp\0', 'utf8').update(tempDir, 'utf8').digest()
  /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1
  /** 中文说明：变量 second 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1
  return `S-1-4-${first}-${second}-1`
}
