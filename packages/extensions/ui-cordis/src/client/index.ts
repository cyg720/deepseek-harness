/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-cordis 的浏览器（Client）半部入口：把动态 Cordis 插件功能的所有
 *             用户界面挂到客户端 UI 槽位上——侧边栏"Cordis 面板"、cordis_define/
 *             run/stop/undefine 工具调用卡片，以及输入框 @ 触发插件引用的来源。
 * 【技术维度】基于客户端槽位系统（slots）注册 UI（CordisPanel/DefineRow/RunRow/
 *             ActionRow 组件）；经 Remote（ctx.remote.dynamicCordisRunner）跨进程
 *             调用 Host 的 run/stop/undefine/inventory；共享库存（inventory.ts）
 *             由 Host 事件驱动刷新；运行状态（activeRuns/renderFailures 等）来自
 *             client-runner 在浏览器侧的镜像。
 * 【产品维度】把"AI 现场写插件"的可见面交给用户：审批请求、运行状态、停止/删除
 *             控制、历史卡片与 @ 引用补全，都在浏览器面板内完成，无需命令行。
 * 【逻辑维度】词典注册 → RPC 端口与库存创建 → 事件驱动的刷新/重连 → 面板槽位 →
 *             三个工具卡片槽位（define/run/stop+undefine）→ @ 触发源注册 → 首读。
 * 【关键边界】库存按全框架（frame-wide）读取、按会话展示；审批请求只在首次出现
 *             时强制刷新；连接重置必须丢弃旧读取（可能换了 Host）。
 * 【新手阅读建议】先看 apply 的整体装配顺序，再看 inventory.ts（库存生命周期）与
 *             run-card-index.ts（最新运行卡片索引）两个支撑模块。
 * ==========================================================================
 */

/** Cordis dynamic-plugin cards, inventory panel, business-view host, and `@pluginId` source. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { InputTriggerService, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from './events.ts'
import { CordisActionRow } from './CordisActionRow.tsx'
import { CordisDefineRow } from './CordisDefineRow.tsx'
import { CordisRunRow } from './CordisRunRow.tsx'
import { CordisPanel } from './CordisPanel.tsx'
import { createCordisInventory } from './inventory.ts'
import { CordisRunCardRegistry } from './run-card-index.ts'
import type { CordisDynamicPort } from './dynamic-port.ts'
import type { CordisCardFace, CordisPanelFace, CordisRunCardFace } from './slots.ts'
import { en, NS, zh } from './locales.ts'

export type { CordisCardFace, CordisPanelFace, CordisRunCardFace, CordisToolViewOwnerProps } from './slots.ts'
export type { CordisActionResult, CordisDynamicPort, CordisInventoryRow } from './dynamic-port.ts'
export type { CordisDefineRowProps } from './CordisDefineRow.tsx'
export type { CordisActionRowProps } from './CordisActionRow.tsx'
export type { CordisRunRowProps } from './CordisRunRow.tsx'
export type {
  CordisRunCardPointer, CordisRunCardStore, CordisToolViewKey,
} from './run-card-index.ts'
export type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  DynamicCordisInventoryRow, DynamicCordisPackage, DynamicCordisRetracted,
} from './events.ts'
export type { CordisKey } from './locales.ts'

/** Required services for the two Tool cards, panel, Remote lifecycle, and Slash source. */
// 依赖注入：slots（UI 槽位）、locale（字典）、inputTriggers（@ 触发）、remote 与
// dynamicCordisRunner（跨进程调用与运行状态）
export const inject = [
  'slots', 'locale', 'inputTriggers', 'remote', 'remote.dynamicCordisRunner', 'dynamicCordisRunner',
]

/** Mount every Cordis browser surface over the shared Host inventory. */
/*
 * 浏览器侧插件入口：注册中英文词典、创建共享库存（inventory）、接入 Host 事件的
 * 刷新/重连处理，然后把面板与各工具卡片挂到对应 UI 槽位，并注册 @ 触发的插件
 * 引用来源。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-cordis: dictionaries')

  // 面板生命周期操作的 RPC 端口：停止/删除/读库存，统一把错误折叠成可展示结果
  const port: CordisDynamicPort = {
    stop: async (sessionId, pluginId) => {
      const answered = await ctx.remote.dynamicCordisRunner.stopFromPanel(sessionId, pluginId)
      if (!answered.ok) return { ok: false, message: `${answered.error.code}: ${answered.error.message}` }
      if (answered.value.ok || answered.value.reason === 'not-running') return { ok: true }
      return { ok: false, message: answered.value.message }
    },
    remove: async (sessionId, pluginId) => {
      const answered = await ctx.remote.dynamicCordisRunner.undefineFromPanel(sessionId, pluginId)
      if (!answered.ok) return { ok: false, message: `${answered.error.code}: ${answered.error.message}` }
      return answered.value.ok ? { ok: true } : { ok: false, message: answered.value.message }
    },
    inventory: async () => {
      const answered = await ctx.remote.dynamicCordisRunner.inventory()
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
  }
  const inventory = createCordisInventory(port, (error) => {
    console.error('[ui-cordis] reading the Cordis inventory failed:', error)
  })
  // runner 是 host-runner 运行状态在浏览器侧的镜像（活动运行/审批/渲染失败等）
  const runner = ctx.dynamicCordisRunner
  const loaded = { getSnapshot: () => runner.getSnapshot(), subscribe: (fn: () => void) => runner.subscribe(fn) }
  // 会话级"运行卡片指针"注册表：追踪哪次成功运行承载业务视图
  const runCards = new CordisRunCardRegistry()

  // 库存变化时同步"待审批"状态：让面板里的审批按钮与 Host 一致
  ctx.effect(() => inventory.subscribe(() => {
    const snapshot = inventory.getSnapshot()
    if (snapshot.read) runner.reconcileApprovals(snapshot.rows)
  }), 'ui-cordis: reconcile pending approvals')

  // Host 广播的激活/收回/审批事件 → 刷新库存（request-run 首次出现时才强制刷新）
  ctx.remote.$on('cordis/dynamic-package', () => { inventory.refresh() })
  ctx.remote.$on('cordis/dynamic-retract', () => { inventory.refresh() })
  ctx.remote.$on('cordis/request-run', (request) => {
    if (!inventory.getSnapshot().rows.some(row => row.pluginId === request.pluginId)) inventory.refresh()
  })
  ctx.remote.$on('cordis/request-run-resolved', () => { inventory.refresh() })
  ctx.on('connection/reset', () => {
    // 连接重置可能换了个 Host：丢弃旧读取结果并重新读取
    inventory.reset()
    inventory.refresh()
  })

  // 侧边栏底部挂 Cordis 面板：提供库存/运行状态 hooks 与审批/运行/停止/删除动词
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'cordis-panel',
    locale: NS,
    inject: (): CordisPanelFace => ({
      hooks: {
        inventory,
        activeRuns: runner.activeRuns,
        runErrors: runner.lastRunError,
        loaded,
        renderFailures: runner.renderFailures,
      },
      onApprove: (requestId, approveFutureVersions) => runner.approve(requestId, approveFutureVersions),
      onDecline: requestId => runner.decline(requestId),
      onRun: request => runner.startUserRun(request),
      onStop: async (sessionId, pluginId) => {
        const result = await port.stop(sessionId, pluginId)
        inventory.refresh()
        return result
      },
      onRemove: async (sessionId, pluginId) => {
        const result = await port.remove(sessionId, pluginId)
        if (result.ok) inventory.retire(pluginId)
        inventory.refresh()
        return result
      },
      onRefresh: () => { inventory.refresh() },
    }),
  }, CordisPanel))

  const cardFace = (): CordisCardFace => ({ hooks: { inventory, loaded } })
  // cordis_define 调用卡片：展示定义信息与源码
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'cordis_define',
    locale: NS,
    inject: cardFace,
  }, CordisDefineRow))

  // cordis_run 调用卡片：按会话共享"最新运行卡片"指针，承载包业务视图
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'cordis_run',
    locale: NS,
    children: { 'tool.view.cordis': { kind: 'keyed', scope: 'session' } },
    inject: (sessionId: SessionId): CordisRunCardFace => {
      const store = runCards.forSession(sessionId)
      return {
        hooks: { inventory, loaded, runCards: store, activeRuns: runner.activeRuns },
        onObserveRunCard: (pointer) => { store.observe(pointer) },
      }
    },
  }, CordisRunRow))

  // cordis_stop / cordis_undefine 共用一张动作卡片
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'cordis_stop', locale: NS,
    }, CordisActionRow)
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'cordis_undefine', locale: NS,
    }, CordisActionRow)
  })

  // @ 触发源：用户在输入框输入 @ 时，按会话过滤出插件候选（含用途说明与词库补全）
  const rowsOf = (sessionId: SessionId, query: string) => inventory.getSnapshot().rows
    .filter(row => row.agentId === sessionId && String(row.pluginId).includes(query))
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'cordis',
    order: 1,
    candidates(session, { query }) {
      const rows = rowsOf(session.sessionId, query)
      return Promise.resolve(rows.map((row) => {
        const packageId = row.nextPackageId ?? row.currentPackageId ?? row.packages.at(-1)?.packageId
        const pkg = packageId === undefined ? undefined : row.packages.find(candidate => candidate.packageId === packageId)
        return {
          name: String(row.pluginId),
          ...pkg === undefined ? {} : { description: pkg.purpose },
        }
      }))
    },
    warm() { inventory.refresh() },
    lexicon(session) { return rowsOf(session.sessionId, '').map(row => String(row.pluginId)) },
    subscribeLexicon(_session, listener) { return inventory.subscribe(listener) },
    onPick({ candidate }) { return { text: `@${candidate.name} ` } },
  }
  const slash = ctx.get('inputTriggers') as InputTriggerService
  ctx.effect(() => slash.registerSource(source), 'ui-cordis: @pluginId source')

  // 启动即读取一次库存
  inventory.refresh()
}
