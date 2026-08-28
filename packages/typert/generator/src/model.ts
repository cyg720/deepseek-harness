/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义"编译器无关"的 typert 分析模型（model）：generator 从 TypeScript
 *             AST 提取出的类型图、导出、服务、事件、对象、远程调用等全部中间表示。
 *             TypeScript 的节点与 checker 只是提取输入，发射器（emitter）只消费本图。
 * 【技术维度】纯类型定义 + 一个图遍历辅助函数（childTypeNodeIds）。用判别联合
 *             （discriminated union，按 kind 区分分支的联合类型）表达类型表达式
 *             （TypeNodeModel），用 SymbolId / TypeNodeId 做图内稳定标识，与编译器解耦。
 * 【产品维度】这是"类型图"的可序列化中间格式：跨包、跨编译面传递类型信息，
 *             让生成出的产物不依赖任何 TypeScript 运行时。
 * 【逻辑维度】按代码顺序：① 基础别名（face / id / 关键字 / 运算符）；② 源码级模型
 *             （导出、JSDoc、服务、事件、对象、schema）；③ 远程调用模型
 *             （边界、参数、调用）；④ 包 / 面 / 工作区模型；⑤ 类型声明与成员模型；
 *             ⑥ 类型表达式（TypeNodeModel）与遍历函数 childTypeNodeIds；
 *             ⑦ TypeGraph 与 assertNever。
 * 【关键边界】模型只承载"发射所需"的信息：成员保留无函数体声明文本以支持字节稳定的
 *             源码投影；symbol 键会从 JSON schema 中抹除；未识别变体走 assertNever 抛错。
 * 【新手阅读建议】先看 TypeNodeModel 的判别联合（类型表达式长什么样），再对照
 *             InvocationModel / PackageModel 理解"一次远程调用被提取成什么"，
 *             最后看 childTypeNodeIds 了解图里的边。
 * ==========================================================================
 */

/**
 * Compiler-independent Typert analysis model. TypeScript nodes and checker
 * objects are extraction inputs only; emitters consume this graph.
 * @module @deepseek-ai/dsh-typert-generator/model
 */
// 中文导读：本文件几乎全是类型声明；唯一运行时函数 childTypeNodeIds 用于遍历类型图。

/** One independently compiled side of the workspace. */
// 中文：一个"独立编译的工作区侧面"：host = 服务提供方（宿主进程）；client = 消费方。
export type TypertFace = 'host' | 'client'

/** Stable graph-local identifier of a type expression. */
// 中文：类型表达式在图内的稳定标识（局部于某个类型图）。
export type TypeNodeId = string

/** Stable workspace identifier of a declared symbol. */
// 中文：已声明符号在工作区范围内的稳定标识，跨包引用时保持一致。
export type SymbolId = string

/** Keyword types accepted in ordinary TypeScript source declarations. */
// 中文：普通 TypeScript 源码声明里允许出现的关键字类型集合（any / never / string 等）。
export type KeywordTypeName =
  | 'any'
  | 'bigint'
  | 'boolean'
  | 'never'
  | 'number'
  | 'object'
  | 'string'
  | 'symbol'
  | 'undefined'
  | 'unknown'
  | 'void'

/** Prefix operators accepted on TypeScript type nodes. */
// 中文：类型节点上允许的前缀运算符：keyof（取键）、readonly（只读）、unique（唯一 symbol）。
export type TypeOperatorName = 'keyof' | 'readonly' | 'unique'

/** Source position retained for diagnostics and source-edit mode. */
// 中文：源文件位置（文件、行、列），供诊断与"源码编辑模式"定位使用。
export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

/** One public package export and the declaration it resolves to. */
// 中文：一个公开的包导出及其解析到的声明：subpath 是包内子路径，name 是导出名，
// symbol 指向声明的稳定标识，aliases 记录它的其他别名。
export interface ExportModel {
  readonly subpath: string
  readonly name: string
  readonly symbol: SymbolId
  readonly aliases: readonly string[]
}

/** One structured JSDoc tag, retaining its original text for unknown tags. */
// 中文：一条结构化的 JSDoc 标签：常见标签拆成 name / argument / comment，
// 未知标签则原样保留在 text 里。
export interface JsDocTagModel {
  readonly name: string
  readonly argument?: string
  readonly comment?: string
  readonly text: string
}

/** JSDoc retained as a standard part of every documented model element. */
// 中文：JSDoc 文档模型，是所有"可被文档化"的模型元素的公共组成部分：
// description / summary 是描述，tags 是结构化标签，jsDoc 保留原始注释文本。
export interface DocumentationModel {
  readonly description?: string
  readonly summary?: string
  readonly tags: readonly JsDocTagModel[]
  readonly jsDoc?: string
}

/** One Cordis Context contribution. */
// 中文：一个 Cordis 服务贡献（服务注册声明）：记录服务键、符号、所属导出、
// 公开成员列表与源位置。
export interface ServiceModel extends DocumentationModel {
  readonly key: string
  readonly symbol: SymbolId
  readonly export: ExportModel
  readonly members: readonly string[]
  readonly location: SourceLocation
}

/** One Cordis Events contribution. */
// 中文：一个 Cordis 事件贡献（事件声明）：name 是事件名，signature 指向事件签名
// 的类型节点，text 保留无函数体声明文本（供字节稳定的源码投影）。
export interface EventModel extends DocumentationModel {
  readonly name: string
  readonly signature: TypeNodeId
  /** Body-free declaration text retained for byte-stable source projections. */
  // 中文：无函数体的声明文本，保留用于字节稳定的源码投影。
  readonly text: string
  readonly mode?: string
  readonly location: SourceLocation
}

/** One explicitly exported reference-passed object. */
// 中文：一个显式导出的"按引用传递"对象（如文件句柄、会话等不能序列化的实体）：
// 传递方式固定为 reference，在类型图里以 symbol 指代。
export interface ObjectModel extends DocumentationModel {
  readonly export: ExportModel
  readonly symbol: SymbolId
  readonly passing: 'reference'
}

/** One explicitly selected value type for schema generation. */
// 中文：一个为 schema 生成而显式选中的值类型：export 是导出声明，type 指向
// 要被生成校验 schema 的类型节点。
export interface SchemaModel extends DocumentationModel {
  readonly export: ExportModel
  readonly symbol: SymbolId
  readonly type: TypeNodeId
}

/** One public business type import retained for a generated Remote declaration. */
// 中文：为生成的 Remote 声明保留的"公开业务类型导入"：生成消费端代码时，
// 需要从原包按 specifier 导入这个符号，name 是导入后在生成文件里的名字。
export interface RemoteTypeImportModel {
  readonly symbol: SymbolId
  readonly specifier: string
  readonly name: string
}

/** One strict wire boundary and the public symbols needed to name it. */
// 中文：一个"严格线边界"及其命名所需的公开符号：type 是作者书写的公开类型（保留给
// 生成的消费端声明），codecType 是 checker 解析后的投影（只用于发射运行时编解码器）。
export interface RemoteBoundaryModel {
  /** Authored public type retained for generated consumer declarations. */
  // 中文：作者书写的公开类型，保留给生成的消费端声明引用。
  readonly type: TypeNodeId
  /** Checker-resolved projection used only to emit the runtime codec. */
  // 中文：checker 解析后的投影，只用于发射运行时编解码器。
  readonly codecType: TypeNodeId
  /** Whether the authored top-level boundary explicitly accepts `undefined`. */
  // 中文：作者书写的顶层边界是否显式接受 undefined。
  readonly acceptsUndefined: boolean
  readonly typeSymbol: string
  readonly imports: readonly RemoteTypeImportModel[]
}

/** One ordered business argument projected onto a Remote wire field. */
// 中文：一个按顺序排列的业务参数，被投影到 Remote 的线上字段：name 是源码名，
// wire 是线上键，source 说明值是 JSON 还是查找引用。
export interface InvocationParameterModel {
  readonly name: string
  readonly wire: string
  readonly source: 'json' | 'lookup'
  readonly lookup?: string
  /** Authored as an optional parameter, so consumers may omit the wire field. */
  // 中文：源码里声明为可选参数，因此消费端可以省略该线上字段。
  readonly optional?: true
  readonly boundary: RemoteBoundaryModel
}

/** One strictly analyzed Host method exported through Typert Gateway. */
// 中文：一个经过严格分析、通过 Typert 网关导出的 Host 方法：id 全局稳定，
// service / namespace / method 组成线上端点，invocation 说明接收者选择方式，
// parameters / result 描述参数与返回值的线边界。
export interface InvocationModel {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly implementation?: string
  readonly mode?: 'stream'
  readonly invocation:
    | { readonly kind: 'direct' }
    | {
      readonly kind: 'context'
      readonly context: string
      readonly wire: string
      readonly boundary: RemoteBoundaryModel
    }
  readonly scope?: {
    readonly context: string
    readonly wire: string
  }
  readonly parameters: readonly InvocationParameterModel[]
  readonly cancellation?: {
    readonly parameter: 'signal'
  }
  readonly result: RemoteBoundaryModel
  readonly location: SourceLocation
}

/** Business semantics discovered in one package on one face. */
// 中文：某个包在某个编译面上发现的全部业务语义：导出、服务、事件、引用对象、
// schema、远程调用，以及包名与根目录。
export interface PackageModel {
  readonly name: string
  readonly root: string
  readonly exports: readonly ExportModel[]
  readonly services: readonly ServiceModel[]
  readonly events: readonly EventModel[]
  readonly objects: readonly ObjectModel[]
  readonly schemas: readonly SchemaModel[]
  readonly invocations: readonly InvocationModel[]
}

/** One explicit import/re-export edge between independently compiled faces. */
// 中文：两个独立编译面之间的一条显式导入 / 再导出边：记录从哪个包的哪个导出
// 连到哪个面的哪个包。
export interface CrossFaceLink {
  readonly fromFace: TypertFace
  readonly fromPackage: string
  readonly toFace: TypertFace
  readonly toPackage: string
  readonly subpath: string
  readonly name: string
}

/** Complete analysis result for an independently compiled face. */
// 中文：一个独立编译面的完整分析结果：face 标识是哪一侧，packages 是该面的包模型，
// graph 是该面的类型图。
export interface FaceModel {
  readonly face: TypertFace
  readonly packages: readonly PackageModel[]
  readonly graph: TypeGraph
}

/** Complete host/client analysis result. */
// 中文：完整的 host / client 分析结果：全部编译面 + 面之间的连接边。
export interface WorkspaceModel {
  readonly faces: readonly FaceModel[]
  readonly crossFaceLinks: readonly CrossFaceLink[]
}

/** One top-level authored type declaration indexed without making it a graph root. */
// 中文：一个顶层书写的类型声明（interface / class / alias / enum），被索引但不作为
// 类型图的根：保留 face、包、名字、种类、位置与声明文本。
export interface SourceDeclarationModel {
  readonly face: TypertFace
  readonly package: string
  readonly name: string
  readonly kind: 'interface' | 'class' | 'alias' | 'enum'
  readonly location: SourceLocation
  readonly text: string
}

/** Visibility recorded on class members. */
// 中文：类成员上记录的可见性：public / protected / private。
export type MemberVisibility = 'public' | 'protected' | 'private'

/** One generic type parameter, preserving its pre-evaluation constraint/default. */
// 中文：一个泛型类型参数：保留求值前的约束（constraint）与默认值（default），
// const 标记 const 类型参数，variance 记录协变 / 逆变。
export interface TypeParameterModel {
  readonly id: string
  readonly name: string
  readonly const: boolean
  readonly constraint?: TypeNodeId
  readonly default?: TypeNodeId
  readonly variance?: 'in' | 'out' | 'in-out'
}

/** One function-like parameter. */
// 中文：一个函数式参数：binding 说明解构形态（标识符 / 对象 / 数组），
// optional / rest / receiver 分别标记可选、剩余与 this 接收者，initializer 保留默认值文本。
export interface ParameterModel {
  readonly name: string
  readonly binding: 'identifier' | 'object' | 'array'
  readonly type: TypeNodeId
  readonly optional: boolean
  readonly rest: boolean
  readonly receiver: boolean
  readonly initializer?: string
}

/** A function/call/construct signature. */
// 中文：一个函数 / 调用 / 构造签名：泛型参数、参数列表与返回类型。
export interface SignatureModel {
  readonly typeParameters: readonly TypeParameterModel[]
  readonly parameters: readonly ParameterModel[]
  readonly returns: TypeNodeId
}

/** Shared flags of a class/interface/type-literal member. */
// 中文：类 / 接口 / 类型字面量成员的公共标志集合：含 id、名字、可选性、只读、async、
// abstract、static、可见性、位置，以及无函数体声明文本（供字节稳定的源码投影）。
export interface MemberBase extends DocumentationModel {
  readonly id: string
  readonly name: string
  /** JSON property name when a literal computed key differs from source text. */
  // 中文：当字面量计算键与源码文本不同时，记录 JSON 属性名。
  readonly jsonName?: string
  /** Non-literal computed keys; symbol keys are erased from JSON schemas. */
  // 中文：非字面量计算键：symbol 键会从 JSON schema 中抹除。
  readonly computed?: 'symbol' | 'dynamic'
  readonly optional: boolean
  readonly readonly: boolean
  readonly async: boolean
  readonly abstract: boolean
  readonly static: boolean
  readonly visibility: MemberVisibility
  readonly location: SourceLocation
  /** Body-free declaration text retained for byte-stable source projections. */
  // 中文：无函数体的声明文本，保留用于字节稳定的源码投影。
  readonly text: string
}

/** A property member. */
// 中文：属性成员：kind 固定为 property，type 指向属性类型节点。
export interface PropertyMemberModel extends MemberBase {
  readonly kind: 'property'
  readonly type: TypeNodeId
}

/** A method member. */
// 中文：方法成员：kind 固定为 method，携带完整的调用签名。
export interface MethodMemberModel extends MemberBase {
  readonly kind: 'method'
  readonly signature: SignatureModel
}

/** A getter or setter member. */
// 中文：访问器成员（getter / setter）：kind 区分二者，携带调用签名。
export interface AccessorMemberModel extends MemberBase {
  readonly kind: 'getter' | 'setter'
  readonly signature: SignatureModel
}

/** A call/construct/index signature in an interface or type literal. */
// 中文：接口或类型字面量里的调用 / 构造 / 索引签名成员，kind 区分三种形态。
export interface SignatureMemberModel extends MemberBase {
  readonly kind: 'call' | 'construct' | 'index'
  readonly signature: SignatureModel
}

/** One declaration or object-literal member. */
// 中文：一个声明或对象字面量成员的统一联合：属性 / 方法 / 访问器 / 签名四选一。
export type MemberModel =
  | PropertyMemberModel
  | MethodMemberModel
  | AccessorMemberModel
  | SignatureMemberModel

/** One enum member, retaining its developer-authored initializer. */
// 中文：一个枚举成员：保留开发者书写的初始化器文本（如 `A = 1` 中的 "1"）。
export interface EnumMemberModel extends DocumentationModel {
  readonly name: string
  readonly initializer?: string
  readonly location: SourceLocation
}

/** One authored part of a merged interface declaration. */
// 中文：合并（merge）接口声明中的一个书写片段：extends 列表、成员 id 列表，
// package 与 location 指明它来自哪个包、哪个位置。
export interface TypeDeclarationPartModel extends DocumentationModel {
  readonly package: string
  readonly location: SourceLocation
  readonly typeParameters: readonly TypeParameterModel[]
  readonly extends: readonly TypeNodeId[]
  readonly members: readonly string[]
}

/** A declared interface, class, or alias. */
// 中文：一个已声明的接口 / 类 / 类型别名 / 枚举：id 是稳定符号，text 保留
// 无函数体声明文本（与类型树并列存放），成员与泛型参数按上面各模型展开。
export interface TypeDeclarationModel extends DocumentationModel {
  readonly id: SymbolId
  readonly package: string
  readonly name: string
  readonly kind: 'interface' | 'class' | 'alias' | 'enum'
  readonly abstract: boolean
  readonly exported: boolean
  readonly location: SourceLocation
  /** Canonical body-free declaration text retained alongside the type tree. */
  // 中文：规范的无函数体声明文本，与类型树并列保留。
  readonly text: string
  readonly typeParameters: readonly TypeParameterModel[]
  readonly extends: readonly TypeNodeId[]
  readonly implements: readonly TypeNodeId[]
  readonly members: readonly MemberModel[]
  readonly parts?: readonly TypeDeclarationPartModel[]
  readonly type?: TypeNodeId
  readonly enumMembers?: readonly EnumMemberModel[]
}

/** Target of a named type reference. */
// 中文：命名类型引用（reference）的解析目标，五种情况：本图内的声明（declaration）、
// 类型参数（type-parameter）、跨编译面的导出（cross-face）、外部模块导出（external）、
// 标准库内建类型（standard）。
export type TypeTargetModel =
  | { readonly kind: 'declaration'; readonly symbol: SymbolId }
  | { readonly kind: 'type-parameter'; readonly parameter: string }
  | {
    readonly kind: 'cross-face'
    readonly face: TypertFace
    readonly package: string
    readonly subpath: string
    readonly name: string
  }
  | {
    readonly kind: 'external'
    readonly module: string
    readonly subpath: string
    readonly name: string
  }
  | { readonly kind: 'standard'; readonly name: string }

/** One tuple element, retaining labels and optional/rest modifiers. */
// 中文：一个元组元素：可选 name 是标签（如 `[a: number]` 里的 a），
// optional / rest 标记可选与剩余元素。
export interface TupleElementModel {
  readonly name?: string
  readonly type: TypeNodeId
  readonly optional: boolean
  readonly rest: boolean
}

/** One template-literal interpolation. */
// 中文：模板字面量类型里的一段插值：type 是插值处的类型节点，text 是插值前的字面量文本。
export interface TemplateSpanModel {
  readonly type: TypeNodeId
  readonly text: string
}

/** Compiler-independent TypeScript type expression. */
// 中文：编译器无关的 TypeScript 类型表达式（类型图的节点）：用 kind 判别联合覆盖
// 关键字、字面量、引用、联合 / 交叉、数组、元组、对象、函数、构造、索引访问、运算符、
// 条件、infer、映射、模板字面量、type query、import 类型、类型谓词与 this。
// 每个节点都有图内唯一 id，子节点以 id 引用，构成一张可遍历的图。
export type TypeNodeModel =
  | { readonly id: TypeNodeId; readonly kind: 'keyword'; readonly name: KeywordTypeName }
  | { readonly id: TypeNodeId; readonly kind: 'literal'; readonly value: string | number | bigint | boolean | null; readonly text: string }
  | { readonly id: TypeNodeId; readonly kind: 'parenthesized'; readonly type: TypeNodeId }
  | { readonly id: TypeNodeId; readonly kind: 'reference'; readonly name: string; readonly target: TypeTargetModel; readonly arguments: readonly TypeNodeId[] }
  | { readonly id: TypeNodeId; readonly kind: 'union' | 'intersection'; readonly types: readonly TypeNodeId[] }
  | { readonly id: TypeNodeId; readonly kind: 'array'; readonly element: TypeNodeId }
  | { readonly id: TypeNodeId; readonly kind: 'tuple'; readonly elements: readonly TupleElementModel[] }
  | { readonly id: TypeNodeId; readonly kind: 'object'; readonly members: readonly MemberModel[] }
  | { readonly id: TypeNodeId; readonly kind: 'function'; readonly signature: SignatureModel }
  | { readonly id: TypeNodeId; readonly kind: 'constructor'; readonly abstract: boolean; readonly signature: SignatureModel }
  | { readonly id: TypeNodeId; readonly kind: 'indexed-access'; readonly object: TypeNodeId; readonly index: TypeNodeId }
  | { readonly id: TypeNodeId; readonly kind: 'operator'; readonly operator: TypeOperatorName; readonly type: TypeNodeId }
  | { readonly id: TypeNodeId; readonly kind: 'conditional'; readonly check: TypeNodeId; readonly extends: TypeNodeId; readonly whenTrue: TypeNodeId; readonly whenFalse: TypeNodeId }
  | { readonly id: TypeNodeId; readonly kind: 'infer'; readonly parameter: TypeParameterModel }
  | {
    readonly id: TypeNodeId
    readonly kind: 'mapped'
    readonly parameter: TypeParameterModel
    readonly nameType?: TypeNodeId
    readonly value?: TypeNodeId
    readonly readonly: 'add' | 'remove' | 'preserve'
    readonly optional: 'add' | 'remove' | 'preserve'
  }
  | { readonly id: TypeNodeId; readonly kind: 'template-literal'; readonly head: string; readonly spans: readonly TemplateSpanModel[] }
  | { readonly id: TypeNodeId; readonly kind: 'type-query'; readonly expression: string; readonly arguments: readonly TypeNodeId[] }
  | {
    readonly id: TypeNodeId
    readonly kind: 'import-type'
    readonly module: string
    readonly qualifier?: string
    readonly arguments: readonly TypeNodeId[]
    readonly typeof: boolean
    readonly attributes?: string
    readonly target?: TypeTargetModel
  }
  | { readonly id: TypeNodeId; readonly kind: 'predicate'; readonly asserts: boolean; readonly parameter: string; readonly type?: TypeNodeId }
  | { readonly id: TypeNodeId; readonly kind: 'this' }

/**
 * Return the direct type-expression edges owned by one node.
 * @param node - compiler-independent type node to inspect.
 * @returns graph-local ids of its direct child type nodes.
 */
// 中文：返回某个类型节点直接拥有的"子类型节点 id"列表（类型图的边）。
// 发射器 / 遍历器靠它递归地走完整张图；mapped / infer 节点还会把泛型参数上的
// 约束与默认值一并算作子边。未知变体走 assertNever 保证穷尽。
export function childTypeNodeIds(node: TypeNodeModel): TypeNodeId[] {
  switch (node.kind) {
    case 'parenthesized':
    case 'operator': return [node.type]
    case 'reference': return [...node.arguments]
    case 'union':
    case 'intersection': return [...node.types]
    case 'array': return [node.element]
    case 'tuple': return node.elements.map(element => element.type)
    case 'indexed-access': return [node.object, node.index]
    case 'conditional': return [node.check, node.extends, node.whenTrue, node.whenFalse]
    case 'mapped': return [
      ...(node.parameter.constraint === undefined ? [] : [node.parameter.constraint]),
      ...(node.parameter.default === undefined ? [] : [node.parameter.default]),
      ...(node.nameType === undefined ? [] : [node.nameType]),
      ...(node.value === undefined ? [] : [node.value]),
    ]
    case 'template-literal': return node.spans.map(span => span.type)
    case 'type-query':
    case 'import-type': return [...node.arguments]
    case 'predicate': return node.type === undefined ? [] : [node.type]
    case 'infer': return [
      ...(node.parameter.constraint === undefined ? [] : [node.parameter.constraint]),
      ...(node.parameter.default === undefined ? [] : [node.parameter.default]),
    ]
    case 'keyword':
    case 'literal':
    case 'object':
    case 'function':
    case 'constructor':
    case 'this': return []
    default: return assertNever(node)
  }
}

/** Type declarations and expressions owned by one face. */
// 中文：一个编译面拥有的类型图：declarations 是全部类型声明，nodes 是全部类型表达式，
// 二者通过 SymbolId / TypeNodeId 相互引用。
export interface TypeGraph {
  readonly declarations: readonly TypeDeclarationModel[]
  readonly nodes: readonly TypeNodeModel[]
}

// 中文：穷尽检查兜底：所有判别联合的 switch 都必须处理每个分支，走到这里说明模型
// 新增了变体而遍历代码没跟上，直接抛错让开发者立刻发现。
function assertNever(value: never): never {
  throw new Error(`unsupported model variant ${JSON.stringify(value)}`)
}
