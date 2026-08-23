/**
 * ================================ 文件注释 ================================
 * 【文件职责】目录选择（浏览式）表面包的宿主（Node）侧入口：空 apply 占位，
 *             实际目录浏览逻辑在浏览器半部与宿主目录选择器后端。
 * 【技术维度】Cordis 插件机制；它驱动的列出/创建原语在宿主目录选择器浏览包中。
 * 【产品维度】用户新建工作区时，可在应用内对话框浏览并选择目录（或新建文件夹）。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts 与 flow.ts。
 * ==========================================================================
 */
/**
 * Directory-picker browsing surface, node half. Pure UI plugin: the empty
 * apply exists so the plugin appears in the host cordis.yml / Loader; the
 * browser half ships via exports["./client"], discovered through the
 * package.json dsh.client declaration. The listing and creation primitives it
 * drives live in `@deepseek-ai/dsh-host-directory-picker-browse`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
