/** 轨迹中的已加载历史台账；不推断每次请求的有效上下文窗口。 */
import { Fragment, type ReactNode } from 'react'
import type { ConversationNode, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { assertNever } from '@deepseek-ai/dsh-util-values'

type Block = Extract<ConversationNode, { kind: 'user' }>['content'][number]
type Media = { renderImages: RenderMessageImages }

type Translate = TranslateNS<'qs-ui-trajectory'>

/**
 * 按持久化内容类型呈现只读详情，媒体委托给当前会话的附件槽。
 * @param props - 内容块、本地化和授权图片呈现。
 * @returns 转义文本及独立媒体呈现。
 */
export function RecordedContent({ blocks, t, renderImages }: { blocks: readonly Block[]; t: Translate } & Media): ReactNode {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'text': return <pre key={index}>{block.text}</pre>
      case 'reasoning': return <div key={index}><h4>{t('record.reasoning')}</h4><pre>{block.text}</pre></div>
      case 'tool-call': return <div key={index}><h4>{block.name}</h4><pre>{block.arguments}</pre></div>
      case 'tool-result': return <div key={index}><h4>{t(block.isError === true ? 'record.error' : 'record.result')}</h4><RecordedContent blocks={block.content} t={t} renderImages={renderImages} /></div>
      case 'image': return <Fragment key={index}>{renderImages({ images: [{ attachment: block.attachment }], align: 'start' }) ?? <p>{t('record.image')}</p>}</Fragment>
      case 'file': return <div key={index} data-qs-trajectory-file>
        <dl><div><dt>{t('record.fileName')}</dt><dd>{block.attachment.name}</dd></div>
          <div><dt>{t('record.fileBytes')}</dt><dd>{block.attachment.bytes}</dd></div></dl>
        <p>{t('record.file')}</p>
      </div>
      // ContentBlock 可由插件扩展，未知内容须可见说明，不能泄漏整个对象作为界面。
      default: return <p key={index}>{t('record.unsupported')}</p>
    }
  })
}

/**
 * 共用助手块呈现，实时和持久化内容采用同一转义及附件规则。
 * @param props - 官方助手块及本地化图片呈现。
 * @returns 只读助手内容。
 */
export function AssistantContent({ blocks, t, renderImages }: {
  blocks: Extract<ConversationNode, { kind: 'assistant' }>['blocks']
  t: Translate
} & Media): ReactNode {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case 'text': return <pre key={index}>{block.text}</pre>
      case 'reasoning': return <div key={index}><h4>{t('record.reasoning')}</h4><pre>{block.text}</pre></div>
      case 'tool-call': return <div key={index}><h4>{block.name}</h4><pre>{block.argsRaw}</pre></div>
      case 'image': return <Fragment key={index}>{renderImages({ images: [{ attachment: block.attachment }], align: 'start' }) ?? <p>{t('record.image')}</p>}</Fragment>
      case 'other': return <p key={index}>{t('record.unsupported')}</p>
      /* v8 ignore next -- @preserve 同进程闭合类型已穷尽，不伪造非法值测试静态不可达分支。 */
      default: return assertNever(block)
    }
  })
}
