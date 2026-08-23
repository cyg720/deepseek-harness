/**
 * ================================ 文件注释 ================================
 * 【文件职责】把会话的瞬时收件箱行投影为队列的只读面（ObservableSnapshot）：供
 *             InputState.queue 使用，无第二份存储、无拷贝。
 * 【技术维度】纯投影：getSnapshot 返回会话快照的 queue 数组，subscribe 直接订阅会话；
 *             会话快照在无关更新间保持队列数组引用稳定。
 * 【产品维度】输入区的排队消息列表实时反映会话侧的收件箱。
 * 【逻辑维度】单个工厂函数 queueReadFaceOf。
 * 【关键边界】只读投影，不写状态；结构上运行时的 QueuedMessage 与 input 契约的同名
 *             类型一致。
 * 【新手阅读建议】理解"复用会话快照引用，不复制"是性能关键。
 * ==========================================================================
 */
/**
 * Queue read face for the InputState.queue projection (frozen contract in
 * ../input/contract.ts): a uSES-compatible observable over one session's
 * transient inbox rows. The Session snapshot already keeps the queue array
 * reference-stable across unrelated snapshot swaps, so this is a pure
 * projection — no second store, no copy.
 */
import type { ObservableSnapshot, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import type { QueuedMessage } from '../input/contract.ts'

/**
 * Project a session's transient inbox rows as a bare observable (subscribe/getSnapshot).
 * The wiring layer overlays this onto InputState.queue; the runtime
 * QueuedMessage and the input-contract QueuedMessage are structurally
 * identical.
 * @param session - the resident session face.
 * @returns the queue read face (snapshot reference stable while the queue is unchanged).
 */
/**
 * 把会话的瞬时收件箱行投影成裸可观察对象（subscribe / getSnapshot）。
 * 使用示例：const queue = queueReadFaceOf(session)；叠到 InputState.queue 上。
 * @param session - 常驻会话面。
 * @returns 队列只读面（队列未变时快照引用稳定）。
 */
export function queueReadFaceOf(session: SessionFace): ObservableSnapshot<readonly QueuedMessage[]> {
  return {
    getSnapshot: () => session.getSnapshot().queue,
    subscribe: fn => session.subscribe(fn),
  }
}
