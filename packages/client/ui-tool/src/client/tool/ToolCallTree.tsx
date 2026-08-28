/** Root/subcall Tool composition with one keyed atomic dispatch path. */
/*
 * 文件职责：实现工具调用的 ToolCallTree 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
/* 中文说明：函数 callName 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
/* 中文说明：视图局部值 ToolCall，由紧邻初始化决定。 */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  children?: ReactNode
}) {
  /** 中文说明：视图局部值 owner，由紧邻初始化决定。 */
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    inspect: () => { inspectCall(callId) },
  }), [callId, toolName, block, openFile, cwd, home, inspectCall])
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
    >
      {renderSlot('tool.call.toolview', owner, {
        entryKey: toolName,
        fallback: <GenericToolCard {...owner} t={t} />,
      })}
      {children}
    </div>
  )
})

/** 中文说明：视图局部值 ToolCallBranch，由紧邻初始化决定。 */
const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, home, openFile, inspectCall, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 't'> & {
  block: ToolCallBlock
  home?: string | undefined
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
/* 中文说明：函数 ToolCallTree 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, inspectCall, useConnectionGeneration, t,
}: ToolTreeProps) {
  const home = useConnectionGeneration(generation => generation?.host.home)
  const block = node.data.root
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={block}
      selectedCallId={selectedCallId}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      t={t}
    />
  )
}
