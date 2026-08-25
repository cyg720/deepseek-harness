/**
 * 文件职责：实现 run-oxlint.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 中文说明：变量 oxlintCli 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const oxlintCli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url))
/** 中文说明：常量 MAX_CAPTURED_OUTPUT_BYTES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024
/** 中文说明：常量 FIX_FLAGS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIX_FLAGS = new Set(['--fix', '--fix-dangerously', '--fix-suggestions'])

/** 中文说明：函数 isFixInvocation 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isFixInvocation(args: readonly string[]): boolean {
  return args.some(arg => FIX_FLAGS.has(arg))
}

/** 中文说明：函数 hasOutputFormat 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hasOutputFormat(args: readonly string[]): boolean {
  return args.some(arg =>
    arg === '-f'
    || arg.startsWith('-f=')
    || arg === '--format'
    || arg.startsWith('--format='))
}

/** Complete Oxlint child-process arguments and environment. */
/* 中文说明：interface OxlintInvocation 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface OxlintInvocation {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * Apply the repository worker bound to both Oxlint backends.
 * @param args - Oxlint CLI arguments requested by the caller.
 * @param env - Environment inherited by the Oxlint process.
 * @returns the complete CLI arguments and child environment.
 */
/* 中文说明：函数 resolveOxlintInvocation 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function resolveOxlintInvocation(args: readonly string[], env: NodeJS.ProcessEnv): OxlintInvocation {
  /** 中文说明：变量 resolvedArgs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolvedArgs = [...args]
  if (env.CI === 'true' && !hasOutputFormat(args)) resolvedArgs.push('--format=unix')
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = env.DSH_OXLINT_THREADS
  if (raw === undefined || raw === '') return { args: resolvedArgs, env: { ...env } }
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`run-oxlint: DSH_OXLINT_THREADS must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  if (args.some(arg => arg === '--threads' || arg.startsWith('--threads='))) {
    throw new Error('run-oxlint: use DSH_OXLINT_THREADS instead of passing --threads directly.')
  }
  return {
    args: [...resolvedArgs, `--threads=${raw}`],
    env: { ...env, GOMAXPROCS: raw },
  }
}

/** 中文说明：函数 completeFrom 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function completeFrom(result: { readonly signal: NodeJS.Signals | null; readonly status: number | null }): void {
  if (result.signal !== null) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exitCode = result.status ?? 1
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  /** 中文说明：变量 invocation 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const invocation = resolveOxlintInvocation(process.argv.slice(2), process.env)
  if (!isFixInvocation(invocation.args)) {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
      env: invocation.env,
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    completeFrom(result)
    return
  }

  /** 中文说明：变量 first 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
    encoding: 'utf8',
    env: invocation.env,
    maxBuffer: MAX_CAPTURED_OUTPUT_BYTES,
  })
  if (first.error !== undefined) throw first.error
  if (first.signal !== null) {
    completeFrom(first)
    return
  }
  if (first.status === 0) {
    process.stdout.write(first.stdout)
    process.stderr.write(first.stderr)
    process.exitCode = 0
    return
  }

  // Overlapping JS-plugin fixes can expose one more fixable diagnostic after the first pass.
  /** 中文说明：变量 second 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const second = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
    env: invocation.env,
    stdio: 'inherit',
  })
  if (second.error !== undefined) throw second.error
  completeFrom(second)
}

/** 中文说明：变量 entrypoint 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const entrypoint = process.argv[1]
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main()
