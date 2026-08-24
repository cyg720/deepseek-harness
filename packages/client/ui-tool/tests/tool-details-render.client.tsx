/** Test adapter for the production conversation.details.tool registration. */
/**
 * 文件职责：验证工具调用的 tool-details-render.client.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationNode, RunningToolCall, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionProviderComponent, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetailsSlotProps, DetailsToolOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import { ToolDetails } from '../src/client/tool/ToolDetails.tsx'

/** Framework session-area seat used by direct DetailsPanel tests. */
/** 中文说明：测试局部值 SessionProviderStub，由紧邻初始化决定。 */
export const SessionProviderStub: SessionProviderComponent = ({ children }) => children('s1' as SessionId)

/** Build the canonical Chat slice consumed by Tool rows and details tests. */
/** 中文说明：函数 toolChatSnapshot 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function toolChatSnapshot(
  settled: readonly ConversationNode[] = [],
  running: readonly RunningToolCall[] = [],
): ChatSnapshot {
  /** 中文说明：测试局部值 roots，由紧邻初始化决定。 */
  const roots = [...settled.filter(node => node.kind === 'tool-result'), ...running]
  /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
  const nodes: ChatConversationViewNode[] = roots.map(root => ({
    key: `tool:${root.callId}`,
    kind: 'tool-call',
    id: root.callId,
    target: 'chat',
    anchorSeq: 'kind' in root ? root.seq : Number.MAX_SAFE_INTEGER,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  }))
  /** 中文说明：测试局部值 byKey，由紧邻初始化决定。 */
  const byKey = new Map(nodes.map(node => [node.key, node]))
  /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
  const empty: readonly string[] = []
  return {
    order: nodes.map(node => node.key),
    nodes: {
      get: key => byKey.get(key),
      values: () => nodes,
    },
    locations: {
      getTurn: () => empty,
      getStep: () => empty,
    },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: {
      nodes: settled,
      runningCalls: running,
      partial: null,
      turnTimings: new Map(),
      turnEnds: new Map(),
    },
  }
}

/**
 * Bind ui-tool's details renderer to the conversation slot callback shape.
 * @param t - conversation locale seat used by Tool cards.
 * @param description - optional Host description so the details card can abbreviate home paths.
 * @returns a direct-test renderSlot implementation.
 */
/** 中文说明：函数 renderToolDetails 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function renderToolDetails(
  t: TranslateNS<'conversation'>,
  description?: HostDescription,
): DetailsSlotProps['renderSlot'] {
  return (_key, owner) => {
    // PropsRenderSlots keeps its key generic even for this one-key share;
    // recover the concrete owner selected by the adapter's fixed slot.
    /** 中文说明：测试局部值 details，由紧邻初始化决定。 */
    const details = owner as unknown as DetailsToolOwnerProps
    return <ToolDetails
      block={details.block}
      cwd={details.cwd}
      useHostDescription={selector => selector(description)}
      t={t}
    />
  }
}
