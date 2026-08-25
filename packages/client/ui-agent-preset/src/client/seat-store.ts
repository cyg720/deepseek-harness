/*
 * ================================ 文件注释 ================================
 * 【文件职责】"英雄芯片"（新会话页挑选 Agent 预设的控件）状态控制器：暂存用户为
 *             下一个会话挑选的预设，并在会话出现时把选择应用上去。
 * 【技术维度】快照存储（SnapshotStore）模式 + 远程 API 调用；通过 currentSession()
 *             回调读取当前会话、onApplied 回调把变更发布给会话列表。
 * 【产品维度】新会话屏幕在会话创建前就要选定预设，因此"挑选"与"应用"拆成两阶段：
 *             先暂存，等会话变为当前且仍为空白时再写入。
 * 【逻辑维度】1) load() 读取清单并定位部署默认值；2) select()/stage() 暂存选择；
 *             3) apply() 在存在空白会话时把暂存选择写进会话；应用后暂存即清除。
 * 【关键边界】只对空白（未跑过回合）会话生效；应用后下次新会话回到部署默认值。
 * 【新手阅读建议】先看 AgentPresetSeatState 状态形状，再沿 load → select → apply 读主流程。
 * ==========================================================================
 */
/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * The new-session screen has no session, so a pick is staged rather than
 * applied. It reaches a session when one becomes current and is still blank —
 * whether the workspace connect created it or reused an existing blank one,
 * which is why staging cannot simply ride along on `sessions.create`.
 *
 * The stage is forgotten once applied: the next new session starts from the
 * deployment default again, matching the workspace picker beside it.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SessionId, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { messageOf, presetOptions } from './settings-store.ts'
import type { AgentPresetOption } from './settings-store.ts'

/** Hero-chip snapshot. */
// 芯片的整页快照状态：清单、当前选中、错误信息、忙碌标记与"首次介绍"提示。
export interface AgentPresetSeatState {
  /** Presets the deployment supplies; empty means the chip renders nothing. */
  options: readonly AgentPresetOption[]
  /** The staged choice, empty until the roster loads. */
  current: string
  /** A rejected apply's message, cleared by the next attempt. */
  error: string | null
  busy: boolean
  /**
   * One-shot cue that the chip should introduce itself (the creator-draft
   * entry staged the pick from another screen, so the user never touched the
   * chip); the renderer clears it via `introduced()` once played.
   */
  introduce: boolean
}

/** 芯片的初始快照：空清单、无选中、无错误、不忙碌、不介绍。 */
const INITIAL: AgentPresetSeatState = {
  options: [], current: '', error: null, busy: false, introduce: false,
}

/** One session's identity and whether it has started. */
// 当前会话的摘要：id 用于定位会话，blank 表示是否可接收预设（未跑过回合）。
export interface SeatSessionSummary {
  /** The session the chip would apply its staged choice to. */
  id: SessionId
  /** False once a turn has run — applying is refused from then on. */
  blank: boolean
  /** The preset the session already runs, when the summary reports one. */
  agentPreset?: string
}

/** Stages the next session's preset and applies it when one appears. */
// 芯片控制器：管理"为下一个会话暂存预设并择机应用"的全部状态与动作。
export class AgentPresetSeatController {
  /** Chip snapshot the renderer subscribes to. */
  // 渲染层订阅的快照存储：所有状态变更都通过 store.set 发布。
  readonly store: SnapshotStore<AgentPresetSeatState> = createSnapshotStore(INITIAL)

  /**
   * The deployment default, so a consumed stage can fall back to it without
   * re-reading the roster.
   */
  // 部署默认预设 id：应用消耗掉暂存后，无需重读清单即可回退到默认值。
  private fallback = ''

  /** Set while a pick is waiting for a session; cleared once applied. */
  // 暂存中的预设 id：挑选后、应用前一直保存；应用成功或被拒绝后清除。
  private staged: string | undefined

  // 构造：注入远程 API、当前会话读取回调与可选的"应用完成"通知回调。
  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets'>,
    /** The session the hero is about to hand over to, when there is one. */
    private readonly currentSession: () => SeatSessionSummary | undefined,
    /**
     * Publish an applied switch into the session list, so the header label
     * moves with the composition instead of waiting for the next full list
     * refresh. Optional: a harness that renders no list omits it.
     */
    private readonly onApplied?: (sessionId: string, agentPreset: string) => void,
  ) {}

  // 合并写入快照：以现有快照为基础，应用补丁字段。
  private set(patch: Partial<AgentPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the roster and open the chip on the deployment default.
   * @returns once the snapshot reflects the host.
   */
  // 读清单并把芯片对准默认预设；若存在暂存则优先展示暂存选择。
  async load(): Promise<void> {
    try {
      const response = await this.api.agentPresets.list({})
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { presets } = response.result.value
      this.fallback = presets.find(preset => preset.isDefault)?.id ?? presets[0]?.id ?? ''
      this.set({
        options: presetOptions(presets),
        // Staged pick first, then the composition the current session
        // already carries, then the deployment default. The middle term is
        // what keeps a late-landing load from regressing the display after
        // an applied stage was consumed — the chip mounts (and loads) only
        // once the flow's session is current, so the reply can arrive after
        // apply() already composed it.
        current: this.staged ?? this.currentSession()?.agentPreset ?? this.fallback,
        error: null,
      })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /**
   * Stage one preset for the next session, applying it immediately when a
   * blank session is already current.
   * @param id - the preset to stage.
   * @returns once the stage settled, and the apply too when one happened.
   */
  // 选择预设：立即暂存，并在有可用会话时马上应用。
  async select(id: string): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.stage(id)
    await this.apply()
  }

  /**
   * Stage a pick WITHOUT the immediate apply, for a flow that starts the
   * receiving session after the pick (the settings section's creator entry).
   * `select()`'s immediate apply would meet the still-current running session
   * and drop the stage as unservable; staging alone leaves it for the
   * list-change applier, which fires when the started session becomes
   * current.
   * @param id - the preset to stage.
   * @param introduce - true when the stage came from another screen and the
   * chip should announce itself on the session it lands on.
   */
  // 仅暂存不应用：供"从别的界面发起创建"的流程使用，避免误伤仍处于当前会话的情况。
  stage(id: string, introduce = false): void {
    this.staged = id
    this.set({ current: id, error: null, introduce })
  }

  /** Acknowledge the introduction cue once the chip has played it. */
  // 清除"首次介绍"提示：渲染层播放完引导后调用。
  introduced(): void {
    if (!this.store.getSnapshot().introduce) return
    this.set({ introduce: false })
  }

  /**
   * Hand the staged choice to the current session, if there is one to take it.
   *
   * Called both by `select()` and by whoever observes the current session
   * changing, because the session may appear either before or after the pick.
   * @returns once the switch settled, or immediately when there is nothing to do.
   */
  // 把暂存的选择交给当前会话：会话可能在挑选之前或之后出现，故 select 与
  // 会话列表变化监听都会调用它；会话已开始或预设相同则丢弃暂存。
  async apply(): Promise<void> {
    const staged = this.staged
    const session = this.currentSession()
    if (staged === undefined || session === undefined) return
    // A started session's history was produced under its own composition; the
    // host refuses the swap, so the stage is no longer meaningful.
    if (!session.blank || session.agentPreset === staged) {
      this.staged = undefined
      return
    }
    this.set({ busy: true, error: null })
    try {
      const response = await this.api.agentPresets.select({ sessionId: session.id, agentPreset: staged })
      this.staged = undefined
      if (!response.result.ok) {
        this.set({ busy: false, error: response.result.error.message, current: this.fallback })
        return
      }
      // Consumed: the next new session opens on the deployment default again.
      this.set({ busy: false, current: response.result.value.agentPreset })
      this.onApplied?.(session.id, response.result.value.agentPreset)
    } catch (error) {
      this.staged = undefined
      this.set({ busy: false, error: messageOf(error), current: this.fallback })
    }
  }
}
