/*
 * ================================ 文件注释 ================================
 * 【文件职责】"模型驱动"的类型图产物发射器：只消费 FaceModel 与 TypeGraph 数据，
 *             产出可执行的 JavaScript、精确的声明文件（.d.ts）以及 Host-for-Client
 *             的 Remote 贡献（含源码映射）。TypeScript 编译器节点不属于本边界。
 * 【技术维度】两类核心产出：① 运行时 TYPERT 清单（服务 / 事件 / 对象 / schema /
 *             调用描述），其中 schema 用 Zod 表达式生成（SchemaEmitter 把类型图
 *             投影成 zod 调用链）；② .d.ts 声明，用 @jridgewell/gen-mapping 手工
 *             生成源码映射。Remote 声明通过模块扩充（declare module）注入协议包。
 * 【产品维度】这是"类型图 → 可发布产物"的最后一公里：业务包发布后，消费端无需
 *             任何编译期工具即可获得类型安全的远程调用与运行时校验。
 * 【逻辑维度】按代码顺序：① 错误类与产物结果类型；② 私有运行时模型
 *             （RuntimeServiceModel 等）；③ FaceModelEmitter：emit 主流程 →
 *             runtimeModel / runtimeMember / runtimeTypes（运行时清单）→ renderJs /
 *             renderDts（本地产物）→ emitRemote / invocationLiteral / renderRemoteDts
 *             （Remote 产物与声明映射）→ remoteSignature / remoteFunctionType；
 *             ④ SchemaEmitter：把类型图投影成 Zod schema（含泛型、继承、引用解析）；
 *             ⑤ 模块级工具（键构造、codec 文本、导入名分配、标识符清洗等）。
 * 【关键边界】不可投影的构造（枚举、computed 动态成员、多数复杂类型节点）一律抛
 *             TypertEmitError 快速失败；symbol 键成员从 JSON schema 中忽略；
 *             TYPERT 的公开声明固定为 unknown，由 loader 在注册时校验收窄。
 * 【新手阅读建议】先读 emit() 看整体流程，再读 renderJs / renderDts 看两份产物的
 *             结构差异，最后读 SchemaEmitter.emit 理解"类型 → Zod"的投影规则。
 * ==========================================================================
 */

/**
 * Model-driven Typert artifact emitter. It consumes only FaceModel and
 * TypeGraph data; TypeScript compiler nodes are not part of this boundary.
 * @module @deepseek-ai/dsh-typert-generator/emitter
 */
// 中文导读：本文件把"分析模型"翻译成"发布产物"：js 是运行时清单，dts 是类型声明，
// remote 是给消费端用的远程契约（只有 host 面且有远程方法时才会生成）。

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { GenMapping, addMapping, toEncodedMap } from '@jridgewell/gen-mapping'
import type {
  DocumentationModel,
  FaceModel,
  InvocationModel,
  MemberModel,
  PackageModel,
  RemoteBoundaryModel,
  RemoteTypeImportModel,
  SchemaModel,
  SymbolId,
  TypeDeclarationModel,
  TypeNodeId,
  TypeNodeModel,
} from './model.ts'
import { TypeGraphRenderer } from './renderer.ts'

/** Failure to project a modeled construct into an emitted artifact. */
// 中文：把模型构造投影成产物失败时抛出的专用错误（例如类型无法映射成 Zod schema）。
export class TypertEmitError extends Error {
  override name = 'TypertEmitError'
}

/** JavaScript and declaration artifacts for one package on one face. */
// 中文：某个包在某个编译面上的完整产物：可执行 js、精确 dts、导出的 schema 名，
// host 面且含远程方法时还有可选的 Remote 贡献（remote）。
export interface ModelEmitResult {
  readonly package: string
  readonly face: FaceModel['face']
  readonly exports: readonly string[]
  readonly js: string
  readonly dts: string
  readonly remote?: RemoteModelEmitResult
}

/** Host-for-Client Remote contribution generated from the Host Program. */
// 中文：从 Host 编译面生成的"Host-for-Client"Remote 贡献：js（描述清单）、
// dts（注入协议包的调用签名）、dtsMap（声明源码映射，仅供编辑器跳转、不发布）。
export interface RemoteModelEmitResult {
  readonly js: string
  readonly dts: string
  readonly dtsMap: string
}

// 中文：内部运行时模型——成员：保留 kind、名字与"含源码修饰符"的渲染文本，
// 以及可选的 summary / jsDoc（用于模型可见的文档信息）。
interface RuntimeMemberModel {
  readonly kind: MemberModel['kind']
  readonly name: string
  readonly signature: string
  readonly summary?: string
  readonly jsDoc?: string
}

// 中文：内部运行时模型——类型：名字与整段渲染好的声明文本（供消费端反射展示）。
interface RuntimeTypeModel {
  readonly name: string
  readonly declaration: string
}

// 中文：内部运行时模型——服务：键、导出名、成员列表与依赖的辅助类型声明。
interface RuntimeServiceModel extends DocumentationModel {
  readonly key: string
  readonly exportName: string
  readonly members: readonly RuntimeMemberModel[]
  readonly types: readonly RuntimeTypeModel[]
}

// 中文：内部运行时模型——事件：名字、模式与渲染好的签名文本。
interface RuntimeEventModel extends DocumentationModel {
  readonly name: string
  readonly mode?: string
  readonly signature: string
}

// 中文：内部运行时模型——按引用传递的对象：名字、导出名、成员与辅助类型声明。
interface RuntimeObjectModel extends DocumentationModel {
  readonly name: string
  readonly exportName: string
  readonly members: readonly RuntimeMemberModel[]
  readonly types: readonly RuntimeTypeModel[]
}

// 中文：内部运行时模型——包：服务 / 事件 / 对象三组清单。
interface RuntimePackageModel {
  readonly services: readonly RuntimeServiceModel[]
  readonly events: readonly RuntimeEventModel[]
  readonly objects: readonly RuntimeObjectModel[]
}

/** Emit generated runtime and type artifacts from one independently analyzed face. */
// 中文：为一个独立分析的编译面发射"运行时 + 类型"产物的发射器。
export class FaceModelEmitter {
  // 中文：类型图渲染器：把模型里的类型节点渲染成 TypeScript 文本。
  private readonly renderer: TypeGraphRenderer

  /**
   * Create an emitter for one face graph.
   * @param face - independently analyzed face.
   */
  // 中文：绑定一个编译面模型，并基于它的类型图构造渲染器。
  constructor(private readonly face: FaceModel) {
    this.renderer = new TypeGraphRenderer(face.graph)
  }

  /**
   * Emit one modeled package.
   * @param packageName - exact package name in the face model.
   * @returns executable JavaScript and its precise declaration file.
   */
  // 中文：发射某个包的全部产物：先收集该包 schema 与调用边界的 Zod 定义，再分别
  // 渲染 js（运行时清单）与 dts（声明文件）；host 面且有远程方法时追加 Remote 产物。
  emit(packageName: string): ModelEmitResult {
    const packageModel = this.face.packages.find(candidate => candidate.name === packageName)
    // 中文：包不在该编译面的模型里（名字拼错或不属于这个面）直接抛错。
    if (packageModel === undefined) {
      throw new TypertEmitError(`typert emitter(${this.face.face}): package ${packageName} is not modeled on this face`)
    }
    // 中文：schema 发射器同时接收"显式 schema"与"调用边界类型"，统一生成 Zod 定义。
    const schemas = new SchemaEmitter(
      this.renderer,
      packageModel.schemas,
      invocationBoundaryRoots(packageModel.invocations),
    )
    const schemaArtifact = schemas.emit()
    const runtimeModel = this.runtimeModel(packageModel)
    const js = this.renderJs(packageModel, schemaArtifact, runtimeModel)
    const dts = this.renderDts(packageModel, schemaArtifact)
    return {
      package: packageName,
      face: this.face.face,
      exports: packageModel.schemas.map(schema => schema.export.name),
      js,
      dts,
      ...(this.face.face === 'host' && packageModel.invocations.length > 0
        ? { remote: this.emitRemote(packageModel) }
        : {}),
    }
  }

  // 中文：把包模型投影成"运行时清单"用的紧凑模型：服务带成员与依赖类型声明；
  // 事件必须是函数类型（否则无法渲染签名）；对象取自其声明模型的成员与类型闭包。
  private runtimeModel(packageModel: PackageModel): RuntimePackageModel {
    const services = packageModel.services.map((service): RuntimeServiceModel => {
      const members = service.members.map(id => this.runtimeMember(this.renderer.member(id)))
      return {
        ...documentationLiteral(service),
        key: service.key,
        exportName: service.export.name,
        members,
        types: this.runtimeTypes(this.renderer.declarationClosureForMembers(service.members), service.symbol),
      }
    })
    const events = packageModel.events.map((event): RuntimeEventModel => {
      const node = this.renderer.node(event.signature)
      // 中文：事件签名必须是函数类型，否则无法生成"事件名(参数...) "的运行时描述。
      if (node.kind !== 'function') {
        throw new TypertEmitError(`typert emitter(${this.face.face}): event ${event.name} is not a function type`)
      }
      return {
        ...documentationLiteral(event),
        name: event.name,
        ...(event.mode === undefined ? {} : { mode: event.mode }),
        signature: `${quote(event.name)}${this.renderer.renderSignature(node.signature)}`,
      }
    })
    const objects = packageModel.objects.map((object): RuntimeObjectModel => {
      const declaration = this.renderer.declaration(object.symbol)
      return {
        ...documentationLiteral(object),
        name: declaration.name,
        exportName: object.export.name,
        members: declaration.members.map(member => this.runtimeMember(member)),
        types: this.runtimeTypes(this.renderer.declarationClosureForMembers(declaration.members.map(member => member.id)), declaration.id),
      }
    })
    return { services, events, objects }
  }

  // 中文：把一个成员投影成运行时成员：签名保留源码修饰符（sourceModifiers = true），
  // 文档信息只带非空字段。
  private runtimeMember(member: MemberModel): RuntimeMemberModel {
    return {
      kind: member.kind,
      name: member.name,
      signature: this.renderer.renderMember(member, true),
      ...(member.summary === undefined ? {} : { summary: member.summary }),
      ...(member.jsDoc === undefined ? {} : { jsDoc: member.jsDoc }),
    }
  }

  // 中文：从声明闭包里筛出"非根声明"（根声明本身就是服务 / 对象本体，不需要单独列出），
  // 渲染成类型条目并按名字排序，保证产物顺序稳定。
  private runtimeTypes(declarations: readonly TypeDeclarationModel[], root: SymbolId): RuntimeTypeModel[] {
    return declarations
      .filter(declaration => declaration.id !== root)
      .map(declaration => ({
        name: declaration.name,
        declaration: this.renderer.renderDeclaration(declaration.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  // 中文：渲染运行时 js 清单：文件头 + 可选的 zod import + schema 定义 + schema 导出 +
  // 一个 TYPERT 常量（含包名、face、schemas、invocations 与序列化后的运行时模型）。
  private renderJs(
    packageModel: PackageModel,
    schemas: SchemaArtifact,
    runtimeModel: RuntimePackageModel,
  ): string {
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from FaceModel — do not edit. */',
    ]
    // 中文：有 schema 定义才需要 import zod。
    if (schemas.definitions.length > 0) lines.push('import { z } from \'zod\'', '')
    lines.push(...schemas.definitions)
    if (schemas.definitions.length > 0) lines.push('')
    // 中文：每个显式 schema 以 `export const 名 = 内部名` 暴露给消费方。
    for (const schema of schemas.exports) lines.push(`export const ${schema.exportName} = ${schema.internalName}`)
    if (schemas.exports.length > 0) lines.push('')
    // 中文：服务 / 事件 / 对象等运行时模型整体序列化成 JSON 嵌进产物。
    const model = JSON.stringify(runtimeModel, null, 2)
    lines.push('export const TYPERT = {')
    lines.push(`  package: ${quote(packageModel.name)},`)
    lines.push(`  face: ${quote(this.face.face)},`)
    lines.push('  schemas: [')
    for (const schema of schemas.exports) {
      lines.push(`    { name: ${quote(schema.exportName)}, schema: ${schema.exportName} },`)
    }
    lines.push('  ],')
    lines.push('  invocations: [')
    for (const invocation of packageModel.invocations) {
      lines.push(`${indent(this.invocationLiteral(invocation, schemas), 4)},`)
    }
    lines.push('  ],')
    lines.push(`  model: ${indent(model, 2).trimStart()},`)
    lines.push('}')
    return `${lines.join('\n')}\n`
  }

  // 中文：渲染 dts 声明文件：schema 导出声明为 zod 类型（通过 `原类型名 as 导出名$source`
  // 的导入保持类型关联），TYPERT 固定声明为 unknown（见下方英文注释说明原因）。
  private renderDts(packageModel: PackageModel, schemas: SchemaArtifact): string {
    // 中文：收集每个 schema 需要从原包导入的类型：`导出名 as 导出名$source`。
    const imports = new Map<string, string[]>()
    for (const schema of schemas.exports) {
      const specifier = packageExportSpecifier(packageModel.name, schema.model.export.subpath)
      const names = imports.get(specifier) ?? []
      names.push(`${schema.model.export.name} as ${schema.exportName}$source`)
      imports.set(specifier, names)
    }
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from FaceModel — do not edit. */',
    ]
    if (schemas.exports.length > 0) lines.splice(1, 0, 'import type { z } from \'zod\'')
    for (const [specifier, names] of [...imports].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`import type { ${names.sort().join(', ')} } from ${quote(specifier)}`)
    }
    lines.push('')
    for (const schema of schemas.exports) {
      lines.push(`export declare const ${schema.exportName}: z.ZodType<${schema.exportName}$source>`)
    }
    if (schemas.exports.length > 0) lines.push('')
    // The Loader validates and narrows this generated module boundary before
    // registration. Keeping the public declaration unknown prevents every
    // contributing business package from depending on the runtime registry.
    // 中文：TYPERT 的公开声明保持 unknown：loader 在注册前会校验并收窄这个生成的模块
    // 边界；若在这里给出具体类型，会让每个贡献业务包都反向依赖运行时注册中心。
    lines.push('export declare const TYPERT: unknown')
    return `${lines.join('\n')}\n`
  }

  // 中文：发射 Host-for-Client 的 Remote 贡献：js 里只含调用描述（descriptors）与
  // 边界 codec 用到的 Zod 定义；dts 里用模块扩充向协议包注入调用签名并带源码映射。
  private emitRemote(packageModel: PackageModel): RemoteModelEmitResult {
    // 中文：Remote 产物不需要显式 schema，只用调用边界类型生成 Zod 定义。
    const schemas = new SchemaEmitter(
      this.renderer,
      [],
      invocationBoundaryRoots(packageModel.invocations),
    ).emit()
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */',
    ]
    if (schemas.definitions.length > 0) lines.push('import { z } from \'zod\'', '')
    lines.push(...schemas.definitions)
    if (schemas.definitions.length > 0) lines.push('')
    lines.push('export const TYPERT_REMOTE = {')
    lines.push(`  package: ${quote(packageModel.name)},`)
    lines.push('  descriptors: [')
    for (const invocation of packageModel.invocations) {
      lines.push(`${indent(this.invocationLiteral(invocation, schemas), 4)},`)
    }
    lines.push('  ],')
    lines.push('}')
    lines.push('')
    lines.push('export default TYPERT_REMOTE')
    const declaration = this.renderRemoteDts(packageModel)
    return {
      js: `${lines.join('\n')}\n`,
      ...declaration,
    }
  }

  // 中文：把一次调用描述渲染成 InvocationDescriptor 字面量（对应协议包的
  // InvocationDescriptor 结构）：id / service / namespace / method / invocation /
  // scope / parameters / cancellation / result / sourceLocation，按可选字段逐段拼装。
  private invocationLiteral(invocation: InvocationModel, schemas: SchemaArtifact): string {
    const lines = [
      '{',
      `  id: ${quote(invocation.id)},`,
      `  service: ${quote(invocation.service)},`,
      `  namespace: ${quote(invocation.namespace)},`,
      `  method: ${quote(invocation.method)},`,
    ]
    // 中文：别名实现成员只在存在时才输出。
    if (invocation.implementation !== undefined) {
      lines.push(`  implementation: ${quote(invocation.implementation)},`)
    }
    // 中文：接收者选择方式：direct 一行输出；context 则带 context / wire / codec。
    if (invocation.invocation.kind === 'direct') {
      lines.push('  invocation: { kind: \'direct\' },')
    } else {
      lines.push('  invocation: {')
      lines.push('    kind: \'context\',')
      lines.push(`    context: ${quote(invocation.invocation.context)},`)
      lines.push(`    wire: ${quote(invocation.invocation.wire)},`)
      lines.push(`    codec: ${indent(strictCodec(
        invocation.invocation.boundary,
        schemas.boundary(contextBoundaryKey(invocation)),
      ), 4).trimStart()},`)
      lines.push('  },')
    }
    // 中文：作用域投影（把某个参数替换成调用 Context 身份）可选。
    if (invocation.scope !== undefined) {
      lines.push('  scope: {')
      lines.push(`    context: ${quote(invocation.scope.context)},`)
      lines.push(`    wire: ${quote(invocation.scope.wire)},`)
      lines.push('  },')
    }
    lines.push('  parameters: [')
    invocation.parameters.forEach((parameter, index) => {
      lines.push('    {')
      lines.push(`      name: ${quote(parameter.name)},`)
      lines.push(`      wire: ${quote(parameter.wire)},`)
      lines.push(`      source: ${quote(parameter.source)},`)
      if (parameter.lookup !== undefined) lines.push(`      lookup: ${quote(parameter.lookup)},`)
      if (parameter.boundary.acceptsUndefined) lines.push('      acceptsUndefined: true,')
      lines.push(`      codec: ${indent(strictCodec(
        parameter.boundary,
        schemas.boundary(parameterBoundaryKey(invocation, index)),
      ), 6).trimStart()},`)
      lines.push('    },')
    })
    lines.push('  ],')
    // 中文：取消信号固定为最后一个保留参数 signal。
    if (invocation.cancellation !== undefined) {
      lines.push("  cancellation: { parameter: 'signal' },")
    }
    lines.push(`  result: ${indent(strictCodec(
      invocation.result,
      schemas.boundary(resultBoundaryKey(invocation)),
    ), 2).trimStart()},`)
    lines.push(`  sourceLocation: ${JSON.stringify(invocation.location)},`)
    lines.push('}')
    return lines.join('\n')
  }

  // 中文：渲染 Remote 的 dts 声明：先收集远程签名需要导入的公开类型并分配去冲突别名，
  // 再用模块扩充（declare module '@deepseek-ai/dsh-typert-protocol'）向协议包注入
  // TypertRemoteMap / TypertRemoteNamespaceMap / TypertRemoteScopeMap 接口，
  // 同时用 GenMapping 记录"生成行 ↔ 源码位置"的映射供编辑器跳转。
  private renderRemoteDts(packageModel: PackageModel): Pick<RemoteModelEmitResult, 'dts' | 'dtsMap'> {
    const imports = remoteImports(packageModel.invocations)
    const referenceNames = allocateRemoteImportNames(imports)
    // 中文：按 specifier 分组导入条目，生成 import 语句。
    const grouped = new Map<string, { readonly name: string; readonly local: string }[]>()
    for (const imported of imports) {
      const values = grouped.get(imported.specifier) ?? []
      values.push({
        name: imported.name,
        local: referenceNames.get(imported.symbol) as string,
      })
      grouped.set(imported.specifier, values)
    }
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */',
      'import type {',
      '  RemoteResult,',
      '  TypertRemoteContribution,',
      '} from \'@deepseek-ai/dsh-typert-protocol\'',
    ]
    // 中文：源码映射生成器：文件名为 remote-client.d.ts，后续逐签名登记映射。
    const sourceMap = new GenMapping({ file: 'typert.remote-client.d.ts' })
    for (const [specifier, values] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
      const names = values.sort((left, right) => left.local.localeCompare(right.local)).map(value =>
        value.name === value.local ? value.name : `${value.name} as ${value.local}`)
      lines.push(`import type { ${names.join(', ')} } from ${quote(specifier)}`)
    }
    lines.push('')
    lines.push('declare module \'@deepseek-ai/dsh-typert-protocol\' {')
    // 中文：把调用分成直连（direct）与作用域化（context 或带 scope）两组分别注入映射表。
    const direct = packageModel.invocations.filter(invocation => invocation.invocation.kind === 'direct')
    const scoped = packageModel.invocations.filter(invocation =>
      invocation.invocation.kind === 'context' || invocation.scope !== undefined)
    if (direct.length > 0) {
      // 中文：每个命名空间生成一个 interface（名字用命名空间的十六进制编码保证合法），
      // 再把全部直连签名写进 TypertRemoteMap，并让命名空间面（TypertRemoteNamespaceMap）
      // 指向那些 interface。
      for (const namespace of uniqueNamespaces(direct)) {
        lines.push(`  interface ${remoteNamespaceInterface(namespace)} {`)
        for (const invocation of direct.filter(candidate => candidate.namespace === namespace)) {
          this.pushRemoteNamespaceSignature(lines, sourceMap, packageModel, invocation, referenceNames)
        }
        lines.push('  }')
      }
      lines.push('  interface TypertRemoteMap {')
      for (const invocation of direct) {
        this.pushRemoteSignature(lines, sourceMap, packageModel, invocation, referenceNames, false)
      }
      lines.push('  }')
      lines.push('  interface TypertRemoteNamespaceMap {')
      for (const namespace of uniqueNamespaces(direct)) {
        lines.push(`    ${quote(namespace)}: ${remoteNamespaceInterface(namespace)}`)
      }
      lines.push('  }')
    }
    if (scoped.length > 0) {
      lines.push('  interface TypertRemoteScopeMap {')
      for (const invocation of scoped) {
        this.pushRemoteSignature(lines, sourceMap, packageModel, invocation, referenceNames, true)
      }
      lines.push('  }')
    }
    lines.push('}')
    lines.push('')
    lines.push('export declare const TYPERT_REMOTE: TypertRemoteContribution')
    lines.push('export default TYPERT_REMOTE')
    lines.push('//# sourceMappingURL=typert.remote-client.d.ts.map')
    return {
      dts: `${lines.join('\n')}\n`,
      dtsMap: `${JSON.stringify(toEncodedMap(sourceMap))}\n`,
    }
  }

  // 中文：把一条直连 / 作用域化调用签名写入声明行，并在源码映射里登记
  // "生成行 ↔ 源码方法声明位置"的对应关系。
  private pushRemoteSignature(
    lines: string[],
    sourceMap: GenMapping,
    packageModel: PackageModel,
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
    scoped: boolean,
  ): void {
    const signature = this.remoteSignature(invocation, referenceNames, scoped)
    // 中文：定位属性键的结束位置（第一个 ': ('），用于映射里的列偏移。
    const keyLength = signature.indexOf(': (')
    if (keyLength < 0) throw new TypertEmitError(`Remote signature ${invocation.id} has no property delimiter`)
    this.pushMappedRemoteSignature(lines, sourceMap, packageModel, invocation, signature, keyLength)
  }

  // 中文：命名空间 interface 里的签名：键用方法名（可带引号），值是该方法的函数类型。
  private pushRemoteNamespaceSignature(
    lines: string[],
    sourceMap: GenMapping,
    packageModel: PackageModel,
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
  ): void {
    const key = renderRemotePropertyName(invocation.method)
    const signature = `${key}: ${this.remoteFunctionType(invocation, referenceNames, false)}`
    this.pushMappedRemoteSignature(lines, sourceMap, packageModel, invocation, signature, key.length)
  }

  // 中文：把签名行写进 lines 并登记两处映射：键起点指向源码方法名，函数类型起点
  // 指向源码声明位置（列号减 1 是因为源列从 0 计）。
  private pushMappedRemoteSignature(
    lines: string[],
    sourceMap: GenMapping,
    packageModel: PackageModel,
    invocation: InvocationModel,
    signature: string,
    keyLength: number,
  ): void {
    lines.push(`    ${signature}`)
    const generatedLine = lines.length
    const source = remoteDeclarationSource(packageModel, invocation)
    addMapping(sourceMap, {
      generated: { line: generatedLine, column: 4 },
      source,
      original: { line: invocation.location.line, column: invocation.location.column - 1 },
      name: invocation.method,
    })
    addMapping(sourceMap, {
      generated: { line: generatedLine, column: 4 + keyLength },
    })
  }

  // 中文：拼出整条 Remote 签名：作用域化的键形如 `ContextKey:namespace/方法`，
  // 直连的键形如 `namespace/方法`；值都是对应的函数类型。
  private remoteSignature(
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
    scoped: boolean,
  ): string {
    // 中文：context 调用的上下文种类来自 invocation；scope 投影则取 scope.context。
    const context = invocation.invocation.kind === 'context'
      ? invocation.invocation.context
      : invocation.scope?.context
    const key = scoped
      ? `${context as string}:${invocation.namespace}/${invocation.method}`
      : `${invocation.namespace}/${invocation.method}`
    return `${quote(key)}: ${this.remoteFunctionType(invocation, referenceNames, scoped)}`
  }

  // 中文：生成消费端调用签名 `(参数...) => Promise<RemoteResult<返回类型>>`：
  // 作用域化调用会剔除被 scope 替换掉的那个参数；取消信号追加为可选 signal。
  private remoteFunctionType(
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
    scoped: boolean,
  ): string {
    const parameters = invocation.parameters.filter(parameter =>
      !scoped || invocation.invocation.kind === 'context' || parameter.wire !== invocation.scope?.wire).map(parameter =>
      `${safeIdentifier(parameter.wire)}${parameter.optional === true ? '?' : ''}: ${this.renderer.renderType(parameter.boundary.type, referenceNames)}`)
    if (invocation.cancellation !== undefined) parameters.push('signal?: AbortSignal')
    const result = this.renderer.renderType(invocation.result.type, referenceNames)
    // The Client Remote face delivers the carrier's outcome, so every generated
    // consumer signature resolves to a result the caller reads instead of a
    // value it must guard with its own try/catch.
    // 中文：Client Remote 面会把 carrier 的结果折叠成 RemoteResult，因此生成的消费端
    // 签名直接返回"可读的结果信封"，调用方无需再包一层 try/catch 去接 carrier 异常。
    return `(${parameters.join(', ')}) => Promise<RemoteResult<${result}>>`
  }
}

// 中文：计算源码映射里"相对源文件路径"：把方法声明文件相对包根的路径再拼上 .. 前缀
// （声明文件生成在 lib 下，源码在工作区 src 下）；路径逃出包根时视为错误。
function remoteDeclarationSource(packageModel: PackageModel, invocation: InvocationModel): string {
  const relativeSource = posix.relative(packageModel.root, invocation.location.file)
  if (relativeSource === '' || relativeSource === '..' || relativeSource.startsWith('../') || posix.isAbsolute(relativeSource)) {
    throw new TypertEmitError(
      `Remote declaration ${invocation.id} is outside its package root ${packageModel.root}`,
    )
  }
  return posix.join('..', relativeSource)
}

// 中文：收集一组调用的去重命名空间并按字典序排序，保证生成的 interface 顺序稳定。
function uniqueNamespaces(invocations: readonly InvocationModel[]): string[] {
  return [...new Set(invocations.map(invocation => invocation.namespace))].sort()
}

// 中文：命名空间 interface 的生成名：`TypertRemoteNamespace$` + 命名空间 utf8 十六进制，
// 这样任何字符串命名空间（含点号等）都能得到合法且唯一的 TypeScript 标识符。
function remoteNamespaceInterface(namespace: string): string {
  return `TypertRemoteNamespace$${Buffer.from(namespace, 'utf8').toString('hex')}`
}

// 中文：内部结构——一条 schema 导出：模型、对外导出名与内部定义名。
interface SchemaExport {
  readonly model: SchemaModel
  readonly exportName: string
  readonly internalName: string
}

// 中文：内部结构——schema 发射结果：全部定义文本、导出条目，以及"边界 key → 定义名"
// 的查询函数（调用描述里的 codec 靠它引用边界 schema）。
interface SchemaArtifact {
  readonly definitions: readonly string[]
  readonly exports: readonly SchemaExport[]
  boundary(key: string): string
}

// 中文：内部结构——一个"调用边界 schema 根"：key 是全局唯一边界键，type 是边界类型节点。
interface BoundarySchemaRoot {
  readonly key: string
  readonly type: TypeNodeId
}

// 中文：把类型图投影成 Zod schema 文本的发射器：为每个被引用的声明生成
// `const 名$schema = z.xxx(...)` 定义；泛型声明生成"参数化 schema 工厂函数"，
// 引用处用 z.lazy 包裹以支持递归类型。
class SchemaEmitter {
  // 中文：声明符号 id → 生成的 schema 定义名（含去冲突后缀）。
  private readonly names = new Map<SymbolId, string>()
  // 中文：调用边界 key → 生成的边界 schema 定义名。
  private readonly boundaryNames = new Map<string, string>()
  // 中文：本包 schema 闭包内的声明（按图顺序）。
  private readonly declarations: TypeDeclarationModel[]

  constructor(
    private readonly renderer: TypeGraphRenderer,
    private readonly schemas: readonly SchemaModel[],
    private readonly boundaries: readonly BoundarySchemaRoot[],
  ) {
    // 中文：从显式 schema 与调用边界两路收集声明闭包，合并去重成待生成的声明集。
    const declarations = new Map<SymbolId, TypeDeclarationModel>()
    for (const schema of schemas) {
      for (const declaration of renderer.declarationClosureForTypes([schema.type])) {
        declarations.set(declaration.id, declaration)
      }
    }
    for (const boundary of boundaries) {
      for (const declaration of renderer.declarationClosureForTypes([boundary.type])) {
        declarations.set(declaration.id, declaration)
      }
    }
    this.declarations = renderer.graph.declarations.filter(declaration => declarations.has(declaration.id))
    // 中文：为每个声明分配 `安全名$schema` 的定义名；同名冲突时追加数字后缀。
    const identifiers = new Set<string>()
    for (const declaration of this.declarations) {
      const base = `${safeIdentifier(declaration.name)}$schema`
      let name = base
      let suffix = 2
      while (identifiers.has(name)) name = `${base}${String(suffix++)}`
      identifiers.add(name)
      this.names.set(declaration.id, name)
    }
    // 中文：边界 schema 同样分配 `安全key$schema` 名（冲突时加后缀）。
    for (const boundary of boundaries) {
      const base = `${safeIdentifier(boundary.key)}$schema`
      let name = base
      let suffix = 2
      while (identifiers.has(name)) name = `${base}${String(suffix++)}`
      identifiers.add(name)
      this.boundaryNames.set(boundary.key, name)
    }
  }

  // 中文：生成全部 schema 定义与导出条目：先所有声明定义，再所有边界定义；
  // 导出条目的内部名指向对应声明的 schema 名。
  emit(): SchemaArtifact {
    const definitions = this.declarations.map(declaration => this.declarationDefinition(declaration))
    for (const boundary of this.boundaries) {
      definitions.push(`const ${this.boundaryName(boundary.key)} = ${this.typeSchema(boundary.type)}`)
    }
    const exports = this.schemas.map((model): SchemaExport => ({
      model,
      exportName: safeIdentifier(model.export.name),
      internalName: this.exportSchemaName(model),
    }))
    return {
      definitions,
      exports,
      boundary: key => this.boundaryName(key),
    }
  }

  // 中文：生成单个声明的定义：无泛型参数时直接 `const 名 = 结构`；
  // 有泛型参数时生成参数化工厂 `const 名 = (类型0$schema, ...) => 结构`，
  // 引用处传入实参 schema（参数名以 typeN$schema 命名避免与业务标识符冲突）。
  private declarationDefinition(declaration: TypeDeclarationModel): string {
    const name = this.schemaName(declaration.id)
    if (declaration.typeParameters.length === 0) {
      return `const ${name} = ${this.declarationSchema(declaration, new Map())}`
    }
    const parameters = declaration.typeParameters.map((parameter, index) =>
      [`type${String(index)}$schema`, parameter.id] as const)
    const substitutions = new Map(parameters.map(([schema, id]) => [id, schema]))
    return `const ${name} = (${parameters.map(([schema]) => schema).join(', ')}) => ${this.declarationSchema(declaration, substitutions)}`
  }

  // 中文：把声明结构投影成 Zod 表达式：枚举无法投影（直接失败）；别名取其右侧类型；
  // 接口 / 类用对象 schema，并对每个 extends 祖先做 z.intersection 合并。
  private declarationSchema(
    declaration: TypeDeclarationModel,
    substitutions: ReadonlyMap<string, string>,
  ): string {
    if (declaration.kind === 'enum') {
      this.fail(declaration.name, 'enum declarations have no Zod projection')
    }
    if (declaration.kind === 'alias') {
      if (declaration.type === undefined) this.fail(declaration.name, 'alias has no modeled type')
      return this.describe(this.typeSchema(declaration.type, substitutions), declaration)
    }
    const own = this.objectSchema(declaration.members, declaration.name, substitutions)
    let result = own
    for (const heritage of declaration.extends) {
      result = `z.intersection(${this.typeSchema(heritage, substitutions)}, ${result})`
    }
    return this.describe(result, declaration)
  }

  // 中文：把类型节点投影成 Zod 表达式（核心递归）：关键字 / 字面量 / 括号 / 引用 /
  // 联合 / 交叉 / 数组 / 元组 / 对象各有投影规则；复杂类型节点（条件、映射、函数等）
  // 无法在运行时校验，一律走 unsupported 抛错。
  private typeSchema(id: TypeNodeId, substitutions: ReadonlyMap<string, string> = new Map()): string {
    const node = this.renderer.node(id)
    switch (node.kind) {
      case 'keyword': return this.keywordSchema(node.name)
      case 'literal': return `z.literal(${node.text})`
      case 'parenthesized': return this.typeSchema(node.type, substitutions)
      case 'reference': return this.referenceSchema(node, substitutions)
      case 'union': {
        // 中文：空联合投影为 z.never()（没有值能通过），单元素联合直接投影该元素。
        if (node.types.length === 0) return 'z.never()'
        if (node.types.length === 1) return this.typeSchema(node.types[0] as TypeNodeId, substitutions)
        return `z.union([${node.types.map(type => this.typeSchema(type, substitutions)).join(', ')}])`
      }
      case 'intersection': {
        const [head, ...tail] = node.types
        if (head === undefined) return 'z.unknown()'
        return tail.reduce(
          (left, right) => `z.intersection(${left}, ${this.typeSchema(right, substitutions)})`,
          this.typeSchema(head, substitutions),
        )
      }
      case 'array': return `z.array(${this.typeSchema(node.element, substitutions)})`
      case 'tuple': {
        // 中文：元组拆成"固定部分"与"剩余部分"：固定部分用 z.tuple，剩余用 .rest()。
        const fixed = node.elements.filter(element => !element.rest)
        const rest = node.elements.find(element => element.rest)
        let schema = `z.tuple([${fixed.map(element => this.optional(this.typeSchema(element.type, substitutions), element.optional)).join(', ')}])`
        if (rest !== undefined) schema += `.rest(${this.tupleRestSchema(rest.type, substitutions)})`
        return schema
      }
      case 'object': return this.objectSchema(node.members, id, substitutions)
      case 'operator':
      case 'indexed-access':
      case 'conditional':
      case 'infer':
      case 'mapped':
      case 'template-literal':
      case 'type-query':
      case 'import-type':
      case 'predicate':
      case 'function':
      case 'constructor':
      case 'this': return this.unsupported(node)
    }
  }

  // 中文：把引用节点投影成 Zod 表达式，按目标分三种情况：
  // ① 本图声明：无泛型 → `z.lazy(() => 名)`；有泛型 → 用实参调用工厂函数；
  // ② 类型参数：取替换表里的 schema（替换表由泛型工厂的形参构成）；
  // ③ 标准库类型：Array / ReadonlyArray / Record / Date 有专门投影，其余不支持。
  private referenceSchema(
    node: Extract<TypeNodeModel, { kind: 'reference' }>,
    substitutions: ReadonlyMap<string, string>,
  ): string {
    if (node.target.kind === 'declaration') {
      const name = this.schemaName(node.target.symbol)
      const declaration = this.renderer.declaration(node.target.symbol)
      if (declaration.typeParameters.length === 0) {
        // 中文：非泛型声明却收到类型实参，属源码错误，直接失败。
        if (node.arguments.length > 0) {
          this.fail(node.name, `non-generic declaration received ${String(node.arguments.length)} type arguments`)
        }
        return `z.lazy(() => ${name})`
      }
      const arguments_ = this.declarationArguments(node, declaration, substitutions)
      return `z.lazy(() => ${name}(${arguments_.join(', ')}))`
    }
    if (node.target.kind === 'type-parameter') {
      if (node.arguments.length > 0) this.fail(node.name, 'type parameter reference cannot receive type arguments')
      const schema = substitutions.get(node.target.parameter)
      if (schema === undefined) this.fail(node.name, 'type parameter has no schema substitution')
      return schema
    }
    if (node.target.kind === 'standard') {
      switch (node.target.name) {
        case 'Array':
        case 'ReadonlyArray': {
          const element = node.arguments[0]
          if (element === undefined) this.fail(node.name, 'array reference has no element type')
          return this.readonly(
            `z.array(${this.typeSchema(element, substitutions)})`,
            node.target.name === 'ReadonlyArray',
          )
        }
        case 'Record': {
          const key = node.arguments[0]
          const value = node.arguments[1]
          if (key === undefined || value === undefined) this.fail(node.name, 'Record requires key and value types')
          return `z.record(${this.typeSchema(key, substitutions)}, ${this.typeSchema(value, substitutions)})`
        }
        case 'Date': return 'z.date()'
        default: this.fail(node.name, `standard type ${node.target.name} has no Zod projection`)
      }
    }
    this.fail(node.name, `${node.target.kind} reference has no Zod projection`)
  }

  // 中文：计算泛型声明被引用时的实参 schema 列表：逐个类型参数匹配实参，缺失的用
  // 参数的默认值补齐；实参个数超过参数个数直接失败。同时把"参数 id → 实参 schema"
  // 逐层累积进 resolved，使后续参数能引用前面参数的 schema。
  private declarationArguments(
    node: Extract<TypeNodeModel, { kind: 'reference' }>,
    declaration: TypeDeclarationModel,
    substitutions: ReadonlyMap<string, string>,
  ): string[] {
    if (node.arguments.length > declaration.typeParameters.length) {
      this.fail(
        node.name,
        `generic declaration accepts ${String(declaration.typeParameters.length)} type arguments but received ${String(node.arguments.length)}`,
      )
    }
    const resolved = new Map(substitutions)
    const arguments_: string[] = []
    for (const [index, parameter] of declaration.typeParameters.entries()) {
      const argument = node.arguments[index]
      const schema = argument === undefined
        ? parameter.default === undefined
          ? this.fail(node.name, `missing type argument ${parameter.name}`)
          : this.typeSchema(parameter.default, resolved)
        : this.typeSchema(argument, substitutions)
      arguments_.push(schema)
      resolved.set(parameter.id, schema)
    }
    return arguments_
  }

  // 中文：元组剩余元素的 schema：剩余元素必须是数组形态（数组字面量或 Array /
  // ReadonlyArray 引用），取它的元素类型作为 .rest() 的参数。
  private tupleRestSchema(id: TypeNodeId, substitutions: ReadonlyMap<string, string>): string {
    const node = this.renderer.node(id)
    if (node.kind === 'array') return this.typeSchema(node.element, substitutions)
    if (node.kind === 'reference'
      && node.target.kind === 'standard'
      && (node.target.name === 'Array' || node.target.name === 'ReadonlyArray')) {
      const element = node.arguments[0]
      if (element === undefined) this.fail(node.name, 'tuple rest array has no element type')
      return this.typeSchema(element, substitutions)
    }
    this.fail(id, 'tuple rest element must retain an array type')
  }

  // 中文：把对象成员投影成 z.object：忽略 static / 非 public / symbol 键成员；
  // 动态计算键无法得到固定 JSON 属性名，直接失败；索引签名投影成 z.record 并与
  // 属性部分做 z.intersection（一个对象最多允许一个索引签名）。
  private objectSchema(
    members: readonly MemberModel[],
    subject: string,
    substitutions: ReadonlyMap<string, string>,
  ): string {
    const properties: string[] = []
    const indices: string[] = []
    let symbolMembers = 0
    for (const member of members) {
      if (member.static || member.visibility !== 'public') continue
      if (member.computed === 'symbol') {
        symbolMembers++
        continue
      }
      if (member.computed === 'dynamic') {
        this.fail(subject, `computed member ${member.name} has no fixed JSON property name`)
      }
      if (member.kind === 'index') {
        const parameter = member.signature.parameters[0]
        if (member.signature.parameters.length !== 1 || parameter === undefined) {
          this.fail(subject, 'index signature must have exactly one key parameter')
        }
        indices.push(this.readonly(
          `z.record(${this.typeSchema(parameter.type, substitutions)}, ${this.typeSchema(member.signature.returns, substitutions)})`,
          member.readonly,
        ))
        continue
      }
      if (member.kind !== 'property') this.fail(subject, `${member.kind} member ${member.name} is not data-schema projectable`)
      const property = this.describe(
        this.optional(this.readonly(this.typeSchema(member.type, substitutions), member.readonly), member.optional),
        member,
      )
      properties.push(`${quote(member.jsonName ?? member.name)}: ${property}`)
    }
    if (indices.length > 1) this.fail(subject, 'object type has more than one JSON index signature')
    // A unique-symbol-only object is a compile-time marker and imposes no JSON shape.
    // 中文：只有 unique symbol 成员的对象是编译期标记，不对应任何 JSON 形状，投影为
    // z.unknown()（运行时不做校验）。
    if (properties.length === 0 && indices.length === 0 && symbolMembers > 0) return 'z.unknown()'
    const object = `z.object({${properties.length === 0 ? '' : `\n${properties.map(property => `  ${property},`).join('\n')}\n`}})`
    const index = indices[0]
    if (index === undefined) return object
    if (properties.length === 0) return index
    return `z.intersection(${object}, ${index})`
  }

  // 中文：显式 schema 导出名：必须指向非泛型声明（泛型导出没有具体类型可校验，直接失败）。
  private exportSchemaName(model: SchemaModel): string {
    const name = this.schemaName(model.symbol)
    const declaration = this.renderer.declaration(model.symbol)
    if (declaration.typeParameters.length > 0) {
      this.fail(model.export.name, 'generic schema exports require a concrete declaration')
    }
    return name
  }

  // 中文：关键字类型 → Zod 表达式；object 关键字用自定义校验（对象或函数，排除 null）。
  private keywordSchema(name: string): string {
    switch (name) {
      case 'any': return 'z.any()'
      case 'unknown': return 'z.unknown()'
      case 'never': return 'z.never()'
      case 'string': return 'z.string()'
      case 'number': return 'z.number()'
      case 'bigint': return 'z.bigint()'
      case 'boolean': return 'z.boolean()'
      case 'symbol': return 'z.symbol()'
      case 'undefined': return 'z.undefined()'
      case 'void': return 'z.void()'
      case 'object': return "z.custom((value) => (typeof value === 'object' && value !== null) || typeof value === 'function')"
      default: this.fail(name, `keyword ${name} has no Zod projection`)
    }
  }

  // 中文：查声明 schema 名；不在闭包内（未被引用）即失败。
  private schemaName(symbol: SymbolId): string {
    const name = this.names.get(symbol)
    if (name === undefined) this.fail(symbol, 'referenced declaration is outside the selected schema closure')
    return name
  }

  // 中文：查边界 schema 名；边界不在所选 schema 根内即失败。
  private boundaryName(key: string): string {
    const name = this.boundaryNames.get(key)
    if (name === undefined) this.fail(key, 'invocation boundary is outside the selected schema roots')
    return name
  }

  // 中文：有文档描述时给 schema 追加 .describe(描述)，让校验错误信息可读。
  private describe(schema: string, documentation: DocumentationModel): string {
    return documentation.description === undefined ? schema : `${schema}.describe(${quote(documentation.description)})`
  }

  // 中文：可选字段追加 .optional()。
  private optional(schema: string, optional: boolean): string {
    return optional ? `${schema}.optional()` : schema
  }

  // 中文：只读字段追加 .readonly()（Zod 只读转换）。
  private readonly(schema: string, readonly: boolean): string {
    return readonly ? `${schema}.readonly()` : schema
  }

  // 中文：不支持的类型节点统一抛错（复用 fail）。
  private unsupported(node: TypeNodeModel): never {
    this.fail(node.id, `type node ${node.kind} has no Zod projection`)
  }

  // 中文：统一失败出口：拼出带上下文的 TypertEmitError。
  private fail(subject: string, message: string): never {
    throw new TypertEmitError(`typert Zod emitter: ${subject}: ${message}`)
  }
}

// 中文：把文档模型压成"只有非空字段"的字面量：描述 / 摘要 / 标签 / 原始 jsDoc，
// 空字段直接省略，保证生成的 JSON 简洁且稳定。
function documentationLiteral(documentation: DocumentationModel): DocumentationModel {
  return {
    ...(documentation.description === undefined ? {} : { description: documentation.description }),
    ...(documentation.summary === undefined ? {} : { summary: documentation.summary }),
    tags: documentation.tags,
    ...(documentation.jsDoc === undefined ? {} : { jsDoc: documentation.jsDoc }),
  }
}

// 中文：收集一次调用全部需要生成 codec 的边界根：context 模式的上下文边界、每个参数
// 边界、结果边界；类型取"checker 解析后的投影"（codecType），因为运行时校验的是
// 解析后的真实形状。
function invocationBoundaryRoots(invocations: readonly InvocationModel[]): BoundarySchemaRoot[] {
  const result: BoundarySchemaRoot[] = []
  for (const invocation of invocations) {
    if (invocation.invocation.kind === 'context') {
      result.push({ key: contextBoundaryKey(invocation), type: invocation.invocation.boundary.codecType })
    }
    invocation.parameters.forEach((parameter, index) => {
      result.push({ key: parameterBoundaryKey(invocation, index), type: parameter.boundary.codecType })
    })
    result.push({ key: resultBoundaryKey(invocation), type: invocation.result.codecType })
  }
  return result
}

// 中文：上下文边界的全局唯一键（以调用 id 为前缀）。
function contextBoundaryKey(invocation: InvocationModel): string {
  return `${invocation.id}:context`
}

// 中文：参数边界的全局唯一键（含参数序号，同一次调用里不重复）。
function parameterBoundaryKey(invocation: InvocationModel, index: number): string {
  return `${invocation.id}:parameter:${String(index)}`
}

// 中文：结果边界的全局唯一键。
function resultBoundaryKey(invocation: InvocationModel): string {
  return `${invocation.id}:result`
}

// 中文：渲染"严格 codec"字面量：mode 固定 strict，带规范类型符号与边界 schema。
function strictCodec(boundary: RemoteBoundaryModel, schema: string): string {
  return [
    '{',
    '  mode: \'strict\',',
    `  typeSymbol: ${quote(boundary.typeSymbol)},`,
    `  schema: ${schema},`,
    '}',
  ].join('\n')
}

// 中文：收集一次调用全部边界的"公开类型导入"需求：同一符号在不同边界出现时，导入
// 来源必须一致，否则说明同名符号有矛盾的公开声明，直接抛错。
function remoteImports(invocations: readonly InvocationModel[]): RemoteTypeImportModel[] {
  const imports = new Map<SymbolId, RemoteTypeImportModel>()
  const add = (boundary: RemoteBoundaryModel): void => {
    for (const imported of boundary.imports) {
      const current = imports.get(imported.symbol)
      if (current !== undefined
        && (current.specifier !== imported.specifier || current.name !== imported.name)) {
        throw new TypertEmitError(`typert Remote emitter: symbol ${imported.symbol} has inconsistent public imports`)
      }
      imports.set(imported.symbol, imported)
    }
  }
  for (const invocation of invocations) {
    if (invocation.invocation.kind === 'context') add(invocation.invocation.boundary)
    for (const parameter of invocation.parameters) add(parameter.boundary)
    add(invocation.result)
  }
  return [...imports.values()].sort((left, right) =>
    left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name))
}

// 中文：为远程声明里引用的公开类型分配"局部别名"：优先用原名的安全标识符，与
// 协议包里的保留名（TypertRemoteContribution / TYPERT_REMOTE）或彼此冲突时追加
// $remote2、$remote3…… 后缀。
function allocateRemoteImportNames(imports: readonly RemoteTypeImportModel[]): ReadonlyMap<SymbolId, string> {
  const used = new Set(['TypertRemoteContribution', 'TYPERT_REMOTE'])
  const names = new Map<SymbolId, string>()
  for (const imported of imports) {
    const base = safeIdentifier(imported.name)
    let name = base
    let suffix = 2
    while (used.has(name)) name = `${base}$remote${String(suffix++)}`
    used.add(name)
    names.set(imported.symbol, name)
  }
  return names
}

// 中文：由包名与子路径拼出完整导入说明符：根子路径 "." 直接返回包名，
// 否则把 "./x" 拼成 "包名/x"。
function packageExportSpecifier(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

// 中文：把任意字符串清洗成合法 TypeScript 标识符：非法字符换成下划线，
// 数字开头时在前面补下划线。
function safeIdentifier(name: string): string {
  const normalized = name.replace(/[^$\w]/gu, '_')
  if (/^[$A-Z_a-z]/u.test(normalized)) return normalized
  return `_${normalized}`
}

// 中文：Remote 签名里方法名的渲染：合法标识符原样输出，否则加单引号。
function renderRemotePropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : quote(name)
}

// 中文：把字符串转成单引号字面量：转义反斜杠、单引号、换行与回车。
function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`
}

// 中文：给多行文本的每一行统一加指定数量的空格前缀（用于把嵌套字面量缩进到指定层级）。
function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return value.split('\n').map(line => `${prefix}${line}`).join('\n')
}
