/** qs-ui-tool 的槽位、注入与本地化契约；槽名与 owner 类型在此定型。 */
// 仅类型：引入 qs.stage.transcript.row 的声明（本包向其贡献 tool-call 行键）。
import type {} from '@deepseek-ai/dsh-qs-transcript/client'
// 仅类型：引入会话标准座席（sessionId、useSessions）。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsUiToolLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 当前工具的独立扩展操作，不复制工具执行或会话状态。 */
    'qs.tool.call.actions': { kind: 'list'; scope: 'session'; owner: { readonly callId: string } }
    /** 已有附件由独立呈现插件消费，读取权限来自会话加载器。 */
    'qs.tool.call.images': { kind: 'single'; scope: 'session'; owner: import('@deepseek-ai/dsh-client-ui-conversation/client').MessageImagesOwnerProps }
    /**
     * 单个工具调用的呈现：按 Wire 工具名分派。
     *
     * 键域开放：未认领的键（含无调用记录的孤儿结果）由声明者提供的兜底卡承载，
     * 既不静默消失，也不伪装成某个已知工具。
     */
    'qs.tool.call.toolview': {
      kind: 'keyed'
      scope: 'session'
      owner: QsToolCallOwnerProps
    }
  }

  interface LocaleNamespaceMap {
    'qs-ui-tool': QsUiToolLocaleKey
  }
}

/**
 * 工具子视图的 owner 输入。
 *
 * 只包含官方持久数据（调用头、结果、结构化 meta）与宿主按会话提供的能力：
 * 轨迹定位由独立轨迹插件贡献到 actions 子槽，复用官方共享阅读状态。
 * owner 不提供未接入的文件打开或宿主家目录能力，路径只按会话工作区根做相对显示。
 */
export interface QsToolCallOwnerProps {
  /** 跨运行与结算保持稳定的调用身份。 */
  readonly callId: string
  /** Wire 工具名；调用记录缺失时为空串。 */
  readonly toolName: string
  /** 该调用的运行头或已结算结果节点（自身拥有其子调用）。 */
  readonly block: ToolCallBlock
  /** 会话工作区根，用于相对路径摘要；未知时按原样显示。 */
  readonly cwd: string | undefined
  /** 按会话授权的图片装载；缺席时图片类结果只给文字限制说明。 */
  readonly loadImage: MessageImageLoader | undefined
}

/**
 * 工具子视图组件的完整 props：owner 输入、会话标准座席与本包 locale 座席。
 *
 * 子视图不接收 `ctx`，也不自行订阅；数据只从 owner 输入读取。
 */
export type QsToolviewProps =
  PropsRuntime<'qs.tool.call.toolview'>
  & PropsLocale<'qs-ui-tool'>
  & PropsRenderSlots<'qs.tool.call.images'>
