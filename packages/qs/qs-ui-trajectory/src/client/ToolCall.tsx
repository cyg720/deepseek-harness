/** 工具层级呈现与一次性焦点路径；关闭状态不挂载参数或子结果。 */
import { useLayoutEffect, useState } from 'react'
import type { ToolCallBlock, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { RecordedContent } from './Content.tsx'
type Copy = { t: TranslateNS<'qs-ui-trajectory'>; renderImages: RenderMessageImages; focusPath?: ReadonlySet<string> | undefined }
/**
 * 展开被定位调用的祖先链，确认定位后仍保留用户可关闭的展开状态。
 * @param props - 官方工具调用树及目标路径。
 * @returns 工具详情。
 */
export function ToolCall({ call, t, renderImages, focusPath }: { call: ToolCallBlock } & Copy) {
  const [expanded, setExpanded] = useState(false)
  const focused = focusPath?.has(call.callId) === true
  useLayoutEffect(() => { if (focused) setExpanded(true) }, [focused])
  const open = expanded || focused
  const settled = 'kind' in call
  const name = settled ? call.call?.name ?? call.callId : call.name
  return <details data-qs-tool-call={call.callId} open={open} onToggle={(event) => { setExpanded(event.currentTarget.open) }}>
    <summary>{name} · {t(settled ? call.isError ? 'record.error' : 'record.result' : 'toolRunning')}</summary>
    {open && <>
      {settled ? <RecordedContent blocks={call.content} t={t} renderImages={renderImages} /> : <pre>{call.argsRaw}</pre>}
      {call.subCalls.map(child => <ToolCall key={child.callId} call={child} focusPath={focusPath} t={t} renderImages={renderImages} />)}
    </>}
  </details>
}
