/*
 * ================================ 文件注释 ================================
 * 【文件职责】目录选择（原生）表面包的宿主侧入口：空 apply 占位；它驱动的
 *             操作系统目录选择器在宿主目录选择器（原生）包中。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】用户选择工作区目录时，弹出操作系统原生的单选目录对话框。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts 与 flow.ts。
 * ==========================================================================
 */
/**
 * Native directory-picker surface, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. The OS chooser it drives lives in
 * `@deepseek-ai/dsh-host-directory-picker-native`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
