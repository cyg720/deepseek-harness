/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-tool 包的浏览器侧装配入口：注册工具调用树（ToolCallTree）、
 *             详情渲染器与全部内置原子工具视图。
 * 【技术维度】Cordis 浏览器插件：conversation.chat.node 键控注册（key 'tool-call'，
 *             声明 tool.call.toolview 键控子槽位）；details 槽位注册详情面板；
 *             ctx.plugin 挂载各内置工具视图插件。
 * 【产品维度】对话中所有工具调用的行式呈现（搜索/读取/写/编辑/终端等）与详情面板。
 * 【逻辑维度】1) 注册工具调用树节点；2) 注册详情面板；3) 挂载七个内置工具视图。
 * 【关键边界】注入面只含 hostDescription（供 POSIX '~' 缩写）。
 * 【新手阅读建议】先读 models/tool-call-model.ts 的行模型，再看本文件的装配。
 * ==========================================================================
 */
/** Register the Tool call tree, details renderer, and built-in atomic views. */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ToolCallTree } from './tool/ToolCallTree.tsx'
import { ToolDetails } from './tool/ToolDetails.tsx'
import { CONVERSATION_NS as NS } from './locale.ts'
import { askQuestionToolview } from './tool/toolviews/ask-question-row.tsx'
import { bashToolviewSample } from './tool/toolviews/bash-sample.tsx'
import { fileMutationToolview } from './tool/toolviews/file-mutation-row.tsx'
import { readToolview } from './tool/toolviews/read-row.tsx'
import { searchToolview } from './tool/toolviews/search-row.tsx'
import { todoToolview } from './tool/toolviews/todo-row.tsx'
import { webToolview } from './tool/toolviews/web-row.tsx'

/** Required services: the slot registry and the Host description used for POSIX `~`. */
export const inject = ['slots', 'connection']

/**
 * Mount the whole-Tool renderers and built-in atomic Tool registrations.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const toolInject = () => ({ hooks: { connectionGeneration: connection.generation } })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    locale: NS,
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
    inject: toolInject,
  }, ToolCallTree))

  ctx.slots.inject('conversation.details.tool', () => ctx.slots.register({
    name: 'conversation.details.tool',
    locale: NS,
    inject: toolInject,
  }, ToolDetails))

  ctx.plugin(bashToolviewSample)
  ctx.plugin(readToolview)
  ctx.plugin(fileMutationToolview)
  ctx.plugin(searchToolview)
  ctx.plugin(webToolview)
  ctx.plugin(todoToolview)
  ctx.plugin(askQuestionToolview)
}
