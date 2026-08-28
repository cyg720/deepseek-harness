/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-attachment 包在浏览器侧的插件入口：把附件呈现组件（草稿附件栏、
 *             消息图片）注册进会话的输入区与消息槽位。
 * 【技术维度】Cordis 浏览器插件：ctx.slots.inject/register 把 React 组件挂到
 *             conversation.input.attachments 与 conversation.message.images 两个槽位。
 * 【产品维度】用户在输入框粘贴/拖入图片时可预览草稿附件；历史消息中的图片可点击放大。
 * 【逻辑维度】apply() 依次注册两个槽位：ComposerAttachments（输入区附件栏）与
 *             MessageImages（消息内图片）。
 * 【关键边界】纯呈现插件，不直接导出 React 组件作为包级值；文案走 conversation 命名空间。
 * 【新手阅读建议】文案解析见 labels.ts；组件实现见对应 .tsx 文件。
 * ==========================================================================
 */
/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'

/** Slot registry required by this presentation plugin. */
// 本插件依赖槽位注册服务。
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
// 注册附件呈现：把草稿附件栏与消息图片组件挂到会话的两个槽位上，组件不对外导出。
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
  ctx.slots.inject('conversation.trajectory.images', () => ctx.slots.register({
    name: 'conversation.trajectory.images',
    locale: 'conversation',
  }, MessageImages))
}
