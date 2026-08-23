/**
 * ================================ 文件注释 ================================
 * 【文件职责】storage-json 包的"不变式伴生插件"：登记一个空的自检安装器。
 * 【技术维度】Cordis 伴生插件形态：导出 name/inject/apply；install 为空函数。
 * 【产品维度】JSON 后端的正确性在于"写持久性"与"发布后再解析等价"，需要介质往返
 * 测试（共享后端一致性测试套件）来验证，进程内没有可连续观察的关系——
 * 所以本包没有运行时自检，但按 invariants 体系约定仍需占位登记。
 * 【逻辑维度】按出现顺序：PACKAGE_NAME（注册名）→ name/inject（插件元信息）→
 * install（空自检安装器）→ apply（注册入口）。
 * 【关键边界】文件主体被 jscpd 重复检测豁免块（jscpd:ignore-start 与
 * jscpd:ignore-end 两个 pragma）包裹，元素级中文注释统一省略（见 invariant.ts 说明）。
 * 【新手阅读建议】先读英文模块注释理解"为什么没有自检"，再看 apply 理解占位注册。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-json`.
 * @module @deepseek-ai/dsh-storage-json/invariant
 */
/**
 * 模块总览：正确性由后端一致性测试套件（介质往返）保障，进程内无可观察关系，
 * 故 install 为空，仅做体系占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage-json'

/** Cordis companion plugin name. */
export const name = 'storage-json-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: correctness here is write-durability and
 * publish-then-reparse equivalence, which require medium round-trip tests
 * (the shared backend conformance suite); the backend exposes no continuously
 * observable in-process relation.
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
