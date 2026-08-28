/*
 * ================================ 文件注释 ================================
 * 【文件职责】共享浏览器平台模块清单：播种、捆绑外部化与 Vite 别名都消费
 *   这份列表，使模块身份不会漂移。
 * 【技术维度】纯常量模块：PLATFORM_MODULES 是种子表键的唯一事实源
 *   （与 tsdown 客户端外部化一致）；PRELOADED_CLIENT_EXTERNALS 是解析器
 *   预载说明符。
 * 【产品维度】shell 与插件 bundle 共享 react/cordis 等实例；这份清单保证
 *   "种子键集合"与"捆绑外部化集合"永远一致。
 * 【逻辑维度】两个常量数组 + 派生类型 PlatformModule。
 * 【关键边界】seed.ts 用 satisfies 钉住投影契约：PLATFORM_MODULES 加了词
 *   而没有静态导入（或反之）会编译失败而非运行时漂移。
 * 【新手阅读建议】对照 seed.ts 与 tsdown 外部化配置理解单一事实源。
 * ==========================================================================
 */
/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @deepseek-ai/dsh-client-web/src/platform
 */
/*
 * 共享浏览器平台模块。播种、捆绑外部化与 Vite 别名都消费这份列表，使
 * 模块身份不会漂移。
 * @module @deepseek-ai/dsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
/* shell 共享进冻结模块表的模块说明符（种子表键）。 */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Client-bundle specifiers whose factories the parser preloads before the shell starts. */
/* 解析器在 shell 启动前预载其工厂的客户端 bundle 说明符。 */
export const PRELOADED_CLIENT_EXTERNALS = [
] as const

/** One platform module specifier (a seed-table key). */
/* 一个平台模块说明符（种子表键）。 */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
