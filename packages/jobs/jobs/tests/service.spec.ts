/**
 * 文件职责：验证后台任务的 service.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证后台任务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type {
  JobDoneListener, JobRead, JobSnapshot, JobStart, JobsChangedListener,
} from '@deepseek-ai/dsh-jobs'

/**
 * Minimal concrete registry: one canned record. The Service Definition owns the contract
 * only (ids, snapshots, authorization-shaped signatures); the registry
 * behavior suite lives with `@deepseek-ai/dsh-jobs-local`.
 */
/** 中文说明：类型或类 StubJobRegistry 约束宿主、交互或任务数据职责。 */
class StubJobRegistry extends JobRegistry {
  snapshotOf(id: JobId): JobSnapshot {
    return {
      id,
      kind: 'bash',
      label: 'sleep 60',
      status: 'running',
      startedAt: 0,
      reported: false,
    }
  }

  start(spec: JobStart): JobId {
    spec.run()
    return JobId(`${spec.kind}-1`)
  }

  list(): JobSnapshot[] {
    return [this.snapshotOf(JobId('bash-1'))]
  }

  get(id: JobId): JobSnapshot {
    return this.snapshotOf(id)
  }

  read(id: JobId): JobRead {
    return { text: '', snapshot: this.snapshotOf(id) }
  }

  kill(): 'requested' | 'already-finished' {
    return 'requested'
  }

  wait(id: JobId, _timeoutMs: number, _caller?: Agent, _signal?: AbortSignal): Promise<JobSnapshot> {
    return Promise.resolve(this.snapshotOf(id))
  }

  onJobDone(_listener: JobDoneListener): () => void {
    return () => {}
  }

  onJobsChanged(_listener: JobsChangedListener): () => void {
    return () => {}
  }

  attachController(_name: string): () => void {
    return () => {}
  }
}

describe('JobRegistry seam', () => {
  it('a concrete subclass registers as ctx.jobs and serves the abstract API', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(StubJobRegistry)

    /** 中文说明：测试局部值 detachController，由紧邻初始化决定。 */
    const detachController = ctx.jobs.attachController('seam-test')
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ctx.jobs.start({ kind: 'bash', label: 'sleep 60', run: () => ({ cancel() {}, done: new Promise(() => {}) }) })
    expect(id).toBe('bash-1')
    expect(ctx.jobs.list()).toHaveLength(1)
    expect(ctx.jobs.get(id).status).toBe('running')
    expect(ctx.jobs.read(id).text).toBe('')
    expect(ctx.jobs.kill(id)).toBe('requested')
    await expect(ctx.jobs.wait(id, 5)).resolves.toMatchObject({ id })
    /** 中文说明：测试局部值 detachListener，由紧邻初始化决定。 */
    const detachListener = ctx.jobs.onJobDone(() => {})
    detachListener()
    /** 中文说明：测试局部值 detachChanges，由紧邻初始化决定。 */
    const detachChanges = ctx.jobs.onJobsChanged(() => {})
    detachChanges()
    detachController()
  })

  it('loading a second implementation throws (one jobs service per context — cordis standard)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(StubJobRegistry)
    /** 中文说明：类型或类 SecondJobRegistry 约束宿主、交互或任务数据职责。 */
    class SecondJobRegistry extends StubJobRegistry {}
    await expect(ctx.plugin(SecondJobRegistry)).rejects.toThrow(/service "jobs" has been registered/)
  })

  it('mounting the abstract seam directly fails loudly at load (stale-composition fence)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await expect(ctx.plugin(JobRegistry as unknown as typeof StubJobRegistry))
      .rejects.toThrow(/abstract job registry seam; load an implementation such as @deepseek-ai\/dsh-jobs-local/)
  })
})
