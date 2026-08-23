/**
 * ================================ 文件注释 ================================
 * 【文件职责】ModelSelect（输入条模型选择器）的注入面类型。
 * 【技术维度】纯类型：目标槽位由 ui-conversation 的输入条入口声明，本包只贡献
 *             唯一占用者，无 SlotMap 合并。
 * 【产品维度】输入条模型选择器的可用性、目录状态与选择动作。
 * 【逻辑维度】available 可用性 → directory 共享目录存储 → load 刷新 → select 提交。
 * 【关键边界】目录存储与 /model 弹窗是同一实例。
 * 【新手阅读建议】配合 directory.ts 与 service.ts 阅读。
 * ==========================================================================
 */
/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from './directory.ts'

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SnapshotStore<ModelDirectoryState>
  /** Refresh the advisory directory (fire-and-forget; errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns whether the host accepted the selection.
   */
  select: (selection: ModelSelection) => Promise<boolean>
}
