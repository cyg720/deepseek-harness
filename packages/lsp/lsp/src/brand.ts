/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-lsp 自有的品牌（branded）类型：LspProviderId——提供者在 ctx.lsp 上注册时保留的不透明身份标识，以及构造它的工厂函数。
 * 【技术维度】基于 @deepseek-ai/dsh-brand 的 Branded<B> 做类型层"品牌"标记：运行时只是普通字符串，
 *   编译期却无法与裸 string 混用，防止跨边界传错 id。类型与工厂同文件，便于 index.ts 用同一个名字
 *   同时 re-export 两者。
 * 【产品维度】为 LSP 提供者身份提供类型安全：注册、冲突检测、路由选择都依靠该不透明 id，避免字符串裸传造成的语义混淆。
 * 【逻辑维度】定义 LspProviderId 品牌类型 → 定义同名工厂函数 LspProviderId(id)（仅做类型断言，不做运行时校验）。
 * 【关键边界】工厂不做校验：空字符串等非法值由注册时的 registry 拒绝；品牌类型不可被外部伪造，保证跨包边界的身份唯一性。
 * 【新手阅读建议】结合 index.ts 的 registerProvider 看品牌 id 在何处被保留与释放；"类型即文档、编译期约束"是本项目跨包边界的通用手法。
 * ==========================================================================
 */
/**
 * dsh-lsp's owned branded id: {@link LspProviderId}, the opaque identity a provider reserves on
 * `ctx.lsp`. The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; keeping the type and its
 * factory together here lets `index.ts` re-export both under one name.
 * @module @deepseek-ai/dsh-lsp/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque provider identity, reserved atomically with its extension mappings at registration. */
// 不透明的提供者身份：注册时与扩展名映射一起被原子保留，跨包边界传递时无法被伪造或误用为普通字符串。
export type LspProviderId = Branded<'LspProviderId'>

/**
 * Brand a string as an {@link LspProviderId}. No validation — the registry rejects an empty id at
 * registration.
 * @param id - the provider's stable identifier.
 * @returns the same string, branded.
 */
// 把字符串"品牌化"为 LspProviderId：不做任何校验（空 id 由注册时的 registry 拒绝），仅返回同一字符串的类型断言版本。
export function LspProviderId(id: string): LspProviderId {
  return id as LspProviderId
}
