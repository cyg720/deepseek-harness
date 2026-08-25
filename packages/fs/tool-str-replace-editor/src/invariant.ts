/**
 * ================================ 文件注释 ================================
 * 【文件职责】tool-str-replace-editor 包的"不变式伴生插件"：登记一个空的自检安装器。
 * 【技术维度】Cordis 伴生插件形态：导出 name/inject/apply；install 为空函数。
 * 【产品维度】本工具适配器不拥有独立的持久状态；文件系统变更关系由提供者与策略
 * 插件拥有，所以无运行时自检，仅做体系占位。
 * 【逻辑维度】按出现顺序：PACKAGE_NAME（注册名）→ name/inject（插件元信息）→
 * install（空自检安装器）→ apply（注册入口）。
 * 【关键边界】文件主体被 jscpd 重复检测豁免块（jscpd:ignore-start 与
 * jscpd:ignore-end 两个 pragma）包裹，元素级中文注释统一省略。
 * 【新手阅读建议】先读英文模块注释理解"为什么没有自检"，再看 apply 理解占位注册。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-str-replace-editor`.
 * @module @deepseek-ai/dsh-tool-str-replace-editor/invariant
 */
/*
 * 模块总览：工具适配器不拥有独立持久状态，变更关系在提供者与策略插件，
 * 故 install 为空，仅做体系占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-str-replace-editor'

/** Cordis companion plugin name. */
export const name = 'tool-str-replace-editor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool adapter owns no independent durable state;
 * filesystem mutation relations stay with the provider and policy plugins.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
