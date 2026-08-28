/**
 * ================================ 文件注释 ================================
 * 【文件职责】Cordis 动态插件 UI 的中英文字典：所有面板/卡片文案的键与两套翻译，
 *             并向 locale 系统声明本命名空间。
 * 【技术维度】NS 常量 + zh/en 两个 satisfies 约束的对象（zh 的键派生 CordisKey，
 *             en 必须与 zh 键完全一致）；声明合并把命名空间注册进 LocaleNamespaceMap。
 * 【产品维度】让面板/卡片文案跟随用户界面语言切换，文案统一管理、可类型检查。
 * 【逻辑维度】命名空间 → 中文字典（键集合源头）→ 键类型 → 英文字典。
 * 【关键边界】键只能在 zh 中增删，en 必须同步；{...} 占位符由调用方替换。
 * 【新手阅读建议】无需深入：知道"键在 zh 定义、en 对齐"即可。
 * ==========================================================================
 */

/** Cordis dynamic-plugin UI dictionaries. */

export const NS = 'cordis'
// 字典命名空间：本包所有 UI 文案都以 NS 为前缀注册

/** Simplified Chinese Cordis UI messages. */
/* 简体中文文案表：Cordis UI 的每个展示字符串。 */
export const zh = {
  'row.defineTitle': '注册 Cordis 插件',
  'row.runTitle': '运行 Cordis 插件',
  'row.updateTitle': '更新 Cordis 插件',
  'row.stopTitle': '停止 Cordis 插件',
  'row.removeTitle': '移除 Cordis 插件',
  'purpose.missing': '(未填写用途)',
  'status.idle': '待激活',
  'status.awaitingApproval': '待审批',
  'status.failed': '运行失败',
  'status.clientPending': 'Client 待激活',
  'status.running': '运行中',
  'status.removed': '已移除',
  'status.superseded': '已有更新',
  'run.removed': '包已不存在',
  'run.superseded': '已有更新的运行卡片，请查看下方',
  'panel.hint': '运行控制在左下角设置上方的 Cordis 面板',
  'panel.plugins.aria': 'Cordis 插件',
  'panel.approvals.aria': 'Cordis 审批',
  'panel.trigger': 'Cordis Plugin',
  'panel.runningCount': '{count} running',
  'panel.title': 'Cordis 插件',
  'panel.empty': '还没有定义任何插件',
  'panel.loading': '读取中…',
  'panel.readFailed': '读取插件清单失败：{message}',
  'panel.group.current': '当前会话',
  'panel.group.others': '其他会话',
  'panel.version': '版本',
  'panel.current': '当前：{packageId}',
  'panel.next': '待切换：{packageId}',
  'action.approve': '允许',
  'action.approveOnce': '仅允许此版本',
  'action.approvePlugin': '允许此插件的后续版本',
  'action.decline': '拒绝',
  'action.run': '运行',
  'action.stop': '停止',
  'action.remove': '移除',
  'action.retry': '重试',
  'action.rollback': '回退',
  'action.inspect': '查看',
  'render.failedAbdicated': '{slot} 渲染失败，已恢复默认界面：',
  'render.failedHeld': '{slot} 渲染失败：',
  'a11y.defining': '正在定义插件',
  'a11y.failed': '定义失败',
  'a11y.stopped': '定义已中断',
  'body.source': '插件代码',
  'body.hostCode': 'Host',
  'body.clientCode': 'Client',
  'body.output': '结果',
  'body.copy': '复制',
  'body.copied': '已复制',
} satisfies Record<string, string>

/** Translation keys owned by the Cordis UI namespace. */
/* 本 UI 命名空间拥有的翻译键集合（以 zh 的键为准）。 */
export type CordisKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dynamic Cordis UI copy. */
    // 向 locale 系统声明本命名空间及其键，让其他组件可类型安全地引用
    cordis: CordisKey
  }
}

/** English Cordis UI messages. */
/* 英文文案表：键与 zh 完全一致，满足类型约束。 */
export const en = {
  'row.defineTitle': 'Register Cordis Plugin',
  'row.runTitle': 'Run Cordis Plugin',
  'row.updateTitle': 'Update Cordis Plugin',
  'row.stopTitle': 'Stop Cordis Plugin',
  'row.removeTitle': 'Remove Cordis Plugin',
  'purpose.missing': '(no purpose given)',
  'status.idle': 'Ready',
  'status.awaitingApproval': 'Awaiting approval',
  'status.failed': 'Run failed',
  'status.clientPending': 'Client ready to activate',
  'status.running': 'Running',
  'status.removed': 'Removed',
  'status.superseded': 'Newer run available',
  'run.removed': 'This package no longer exists',
  'run.superseded': 'A newer run card is available below',
  'panel.hint': 'Run controls live in the Cordis panel above Settings',
  'panel.plugins.aria': 'Cordis plugins',
  'panel.approvals.aria': 'Cordis approvals',
  'panel.trigger': 'Cordis Plugin',
  'panel.runningCount': '{count} running',
  'panel.title': 'Cordis plugins',
  'panel.empty': 'No plugins defined yet',
  'panel.loading': 'Reading…',
  'panel.readFailed': 'Reading the plugin inventory failed: {message}',
  'panel.group.current': 'This session',
  'panel.group.others': 'Other sessions',
  'panel.version': 'Version',
  'panel.current': 'Current: {packageId}',
  'panel.next': 'Next: {packageId}',
  'action.approve': 'Allow',
  'action.approveOnce': 'Allow this version only',
  'action.approvePlugin': 'Allow future versions of this plugin',
  'action.decline': 'Decline',
  'action.run': 'Run',
  'action.stop': 'Stop',
  'action.remove': 'Remove',
  'action.retry': 'Retry',
  'action.rollback': 'Roll back',
  'action.inspect': 'Inspect',
  'render.failedAbdicated': 'Rendering failed in {slot}; the default UI was restored:',
  'render.failedHeld': 'Rendering failed in {slot}:',
  'a11y.defining': 'Defining the plugin',
  'a11y.failed': 'Definition failed',
  'a11y.stopped': 'Definition interrupted',
  'body.source': 'Plugin source',
  'body.hostCode': 'Host',
  'body.clientCode': 'Client',
  'body.output': 'Result',
  'body.copy': 'Copy',
  'body.copied': 'Copied',
} satisfies Record<CordisKey, string>
