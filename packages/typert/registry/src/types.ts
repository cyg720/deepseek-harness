/*
 * ================================ 文件注释 ================================
 * 【文件职责】registry 包的纯类型定义：生成的产物清单结构与运行时注册中心使用的
 *             记录类型。注册中心把 Zod schema 与"生成的包反射元数据"分开存储，
 *             本文件定义二者的统一形态。
 * 【技术维度】纯类型声明：TypertContribution 是 loader 校验后交给注册中心的"贡献"
 *             结构（对应 generator 产物 TYPERT 清单）；TypertSchemaRecord /
 *             TypertPackageRecord 是注册中心内存里的活记录；Filter 类型用于枚举过滤。
 * 【产品维度】消费方（网关 / 调试器 / 文档工具）通过这些类型以类型安全的方式查询
 *             schema 与包反射信息。
 * 【逻辑维度】按代码顺序：① TypertFace；② 文档与成员 / 类型模型（TypertDocTag /
 *             TypertDocumentation / TypertMemberModel / TypertTypeModel）；③ 服务 /
 *             事件 / 对象 / 包模型（TypertServiceModel / TypertEventModel /
 *             TypertObjectModel / TypertPackageModel）；④ 贡献与记录（TypertSchema /
 *             TypertContribution / TypertSchemaRecord / TypertPackageRecord）；
 *             ⑤ 枚举过滤器（TypertSchemaFilter / TypertPackageFilter）。
 * 【关键边界】本文件只描述结构、不含实现；schema 记录直接持有 Zod 实例（运行时可校验）。
 * 【新手阅读建议】先读 TypertContribution（一次注册"长什么样"），再看两类 Record。
 * ==========================================================================
 */

/**
 * Pure generated-artifact and runtime-registry types. The registry stores Zod
 * schemas separately from generated package reflection metadata.
 * @module @deepseek-ai/dsh-typert-registry/types
 */
// 中文导读：本文件是"产物 ↔ 运行时"的桥梁类型：产物携带这些结构，注册中心按这些
// 结构存储与查询。

import type { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** Independently compiled side that produced a contribution. */
// 中文：产出贡献的"独立编译侧"：host（宿主）/ client（消费方）。
export type TypertFace = 'host' | 'client'

/** Structured JSDoc tag retained by generated runtime metadata. */
// 中文：生成运行时元数据里保留的结构化 JSDoc 标签。
export interface TypertDocTag {
  readonly name: string
  readonly argument?: string
  readonly comment?: string
  readonly text: string
}

/** Source documentation retained on reflected package elements. */
// 中文：反射出的包元素上保留的源码文档：描述、摘要、标签表与原始 JSDoc 文本。
export interface TypertDocumentation {
  readonly description?: string
  readonly summary?: string
  readonly tags: readonly TypertDocTag[]
  readonly jsDoc?: string
}

/** One generated public member signature. */
// 中文：一条生成的公开成员签名（属性 / 方法 / 访问器 / 签名成员），含可选文档。
export interface TypertMemberModel {
  readonly kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index'
  readonly name: string
  readonly signature: string
  readonly summary?: string
  readonly jsDoc?: string
}

/** One named type declaration referenced by a reflected business surface. */
// 中文：被反射业务表面引用的一个命名类型声明（名字 + 整段声明文本）。
export interface TypertTypeModel {
  readonly name: string
  readonly declaration: string
}

/** Runtime reflection metadata for one Cordis service. */
// 中文：一个 Cordis 服务的运行时反射元数据：键、导出名、公开成员与依赖类型声明。
export interface TypertServiceModel extends TypertDocumentation {
  readonly key: string
  readonly exportName: string
  readonly members: readonly TypertMemberModel[]
  readonly types: readonly TypertTypeModel[]
}

/** Runtime reflection metadata for one Cordis event. */
// 中文：一个 Cordis 事件的运行时反射元数据：名字、可选模式与签名文本。
export interface TypertEventModel extends TypertDocumentation {
  readonly name: string
  readonly mode?: string
  readonly signature: string
}

/** Runtime reflection metadata for one explicitly exported reference object. */
// 中文：一个显式导出的引用对象的运行时反射元数据：名字、导出名、成员与类型声明。
export interface TypertObjectModel extends TypertDocumentation {
  readonly name: string
  readonly exportName: string
  readonly members: readonly TypertMemberModel[]
  readonly types: readonly TypertTypeModel[]
}

/** Generated business reflection for one package on one face. */
// 中文：某个包在某个面上的生成业务反射：服务 / 事件 / 对象三组模型。
export interface TypertPackageModel {
  readonly services: readonly TypertServiceModel[]
  readonly events: readonly TypertEventModel[]
  readonly objects: readonly TypertObjectModel[]
}

/** One generated live Zod schema. */
// 中文：一条生成的、活着的 Zod schema：名字 + 校验器实例。
export interface TypertSchema {
  readonly name: string
  readonly schema: z.ZodType
}

/** One generated package contribution registered and withdrawn atomically. */
// 中文：一次生成的包贡献——"原子注册 / 原子撤销"的单位：包名、面、schema 列表、
// 包反射模型与远程调用描述（无远程方法时为空数组）。
export interface TypertContribution {
  readonly package: string
  readonly face: TypertFace
  readonly schemas: readonly TypertSchema[]
  readonly model: TypertPackageModel
  /** Host invocation definitions, empty when the package exports no Remote methods. */
  // 中文：Host 调用定义；包没有导出远程方法时为空数组。
  readonly invocations: readonly InvocationDescriptor[]
}

/** A live schema plus its contribution identity. */
// 中文：活 schema 记录：在 TypertSchema 之上附加贡献身份（包、面、全局键）。
export interface TypertSchemaRecord extends TypertSchema {
  readonly package: string
  readonly face: TypertFace
  readonly key: string
}

/** A live generated package model plus its stable identity. */
// 中文：活的包模型记录：包模型之上附加稳定身份（包、面、全局键）。
export interface TypertPackageRecord {
  readonly package: string
  readonly face: TypertFace
  readonly key: string
  readonly model: TypertPackageModel
}

/** Filter for schema enumeration. */
// 中文：schema 枚举过滤器：按包名 / 面筛选。
export interface TypertSchemaFilter {
  readonly package?: string
  readonly face?: TypertFace
}

/** Filter for package-model enumeration. */
// 中文：包模型枚举过滤器：按包名 / 面筛选。
export interface TypertPackageFilter {
  readonly package?: string
  readonly face?: TypertFace
}
