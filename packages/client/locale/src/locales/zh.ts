/*
 * ================================ 文件注释 ================================
 * 【文件职责】common 命名空间的简体中文基础字典：跨功能标准词汇。
 * 【技术维度】纯常量字典：zh 是键集事实源（中文优先仓库约定），en 以
 *   satisfies 对照本键集检查完整性。
 * 【产品维度】确定/取消/复制/重试等高频 UI 词汇在此共享，避免各功能
 *   重复翻译导致文案漂移。
 * 【逻辑维度】zh 字典 + CommonKey 键联合类型。
 * 【关键边界】zh 是键权威；缺失或多余 en 键会编译失败。
 * 【新手阅读建议】对照 en.ts 与 locales/index.ts 的导出理解。
 * ==========================================================================
 */
/** zh base dictionary for the common namespace: cross-feature standard words. */
/* common 命名空间的简体中文基础字典：跨功能标准词汇。 */
export const zh = {
  'ok': '确定',
  'cancel': '取消',
  'close': '关闭',
  'copy': '复制',
  'copied': '复制成功',
  'retry': '重试',
  'loading': '加载中…',
  'load.failed': '加载失败',
  'submit': '提交',
  'submitting': '正在提交…',
  'next': '下一步',
  'previous': '上一步',
  'skip': '跳过',
  'delete': '删除',
  'edit': '编辑',
  'save': '保存',
  'search': '搜索',
  'more': '更多',
  'collapse': '收起',
  'expand': '展开',
  'back': '返回',
  'unknown': '未知',
  'none': '无',
  'truncated': '已截断',
} satisfies Record<string, string>

/** The common vocabulary key union (zh is the key-set source of truth). */
/* 公共词汇键联合类型（zh 是键集事实源）。 */
export type CommonKey = keyof typeof zh
