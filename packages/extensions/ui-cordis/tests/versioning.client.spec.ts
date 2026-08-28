/**
 * 文件职责：验证Cordis 扩展界面的 versioning.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 扩展界面在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { DynamicCordisLivePackage } from '@deepseek-ai/dsh-cordis-client-runner/client'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  DynamicCordisInventoryRow,
} from '../src/client/events.ts'
import { cordisDefineCard, cordisRunCard } from '../src/client/card-model.ts'
import { CordisRunCardRegistry, cordisToolViewKey } from '../src/client/run-card-index.ts'
import { cordisVisibleStatus } from '../src/client/status.ts'

/** 中文说明：测试局部值 PLUGIN，由紧邻初始化决定。 */
const PLUGIN = 'clock-1' as CordisDynamicPluginId
/** 中文说明：测试局部值 PACKAGE，由紧邻初始化决定。 */
const PACKAGE = 'pkg-1' as CordisDynamicPackageId
/** 中文说明：测试局部值 RUN，由紧邻初始化决定。 */
const RUN = 'run-1' as CordisDynamicPluginRunId

/** 中文说明：测试局部值 row，由紧邻初始化决定。 */
const row = (client: boolean): DynamicCordisInventoryRow => ({
  pluginId: PLUGIN,
  agentId: 'session-1' as DynamicCordisInventoryRow['agentId'],
  packages: [{
    packageId: PACKAGE,
    name: 'Clock',
    purpose: 'show time',
    hasHostHalf: true,
    hasClientHalf: client,
  }],
  currentPackageId: PACKAGE,
  activeRun: { packageId: PACKAGE, pluginRunId: RUN },
})

describe('versioned Cordis card models', () => {
  it('reads symmetric Host and Client source fields from cordis_define', () => {
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = cordisDefineCard({
      callId: 'call-1',
      name: 'cordis_define',
      argsRaw: JSON.stringify({
        plugin: { kind: 'new', idPrefix: 'clock' },
        name: 'Clock',
        purpose: 'show time',
        code: { host: 'HOST_CODE', client: 'CLIENT_CODE' },
      }),
      turn: 1,
      step: 1,
      time: 1,
      subCalls: [],
    })

    expect(card).toMatchObject({
      pluginId: null,
      packageId: null,
      hostCode: 'HOST_CODE',
      clientCode: 'CLIENT_CODE',
      state: 'running',
    })
  })

  it('reads exact activation metadata from a successful cordis_run result', () => {
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = cordisRunCard({
      kind: 'tool-result',
      seq: 9,
      time: 2,
      callId: 'call-2',
      call: { name: 'cordis_run', argsRaw: JSON.stringify({ pluginId: PLUGIN, packageId: PACKAGE, mode: 'run' }) },
      callTime: 1,
      content: [{ type: 'text', text: 'running' }],
      isError: false,
      meta: { pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN },
      subCalls: [],
    })

    expect(card).toMatchObject({
      pluginId: PLUGIN,
      packageId: PACKAGE,
      pluginRunId: RUN,
      mode: 'run',
      seq: 9,
      state: 'ok',
    })
  })

  it('keeps the target identities while cordis_run waits for approval', () => {
    /** 中文说明：测试局部值 card，由紧邻初始化决定。 */
    const card = cordisRunCard({
      callId: 'call-3',
      name: 'cordis_run',
      argsRaw: JSON.stringify({ pluginId: PLUGIN, packageId: PACKAGE, mode: 'update' }),
      turn: 1,
      step: 1,
      time: 1,
      subCalls: [],
    })

    expect(card).toMatchObject({
      pluginId: PLUGIN,
      packageId: PACKAGE,
      pluginRunId: null,
      mode: 'update',
      state: 'running',
    })
  })
})

describe('Cordis run-card ownership', () => {
  it('keeps the greatest Session log sequence for one Plugin and Package', () => {
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new CordisRunCardRegistry().forSession('session-1' as DynamicCordisInventoryRow['agentId'])
    /** 中文说明：测试局部值 changed，由紧邻初始化决定。 */
    const changed = vi.fn()
    store.subscribe(changed)
    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    const key = cordisToolViewKey(PLUGIN, PACKAGE)

    store.observe({ key, callId: 'new', seq: 20, pluginRunId: RUN })
    store.observe({ key, callId: 'old', seq: 10, pluginRunId: 'run-0' as CordisDynamicPluginRunId })

    expect(store.getSnapshot().get(key)?.callId).toBe('new')
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

describe('Cordis visible status', () => {
  it('distinguishes Host-only running, Client pending, and fully loaded', () => {
    expect(cordisVisibleStatus(row(false), PACKAGE, [])).toBe('running')
    expect(cordisVisibleStatus(row(true), PACKAGE, [])).toBe('client-pending')
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定。 */
    const loaded: DynamicCordisLivePackage[] = [{
      pluginId: PLUGIN,
      packageId: PACKAGE,
      pluginRunId: RUN,
      name: 'Clock',
      slots: [],
      styleCount: 0,
    }]
    expect(cordisVisibleStatus(row(true), PACKAGE, loaded)).toBe('running')
  })
})
