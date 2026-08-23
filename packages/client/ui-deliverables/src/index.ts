/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-deliverables 包在宿主（Node）侧的入口：向系统提示词注册"最终回复要
 *             提及产出文件"的引导，使模型输出可被浏览器半部识别为可点击的文件引用。
 * 【技术维度】Cordis 宿主插件：ctx.systemPrompt.section 注册一段带名称与顺序的
 *             提示词片段；浏览器半部通过 dsh.client 声明加载。
 * 【产品维度】模型成功创建/修改文件后，在最终回复里用内联代码格式提及主要产出，
 *             用户在网页端可点击打开。
 * 【逻辑维度】FILE_REFERENCE_PROMPT 常量 + apply() 注册提示词片段。
 * 【关键边界】该引导与浏览器端的文件引用渲染器配对使用；顺序 190 决定其在提示词中的位置。
 * 【新手阅读建议】与 client/turn-deliverables.ts 的提及解析对照阅读。
 * ==========================================================================
 */
/**
 * Deliverables plugin, node half. Registers the response-format guidance that
 * lets the browser half recognize final-response file references. The browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Services required for the model guidance paired with the browser renderer. */
// 本插件依赖系统提示词注册服务。
export const inject = ['systemPrompt']

/** Stable final-response guidance owned by the matching renderer. */
// 注册进系统提示词的稳定引导文本：要求模型在最终回复中用内联代码提及产出文件，
// 且使用精确的文件工具路径（basename 唯一时才可用简写），使引用在网页端可点击。
const FILE_REFERENCE_PROMPT = 'When you successfully create or modify files, mention the primary outputs in your final response. '
  + 'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/**
 * Register model guidance for the file-reference renderer shipped by this package.
 * @param ctx - host context carrying the system-prompt registry.
 */
// 注册模型引导：把"最终回复需提及产出文件"的提示词片段写入系统提示词。
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: 190,
    text: FILE_REFERENCE_PROMPT,
  })
}
