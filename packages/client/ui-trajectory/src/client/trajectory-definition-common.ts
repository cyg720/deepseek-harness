import type { ConversationNodeContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
