/*
 * ================================ 文件注释 ================================
 * 【文件职责】声明"每会话聊天状态"共享 store（ChatStore）：选中目标、草稿文本、活动视图
 *             与详情检查目标，以及四个写操作。
 * 【技术维度】基于 client-runtime 的 defineStore；状态形状锚定契约（ChatStoreState），
 *             持久化键 dsh.conversation.chat。
 * 【产品维度】对话视图、会话头部、详情面板等共享同一份"视图交互状态"，跨重挂载保持。
 * 【逻辑维度】1) 动作类型；2) createChatStore 工厂（init + persist + actions）。
 * 【关键边界】store 句柄在 apply 时创建，身份跟随插件纤维；组件经 PropsStore 只读访问。
 * 【新手阅读建议】理解 defineStore 的"初始化 + 持久化 + 动作"三件套。
 * ==========================================================================
 */
/**
 * Per-session chat store shared by conversation and details registrations.
 * The plugin creates its handle at apply time so identity follows the fiber.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { CallId, ChatStoreState, SelectionTarget } from './contract/views.ts'

/** Declared action shape used to give the exported factory a stable return type. */
// 声明的动作形状：四个写操作（选择 / 草稿 / 视图 / 详情检查目标），给工厂一个稳定返回类型。
type ChatActions = {
  select: (draft: ChatStoreState, target: SelectionTarget | null) => void
  setDraft: (draft: ChatStoreState, text: string) => void
  setView: (draft: ChatStoreState, view: string) => void
  setInspect: (draft: ChatStoreState, target: { callId: CallId } | null) => void
}

/**
 * Declares the per-session chat state and write surface.
 * @returns the store handle.
 */
/*
 * 声明每会话的聊天状态与写操作面。
 * 使用示例：apply 里 const chatStore = createChatStore()；再经 slots.register 的 store 字段共享。
 * @returns store 句柄。
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    // Anchored to the contract shape: consumers read the store through
    // PropsStore<ChatStore>'s SnapshotSelectorHook<ChatStoreState>, so init
    // and the contract cannot drift.
    // 状态形状锚定契约：消费方经 PropsStore 的快照选择器读取，因此 init 与契约不会漂移。
    init: (): ChatStoreState => ({ selection: null, draft: '', view: null, inspect: null }),
    persist: 'dsh.conversation.chat',
    actions: {
      select: (d, target: SelectionTarget | null) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      setView: (d, view: string) => { d.view = view },
      setInspect: (d, target: { callId: CallId } | null) => { d.inspect = target },
    },
  })
}
