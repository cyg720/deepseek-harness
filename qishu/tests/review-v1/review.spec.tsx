/** 审查负向用例：断言需求应有行为，失败用于记录现有缺陷，禁止改成迎合实现。 */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, act, fireEvent } from '@testing-library/react'
import { hasProcessActivity, turnProcessModel, hasTurnDiagnostic } from '../../../packages/qs/qs-transcript/src/client/turn-view-model.ts'
import { isProcessMemberHidden } from '../../../packages/qs/qs-transcript/src/client/process-fold.ts'
import { askCardModel } from '../../../packages/qs/qs-ui-tool/src/client/toolviews/ask-question.tsx'
import { ImageToolview } from '../../../packages/qs/qs-ui-tool/src/client/toolviews/read-image.tsx'
import { WebToolview } from '../../../packages/qs/qs-ui-tool/src/client/toolviews/web.tsx'
import { GenericToolCard } from '../../../packages/qs/qs-ui-tool/src/client/toolviews/generic.tsx'
import { TodoToolview } from '../../../packages/qs/qs-ui-tool/src/client/toolviews/todo.tsx'
import { summaryOf } from '../../../packages/qs/qs-ui-tool/src/client/tool-view-model.ts'
import { resultNode } from '../../../packages/qs/qs-ui-tool/tests/tool-fixtures.client.ts'
import type { ChatConversationViewNode, ChatTurnProcessPresentation } from '@deepseek-ai/dsh-client-ui-chat/client'
afterEach(cleanup)
it('有外部过程而计数均为零时，折叠后仍必须允许展开', () => {
  const spec = { turn: 1, controlAnchorSeq: 2, processStartSeq: 2, answerAnchorSeq: 10, answerStep: 2, inlineReasoning: false, messageCount: 0, toolCallCount: 0, subagentCount: 0 }
  const process = { spec, turn: 1, turnClosed: true, hasExternalProcess: true, compactAnswer: true } as ChatTurnProcessPresentation
  expect(isProcessMemberHidden({kind:'model-retry', anchorSeq: 3, presentation:process, open:false, historyIncomplete:false})).toBe(true)
  expect(hasProcessActivity(turnProcessModel(process,spec))).toBe(true)
})
it('无法配对的历史回答不得谎报零回答', () => {
  const model = askCardModel(resultNode({call:{name:'ask_user_question',argsRaw:JSON.stringify({questions:[{id:'q1',question:'one'},{id:'q2',question:'two'}]})},content:[{type:'text',text:JSON.stringify({answers:[{id:'q1',selected:['yes']}]})}]}))
  expect(model).not.toEqual({kind:'counted', answered:0,total:2})
})
it('待办调用失败后必须保留错误正文', () => {
  const block=resultNode({call:{name:'todo_write',argsRaw:JSON.stringify({todos:[{content:'item',status:'completed'}]})},isError:true,content:[{type:'text',text:'REVIEW_EXPECTED_FAILURE_DETAIL'}],error:{name:'Error',code:'FAILED'}})
  const view=render(<TodoToolview {...({block,t:(key:string)=>key} as Parameters<typeof TodoToolview>[0])}/>)
  expect(view.container.textContent).toContain('REVIEW_EXPECTED_FAILURE_DETAIL')
})
it('折叠摘要不自动显示 Authorization 凭据', () => {
  const summary=summaryOf('bash',JSON.stringify({command:"curl -H 'Authorization: Bearer review-only-placeholder' https://example.invalid"}))
  // 命令原文没有自动摘要；完整原文的显式展开由工具包 DOM 回归验证。
  expect(summary).toBeUndefined()
})
it('收尾诊断按快照线性索引，不随收尾行数量重复扫描', () => {
  const counts=[]
  for(const size of [100,1000,10000]) {
    let reads=0
    const nodes=Array.from({length:size},()=>({get kind(){reads++;return 'assistant-step'}})) as ChatConversationViewNode[]
    for(let turn=0;turn<size/10;turn++){hasTurnDiagnostic(nodes,turn,'turn-error');hasTurnDiagnostic(nodes,turn,'turn-max-tokens')}
    counts.push({nodes:size,tails:size/10,kindReads:reads})
    expect(reads).toBe(size)
  }
  console.log('REVIEW_WORK_COUNTS',JSON.stringify(counts))
})

it('图片 URL 装载成功但浏览器解码失败时应显示错误提示', async () => {
  const block=resultNode({call:{name:'read_image',argsRaw:'{"file_path":"synthetic.png"}'},content:[{type:'image',attachment:{attachmentId:'review-image',mediaType:'image/png',bytes:1,width:1,height:1}}] as never})
  const props={block,loadImage:async()=>'/synthetic-missing-image.png',t:(key:string)=>key}
  const view=render(<ImageToolview {...(props as Parameters<typeof ImageToolview>[0])}/>)
  await act(async()=>{await Promise.resolve()})
  fireEvent.error(view.container.querySelector('img')!)
  expect(view.queryByRole('alert')).not.toBeNull()
})
it('不可信 Web URL 与通用文本不生成执行入口', () => {
  const block=resultNode({call:{name:'web_fetch',argsRaw:'{}'},meta:{url:'javascript:alert(1)',statusCode:200,truncated:false}})
  const view=render(<WebToolview {...({block,toolName:'web_fetch',t:(key:string)=>key} as Parameters<typeof WebToolview>[0])}/>)
  expect(view.container.querySelector('a')).toBeNull()
  const text=resultNode({content:[{type:'text',text:'<script>REVIEW_SYNTHETIC</script>'}]})
  view.rerender(<GenericToolCard {...({block:text,t:(key:string)=>key} as Parameters<typeof GenericToolCard>[0])}/>)
  expect(view.container.querySelector('script')).toBeNull()
  expect(view.container.textContent).toContain('<script>REVIEW_SYNTHETIC</script>')
})
