/*
 * ================================ 文件注释 ================================
 * 【文件职责】输入框"压缩器块"（ComposerBlock）：另一个插件停止某会话输入的唯一种方式。
 *             块携带本地化的失效原因；输入栏读取自己会话的 store 渲染为惰性占位符。
 * 【技术维度】每会话 SnapshotStore；注册表面（ComposerBlocks）经 ctx.conversation.blocks
 *             暴露；set 幂等（无变化不通知）。
 * 【产品维度】如"模型选择"插件知道某会话路由没有适配器时，让输入框变为不可用并显示原因。
 * 【逻辑维度】1) ComposerBlock 接口；2) ComposerBlocks 表面；3) 注册表实现（按会话建 store）。
 * 【关键边界】这是"提示"而非"强制"：宿主对无法路由的提示词无论如何都会拒绝；
 *             依赖方向只允许 ui-model-selection → ui-conversation，不可反向。
 * 【新手阅读建议】理解"为什么需要块"（插件无法 import 输入框实现，只能推状态）。
 * ==========================================================================
 */
/**
 * Composer blocks: the one way another plugin stops a session's input.
 *
 * The composer cannot read the plugins that would know — the dependency runs
 * ui-model-selection → ui-conversation, never back — so a blocker pushes here and the
 * bar reads its own session's store. A block carries the localized reason it
 * exists, because the plugin that raised it owns that copy; the composer only
 * knows how to render an inert textarea with a placeholder, exactly as it
 * already does for a session with no workspace.
 *
 * This is an affordance, not enforcement: the Host refuses a prompt it cannot
 * route regardless of what any client disables.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerBlock, ComposerBlocks } from '../contract/composer-blocks.ts'

/** The per-session composer-block registry (one instance per plugin fiber). */
/* 每会话的输入框块注册表（每个插件纤维一个实例）。 */
export class ComposerBlockRegistry implements ComposerBlocks {
  private readonly stores = new Map<SessionId, SnapshotStore<ComposerBlock | undefined>>()

  /** @inheritdoc */
  set(sessionId: SessionId, block: ComposerBlock | undefined): void {
    const store = this.storeFor(sessionId)
    const current = store.getSnapshot()
    if (current?.reason === block?.reason) return
    store.set(block)
  }

  /** @inheritdoc */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined> {
    const existing = this.stores.get(sessionId)
    if (existing !== undefined) return existing
    const created = createSnapshotStore<ComposerBlock | undefined>(undefined)
    this.stores.set(sessionId, created)
    return created
  }

  /** @inheritdoc */
  forget(sessionId: SessionId): void {
    this.stores.delete(sessionId)
  }
}
