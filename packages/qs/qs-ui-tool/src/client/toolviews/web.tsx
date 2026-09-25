/** web_search / web_fetch 视图：来源摘要、HTTP 状态与截断说明。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { WebBlock, type WebSourceView } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QsToolviewProps } from '../contract.ts'
import { webLabels } from '../primitive-labels.ts'
import { callHead, isSettled } from '../raw-tool-call.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'

/** `web_search` / `web_fetch` 的视图模型。 */
export type WebCardModel =
  | {
    readonly kind: 'search'
    readonly sources: readonly WebSourceView[]
    readonly truncated: boolean
    readonly answer: string | undefined
  }
  | { readonly kind: 'fetch'; readonly url: string; readonly statusCode: number; readonly truncated: boolean }

/**
 * 校验一个来源（字段缺省即省略，不补造）。
 * @param value - meta 里的一个来源。
 * @returns 来源；结构不符时为 undefined。
 */
function webSource(value: unknown): WebSourceView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as { url?: unknown; title?: unknown; snippet?: unknown; publishedAt?: unknown }
  if (typeof source.url !== 'string' || source.url === '') return undefined
  const view: { url: string; title?: string; snippet?: string; publishedAt?: string } = { url: source.url }
  for (const key of ['title', 'snippet', 'publishedAt'] as const) {
    const field = source[key]
    if (field === undefined) continue
    if (typeof field !== 'string') return undefined
    view[key] = field
  }
  return view
}

/**
 * 校验官方 Web meta。
 * @param name - Wire 工具名。
 * @param value - 结算结果上的 meta。
 * @returns 视图模型；结构不符时为 undefined。
 */
function webMeta(name: string, value: unknown): WebCardModel | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const meta = value as { truncated?: unknown; sources?: unknown; answer?: unknown; url?: unknown; statusCode?: unknown }
  if (typeof meta.truncated !== 'boolean') return undefined
  if (name === 'web_fetch') {
    if (typeof meta.url !== 'string' || meta.url === '') return undefined
    if (typeof meta.statusCode !== 'number' || !Number.isInteger(meta.statusCode)) return undefined
    return { kind: 'fetch', url: meta.url, statusCode: meta.statusCode, truncated: meta.truncated }
  }
  if (!Array.isArray(meta.sources)) return undefined
  if (meta.answer !== undefined && typeof meta.answer !== 'string') return undefined
  const sources: WebSourceView[] = []
  for (const source of meta.sources) {
    const view = webSource(source)
    if (view === undefined) return undefined
    sources.push(view)
  }
  return { kind: 'search', sources, truncated: meta.truncated, answer: meta.answer }
}

/**
 * 构建 Web 模型。
 *
 * 与官方一致：`web_fetch` 要求整数 `statusCode`，`web_search` 要求合法来源数组；
 * 失败结算与参数契约不符一律回落兜底卡。
 * @param name - Wire 工具名。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；无法按契约呈现时为 undefined。
 */
export function webCardModel(name: string, block: ToolCallBlock): WebCardModel | undefined {
  if (callHead(block) === undefined || !isSettled(block) || block.isError) return undefined
  return webMeta(name, block.meta)
}

/** Web 视图组件：模型不成立时回落兜底卡。 */
export const WebToolview: ToolviewComponent = ({ block, toolName, t }: QsToolviewProps): ReactNode => {
  const model = webCardModel(toolName, block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  return (
    <div data-qs-tool-web>
      {model.kind === 'fetch'
        ? <WebBlock kind="fetch" url={model.url} statusCode={model.statusCode} truncated={model.truncated} labels={webLabels(t)} />
        : <WebBlock kind="search" sources={[...model.sources]} truncated={model.truncated} answer={model.answer} labels={webLabels(t)} />}
    </div>
  )
}

/** Web 视图插件：与官方 web 子插件同职责，一个插件覆盖 web_search 与 web_fetch 两个键。 */
export const webToolview = {
  name: 'qs-web-toolview',
  inject: ['slots'],
  /** 注册 web_search 与 web_fetch 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'web_search', WebToolview)
    registerToolview(ctx, 'web_fetch', WebToolview)
  },
}
