/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器工具插件入口桶：转发 apply/inject 并导出工具槽位契约类型。
 * 【技术维度】桶文件：装配逻辑在 apply.ts，槽位类型在 contract/slots.ts。
 * 【产品维度】工具调用树、详情面板与原子工具视图。
 * 【逻辑维度】re-export：apply/inject 来自 apply.ts；契约类型来自 contract/slots.ts。
 * 【关键边界】极简桶文件，无自身逻辑。
 * 【新手阅读建议】跟随导出到 apply.ts 与 contract/slots.ts 阅读。
 * ==========================================================================
 */
/** Browser Tool plugin: whole-call composition and keyed atomic Tool views. */
export { apply, inject } from './apply.ts'
export type {
  ToolCallOwnerProps, ToolCallViewProps, ToolDetailsProps, ToolHostDescriptionInjected, ToolTreeProps,
} from './contract/slots.ts'
