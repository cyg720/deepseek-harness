/**
 * 文件职责：订阅单个聊天节点，并按节点类型把它分发到对应的可扩展渲染插槽。
 * 技术维度：使用 React memo/useMemo、键控会话快照和类型判别联合实现局部渲染。
 * 产品维度：聊天记录中的不同消息节点可由插件定制展示，未知类型仍能以 JSON 安全回退。
 * 逻辑维度：按键读取节点，缓存共享操作属性，建立节点与所有者关联，再调用插槽渲染器。
 * 关键边界：nodeKey 必须对应当前会话节点；运行时负责保证节点判别值与插槽入口一致。
 * 新手阅读建议：先看 ChatNodeSeatProps 的输入，再追踪 node、owner、routedOwner 三步数据准备。
 */
import { memo, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

/** 单个聊天节点座位所需的节点键、会话订阅器、插槽渲染器和翻译函数。 */
interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  /** 在聊天节点映射中定位目标节点的稳定键。 */
  readonly nodeKey: string
  /** 订阅当前会话快照指定片段的 Hook。 */
  readonly useSession: ChatViewSlotProps['useSession']
  /** 按插槽名称和入口键选择节点渲染器的函数。 */
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  /** 聊天界面本地化文本解析函数。 */
  readonly t: ChatViewSlotProps['t']
}

/** 将每种聊天节点判别类型与同类型节点的所有者属性建立一一对应关系。 */
type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
/*
 * 只订阅一个稳定节点键，并将该节点分发给对应类型的渲染插槽。
 * @param props 节点键、会话能力以及节点可执行操作。
 * @returns 节点渲染结果；节点不存在时返回 null。
 * @example `<ChatNodeSeat nodeKey={key} {...ownerProps} />`
 */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, fileMentions, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  /** 从会话快照中按稳定键读取的节点，节点删除后为 undefined。 */
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  /** 用于后续判别分发的通用聊天节点视图。 */
  const routedNode = node as ChatNode | undefined
  /** 不包含节点本体的共享操作属性，仅在节点或依赖变化时重建。 */
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions,
  ])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  // 运行时分发保证节点判别值与键控插槽入口匹配；TypeScript 不会自动分配含联合字段的对象类型。
  /** 已将具体节点与共享操作关联的插槽属性，由运行时保证判别类型一致。 */
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
