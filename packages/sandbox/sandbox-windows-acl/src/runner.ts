/**
 * The windows-acl confinement runner: the argv-prefix wrapper the sandbox
 * seam spawns in place of the caller's command. It creates the
 * WRITE_RESTRICTED token with the workspace write-SID allowlist, spawns the
 * wrapped argv under it with the CALLER'S stdio inherited (bytes flow
 * straight through), mirrors the child's exit code, and revokes its temp
 * grant on exit (workspace ACEs stay standing as the reuse cache).
 *
 * Stable argv contract (the seam builds it; a native-exe replacement would
 * keep the same contract):
 *   [node, runner.js, '--workspace', <dir>, '--temp', <dir>,
 *    '--mode', <read-only|workspace-write>,
 *    ['--write-sid', <S-1-4-…>,
 *     '--temp-write-sid', <S-1-4-…>], '--', <argv...>]
 *
 * Modes:
 *  - workspace-write: the workspace and temp directories carry distinct
 *    capability-SID Write grants; other ACL-addressable writes are denied
 *    except for the documented Everyone and hard-link boundaries.
 *  - read-only: no capability-SID grants; the restricting list carries no
 *    capability SID, so a standing grant ACE from an earlier
 *    workspace-write period stays inert. BOTH modes drop Authenticated Users
 *    (CIM unavailable — documented in README) and INTERACTIVE/LOCAL (the
 *    Public tree writes are denied); the two lists share the keep-alive group
 *    (logon SID, EVERYONE) and differ only by the capabilities.
 *
 * `--write-sid` + `--temp-write-sid`: the seam's grant contract — the
 * CALLER has already materialized distinct workspace and private-temp ACEs
 * and owns their revocation, so the runner neither grants nor revokes
 * (`manageDacls: false`). Both values are checked against their owning paths.
 * Without the pair (standalone/agentless use), workspace-write treats
 * `--temp` as a ROOT, creates a random private child directory, derives its
 * own temp SID, and removes that directory after the child exits. In both
 * flows the runner rewrites TMP/TEMP in its OWN environment to the private
 * directory before spawning; the child inherits that block (`lpEnvironment`
 * NULL; an explicit block through koffi trips ERROR_INVALID_PARAMETER in
 * CreateProcessAsUserW, verified empirically). Read-only leaves the ambient
 * temp entries untouched (writes there are denied anyway).
 *
 * Failure contract: every runner-side failure (bad args, missing
 * directories, token/grant/spawn errors) prints `windows-acl-run: <detail>`
 * to stderr and exits 127 — the seam's RUNNER_FAILURE_RULES matches that
 * signature. The child is NEVER spawned unrestricted.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/runner
 */
/**
 * 文件职责：实现 runner.ts 承担的沙箱策略或 Windows ACL 隔离职责。
 * 技术维度：使用 TypeScript、Windows 原生接口、访问控制列表和进程生命周期管理。
 * 产品维度：限制 Agent 子进程可访问的系统资源，降低误操作和凭据泄露风险。
 * 逻辑维度：解析策略，构造权限或原生调用，启动受限进程，并等待退出后清理。
 * 关键边界：原生句柄和权限失败必须显式处理；环境变量需净化；清理必须达到静止状态。
 * 新手阅读建议：先看公开配置和 Win32 类型，再读权限授予与启动，最后关注错误和清理。
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { win32 } from './ffi.ts'
import { AclSandbox, assertTempRootOutsideWorkspace } from './index.ts'
import { tempWriteSid, workspaceWriteSid } from './workspace-sid.ts'

/** 中文说明：常量 RUNNER_SIGNATURE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RUNNER_SIGNATURE = 'windows-acl-run'
/** 中文说明：常量 RUNNER_FAILURE_EXIT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RUNNER_FAILURE_EXIT = 127

/** 中文说明：class RunnerFailure 定义本模块所需的数据或行为，用于表达沙箱安全场景。 */
class RunnerFailure extends Error {}

/** Print the runner-failure signature line and unwind. */
/** 中文说明：函数 fail 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function fail(detail: string): never {
  process.stderr.write(`${RUNNER_SIGNATURE}: ${detail}\n`)
  throw new RunnerFailure(detail)
}

/** 中文说明：interface ParsedArgs 定义本模块所需的数据或行为，用于表达沙箱安全场景。 */
interface ParsedArgs {
  workspace: string
  temp: string
  mode: 'read-only' | 'workspace-write'
  writeSid: string | undefined
  tempWriteSid: string | undefined
  command: string
  args: string[]
}

/** 中文说明：函数 parseArgs 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseArgs(raw: string[]): ParsedArgs {
  /** 中文说明：变量 workspace 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let workspace: string | undefined
  /** 中文说明：变量 temp 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let temp: string | undefined
  /** 中文说明：变量 mode 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let mode: string | undefined
  /** 中文说明：变量 writeSid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let writeSid: string | undefined
  /** 中文说明：变量 parsedTempWriteSid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let parsedTempWriteSid: string | undefined
  /** 中文说明：变量 index 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let index = 0
  /** 中文说明：该循环依次处理权限或资源数据；循环变量仅在当前循环中有效。 */
  for (; index < raw.length; index++) {
    /** 中文说明：变量 token 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const token = raw[index]
    if (token === '--') {
      index++
      break
    }
    index++
    /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = raw[index]
    if (value === undefined) fail(`missing value after ${token}`)
    switch (token) {
      case '--workspace': workspace = value; break
      case '--temp': temp = value; break
      case '--mode': mode = value; break
      case '--write-sid': writeSid = value; break
      case '--temp-write-sid': parsedTempWriteSid = value; break
      default: fail(`unknown argument: ${token}`)
    }
  }
  if (workspace === undefined) fail('missing --workspace')
  if (temp === undefined) fail('missing --temp')
  if (mode !== 'read-only' && mode !== 'workspace-write') fail(`unknown mode: ${String(mode)}`)
  /** 中文说明：变量 argv 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const argv = raw.slice(index)
  /** 中文说明：变量 command 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const command = argv[0]
  if (command === undefined) fail('missing command after --')
  return { workspace, temp, mode, writeSid, tempWriteSid: parsedTempWriteSid, command, args: argv.slice(1) }
}

/** 中文说明：函数 requireDirectory 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function requireDirectory(label: string, path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(`${label} is not an existing directory: ${path}`)
  }
}

/** 中文说明：函数 main 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function main(): Promise<number> {
  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = parseArgs(process.argv.slice(2))
  // Both directories are validated in both modes: a provider bug that passes
  // a bogus root must fail loudly at the runner boundary, never mid-child.
  requireDirectory('--workspace', parsed.workspace)
  requireDirectory('--temp', parsed.temp)

  /** 中文说明：变量 seamManaged 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seamManaged = parsed.writeSid !== undefined || parsed.tempWriteSid !== undefined
  if (parsed.mode === 'read-only' && seamManaged) {
    fail('read-only does not accept --write-sid or --temp-write-sid')
  }
  if (parsed.mode === 'workspace-write' && (parsed.writeSid === undefined) !== (parsed.tempWriteSid === undefined)) {
    fail('workspace-write requires --write-sid and --temp-write-sid together')
  }
  if (parsed.mode === 'workspace-write') {
    assertTempRootOutsideWorkspace(parsed.workspace, parsed.temp)
  }

  /** 中文说明：变量 api 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const api = await win32()
  // Ignore this process's own CTRL+C: the confined child (same console) keeps
  // handling its own; the runner must survive to revoke grants and mirror the
  // child's exit code.
  if (api.setConsoleCtrlHandler(null, 1) === 0) {
    fail(`SetConsoleCtrlHandler failed (Win32 ${api.getLastError()})`)
  }

  /** 中文说明：变量 ownedTempDir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let ownedTempDir: string | undefined
  /** 中文说明：变量 sandbox 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let sandbox: AclSandbox | undefined
  /** 中文说明：变量 initialized 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let initialized = false
  try {
    /** 中文说明：变量 privateTempDir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let privateTempDir: string | null = null
    /** 中文说明：变量 writeSid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let writeSid: string | undefined
    /** 中文说明：变量 privateTempSid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let privateTempSid: string | undefined
    if (parsed.mode === 'workspace-write') {
      writeSid = workspaceWriteSid(parsed.workspace)
      if (seamManaged) {
        if (parsed.writeSid !== writeSid) fail('--write-sid does not match --workspace')
        privateTempDir = parsed.temp
        privateTempSid = tempWriteSid(privateTempDir)
        if (parsed.tempWriteSid !== privateTempSid) fail('--temp-write-sid does not match --temp')
      } else {
        ownedTempDir = mkdtempSync(join(parsed.temp, 'dsh-'))
        privateTempDir = ownedTempDir
        privateTempSid = tempWriteSid(privateTempDir)
      }
    }
    sandbox = new AclSandbox({
      writableDirs: parsed.mode === 'workspace-write' ? [parsed.workspace] : [],
      tempDir: privateTempDir,
      mode: parsed.mode,
      ...writeSid === undefined ? {} : { writeSid },
      ...privateTempSid === undefined ? {} : { tempWriteSid: privateTempSid },
      manageDacls: !seamManaged,
    })
    await sandbox.init()
    initialized = true

    if (privateTempDir !== null) {
      if (api.setEnvironmentVariableW('TMP', privateTempDir) === 0) {
        fail(`SetEnvironmentVariableW TMP failed (Win32 ${api.getLastError()})`)
      }
      if (api.setEnvironmentVariableW('TEMP', privateTempDir) === 0) {
        fail(`SetEnvironmentVariableW TEMP failed (Win32 ${api.getLastError()})`)
      }
    }

    /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = sandbox.spawn({
      command: parsed.command,
      args: parsed.args,
      stdio: 'inherit',
    })
    /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await child.wait()
    return result.exitCode
  } finally {
    // Cleanup failures must not mask the child's exit code: report and keep going.
    if (initialized) {
      try {
        sandbox?.dispose()
      } catch (error) {
        process.stderr.write(`${RUNNER_SIGNATURE}: cleanup: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
    if (ownedTempDir !== undefined) {
      try {
        rmSync(ownedTempDir, { recursive: true, force: true })
      } catch (error) {
        process.stderr.write(`${RUNNER_SIGNATURE}: cleanup: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
  }
}

main().then(
  (exitCode) => {
    // Exit-code mirroring is full-width on Windows, verified empirically on
    // this machine (Windows 11 build 26200, Node 24): a child that exits
    // with the NTSTATUS 0xC0000005 (STATUS_ACCESS_VIOLATION) is read back
    // by GetExitCodeProcess as the uint32 3221225477, and after
    // process.exitCode = 3221225477 the parent observes exactly
    // 3221225477 (spawnSync status). PowerShell's $LASTEXITCODE and cmd
    // print the signed view (-1073741819), but no truncation or masking
    // happens anywhere in the chain — the mirror contract holds for the
    // full 32-bit range, so no re-mapping is needed.
    process.exitCode = exitCode
  },
  (error: unknown) => {
    if (!(error instanceof RunnerFailure)) {
      process.stderr.write(`${RUNNER_SIGNATURE}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    process.exitCode = RUNNER_FAILURE_EXIT
  },
)
