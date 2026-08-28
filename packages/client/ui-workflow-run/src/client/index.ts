/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-workflow-run 包在浏览器侧的插件入口：注册工作流运行的会话节点
 *             定义、字典与键控聊天渲染器。
 * 【技术维度】Cordis 浏览器插件：conversationEvents.register 注册定义、
 *             slots 注册键控节点（注入 openSession 导航动作）。
 * 【产品维度】对话中可点开工作流运行的成员会话。
 * 【逻辑维度】1) 注册定义；2) 注册字典；3) 注册键控聊天节点。
 * 【关键边界】节点键 'workflow-run' 与定义 kind 一致。
 * 【新手阅读建议】先读 workflow-definition.ts 的投影，再看本文件的注册。
 * ==========================================================================
 */
/** Browser plugin for durable workflow-run Conversation Nodes. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { WorkflowRunPanel, type WorkflowRunInjected } from './WorkflowRunPanel.tsx'
import { en, NS, type WorkflowRunKey, zh } from './locales.ts'
import { workflowRunDefinition } from './workflow-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Durable workflow-run node copy. */
    workflowRun: WorkflowRunKey
  }
}

/** Required services for Definition, keyed renderer, navigation, and copy. */
export const inject = ['uiConversation', 'slots', 'sessions', 'locale']

/** Register the workflow Definition, dictionary, and keyed Chat renderer. */
export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(workflowRunDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow-run: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'workflow-run',
    locale: NS,
    inject: (): WorkflowRunInjected => ({
      openSession: (id: SessionId) => { ctx.sessions.open(id) },
    }),
  }, WorkflowRunPanel))
}
