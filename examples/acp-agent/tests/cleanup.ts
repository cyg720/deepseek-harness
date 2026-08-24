/** Shared teardown for ACP example tests. */
/**
 * 文件职责：为 ACP 示例测试统一关闭代理进程并删除临时工作区，同时汇总所有清理失败。
 * 技术维度：使用 Promise.allSettled、递归强制删除和 AggregateError 实现尽力清理。
 * 产品维度：保持示例测试相互隔离，不因一次清理失败掩盖另一个资源泄漏。
 * 逻辑维度：分别尝试关闭已启动代理和删除目录，收集 rejected 原因，最后一次性抛出。
 * 关键边界：关闭使用 SIGKILL；两个参数都允许 undefined，清理函数仍应成功返回。
 * 新手阅读建议：先看 results 如何积累两个操作，再看 failures 为什么在全部尝试后才抛出。
 */

import { rm } from 'node:fs/promises'
import type { LaunchedAcpTestAgent } from '@deepseek-ai/dsh-acp-snapshot'

/**
 * Close the test agent, then remove its workspace, attempting both operations
 * and reporting every failure instead of allowing the later one to mask the
 * earlier one.
 */
/**
 * 关闭 ACP 测试代理并删除其工作区，两个操作都会被尝试。
 * @param spawned - 可选的已启动测试代理，只需提供 close 方法。
 * @param workdir - 可选临时工作区路径。
 * @returns 所有清理成功时完成；有失败时抛出包含全部原因的 AggregateError。
 * @example await cleanupAcpExampleTest(agent, tempDir)。
 */
export async function cleanupAcpExampleTest(
  spawned: Pick<LaunchedAcpTestAgent, 'close'> | undefined,
  workdir: string | undefined,
): Promise<void> {
  // results：每个实际执行清理操作的 fulfilled 或 rejected 结果。
  const results: PromiseSettledResult<unknown>[] = []
  if (spawned !== undefined) results.push(...await Promise.allSettled([spawned.close('SIGKILL')]))
  if (workdir !== undefined) results.push(...await Promise.allSettled([rm(workdir, { recursive: true, force: true })]))

  // failures：从全部清理结果中提取的原始拒绝原因，不让后执行失败遮盖先前失败。
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason as unknown)
  if (failures.length > 0) throw new AggregateError(failures, 'ACP example cleanup failed')
}
