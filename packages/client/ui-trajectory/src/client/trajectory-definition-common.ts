/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标（target: 'trajectory'）各状态机共用的节点封装函数 trajectoryNode：
 *             把业务 Context 与贡献载荷包成 Trajectory 视图节点信封。
 * 【技术维度】纯函数；把 ConversationNodeContext 的 key / kind / id / location 与业务
 *             payload 合成 ConversationViewNode 兼容对象。
 * 【产品维度】统一各 Definition 产出视图节点的格式，供快照构建器消费。
 * 【逻辑维度】单函数封装；anchorSeq 决定跨贡献的排序。
 * 【关键边界】location 缺失时回退为 'unresolved'。
 * 【新手阅读建议】这是"Definition 产出 → 视图节点"的边界适配层。
 * ==========================================================================
 */
import type { ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TrajectoryContribution, TrajectoryConversationViewNode,
} from './trajectory-contract.ts'

/**
 * Wrap one contribution in the Engine-owned target envelope.
 *
 * @param context - Context that owns the contribution identity.
 * @param anchorSeq - Sequence used to order the contribution.
 * @param data - Trajectory-specific contribution payload.
 * @returns The contribution wrapped as a Trajectory view node.
 */
/*
 * 把一个贡献包进 Engine 拥有的目标信封（trajectory 视图节点）。
 * 使用示例：各 Definition 的 buildViewNode 里调用 trajectoryNode(context, seq, { kind: 'tool', root })。
 * @param context - 拥有该贡献身份的 Context（提供 key / kind / id / location）。
 * @param anchorSeq - 用于跨贡献排序的序列号。
 * @param data - 轨迹专属的贡献载荷。
 * @returns 包装成 Trajectory 视图节点的信封。
 */
export function trajectoryNode(
  context: ConversationNodeContext,
  anchorSeq: number,
  data: TrajectoryContribution,
): TrajectoryConversationViewNode {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: 'trajectory',
    anchorSeq,
    location: context.start?.location ?? { kind: 'unresolved' },
    data,
  }
}
