/**
 * ================================ 文件注释 ================================
 * 【文件职责】"Agent 预设管理分区"控制器：预设清单（roster）展示、复制对话框、
 *             只读查看器、目录打开/路径揭示、删除与设为默认。
 * 【技术维度】SnapshotStore 模式 + 远程 API（agentPresets.* 系列调用）；浏览器不直接
 *             编辑预设文本，复制由宿主在文件层面完成（{ from, id, name? } 过网）。
 * 【产品维度】复制是创建新预设的唯一入口；页面还负责把用户带到预设文件所在目录，
 *             因为创建之后的编辑都发生在预设自己的文件里。
 * 【逻辑维度】1) load() 读清单；2) view/closeView 只读查看；
 *             3) beginCopy/confirmCopy 完成复制（校验 id、调宿主、重读清单）；
 *             4) openLocation 打开目录或揭示路径；5) confirmDelete/remove 删除；
 *             6) makeDefault 写默认值。
 * 【关键边界】宿主是唯一事实源：每次变更后都重读清单；复制不覆盖已存在 id；
 *             无桌面打开器的环境以文本路径代替打开。
 * 【新手阅读建议】先读状态接口 AgentPresetSectionState，再按"加载→复制→定位"主线读方法。
 * ==========================================================================
 */
/**
 * Agent-preset management controller: the roster as a list, a copy dialog as
 * the only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text. A new preset is a host-side copy of
 * an existing one (`{ from, id, name? }` is all that crosses the wire), and
 * everything after creation happens in the preset's own files — which is why
 * the page's other job is getting the user TO those files: open the directory
 * where the host has a desktop, show its path where it does not.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because a copy changes
 * more than the row it targeted.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { beginRosterRead, messageOf, writeDefaultPreset } from './settings-store.ts'

/** Ids a preset directory may be named, mirroring the host's own rule. */
// 预设目录名（即 id）的合法格式：小写字母或数字开头，后续可含连字符。
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** One preset row the page renders. */
// 页面上的一行预设：id 是目录名，其余字段是可选的展示元数据。
export interface PresetRow {
  /** Preset id and directory name; the display name falls back to it. */
  id: string
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  isDefault: boolean
  /**
   * Why the preset cannot compose a session, absent when it can. A broken
   * row renders marked and unselectable — its directory still occupies the
   * id, so deleting it (or fixing the files) is the way out, and this page
   * is where both of those live.
   */
  broken?: string
}

/** The copy dialog: a new id and optional display name over a fixed source. */
// 复制对话框的草稿状态：源预设固定，用户输入新 id 与可选显示名。
export interface CopyDraft {
  /** The preset being copied. */
  from: string
  /** Display name of the source, for the dialog title. */
  fromTitle: string
  /** New preset id being typed; the directory name, so it is required. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** Whether the copy is in flight. */
  saving: boolean
  /** The last copy failure, cleared by the next edit. */
  error: string | null
}

/** The read-only composition viewer over one shipped preset. */
// 只读查看器的数据：展示某个已发布预设的组装文本（agent.cordis.yml）。
export interface PresetView {
  /** The preset whose composition is shown. */
  id: string
  /** Display name, for the dialog title. */
  title: string
  /** Composition text exactly as stored. */
  content: string
}

/** Page snapshot. */
// 管理分区的整页快照：加载状态、清单行、复制对话框、查看器、删除确认等。
export interface AgentPresetSectionState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whole-load failure text; a copy failure stays on the dialog. */
  error: string | null
  /** Whether the deployment configures a root new presets can be written to. */
  authorable: boolean
  /** Whether the host can open a preset directory on a native desktop. */
  hasDocument: boolean
  /** Every preset the deployment currently supplies. */
  rows: readonly PresetRow[]
  /** The open copy dialog, or null. */
  copy: CopyDraft | null
  /** The open read-only viewer, or null. */
  view: PresetView | null
  /** The preset awaiting delete confirmation. */
  pendingDelete: string | null
  /** Whether a delete is in flight. */
  deleting: boolean
  /**
   * Preset directories shown as text because the host has no desktop opener
   * — the answer `openDocument` gives instead of opening.
   */
  revealedPaths: Readonly<Record<string, string>>
}

/** 管理分区初始快照：空闲状态、空清单、无对话框、无查看器、无删除确认。 */
const INITIAL: AgentPresetSectionState = {
  status: 'idle',
  error: null,
  authorable: false,
  hasDocument: false,
  rows: [],
  copy: null,
  view: null,
  pendingDelete: null,
  deleting: false,
  revealedPaths: {},
}

/**
 * Why this copy cannot be submitted yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id and its answer is what
 * the dialog reports on failure.
 * @param draft - the open copy dialog.
 * @param rows - the roster, for the collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
// 复制前的本地校验：id 为空、格式非法或与现有预设重名时给出对应的文案键；
// 仅供对话框即时反馈，宿主会在提交时再次校验。
export function draftBlocker(
  draft: CopyDraft,
  rows: readonly PresetRow[],
): 'idRequired' | 'idInvalid' | 'idTaken' | undefined {
  if (draft.id === '') return 'idRequired'
  if (!PRESET_ID.test(draft.id)) return 'idInvalid'
  // A copy never overwrites: landing on a name already in use would replace
  // something the user did not open.
  if (rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/** Reads the roster and drives the copy dialog, viewer, and location reveals. */
// 管理分区控制器：读清单并驱动复制对话框、只读查看器与目录位置揭示。
export class AgentPresetSectionController {
  /** Page snapshot the renderer subscribes to. */
  // 渲染层订阅的快照存储：整页状态都通过它发布。
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets' | 'settings'>,
    /**
     * Called after this page changes the roster DIRECTORY, so the other
     * surfaces reading the same roster re-read it. A settings field moving is
     * already announced by the host through the forwarded
     * `settings/document-updated`; a directory copied or deleted here is not,
     * and the new-session chip has no other way to learn a preset it should
     * offer now exists.
     */
    private readonly rosterChanged: () => void = () => {},
  ) {}

  // 合并写入整页快照。
  private set(patch: Partial<AgentPresetSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  // 合并写入复制对话框草稿；对话框未打开时忽略。
  private patchCopy(patch: Partial<CopyDraft>): void {
    const { copy } = this.store.getSnapshot()
    if (copy === null) return
    this.set({ copy: { ...copy, ...patch } })
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the section
   * reports `unavailable` and renders nothing.
   * @returns once the snapshot reflects the host.
   */
  // 加载清单：空清单是合法部署（显示不可用而非报错）；路径揭示会随清单刷新保留有效项。
  async load(): Promise<void> {
    const roster = await beginRosterRead(this.api, this.store)
    if (roster === undefined) return
    const { presets, authorable, hasDocument } = roster
    if (presets.length === 0) {
      // Nothing to manage leaves nothing to keep a dialog open over.
      this.set({ status: 'unavailable', rows: [], authorable, hasDocument, copy: null, view: null })
      return
    }
    // A reveal outlives a reload but not its preset: a path for a row the
    // roster no longer lists would be a claim about a directory that is gone.
    const revealed = this.store.getSnapshot().revealedPaths
    const kept = Object.fromEntries(
      Object.entries(revealed).filter(([id]) => presets.some(preset => preset.id === id)))
    this.set({
      status: 'ready',
      error: null,
      authorable,
      hasDocument,
      rows: presets.map(preset => ({ ...preset })),
      revealedPaths: kept,
    })
  }

  /**
   * Open one shipped preset's composition in the read-only viewer.
   * @param id - the preset to view.
   * @returns once the composition loaded or the failure is on the page.
   */
  // 在只读查看器中打开某个预设的组装文本。
  async view(id: string): Promise<void> {
    this.set({ error: null })
    try {
      const response = await this.api.agentPresets.read({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { name, content } = response.result.value
      this.set({ view: { id, title: name ?? id, content } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close the read-only viewer. */
  // 关闭只读查看器。
  closeView(): void {
    this.set({ view: null })
  }

  /**
   * Open the copy dialog over one preset.
   * @param from - the preset the copy will start from.
   */
  // 打开复制对话框：以选中行的名为默认标题，草稿初始为空 id。
  beginCopy(from: string): void {
    const row = this.store.getSnapshot().rows.find(candidate => candidate.id === from)
    this.set({
      error: null,
      copy: { from, fromTitle: row?.name ?? from, id: '', name: '', saving: false, error: null },
    })
  }

  /** Close the copy dialog, discarding whatever was typed. */
  // 关闭复制对话框并丢弃已输入内容。
  cancelCopy(): void {
    this.set({ copy: null })
  }

  /**
   * Name the preset the copy creates.
   * @param id - the id typed into the dialog.
   */
  // 更新对话框中的 id 输入并清除旧错误。
  setCopyId(id: string): void {
    this.patchCopy({ id, error: null })
  }

  /**
   * Name the copy's display name.
   * @param name - the display name typed into the dialog.
   */
  // 更新对话框中的显示名输入并清除旧错误。
  setCopyName(name: string): void {
    this.patchCopy({ name, error: null })
  }

  /**
   * Submit the copy, re-read the roster, then take the user to the new
   * preset's files — the directory opens where the host has a desktop, and
   * then its path appears on the new row where it does not.
   * @returns once the copy settled and the page reflects it.
   */
  // 提交复制：先本地校验，再让宿主复制文件，随后重读清单、通知外部并打开新预设目录。
  async confirmCopy(): Promise<void> {
    const draft = this.store.getSnapshot().copy
    if (draft === null || draft.saving) return
    if (draftBlocker(draft, this.store.getSnapshot().rows) !== undefined) return
    this.patchCopy({ saving: true, error: null })
    try {
      const name = draft.name.trim()
      const response = await this.api.agentPresets.copy({
        from: draft.from,
        agentPreset: draft.id,
        ...name === '' ? {} : { name },
      })
      if (!response.result.ok) {
        this.patchCopy({ saving: false, error: response.result.error.message })
        return
      }
      this.set({ copy: null })
      await this.load()
      this.rosterChanged()
      // A preset is its files from here on (the dialog collected nothing
      // else), so landing in them is the completion, not a follow-up.
      await this.openLocation(draft.id)
    } catch (error) {
      this.patchCopy({ saving: false, error: messageOf(error) })
    }
  }

  /**
   * Open one preset's directory on the host desktop, or reveal its path on
   * the row where the deployment has no opener to hand it to.
   * @param id - the preset whose files the user wants.
   * @returns once the host answered and the page reflects it.
   */
  // 打开预设目录：宿主有桌面打开器则直接打开，否则把路径揭示在对应行上。
  async openLocation(id: string): Promise<void> {
    try {
      const response = await this.api.agentPresets.openDocument({ agentPreset: id })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      if (response.result.value.opened) return
      const { path } = response.result.value
      this.set({ revealedPaths: { ...this.store.getSnapshot().revealedPaths, [id]: path } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /**
   * Ask for confirmation before deleting one preset.
   * @param id - the preset to delete, or null to dismiss the confirmation.
   */
  // 设置待删除确认的预设；传 null 则取消确认。
  confirmDelete(id: string | null): void {
    if (this.store.getSnapshot().deleting) return
    this.set({ pendingDelete: id })
  }

  /**
   * Delete the preset awaiting confirmation, then re-read the roster.
   *
   * A session already composed from it keeps running: its composition was
   * mounted at creation and nothing re-reads the file.
   * @returns once the delete settled and the page reflects it.
   */
  // 删除待确认的预设：删除后重读清单并通知外部；已运行的会话不受影响。
  async remove(): Promise<void> {
    const { pendingDelete, deleting } = this.store.getSnapshot()
    if (pendingDelete === null || deleting) return
    this.set({ deleting: true, error: null })
    try {
      const response = await this.api.agentPresets.remove({ agentPreset: pendingDelete })
      if (!response.result.ok) {
        this.set({ deleting: false, pendingDelete: null, error: response.result.error.message })
        return
      }
      this.set({ deleting: false, pendingDelete: null })
      await this.load()
      this.rosterChanged()
    } catch (error) {
      this.set({ deleting: false, pendingDelete: null, error: messageOf(error) })
    }
  }

  /**
   * Make one preset the default for sessions created later. Running sessions
   * keep the composition they began with, so this never disturbs work.
   * @param id - the preset to make default.
   * @returns once the write settled and the roster was re-read.
   */
  async makeDefault(id: string): Promise<void> {
    const failure = await writeDefaultPreset(this.api, id)
    if (failure !== undefined) {
      this.set({ error: failure })
      return
    }
    await this.load()
  }
}
