/*
 * ================================ 文件注释 ================================
 * 【文件职责】frontend-static 包的"不变量伴生插件"：注册本包拥有者身份。
 * 唯一的属主关系是兜底席位，但无法从 teardown 流探针——internal/plugin 在
 * 释放 fiber 的 effects 运行前触发，合法属主在通知时刻仍持有席位，任何占用
 * 探针都会在每次正确释放时误报（不同于 webserver 伴生用保留路径探针、不会与
 * 活跃注册冲突）。席位的注册/释放对称性改由真实组合的 HMR 安全测试覆盖。
 * 【技术维度】Cordis 伴生插件模板（空 install + 理由说明）。
 * 【产品维度】为不变量门禁提供归属登记，同时用文档化的理由说明为何此处不做
 * 探针式断言。
 * 【逻辑维度】包名 → 注入声明 → 空 install（附详尽理由）→ apply 注册。
 * 【关键边界】本文件没有 jscpd:ignore 包裹（代码量小，不触发克隆检测）。
 * 【新手阅读建议】与 webserver/invariant.ts 对照：同一个"无法探针"问题因场景
 * 不同得到不同解。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-frontend-static`.
 * @module @deepseek-ai/dsh-host-frontend-static/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在不变量注册表中使用的包名键。
const PACKAGE_NAME = '@deepseek-ai/dsh-host-frontend-static'

/** Cordis companion plugin name. */
// 伴生插件的 Cordis 插件名。
export const name = 'host-frontend-static-invariant'
/** Service required before the companion can register. */
// 启动前必须注入的服务：不变量注册服务。
export const inject = ['invariants']

/**
 * No runtime invariant: the only owned relation is the single fallback seat,
 * which cannot be probed from the teardown stream — `internal/plugin` fires
 * before the disposing fiber's effects run, so the legitimate owner still
 * holds the seat at notification time and any claim probe would
 * false-positive on every correct disposal (unlike the webserver companion,
 * whose reserved-path probes never collide with a live registration). The
 * seat's register/release symmetry is covered by the package's
 * real-composition HMR-safety test instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 伴生插件入口：注册空 install，返回释放函数。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
