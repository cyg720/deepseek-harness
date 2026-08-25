/**
 * 文件职责：验证 coverage-partitions.spec.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { access, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COVERAGE_PARTITION_MODE_ENV,
  COVERAGE_PARTITIONS_ENV,
  COVERAGE_TEST_TIMEOUT_ENV,
  CoveragePartitionCoordinator,
  coverageTestTimeoutArgs,
  forwardedCoverageArgs,
  parseCoveragePartitionCount,
  /** 中文说明：type CoverageCommand 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
  type CoverageCommand,
  /** 中文说明：type CoverageCommandResult 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
  type CoverageCommandResult,
} from './coverage-partitions.ts'

/** 中文说明：变量 passed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const passed: CoverageCommandResult = { exitCode: 0, signalCode: null }

afterEach(() => vi.restoreAllMocks())

/** 中文说明：函数 writeBlob 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function writeBlob(command: CoverageCommand): Promise<void> {
  if (command.blobPath === undefined) return
  await mkdir(dirname(command.blobPath), { recursive: true })
  await writeFile(command.blobPath, '{}')
}

/** 中文说明：函数 temporaryRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function temporaryRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-coverage-partitions-'))
}

/** 中文说明：函数 successfulCommandRecorder 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function successfulCommandRecorder(commands: CoverageCommand[]) {
  return vi.fn(async (command: CoverageCommand) => {
    commands.push(command)
    await writeBlob(command)
    return passed
  })
}

describe('coverage partition count', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['2', 2],
    ['3', 3],
  ])('parses %j as %j', (raw, expected) => {
    expect(parseCoveragePartitionCount(raw)).toBe(expected)
  })

  it.each(['0', '1', '2.5', '02', 'many'])('rejects %j', (raw) => {
    expect(() => parseCoveragePartitionCount(raw))
      .toThrow(`${COVERAGE_PARTITIONS_ENV} must be an integer greater than 1`)
  })
})

describe('coverage partition timeout', () => {
  it('applies one configured timeout to tests and polling', () => {
    expect(coverageTestTimeoutArgs('30000')).toEqual([
      '--testTimeout=30000',
      '--expect.poll.timeout=30000',
    ])
  })

  it('keeps Vitest defaults when the timeout is absent', () => {
    expect(coverageTestTimeoutArgs(undefined)).toEqual([])
  })

  it('rejects invalid timeout input', () => {
    expect(() => coverageTestTimeoutArgs('0'))
      .toThrow(`${COVERAGE_TEST_TIMEOUT_ENV} must be a positive integer`)
  })
})

describe('coverage forwarded arguments', () => {
  it('removes one package-script separator', () => {
    expect(forwardedCoverageArgs(['--', 'scripts/example.spec.ts'])).toEqual(['scripts/example.spec.ts'])
  })

  it('preserves direct arguments and a subsequent Vitest separator', () => {
    expect(forwardedCoverageArgs(['--testNamePattern=example'])).toEqual(['--testNamePattern=example'])
    expect(forwardedCoverageArgs(['--', '--', 'example'])).toEqual(['--', 'example'])
  })
})

describe('coverage partition coordinator', () => {
  it('runs every single-worker partition before one merged threshold check', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：变量 commands 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commands: CoverageCommand[] = []
    /** 中文说明：变量 runCommand 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runCommand = successfulCommandRecorder(commands)
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 3,
      pnpmEntrypoint: '/pnpm.cjs',
      vitestArgs: ['--testTimeout=30000'],
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)

    expect(commands.map(command => command.label)).toEqual([
      'partition 1/3',
      'partition 2/3',
      'partition 3/3',
      'merged coverage report',
    ])
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const [index, command] of commands.slice(0, 3).entries()) {
      expect(command.command).toBe(process.execPath)
      expect(command.args[0]).toBe('/pnpm.cjs')
      expect(command.args).toEqual(expect.arrayContaining([
        '--coverage',
        '--coverage.reportOnFailure',
        '--maxWorkers=1',
        `--shard=${index + 1}/3`,
        '--reporter=default',
        '--reporter=blob',
        '--testTimeout=30000',
      ]))
      expect(command.env).toEqual({
        [COVERAGE_PARTITIONS_ENV]: undefined,
        [COVERAGE_PARTITION_MODE_ENV]: '1',
      })
    }
    /** 中文说明：变量 mergeCommand 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mergeCommand = commands[3]
    if (mergeCommand === undefined) throw new Error('coverage merge command was not observed')
    expect(mergeCommand.args).toContain('--coverage')
    expect(mergeCommand.args.some(argument => argument.startsWith('--merge-reports='))).toBe(true)
    expect(mergeCommand.env).toEqual({
      [COVERAGE_PARTITIONS_ENV]: undefined,
      [COVERAGE_PARTITION_MODE_ENV]: undefined,
    })
  })

  it('runs a native pnpm entrypoint directly', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：变量 commands 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commands: CoverageCommand[] = []
    /** 中文说明：变量 runCommand 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runCommand = successfulCommandRecorder(commands)
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/tools/pnpm',
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)
    expect(commands).toHaveLength(3)
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const command of commands) {
      expect(command.command).toBe('/tools/pnpm')
      expect(command.args[0]).toBe('exec')
    }
  })

  it('merges normal test failures and returns their failed status', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：函数值 reported 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    /** 中文说明：函数值 runCommand 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      await writeBlob(command)
      return command.label === 'partition 2/2'
        ? { exitCode: 1, signalCode: null, outputTail: 'specific Vitest failure' }
        : passed
    })
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(1)
    expect(reported).toHaveBeenCalledWith('coverage-partitions: FAIL partition 2/2 (exit 1)')
    expect(reported).toHaveBeenCalledWith(
      'coverage-partitions: output tail for partition 2/2:\nspecific Vitest failure',
    )
    expect(runCommand).toHaveBeenCalledTimes(3)
  })

  it('rejects a missing partition blob before merge', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：函数值 runCommand 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      if (command.label !== 'partition 2/2') await writeBlob(command)
      return passed
    })
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      runCommand,
    })

    await expect(coordinator.run()).rejects.toThrow('coverage partitions produced')
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('reports signal termination before missing-blob validation', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：函数值 reported 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    /** 中文说明：函数值 runCommand 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      if (command.label === 'partition 1/2') await writeBlob(command)
      return command.label === 'partition 2/2'
        ? { exitCode: null, signalCode: 'SIGTERM' as const }
        : passed
    })
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      runCommand,
    })

    await expect(coordinator.run()).rejects.toThrow('coverage partitions produced')
    expect(reported).toHaveBeenCalledWith('coverage-partitions: FAIL partition 2/2 (signal SIGTERM)')
  })

  it('waits for every partition after one spawn failure', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：函数值 reported 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    /** 中文说明：变量 secondFinished 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let secondFinished = false
    /** 中文说明：函数值 runCommand 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      await writeBlob(command)
      if (command.label === 'partition 1/2') {
        return { exitCode: null, signalCode: null, error: 'spawn unavailable' }
      }
      if (command.label === 'partition 2/2') secondFinished = true
      return passed
    })
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(1)
    expect(reported).toHaveBeenCalledWith('coverage-partitions: FAIL partition 1/2 (spawn unavailable)')
    expect(secondFinished).toBe(true)
    expect(runCommand).toHaveBeenCalledTimes(3)
  })

  it('unlinks a link-shaped coverage path without touching its target', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await temporaryRoot()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await temporaryRoot()
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(target, 'marker.txt')
    await writeFile(marker, 'owned elsewhere')
    await symlink(target, join(root, 'coverage'), process.platform === 'win32' ? 'junction' : 'dir')
    /** 中文说明：函数值 runCommand 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runCommand = vi.fn(async (command: CoverageCommand) => {
      await writeBlob(command)
      return passed
    })
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coordinator = new CoveragePartitionCoordinator({
      root,
      partitions: 2,
      pnpmEntrypoint: '/pnpm.cjs',
      runCommand,
    })

    await expect(coordinator.run()).resolves.toBe(0)
    await expect(access(marker)).resolves.toBeUndefined()
  })
})
