/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */
/**
 * 文件职责：实现 profiles.ts 承担的沙箱策略与本地隔离配置、注册与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验和系统资源管理。
 * 产品维度：为 Agent 提供可靠的沙箱策略与本地隔离能力。
 * 逻辑维度：解析配置，注册能力，执行核心操作，并在卸载时等待资源停止。
 * 关键边界：安全配置应尽早失败；不得泄露环境凭据；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型与配置，再读主流程，最后关注平台限制和清理。
 */

import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
/** 中文说明：函数 bwrapProfileArgs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  /** 中文说明：变量 args 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
/** 中文说明：函数 landlockProfileArgs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  /** 中文说明：变量 readWrite 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
/** 中文说明：函数 sbplString 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
/** 中文说明：函数 seatbeltProfileArgs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  /** 中文说明：变量 forms 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  /** 中文说明：变量 roots 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  return ['-p', forms.join(' ')]
}
