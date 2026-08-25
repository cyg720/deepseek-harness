/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-agent-preset 包在浏览器侧的插件入口：把"Agent 预设"的四个 UI 面
 *             （设置行、新会话页芯片、会话头部标签、管理分区）注册进对应槽位。
 * 【技术维度】Cordis 浏览器插件：ctx.effect() 注册副作用、ctx.slots.register() 挂载 UI、
 *             ctx.inject() 注入后续作用域，通过 remote 事件（settings/document-updated、
 *             agent-preset/selected）与宿主同步。
 * 【产品维度】一套预设是一份插件组合（工具、提示词、能力）。用户可设默认预设，
 *             新会话开场前在芯片上挑选预设，会话头部显示该会话实际使用的预设，
 *             设置页可复制/删除预设或进入其目录编辑。
 * 【逻辑维度】1) apply 建立设置行控制器并监听外部变更刷新；
 *             2) 注入会话作用域，建立"芯片+头部标签"共享控制器，监听会话列表变化
 *                以应用暂存的预设选择；
 *             3) 注册管理分区，暴露增删改查与打开目录等操作。
 * 【关键边界】运行中的会话保持开始时的预设，宿主拒绝中途换预设——这是"选择"与
 *             "显示"分离的原因；预设按 id 存于目录，删除/复制是文件级操作。
 * 【新手阅读建议】先读 settings-store / seat-store / section-store 三个控制器，
 *             再看本文件如何把它们挂到槽位上。
 * ==========================================================================
 */
/**
 * Agent-preset surface plugin, browser half — four surfaces over one roster:
 * a General-settings row for the default preset, a chip on the new-session
 * screen for the session about to start, a read-only label in the session
 * header, and a settings section that manages the roster (copy, delete,
 * default, and the way into a preset's own files).
 *
 * A running session keeps the composition it began with (the host refuses to
 * adopt an existing session under a different preset). That is what splits
 * the choice from the display: the General row and the hero chip are both
 * before-the-fact, while the header only reports what a session already runs.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AgentPresetLabel } from './AgentPresetLabel.tsx'
import type { AgentPresetLabelInjected } from './AgentPresetLabel.tsx'
import { AgentPresetRow } from './AgentPresetRow.tsx'
import type { AgentPresetRowInjected } from './AgentPresetRow.tsx'
import { AgentPresetSeat } from './AgentPresetSeat.tsx'
import type { AgentPresetSeatInjected } from './AgentPresetSeat.tsx'
import { AgentPresetSection } from './AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from './AgentPresetSection.tsx'
import { AgentPresetSeatController } from './seat-store.ts'
import type { SeatSessionSummary } from './seat-store.ts'
import { AgentPresetSectionController } from './section-store.ts'
import { en, zh } from './locales.ts'
import { AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController } from './settings-store.ts'

export type { AgentPresetLabelInjected, AgentPresetLabelProps } from './AgentPresetLabel.tsx'
export type { AgentPresetRowInjected, AgentPresetRowProps } from './AgentPresetRow.tsx'
export type { AgentPresetSeatInjected, AgentPresetSeatProps } from './AgentPresetSeat.tsx'
export type { AgentPresetSectionInjected, AgentPresetSectionProps } from './AgentPresetSection.tsx'
export type { AgentPresetSeatState, SeatSessionSummary } from './seat-store.ts'
export {
  draftBlocker, type AgentPresetSectionState, type CopyDraft, type PresetRow, type PresetView,
} from './section-store.ts'
export type { AgentPresetOption, AgentPresetSettingsState } from './settings-store.ts'
export { AGENT_PRESET_SETTINGS_NS, writeDefaultPreset } from './settings-store.ts'

/** Required services (cordis fiber inject). */
// 本插件依赖的服务名清单：槽位、本地化、连接、远程网关与设置作用域，缺一不可。
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Mount the General-settings row.
 * @param ctx - the browser plugin context.
 */
// 浏览器侧插件入口：把四个"Agent 预设"表面（设置行、新会话芯片、会话头部标签、
// 管理分区）注册进对应槽位，并连接它们与宿主之间的同步事件。
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const controller = new AgentPresetSettingsController(api, ctx.settingsScope.describe())
  // One roster, four surfaces. The chip is registered in a later scope, so it
  // subscribes here rather than being reached from this one.
  // 共享清单刷新回调集合：任何表面改变预设目录（复制/删除）后都会通知所有订阅者重读。
  const rosterReaders = new Set<() => void>()
  // 管理分区控制器：其 rosterChanged 回调会刷新设置行并通知所有共享订阅者。
  const section = new AgentPresetSectionController(api, () => {
    void controller.load()
    for (const read of rosterReaders) read()
  })

  ctx.effect(() => ctx.locale.register('settings.agentPreset', { zh, en }), 'ui-agent-preset: settings row dictionaries')

  const injected = (): AgentPresetRowInjected => ({
    hooks: { agentPreset: controller.store },
    load: () => controller.load(),
    select: (id: string) => controller.select(id),
  })

  ctx.effect(() => {
    // The roster is a live directory and the default is a settings field, so
    // both an external settings edit and a reconnect can move this row.
    const refresh = (): void => {
      void controller.load()
      // The section reads the same roster and marks the same default, so a
      // change made from either surface converges both.
      if (section.store.getSnapshot().status !== 'idle') void section.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        refresh()
      }),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-agent-preset: settings refresh')

  // The settings section's conversational authoring entry: stage the
  // self-referential preset and land a new session on it. Bound inside the
  // conversation scope below (the seat and the session flow live there) and
  // unbound with it, so the section's face reads the current binding per
  // render and simply hides the button while no flow exists.
  // 设置分区里的"创作草稿"入口：暂存创造模式预设并启动一个新会话落到它上面。
  // 该绑定在下面的会话作用域内创建与销毁，分区渲染时按当前绑定决定是否显示按钮。
  let creatorDraft: (() => void) | undefined

  // The new-session chip and the header label: one controller, because the
  // staged choice belongs to the flow rather than to any one session.
  // 新会话芯片与会话头部标签共用一个控制器：暂存的选择属于"新会话流程"，
  // 不属于任何一个具体的会话。
  ctx.inject(['slots', 'conversation', 'sessions', 'workspaces'], (scope: ClientContext) => {
    const api = (scope.get('connection') as ConnectionHandle).api
    // 芯片控制器：读取当前会话摘要（供应用暂存选择）、把应用结果写回会话列表。
    const seat = new AgentPresetSeatController(api, (): SeatSessionSummary | undefined => {
      const state = scope.sessions.list.getSnapshot()
      const summary = state.current === undefined ? undefined : state.byId[state.current]
      return summary === undefined
        ? undefined
        : {
          id: summary.id,
          blank: summary.blank,
          ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
        }
    }, (sessionId, agentPreset) => {
      scope.sessions.noteAgentPreset(sessionId as never, agentPreset)
    })

    // 芯片注入面：把芯片的 store 与动作暴露给槽位渲染层。
    const seatInjected = (): AgentPresetSeatInjected => ({
      hooks: { agentPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
      introduced: () => { seat.introduced() },
    })

    // 头部标签注入面：暴露控制器 store 与 load，标签据此显示当前会话的预设。
    const labelInjected = (): AgentPresetLabelInjected => ({
      hooks: { agentPresets: controller.store },
      load: () => controller.load(),
    })

    scope.effect(() => {
      // Connecting a workspace either creates a blank session or reuses one,
      // and either way the chip's pick predates it — so the stage is applied
      // when the session arrives, not when it was made.
      const stop = scope.sessions.list.subscribe(() => { void seat.apply() })
      // The chip opens on the deployment default, so a default changed from
      // the settings surface moves it too — otherwise the screen that starts
      // the next session keeps offering the previous default until a reload,
      // which is exactly the session the setting claims to govern. A staged
      // pick survives: `load()` prefers it over the refreshed fallback.
      const settingsMoved = scope.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        void seat.load()
      })
      // Every tab folds the committed preset into the shared session row; the
      // initiating tab may already have applied the RPC echo, which is idempotent.
      const presetSelected = scope.remote.$on('agent-preset/selected', (sessionId, agentPreset) => {
        scope.sessions.noteAgentPreset(sessionId, agentPreset)
      })
      // Authoring writes a FILE, not a setting, so nothing on the wire
      // announces it — without this the screen that starts the next session
      // keeps offering the roster as it stood when the chip first loaded, and
      // a preset authored to be used is missing from the one place it is used.
      const readRoster = (): void => { void seat.load() }
      rosterReaders.add(readRoster)
      // Stage WITHOUT applying — the still-current running session would
      // refuse the swap and drop the stage — then start the session it lands
      // on: the chip's list-change applier composes the blank session the
      // workspace connect produces or reuses.
      creatorDraft = () => {
        // The introduce cue makes the chip announce the pick the user never
        // made on this screen — the stage happened back in settings.
        seat.stage('cordis', true)
        scope.workspaces.startSession()
      }
      const chip = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, AgentPresetSeat)
      const label = scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'agent-preset',
        // Static session context occupies the header's leading negative-order band.
        order: -10,
        locale: 'settings.agentPreset',
        inject: labelInjected,
      }, AgentPresetLabel)
      return () => {
        stop()
        settingsMoved()
        presetSelected()
        rosterReaders.delete(readRoster)
        creatorDraft = undefined
        chip()
        label()
      }
    }, 'ui-agent-preset: new-session chip and header label')
  })

  // 管理分区注入面：把分区的 store 与全部操作暴露给渲染层。
  const sectionInjected = (): AgentPresetSectionInjected => ({
    hooks: { agentPresetSection: section.store },
    load: () => section.load(),
    view: (id: string) => section.view(id),
    closeView: () => { section.closeView() },
    beginCopy: (from: string) => { section.beginCopy(from) },
    cancelCopy: () => { section.cancelCopy() },
    setCopyId: (id: string) => { section.setCopyId(id) },
    setCopyName: (name: string) => { section.setCopyName(name) },
    confirmCopy: () => section.confirmCopy(),
    openLocation: (id: string) => section.openLocation(id),
    ...creatorDraft === undefined ? {} : { startCreatorDraft: creatorDraft },
    confirmDelete: (id: string | null) => { section.confirmDelete(id) },
    remove: () => section.remove(),
    makeDefault: (id: string) => section.makeDefault(id),
  })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'agent-preset',
    order: -25,
    locale: 'settings.agentPreset',
    inject: injected,
  }, AgentPresetRow))
  // Ordered after Models: choosing a model is routine, and composing an
  // agent is the deployment-shaping act behind it.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-presets',
    order: 20,
    label: () => ctx.locale.bind('settings.agentPreset')('nav'),
    locale: 'settings.agentPreset',
    inject: sectionInjected,
  }, AgentPresetSection))
}
