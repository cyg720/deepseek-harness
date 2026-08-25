/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-attachment 包在宿主侧的入口：空 apply 占位，实际呈现逻辑在浏览器半部。
 * 【技术维度】Cordis 插件机制：宿主半部与浏览器半部分离。
 * 【产品维度】本包提供对话输入区的附件（图片）呈现：草稿附件栏、消息图片与灯箱。
 * 【逻辑维度】apply() 为空函数——宿主无行为。
 * 【关键边界】宿主进程无任何逻辑。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/** Host half of the browser-only attachment presentation plugin. */

/** No host-side behavior; the client half registers the React slot entries. */
// 宿主侧无行为：React 槽位注册全部在浏览器半部完成。
export function apply(): void {}
