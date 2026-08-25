/*
 * ================================ 文件注释 ================================
 * 【文件职责】JSONL 后端包的"不变量伴侣插件"：向 dsh-invariants 服务登记包所有权，
 *   并声明本包不提供任何运行时不变量检查。
 * 【技术维度】Cordis 插件协议三件套（name / inject / apply）；apply 返回登记项
 *   的 disposer 供容器拆除时注销。
 * 【产品维度】让包集合在不变量注册表中完整可审计；显式声明"无运行时不变量"
 *   而非缺省缺失，避免审计误报。
 * 【逻辑维度】定义包名常量与空安装器，apply 完成登记。
 * 【关键边界】持久化正确性依赖后端往返与崩溃残尾测试，进程内没有可连续观测的
 *   关系式——install 为空是设计决定而非遗漏。
 * 【新手阅读建议】了解 name/inject/apply 约定即可；与 session-persistence 包的
 *   invariant.ts 结构完全一致，仅包名不同。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-persistence-jsonl`.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/invariant
 */
/*
 * 【中文导读】上面英文说明：这是 dsh-session-persistence-jsonl 包专属的不变量
 * 伴侣模块。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 【中文】本伴侣插件所代表（认领所有权）的包名。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-session-persistence-jsonl'

/** Cordis companion plugin name. */
/* 【中文】Cordis 伴侣插件名。 */
export const name = 'session-persistence-jsonl-invariant'
/** Service required before the companion can reserve package ownership. */
/* 【中文】依赖声明：需要先存在 invariants 服务才能登记包所有权。 */
export const inject = ['invariants']

/**
 * No runtime invariant: persistence correctness requires backend round-trip and crash-tail tests;
 * this package exposes no continuously observable in-process relation.
 */
/*
 * 【中文】空安装器：不注册任何运行时不变量——持久化正确性必须靠后端往返与崩溃
 * 残尾测试验证。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 【中文】插件入口：把空安装器以 PACKAGE_NAME 登记进 invariants 服务。
 * @param ctx - 携带 invariants 服务的 Cordis 上下文。
 * @returns 设置成功后返回该登记项的 disposer（注销函数）。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
