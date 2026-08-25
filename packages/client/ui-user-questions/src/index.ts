/*
 * ================================ 文件注释 ================================
 * 【文件职责】Web 提问插件的宿主侧入口：刻意为空。渲染提问是宿主 UI 能力，
 *             拥有工具是 agent 能力，只有预设决定后者；工具注册在预设层
 *             （而非本插件的全局层）。
 * 【技术维度】Cordis 插件机制 + 预设组合。
 * 【产品维度】ask_user_question 工具的按预设可见性（避免两工具基准预设实际
 *             呈现三个工具）。
 * 【逻辑维度】apply() 为空函数——工具按预设组合，不在此注册。
 * 【关键边界】tool-ask-user 行属于想要它的预设与无预设的 TUI 组合。
 * 【新手阅读建议】浏览器半部见 src/client/。
 * ==========================================================================
 */
/**
 * Web question plugin, node half.
 *
 * Deliberately empty. Mounting `ask_user_question` here put it in the tools
 * registry's GLOBAL layer, so every agent saw it no matter which preset
 * composed it — a two-tool benchmark preset actually presented three, and a
 * locally authored `bash-only` preset presented two. Rendering a question is
 * a host UI capability; having the tool is an agent capability, and only a
 * preset decides that. The `tool-ask-user` row belongs in the presets that
 * want it (and in the TUI composition, which has no presets).
 */

/** Host plugin body — the model-facing tool is composed per preset, not here. */
export function apply(): void {}
