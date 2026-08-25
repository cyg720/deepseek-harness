/** CLI entry for partitioned Vitest coverage. */
/*
 * 文件职责：解析分区覆盖率环境和透传参数，启动 CoveragePartitionCoordinator。
 * 技术维度：使用顶层 await、pnpm 生命周期入口和 Vitest 参数辅助函数协调多个子进程。
 * 产品维度：把大型覆盖率门禁拆分并行执行，缩短反馈时间同时保持汇总结果一致。
 * 逻辑维度：校验分区数与 pnpm 入口，构建协调器配置，运行后把状态写入 process.exitCode。
 * 关键边界：必须通过 pnpm 包脚本启动并设置分区环境变量；无效配置立即失败。
 * 新手阅读建议：先看两个前置校验，再展开 coordinator 配置中的 root、partitions 和 vitestArgs。
 */
import { resolve } from 'node:path'
import {
  COVERAGE_PARTITIONS_ENV,
  COVERAGE_TEST_TIMEOUT_ENV,
  CoveragePartitionCoordinator,
  coverageTestTimeoutArgs,
  forwardedCoverageArgs,
  parseCoveragePartitionCount,
} from './coverage-partitions.ts'

// partitions：从环境解析的正整数分区数量；缺失时不允许继续。
const partitions = parseCoveragePartitionCount(process.env[COVERAGE_PARTITIONS_ENV])
if (partitions === undefined) {
  throw new Error(`${COVERAGE_PARTITIONS_ENV} is required by partitioned coverage.`)
}
// pnpmEntrypoint：当前 pnpm 生命周期的实际入口，用于无 shell 启动覆盖率子进程。
const pnpmEntrypoint = process.env.npm_execpath
if (pnpmEntrypoint === undefined || pnpmEntrypoint === '') {
  throw new Error('partitioned coverage must be invoked through a pnpm package script.')
}

// coordinator：持有仓库根、分区数量、pnpm 入口和最终 Vitest 参数的覆盖率协调器。
const coordinator = new CoveragePartitionCoordinator({
  root: resolve(import.meta.dirname, '..'),
  partitions,
  pnpmEntrypoint,
  vitestArgs: [
    ...coverageTestTimeoutArgs(process.env[COVERAGE_TEST_TIMEOUT_ENV]),
    ...forwardedCoverageArgs(process.argv.slice(2)),
  ],
})
process.exitCode = await coordinator.run()
