/**
 * 文件职责：验证Cordis 宿主运行器的 versioning.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 宿主运行器在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { AGENT_A, CLIENT_CODE, setup } from './helpers.ts'

/** 中文说明：测试局部值 HOST，由紧邻初始化决定。 */
const HOST = 'return { apply() {} }'

describe('dynamic Plugin versions', () => {
  it('keeps currentPackageId when an update fails and clears nextPackageId after rollback', async () => {
    /** 中文说明：测试局部值 { runner }，由紧邻初始化决定。 */
    const { runner } = await setup()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'clock' },
      name: 'clock v1',
      purpose: 'show time',
      code: { host: HOST },
    })
    await expect(runner.run(AGENT_A, first.pluginId, first.packageId, 'run')).resolves.toMatchObject({ ok: true })

    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'existing', pluginId: first.pluginId },
      name: 'clock v2',
      purpose: 'show time',
      code: { host: 'throw new Error("broken update")' },
    })
    await expect(runner.run(AGENT_A, first.pluginId, second.packageId, 'update'))
      .resolves.toMatchObject({ ok: false, reason: 'host-half-failed' })
    expect(runner.inventory()[0]).toMatchObject({
      currentPackageId: first.packageId,
      nextPackageId: second.packageId,
    })
    expect(runner.inventory()[0]?.activeRun).toBeUndefined()

    await expect(runner.run(AGENT_A, first.pluginId, first.packageId, 'run')).resolves.toMatchObject({ ok: true })
    expect(runner.inventory()[0]).toMatchObject({
      currentPackageId: first.packageId,
      activeRun: { packageId: first.packageId },
    })
    expect(runner.inventory()[0]?.nextPackageId).toBeUndefined()
  })

  it('cancels and retracts a Host activation owned by the pending approval', async () => {
    /** 中文说明：测试局部值 { runner, gateway }，由紧邻初始化决定。 */
    const { runner, gateway } = await setup()
    /** 中文说明：测试局部值 defined，由紧邻初始化决定。 */
    const defined = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'render a panel',
      code: { host: HOST, client: CLIENT_CODE },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run', controller.signal)
    await Promise.resolve()
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    const request = gateway.events.find(([event]) => event === 'cordis/request-run')?.[1]
    expect(request).toBeDefined()
    /** 中文说明：测试局部值 approval，由紧邻初始化决定。 */
    const approval = request as {
      requestId: Parameters<typeof runner.runHostHalf>[4]
    }
    await expect(runner.runHostHalf(
      AGENT_A,
      defined.pluginId,
      defined.packageId,
      'run',
      approval.requestId,
      false,
    )).resolves.toMatchObject({ ok: true, startedHere: true })

    controller.abort()

    await expect(pending).resolves.toMatchObject({ ok: true, status: 'awaiting-approval' })
    expect(runner.inventory()[0]?.activeRun).toBeDefined()
    await runner.stop(AGENT_A, defined.pluginId)
    expect(runner.inventory()[0]?.activeRun).toBeUndefined()
  })

  it('does not stop an existing Host run when an attaching page fails to load Client code', async () => {
    /** 中文说明：测试局部值 { runner }，由紧邻初始化决定。 */
    const { runner } = await setup()
    /** 中文说明：测试局部值 defined，由紧邻初始化决定。 */
    const defined = runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'panel' },
      name: 'panel',
      purpose: 'render a panel',
      code: { host: HOST, client: CLIENT_CODE },
    })
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await runner.runHostHalf(AGENT_A, defined.pluginId, defined.packageId, 'run', null, false)
    expect(first).toMatchObject({ ok: true, startedHere: true })
    if (!first.ok) throw new Error(first.message)
    await expect(runner.settleUserRun(AGENT_A, defined.pluginId, {
      ok: true,
      pluginRunId: first.pluginRunId,
    })).resolves.toMatchObject({ ok: true })

    /** 中文说明：测试局部值 attached，由紧邻初始化决定。 */
    const attached = await runner.runHostHalf(AGENT_A, defined.pluginId, defined.packageId, 'run', null, false)
    expect(attached).toMatchObject({ ok: true, startedHere: false })
    if (!attached.ok) throw new Error(attached.message)
    await expect(runner.settleUserRun(AGENT_A, defined.pluginId, {
      ok: false,
      reason: 'client-half-failed',
      pluginRunId: attached.pluginRunId,
      startedHere: attached.startedHere,
      message: 'this page cannot load it',
    })).resolves.toMatchObject({ ok: false, reason: 'client-half-failed' })

    expect(runner.inventory()[0]?.activeRun).toEqual({
      packageId: defined.packageId,
      pluginRunId: first.pluginRunId,
    })
  })
})
