/** Coordinate single-worker Vitest coverage partitions and one merged report. */
/**
 * 文件职责：实现 coverage-partitions.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
import { spawn } from 'node:child_process'
import { lstat, mkdir, readdir, rm, unlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Environment variable selecting the number of instrumented coverage processes. */
/** 中文说明：常量 COVERAGE_PARTITIONS_ENV 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const COVERAGE_PARTITIONS_ENV = 'DSH_COVERAGE_PARTITIONS'

/** Internal marker that suppresses reports and thresholds inside a partition process. */
/** 中文说明：常量 COVERAGE_PARTITION_MODE_ENV 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const COVERAGE_PARTITION_MODE_ENV = 'DSH_COVERAGE_PARTITION_MODE'

/** Environment variable overriding instrumented test and polling timeouts. */
/** 中文说明：常量 COVERAGE_TEST_TIMEOUT_ENV 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const COVERAGE_TEST_TIMEOUT_ENV = 'DSH_COVERAGE_TEST_TIMEOUT_MS'

/** One child command owned by the coverage coordinator. */
/** 中文说明：interface CoverageCommand 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface CoverageCommand {
  /** Diagnostic identity. */
  label: string
  /** Executable launched without a platform shell. */
  command: string
  /** Arguments passed to the executable. */
  args: string[]
  /** Environment additions for the child. */
  env: Record<string, string | undefined>
  /** Working directory for the child. */
  cwd: string
  /** Blob the partition must produce; absent for the merge command. */
  blobPath?: string
}

/** Observable child-process completion. */
/** 中文说明：interface CoverageCommandResult 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface CoverageCommandResult {
  /** Numeric process status, or `null` when a signal ended the child. */
  exitCode: number | null
  /** Terminating signal, or `null` after an ordinary exit. */
  signalCode: NodeJS.Signals | null
  /** Spawn failure recorded independently from process completion. */
  error?: string
  /** Bounded combined stdout/stderr tail repeated when the command fails. */
  outputTail?: string
}

/** Execute one coordinator command with inherited output. */
/** 中文说明：type CoverageCommandRunner 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export type CoverageCommandRunner = (command: CoverageCommand) => Promise<CoverageCommandResult>

/** Construction inputs for {@link CoveragePartitionCoordinator}. */
/** 中文说明：interface CoveragePartitionCoordinatorOptions 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface CoveragePartitionCoordinatorOptions {
  /** Repository root that owns coverage output. */
  root: string
  /** Number of concurrent single-worker Vitest processes. */
  partitions: number
  /** pnpm JavaScript or executable entrypoint from `npm_execpath`. */
  pnpmEntrypoint: string
  /** Additional arguments shared by every partition. */
  vitestArgs?: string[]
  /** Child executor, injectable for scheduler tests. */
  runCommand?: CoverageCommandRunner
}

/** Parse an optional coverage partition count. */
/** 中文说明：函数 parseCoveragePartitionCount 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function parseCoveragePartitionCount(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 2 || String(parsed) !== raw) {
    throw new Error(`${COVERAGE_PARTITIONS_ENV} must be an integer greater than 1, got ${JSON.stringify(raw)}.`)
  }
  return parsed
}

/** Resolve the paired Vitest timeout arguments used by coverage partitions. */
/** 中文说明：函数 coverageTestTimeoutArgs 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function coverageTestTimeoutArgs(raw: string | undefined): string[] {
  if (raw === undefined || raw === '') return []
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`${COVERAGE_TEST_TIMEOUT_ENV} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return [`--testTimeout=${raw}`, `--expect.poll.timeout=${raw}`]
}

/** Remove pnpm's package-script separator before forwarding Vitest arguments. */
/** 中文说明：函数 forwardedCoverageArgs 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function forwardedCoverageArgs(args: readonly string[]): string[] {
  return [...args.slice(args[0] === '--' ? 1 : 0)]
}

/** Run instrumented partitions, validate their blobs, and merge once. */
/** 中文说明：class CoveragePartitionCoordinator 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export class CoveragePartitionCoordinator {
  private readonly root: string
  private readonly partitions: number
  private readonly pnpmEntrypoint: string
  private readonly vitestArgs: string[]
  private readonly runCommand: CoverageCommandRunner
  private readonly temporaryRoot: string
  private readonly blobsRoot: string

  /** Create a coordinator from validated process-independent inputs. */
  public constructor(options: CoveragePartitionCoordinatorOptions) {
    if (!Number.isSafeInteger(options.partitions) || options.partitions < 2) {
      throw new Error(`coverage partitions must be an integer greater than 1, got ${String(options.partitions)}.`)
    }
    this.root = options.root
    this.partitions = options.partitions
    this.pnpmEntrypoint = options.pnpmEntrypoint
    this.vitestArgs = options.vitestArgs ?? []
    this.runCommand = options.runCommand ?? runCoverageCommand
    this.temporaryRoot = join(this.root, 'coverage', '.partitioned')
    this.blobsRoot = join(this.temporaryRoot, 'blobs')
  }

  /**
   * Run every partition before one merged threshold check.
   * @returns zero only when every partition and the merge command succeed.
   */
  public async run(): Promise<number> {
    await removeOwnedTree(join(this.root, 'coverage'))
    await mkdir(this.blobsRoot, { recursive: true })

    try {
      /** 中文说明：变量 commands 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const commands = Array.from(
        { length: this.partitions },
        (_, index) => this.partitionCommand(index + 1),
      )
      /** 中文说明：函数值 results 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const results = await Promise.all(commands.map(async (command) => {
        console.log(`coverage-partitions: start ${command.label}`)
        /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const result = await this.runCommand(command)
        if (commandFailed(result)) {
          console.error(`coverage-partitions: FAIL ${command.label} (${commandFailureReason(result)})`)
          if (result.outputTail !== undefined && result.outputTail !== '') {
            console.error(`coverage-partitions: output tail for ${command.label}:\n${result.outputTail}`)
          }
        }
        return result
      }))
      await this.assertCompleteBlobSet(commands)

      /** 中文说明：变量 mergeCommand 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const mergeCommand = this.mergeCommand()
      console.log(`coverage-partitions: start ${mergeCommand.label}`)
      /** 中文说明：变量 mergeResult 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const mergeResult = await this.runCommand(mergeCommand)
      return results.some(commandFailed) || commandFailed(mergeResult) ? 1 : 0
    } finally {
      await removeOwnedTree(this.temporaryRoot)
    }
  }

  private partitionCommand(index: number): CoverageCommand {
    /** 中文说明：变量 blobPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blobPath = join(this.blobsRoot, `partition-${index}.json`)
    /** 中文说明：变量 reportsDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reportsDirectory = join(this.temporaryRoot, `coverage-${index}`)
    /** 中文说明：变量 invocation 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invocation = pnpmInvocation([
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reportOnFailure',
      '--maxWorkers=1',
      `--shard=${index}/${this.partitions}`,
      '--reporter=default',
      '--reporter=blob',
      `--outputFile.blob=${this.relativePath(blobPath)}`,
      `--coverage.reportsDirectory=${this.relativePath(reportsDirectory)}`,
      ...this.vitestArgs,
    ], { npm_execpath: this.pnpmEntrypoint })
    return {
      label: `partition ${index}/${this.partitions}`,
      ...invocation,
      env: {
        [COVERAGE_PARTITIONS_ENV]: undefined,
        [COVERAGE_PARTITION_MODE_ENV]: '1',
      },
      cwd: this.root,
      blobPath,
    }
  }

  private mergeCommand(): CoverageCommand {
    /** 中文说明：变量 invocation 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invocation = pnpmInvocation([
      'exec',
      'vitest',
      `--merge-reports=${this.relativePath(this.blobsRoot)}`,
      '--coverage',
    ], { npm_execpath: this.pnpmEntrypoint })
    return {
      label: 'merged coverage report',
      ...invocation,
      env: {
        [COVERAGE_PARTITIONS_ENV]: undefined,
        [COVERAGE_PARTITION_MODE_ENV]: undefined,
      },
      cwd: this.root,
    }
  }

  private relativePath(path: string): string {
    return relative(this.root, path).split(sep).join('/')
  }

  private async assertCompleteBlobSet(commands: CoverageCommand[]): Promise<void> {
    /** 中文说明：函数值 expected 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const expected = commands.map((command) => {
      if (command.blobPath === undefined) throw new Error(`${command.label} has no blob path.`)
      return this.relativePath(command.blobPath)
    }).sort()
    /** 中文说明：变量 actual 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const actual = (await readdir(this.blobsRoot))
      .map(name => this.relativePath(join(this.blobsRoot, name)))
      .sort()
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error(`coverage partitions produced ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`)
    }
  }
}

/** Spawn one pnpm-backed command without a platform shell. */
/** 中文说明：函数 runCoverageCommand 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function runCoverageCommand(command: CoverageCommand): Promise<CoverageCommandResult> {
  return new Promise((resolveCommand) => {
    /** 中文说明：变量 outputTail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let outputTail = ''
    /** 中文说明：变量 env 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const env = { ...process.env }
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const [name, value] of Object.entries(command.env)) {
      if (value === undefined) Reflect.deleteProperty(env, name)
      else env[name] = value
    }
    /** 中文说明：变量 child 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      process.stdout.write(chunk)
      outputTail = appendOutputTail(outputTail, chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      process.stderr.write(chunk)
      outputTail = appendOutputTail(outputTail, chunk)
    })
    child.once('error', (error: Error) => {
      resolveCommand({ exitCode: null, signalCode: null, error: error.message, outputTail })
    })
    child.once('close', (exitCode, signalCode) => {
      resolveCommand({ exitCode, signalCode, outputTail })
    })
  })
}

/** 中文说明：函数 appendOutputTail 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function appendOutputTail(previous: string, chunk: string): string {
  /** 中文说明：变量 combined 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const combined = previous + chunk
  return combined.length <= 65_536 ? combined : combined.slice(-65_536)
}

/** 中文说明：函数 commandFailed 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function commandFailed(result: CoverageCommandResult): boolean {
  return result.exitCode !== 0 || result.signalCode !== null || result.error !== undefined
}

/** 中文说明：函数 commandFailureReason 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function commandFailureReason(result: CoverageCommandResult): string {
  /** 中文说明：变量 facts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const facts = [
    result.error,
    result.exitCode === null ? undefined : `exit ${result.exitCode}`,
    result.signalCode === null ? undefined : `signal ${result.signalCode}`,
  ].filter((fact): fact is string => fact !== undefined)
  return facts.join(', ') || 'no exit code or signal'
}

/** 中文说明：函数 removeOwnedTree 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function removeOwnedTree(path: string): Promise<void> {
  /** 中文说明：函数值 metadata 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const metadata = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  if (metadata === undefined) return
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    await unlink(path)
    return
  }
  await rm(path, { recursive: true, force: true })
}
