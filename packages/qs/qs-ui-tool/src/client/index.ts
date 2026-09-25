/**
 * qs-ui-tool 的浏览器装配。
 *
 * 对应官方 ui-tool：注册 `tool-call` 行并在其上声明 `qs.tool.call.toolview` 子槽，
 * 再逐个挂载八类工具子视图插件（与官方 apply 的子插件清单一一对应）。
 * 官方 `tool.call.toolview` 属官方父 entry，本包不接管、不重复声明。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 仅类型：引入 ctx.slots 服务合并、ctx.locale 服务与转写行槽的声明。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-qs-transcript/client'
import { en, zh } from './locales.ts'
import { NS } from './toolview-registration.ts'
import { ToolCallRow } from './tool-tree.tsx'
import { askQuestionToolview } from './toolviews/ask-question.tsx'
import { shellToolview } from './toolviews/bash.tsx'
import { fileMutationToolview } from './toolviews/file-mutation.tsx'
import { searchToolview } from './toolviews/search.tsx'
import { readToolview } from './toolviews/read.tsx'
import { readImageToolview } from './toolviews/read-image.tsx'
import { todoToolview } from './toolviews/todo.tsx'
import { webToolview } from './toolviews/web.tsx'
// 独立扩展插件通过公开类型取得工具子槽，避免依赖本包私有文件。
export type * from './contract.ts'

/** 必需服务：槽注册表与语言。 */
export const inject = ['slots', 'locale']

/**
 * 安装工具呈现。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-ui-tool: dictionaries')

  // 行分派：转写按有效行键派发，本键缺席时该 kind 自动回到 unknown 兜底行。
  ctx.slots.inject('qs.stage.transcript.row', () => ctx.slots.register({
    name: 'qs.stage.transcript.row',
    key: 'tool-call',
    locale: NS,
    children: {
      'qs.tool.call.actions': { kind: 'list', scope: 'session' },
      'qs.tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  }, ToolCallRow))

  // 八类工具子视图：各自独立 apply 与注册，卸载时逐个释放。
  ctx.plugin(shellToolview)
  ctx.plugin(readToolview)
  ctx.plugin(readImageToolview)
  ctx.plugin(fileMutationToolview)
  ctx.plugin(searchToolview)
  ctx.plugin(webToolview)
  ctx.plugin(todoToolview)
  ctx.plugin(askQuestionToolview)
}
