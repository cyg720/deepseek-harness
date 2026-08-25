/*
 * ================================ 文件注释 ================================
 * 【文件职责】`settings.plugin.item` 槽位类型：可配置插件页签里的一张插件卡片，
 *             以卡片编辑的设置命名空间为键（key）。
 * 【技术维度】纯类型：SlotMap 声明合并；卡片自己绘制内部内容，页签只决定分派
 *             哪些命名空间并堆叠返回结果。
 * 【产品维度】仓库外分发的插件也能贡献卡片：在宿主注册自己的设置命名空间、
 *             在浏览器按该键注册卡片，页签无需理解命名空间含义即可配对。
 * 【逻辑维度】SlotMap 声明 keyed 槽位 + SettingsPluginItemOwnerProps（空 owner props）。
 * 【关键边界】类型住在声明者（本包）处：注册卡片的插件已依赖本包的声明。
 * 【新手阅读建议】与 tab-store.ts 的分派逻辑对照阅读。
 * ==========================================================================
 */
/**
 * The `settings.plugin.item` slot type — one plugin's card inside the
 * configurable-plugins tab, keyed by the settings namespace the card edits.
 * Options: `key` (the namespace). A card draws its own internals; the tab only
 * decides which namespaces to dispatch and stacks what comes back.
 *
 * Keying on the namespace is what lets a plugin distributed outside this
 * repository contribute a card: it registers its own settings namespace on the
 * Host and its own card under that key in the browser, and the tab pairs the
 * two without ever learning what the namespace means.
 *
 * TYPE HOME RATIONALE: the tab declares this slot at runtime, and a plugin
 * registering its own card already depends on this package for the slot's
 * declaration. The type therefore lives with its declarer.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section (see module JSDoc). */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}
