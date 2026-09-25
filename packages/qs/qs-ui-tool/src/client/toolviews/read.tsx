/** read 视图：路径、行窗口与内容。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ReadBlock, type ReadBlockLine } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QsToolviewProps } from '../contract.ts'
import { readLabels } from '../primitive-labels.ts'
import { callHead, isSettled, parseArgs, stringArg } from '../raw-tool-call.ts'
import { displayPath } from '../tool-view-model.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/** `read` 的视图模型：运行中只有路径，结算后带结构化行窗口。 */
export type ReadCardModel =
  | { readonly kind: 'running'; readonly path: string }
  | {
    readonly kind: 'settled'
    readonly path: string
    readonly lines: readonly ReadBlockLine[]
    readonly totalLines: number
    readonly lang: string | undefined
  }

/**
 * 校验后的 `read` 结构化 meta（官方 `FsReadMeta` 的呈现子集）。
 */
interface ReadMeta {
  /** 模型面对的文件路径。 */
  readonly path: string
  /** 返回窗口内的行，保持文件自身行号。 */
  readonly lines: readonly ReadBlockLine[]
  /** 文件总行数。 */
  readonly totalLines: number
  /** 语法高亮语言提示；缺失表示纯文本。 */
  readonly lang: string | undefined
}

/**
 * 校验 `read` 的结构化 meta。
 * @param meta - 结算结果上的 meta。
 * @returns 校验后的行窗口；结构不符时为 undefined。
 */
function readMeta(meta: unknown): ReadMeta | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const value = meta as { path?: unknown; lines?: unknown; totalLines?: unknown; lang?: unknown }
  if (typeof value.path !== 'string' || value.path === '') return undefined
  if (typeof value.totalLines !== 'number' || !Number.isInteger(value.totalLines) || value.totalLines < 0) return undefined
  if (!Array.isArray(value.lines)) return undefined
  const lines: ReadBlockLine[] = []
  for (const line of value.lines) {
    if (typeof line !== 'object' || line === null) return undefined
    const item = line as { number?: unknown; text?: unknown }
    if (typeof item.number !== 'number' || !Number.isInteger(item.number) || item.number < 1) return undefined
    if (typeof item.text !== 'string') return undefined
    lines.push({ number: item.number, text: item.text })
  }
  if (value.lang !== undefined && typeof value.lang !== 'string') return undefined
  return { path: value.path, lines, totalLines: value.totalLines, lang: value.lang }
}

/**
 * 构建 `read` 模型。
 *
 * `file_path` 不在参数、结算结果缺少结构化行窗口时返回 `undefined`，由调用方回落兜底卡：
 * 本阶段不解析结果正文里的路径信封，避免把文本当成结构化事实。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；无法按契约呈现时为 undefined。
 */
export function readCardModel(block: ToolCallBlock): ReadCardModel | undefined {
  const head = callHead(block)
  if (head === undefined) return undefined
  const path = stringArg(parseArgs(head.argsRaw), 'file_path')
  if (path === undefined) return undefined
  if (!isSettled(block)) return { kind: 'running', path }
  const meta = readMeta(block.meta)
  if (meta === undefined) return undefined
  return { kind: 'settled', path: meta.path, lines: meta.lines, totalLines: meta.totalLines, lang: meta.lang }
}

/** `read` 视图组件：模型不成立时回落兜底卡。 */
export const ReadToolview: ToolviewComponent = ({ block, cwd, t }: QsToolviewProps): ReactNode => {
  const model = readCardModel(block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  const label = displayPath(model.path, cwd)
  if (model.kind === 'running') {
    return (
      <div data-qs-tool-read>
        <p className={styles.label}>{t('read.path')}：{label}</p>
        <p className={styles.notice}>{t('read.running')}</p>
      </div>
    )
  }
  return (
    <div data-qs-tool-read>
      <ReadBlock
        label={label}
        lines={model.lines}
        labels={readLabels(t)}
        totalLines={model.totalLines}
        lang={model.lang}
      />
    </div>
  )
}

/** read 视图插件。 */
export const readToolview = {
  name: 'qs-read-toolview',
  inject: ['slots'],
  /** 注册 read 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'read', ReadToolview)
  },
}
