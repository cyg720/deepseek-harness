/**
 * 文件职责：验证后台任务的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证后台任务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import JobRegistry, { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobDoneListener, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import * as JobsInvariant from '@deepseek-ai/dsh-jobs/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：测试局部值 BASE，由紧邻初始化决定。 */
const BASE: JobSnapshot = {
  id: JobId('bash-1'),
  kind: 'bash',
  label: 'compile',
  status: 'completed',
  startedAt: 10,
  finishedAt: 20,
  reported: false,
}

/** 中文说明：测试局部值 RUNNING，由紧邻初始化决定。 */
const RUNNING: JobSnapshot = {
  id: JobId('bash-1'),
  kind: 'bash',
  label: 'compile',
  status: 'running',
  startedAt: 10,
  reported: false,
}

/** 中文说明：测试局部值 TERMINAL_WITHOUT_FINISH，由紧邻初始化决定。 */
const TERMINAL_WITHOUT_FINISH: JobSnapshot = {
  id: JobId('bash-1'),
  kind: 'bash',
  label: 'compile',
  status: 'completed',
  startedAt: 10,
  reported: false,
}

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(seed: JobSnapshot[] = []): Promise<(snapshot: unknown, owner?: Agent) => void> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let listener: JobDoneListener | undefined
  /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
  const probe = {
    list: () => seed,
    onJobDone(value: JobDoneListener) {
      listener = value
      return () => { listener = undefined }
    },
  } as unknown as JobRegistry
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin({
    name: 'job-invariant-probe',
    apply(child: Context) { child.provide('jobs', probe) },
  })
  await ctx.plugin(JobsInvariant)
  if (listener === undefined) throw new Error('job invariant did not subscribe to terminal snapshots')
  return (snapshot, owner) => { listener!(snapshot as JobSnapshot, owner) }
}

describe('job-registry invariants', () => {
  it('accepts coherent current and terminal snapshots', async () => {
    /** 中文说明：测试局部值 notify，由紧邻初始化决定。 */
    const notify = await setup([RUNNING])
    expect(() => { notify(BASE) }).not.toThrow()
    /** 中文说明：测试局部值 owner，由紧邻初始化决定。 */
    const owner = { id: SessionId('owner') } as Agent
    expect(() => { notify({ ...BASE, id: JobId('subagent-2'), kind: 'subagent', ownerSession: owner.id }, owner) })
      .not.toThrow()
  })

  it.each([
    [{ ...BASE, id: JobId('-1'), kind: '' }, undefined, /positive ordinal/],
    [{ ...BASE, id: JobId('other-1') }, undefined, /must be "bash-" followed by a positive ordinal/],
    [{ ...BASE, id: JobId('bash-x') }, undefined, /positive ordinal/],
    [{ ...BASE, id: JobId('bash-0') }, undefined, /positive ordinal/],
    [{ ...BASE, startedAt: -1 }, undefined, /startedAt must be a non-negative epoch integer/],
    [{ ...BASE, startedAt: 0.5 }, undefined, /startedAt must be a non-negative epoch integer/],
    [{ ...BASE, status: 'running' }, undefined, /finishedAt must be present exactly for a terminal status/],
    [TERMINAL_WITHOUT_FINISH, undefined, /finishedAt must be present exactly for a terminal status/],
    [{ ...BASE, finishedAt: 9 }, undefined, /no earlier than startedAt/],
    [{ ...BASE, finishedAt: 20.5 }, undefined, /no earlier than startedAt/],
    [{ ...BASE, ownerSession: SessionId('recorded') }, { id: SessionId('actual') } as Agent, /does not match its completion owner/],
  ] as const)('rejects an incoherent registry snapshot', async (snapshot, owner, message) => {
    /** 中文说明：测试局部值 notify，由紧邻初始化决定。 */
    const notify = await setup()
    expect(() => { notify(snapshot, owner) }).toThrow(message)
  })

  it('rejects an incoherent record already present at installation', async () => {
    await expect(setup([{ ...BASE, label: '' }])).rejects.toThrow(/label must be non-empty/)
  })
})
