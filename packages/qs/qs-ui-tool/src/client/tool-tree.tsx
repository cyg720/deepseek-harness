/**
 * `tool-call` 行：根调用与递归子调用的呈现与分派。
 *
 * 本行注册在转写行槽的 `tool-call` 键上，并声明 `qs.tool.call.toolview` 子槽：
 * 每个调用按 Wire 工具名分派到对应子视图，未认领的键（含孤儿结果）走兜底卡。
 * 子调用身份由官方投影给出的 `callId` 保持，层级上限只作第二道防线。
 */
import type { ReactNode } from 'react'
import type { ChatConversationViewNode, ToolCallBlock, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsToolCallOwnerProps } from './contract.ts'
import { callHead } from './raw-tool-call.ts'
import { QsToolRowChrome } from './tool-row.tsx'
import {
  TOOL_TREE_MAX_DEPTH, durationSeconds, isOrphanResult, stateKey, summaryOf, toolName, toolState,
} from './tool-view-model.ts'
import { GenericToolCard } from './toolviews/generic.tsx'
import styles from './tool.module.css'

/** `tool-call` 行的完整 props：行 owner、子槽渲染器与 locale 座席。 */
export type QsToolCallRowProps =
  PropsRuntime<'qs.stage.transcript.row'>
  & PropsRenderSlots<'qs.tool.call.toolview' | 'qs.tool.call.actions'>
  & PropsLocale<'qs-ui-tool'>

/**
 * 从可见节点读取 tool-call 负载。
 * @param value - 行订阅座席读到的节点。
 * @returns 工具负载；节点不可见或不是 tool-call 时为 undefined。
 */
function selectToolData(value: ChatConversationViewNode | undefined): ToolChatData | undefined {
  if (value === undefined || value.visibility === 'hidden' || value.kind !== 'tool-call') return undefined
  return value.data as ToolChatData
}

/** 单个调用分支的输入。 */
interface BranchProps {
  /** 该调用的持久块（自身拥有其子调用）。 */
  readonly block: ToolCallBlock
  /** 当前层级，根为 0。 */
  readonly depth: number
  /** 会话工作区根。 */
  readonly cwd: string | undefined
  /** 按会话授权的图片装载；传给图片类子视图。 */
  readonly loadImage: MessageImageLoader | undefined
  /** 子视图渲染器。 */
  readonly renderSlot: QsToolCallRowProps['renderSlot']
  /** 翻译座席。 */
  readonly t: QsToolCallRowProps['t']
  /** 是否作为子调用缩进显示。 */
  readonly nested: boolean
}

/**
 * 渲染一个调用及其子调用。
 * @param props - 调用块、层级与渲染座席。
 * @returns 调用行节点。
 */
function ToolCallBranch({ block, depth, cwd, loadImage, renderSlot, t, nested }: BranchProps): ReactNode {
  const name = toolName(block)
  const state = toolState(block)
  const head = callHead(block)
  const summary = head === undefined ? undefined : summaryOf(head.name, head.argsRaw)
  const duration = durationSeconds(block)
  const owner: QsToolCallOwnerProps = { callId: block.callId, toolName: name, block, cwd, loadImage }
  const children = block.subCalls
  const body = (
    <>
      {renderSlot('qs.tool.call.toolview', owner, {
        entryKey: name,
        fallback: <GenericToolCard block={block} t={t} />,
      })}
      {renderSlot('qs.tool.call.actions', { callId: block.callId })}
      {children.length === 0 ? null : depth >= TOOL_TREE_MAX_DEPTH ? (
        <p className={styles.notice}>{t('row.depthLimit')}</p>
      ) : (
        <div className={styles.subCalls} data-qs-tool-subcalls>
          {children.map(child => (
            <ToolCallBranch
              key={child.callId}
              block={child}
              depth={depth + 1}
              cwd={cwd}
              loadImage={loadImage}
              renderSlot={renderSlot}
              t={t}
              nested
            />
          ))}
        </div>
      )}
    </>
  )
  return (
    <QsToolRowChrome
      state={state}
      stateLabel={t(stateKey(state))}
      title={name === '' ? t('row.unknownTool') : name}
      summary={isOrphanResult(block) ? t('row.orphan') : summary}
      meta={duration === undefined ? undefined : t('row.duration', { seconds: duration })}
      body={body}
      nested={nested}
    />
  )
}

/**
 * 渲染 `tool-call` 行。
 * @param props - 行 owner、子槽渲染器与 locale 座席。
 * @returns 根调用行；节点不可见或不是工具调用时为 null。
 */
export function ToolCallRow(props: QsToolCallRowProps): ReactNode {
  const { nodeKey, useNode, renderSlot, t, sessionId, useSessions, loadImage } = props
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const data = useNode(nodeKey, selectToolData)
  if (data === undefined) return null
  return (
    <ToolCallBranch
      block={data.root}
      depth={0}
      cwd={cwd}
      loadImage={loadImage}
      renderSlot={renderSlot}
      t={t}
      nested={false}
    />
  )
}
