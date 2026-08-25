/*
 * ================================ 文件注释 ================================
 * 【文件职责】registry 包的主入口（桶文件）：从 service.ts 再导出注册中心实现与
 *             键构造工具，并再导出全部类型；同时通过模块扩充给协议包的
 *             TypertRegistryContract 补上"包模型 / schema 查询"的具体方法签名。
 * 【技术维度】纯再导出 + declare module 接口扩充：把 TypertRegistry 的独有方法
 *             （register / get / resolve / list / getPackage / listPackages /
 *             toJSONSchema）声明进协议包的契约接口。
 * 【产品维度】host / client 两侧入口（service.ts 与 client/index.ts）共用的门面：
 *             消费方只需 import 本包即可拿到类型化注册中心 API。
 * 【逻辑维度】按代码顺序：① 从 service.ts 再导出实现与键工具；② 再导出全部类型；
 *             ③ 模块扩充声明 registry 契约的扩展方法。
 * 【关键边界】模块扩充只声明类型、不产生运行时代码；契约的实现在 service.ts 的
 *             TypertRegistry 类里。
 * 【新手阅读建议】配合 service.ts 一起读：先看扩充的方法签名，再对照类实现。
 * ==========================================================================
 */

/** Host entry for the shared Typert runtime registry. */
// 中文导读：这是"host 面"的注册中心入口；client 面入口在 client/index.ts，
// 两者共用 service.ts 里的同一份实现。

import type { z } from 'zod'
import type { TypertDisposer } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TypertContribution,
  TypertFace,
  TypertPackageFilter,
  TypertPackageRecord,
  TypertSchemaFilter,
  TypertSchemaRecord,
} from './types.ts'

export { default, TypertRegistry, typertEndpoint, typertKey, typertPackageKey } from './service.ts'
export type * from './types.ts'

// 中文：模块扩充——给协议包的 TypertRegistryContract 补充 registry 独有的扩展方法，
// 使 ctx.typert 拥有完整的 schema / 包模型查询能力。
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRegistryContract {
    register(contribution: TypertContribution): TypertDisposer
    get(key: string): TypertSchemaRecord | undefined
    resolve(key: string): TypertSchemaRecord
    list(filter?: TypertSchemaFilter): TypertSchemaRecord[]
    getPackage(packageName: string, face?: TypertFace): TypertPackageRecord | undefined
    listPackages(filter?: TypertPackageFilter): TypertPackageRecord[]
    toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
  }
}
