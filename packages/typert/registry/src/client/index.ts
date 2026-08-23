/**
 * ================================ 文件注释 ================================
 * 【文件职责】registry 包的"client 面"入口：作为 Cordis 插件安装与 host 面相同的
 *             TypertRegistry 实现，让 client 运行时也拥有类型化注册中心。
 * 【技术维度】极简 Cordis 插件：inject 为空数组（client 侧反射根不依赖其他服务），
 *             apply 里直接 new TypertRegistry(ctx)。
 * 【产品维度】host / client 两侧共用同一注册中心实现：client 进程里插件加载时自动
 *             挂载 ctx.typert，无需重复实现。
 * 【逻辑维度】按代码顺序：inject 声明 → apply 安装实现。
 * 【关键边界】无配置项；实现细节全部在 ../service.ts。
 * 【新手阅读建议】对照 service.ts 的 TypertRegistry 类阅读本文件即可。
 * ==========================================================================
 */

/** Browser face of the shared Typert runtime registry. */
// 中文导读：client（浏览器侧）入口；实际实现复用 service.ts，本文件只负责安装。

import type { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '../service.ts'

/** Required services: none; this is the Client reflection root. */
// 中文：本插件不依赖其他服务——它是 client 侧的反射根。
export const inject: string[] = []

/**
 * Install the same registry implementation used by the Host face.
 * @param ctx - Client Cordis root.
 */
// 中文：把 host 面用的同一份注册中心实现安装到 client 上下文上。
export function apply(ctx: Context): void {
  new TypertRegistry(ctx)
}
