/**
 * 转写视图模型映射：把 Chat 节点折叠成行组件需要的纯数据。
 *
 * 这里是**回放与实时两路共用**的唯一映射入口，便于单测覆盖；`legacy` 投影一律不用。
 */
import type {
  AssistantChatData, ChatConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'

/** 本阶段自绘图的行 kind；其余 kind 一律走通用兜底行。 */
export const NATIVE_ROW_KINDS = [
  'user', 'steering', 'context', 'assistant-step', 'system-prompt', 'turn-process', 'turn-tail',
] as const

/** 自绘图的行 kind。 */
export type NativeRowKind = typeof NATIVE_ROW_KINDS[number]

/** 行组件的注册键：自绘 kind 或通用兜底。 */
export type RowKey = string

/**
 * 把节点 kind 归一到行注册键。
 * @param kind - Chat 节点判别式。
 * @param available - 当前未退位的有效行注册键。
 * @returns 自绘 kind，或 `'unknown'`（未知 kind 走兜底行，不静默消失）。
 */
export function rowKeyOf(kind: string, available: readonly string[]): RowKey {
  return available.includes(kind) ? kind : 'unknown'
}

/** 一行文本块。 */
export interface TextLine {
  readonly kind: 'text' | 'reasoning'
  readonly text: string
}

/**
 * 提取助手负载里的文本与推理块。
 * @param data - `assistant-step` 节点负载。
 * @returns 按块顺序排列的文本行。
 */
export function assistantLines(data: AssistantChatData): readonly TextLine[] {
  const lines: TextLine[] = []
  for (const block of data.blocks) {
    if (block.kind === 'text') lines.push({ kind: 'text', text: block.text })
    else if (block.kind === 'reasoning') lines.push({ kind: 'reasoning', text: block.text })
  }
  return lines
}

/**
 * 拼接内容块里的纯文本。
 *
 * 视图节点把 data 声明为 unknown，因此这里按结构取  成员：只有字符串 text
 * 才进入结果，图片、工具调用等其余成员本阶段不渲染，也不猜测其内容。
 * @param blocks - 会话事件里的内容块。
 * @returns 以空行分隔的文本。
 */
export function contentText(blocks: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block === 'object' && block !== null && 'text' in block
      && typeof (block).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n\n')
}

/**
 * 读取节点负载；节点被判为 hidden 时返回 undefined。
 * @param node - Chat 视图节点。
 * @returns 可见节点，或 undefined。
 */
export function visibleNode(
  node: ChatConversationViewNode | undefined,
): ChatConversationViewNode | undefined {
  return node === undefined || node.visibility === 'hidden' ? undefined : node
}

/**
 * 助手行的状态文案键。
 * @param data - `assistant-step` 节点负载。
 * @returns 状态文案键。
 */
export function assistantStatusKey(data: AssistantChatData): 'row.running' | 'row.settled' | 'row.interrupted' {
  if (data.status === 'running') return 'row.running'
  if (data.status === 'interrupted') return 'row.interrupted'
  return 'row.settled'
}

/**
 * 读取一条人类消息（user / steering / context）的内容块。
 *
 * 节点负载是**消息对象**（`{ kind, seq, time, content, source }`），内容块在它的
 * `content` 字段里——不是负载本身。断言成数组会让 `contentText` 去遍历一个对象，
 * 运行期抛 `blocks is not iterable`。
 * @param node - Chat 视图节点。
 * @returns 内容块，或 undefined（节点不是这三类或没有 content）。
 */
export function messageContent(node: ChatConversationViewNode): readonly unknown[] | undefined {
  if (node.kind !== 'user' && node.kind !== 'steering' && node.kind !== 'context') return undefined
  const content = (node.data as { readonly content?: unknown }).content
  return Array.isArray(content) ? content : undefined
}

/**
 * 读取 assistant-step 的负载。
 *
 * 视图节点把  声明为 unknown（判别式 kind 是 string），按 kind 取负载是一次
 * 显式的收窄而不是猜测：kind 与本行注册键一致时负载类型才成立。
 * @param node - Chat 视图节点。
 * @returns 助手负载，或 undefined（节点不是 assistant-step）。
 */
export function assistantStepData(node: ChatConversationViewNode): AssistantChatData | undefined {
  return node.kind === 'assistant-step' ? node.data as AssistantChatData : undefined
}
