/*
 * ================================ 文件注释 ================================
 * 【文件职责】在"编译器无关的类型图"（TypeGraph）上做渲染与遍历：把模型里的类型表达式
 *             重新拼回 TypeScript 类型文本。发射器（emitter）用它渲染，不再触碰
 *             TypeScript AST 节点。
 * 【技术维度】TypeGraphRenderer 类把节点 / 声明 / 成员索引成 Map，按 id 快速解析；
 *             renderType 对 TypeNodeModel 判别联合递归渲染；另有渲染成员、签名、
 *             声明、参数、类型参数与对象字面量的系列私有方法；文件尾部是一组
 *             文本工具函数（转义、引号、数组括号判定等）。
 * 【产品维度】类型图产物（生成的 .ts / .d.ts 文本）正是由这里的渲染结果拼装而成，
 *             保证"从源码提取 → 模型 → 文本"整条链路上类型信息不丢失、可读、可发布。
 * 【逻辑维度】按代码顺序：① TypeGraphRenderError 错误类；② TypeGraphRenderer
 *             （构造索引 + node / declaration / member 解析）；③ renderType
 *             （类型表达式渲染，覆盖全部变体）；④ renderSignature / renderMember /
 *             renderDeclaration（签名、成员、命名声明）；⑤ 声明闭包遍历
 *             （declarationClosure*，找出被引用的全部声明）；⑥ 私有渲染助手
 *             （renderSignatureHead / renderParameter / renderTypeParameters 等）；
 *             ⑦ 模块级工具函数（nodeSignatures / needsArrayParentheses /
 *             renderPropertyName / quote / escapeTemplate / assertNever）。
 * 【关键边界】图内引用缺失（悬空 id）一律抛 TypeGraphRenderError；mapped 类型缺约束、
 *             alias 缺类型节点也会抛错——内部不一致必须快速失败，而不是生成错误文本。
 * 【新手阅读建议】先读 renderType 的 reference / union / object 几个分支理解核心套路，
 *             再看 renderDeclaration 怎么把声明渲染成多行文本，最后看
 *             declarationClosure 理解"怎么找出被引用的全部声明"。
 * ==========================================================================
 */

/**
 * Rendering and traversal over the compiler-independent TypeGraph. Emitters
 * use this module instead of reaching back into TypeScript AST nodes.
 * @module @deepseek-ai/dsh-typert-generator/renderer
 */
// 中文导读：本文件是"模型 → TypeScript 文本"的翻译器：输入类型图，输出可发布的类型声明。

import { childTypeNodeIds } from './model.ts'
import type {
  MemberModel,
  ParameterModel,
  SignatureModel,
  SymbolId,
  TypeDeclarationModel,
  TypeGraph,
  TypeNodeId,
  TypeNodeModel,
  TypeParameterModel,
} from './model.ts'

/** Failure to render or traverse an internally inconsistent TypeGraph. */
// 中文：渲染或遍历"内部不一致的类型图"时抛出的专用错误（例如引用不存在的节点或声明）。
export class TypeGraphRenderError extends Error {
  override name = 'TypeGraphRenderError'
}

/** Read and render one TypeGraph without compiler objects. */
// 中文：只读 + 渲染一个 TypeGraph 的渲染器：构造时把图索引成三张 Map，
// 之后所有渲染与遍历都通过 id 查表完成，全程不接触 TypeScript 编译器对象。
export class TypeGraphRenderer {
  // 中文：类型节点表：TypeNodeId → 节点，渲染时按 id 取节点。
  private readonly nodes: ReadonlyMap<TypeNodeId, TypeNodeModel>
  // 中文：声明表：SymbolId → 声明模型。
  private readonly declarations: ReadonlyMap<SymbolId, TypeDeclarationModel>
  // 中文：成员表：成员 id → 成员模型（声明里的成员被扁平化索引，方便按 id 直达）。
  private readonly members: ReadonlyMap<string, MemberModel>
  // 中文：泛型参数 id → 参数名，渲染 reference 时把类型参数占位还原成可读名字。
  private readonly parameterNames = new Map<string, string>()

  /**
   * Index one complete graph.
   * @param graph - compiler-independent graph to render.
   */
  // 中文：接收一张完整类型图并建立索引：节点、声明、成员各进一张 Map；
  // 同时把声明及其成员签名里的泛型参数 id 登记到 parameterNames，供渲染时查名。
  constructor(readonly graph: TypeGraph) {
    this.nodes = new Map(graph.nodes.map(node => [node.id, node]))
    this.declarations = new Map(graph.declarations.map(declaration => [declaration.id, declaration]))
    this.members = new Map(graph.declarations.flatMap(declaration => declaration.members.map(member => [member.id, member] as const)))
    for (const declaration of graph.declarations) {
      this.indexParameters(declaration.typeParameters)
      for (const member of declaration.members) {
        if ('signature' in member) this.indexParameters(member.signature.typeParameters)
      }
    }
  }

  /**
   * Resolve a node id or fail with the broken edge.
   * @param id - graph-local type node id.
   * @returns the referenced node.
   */
  // 中文：按 id 取类型节点；节点不存在说明图内部有悬空引用，抛 TypeGraphRenderError 快速失败。
  node(id: TypeNodeId): TypeNodeModel {
    const node = this.nodes.get(id)
    if (node === undefined) throw new TypeGraphRenderError(`type graph references missing node ${id}`)
    return node
  }

  /**
   * Resolve a declaration id or fail with the broken edge.
   * @param id - workspace symbol id.
   * @returns the referenced declaration.
   */
  // 中文：按符号 id 取声明模型；不存在时抛 TypeGraphRenderError。
  declaration(id: SymbolId): TypeDeclarationModel {
    const declaration = this.declarations.get(id)
    if (declaration === undefined) throw new TypeGraphRenderError(`type graph references missing declaration ${id}`)
    return declaration
  }

  /**
   * Resolve a public member id.
   * @param id - declaration member id.
   * @returns the referenced member.
   */
  // 中文：按成员 id 取成员模型；不存在时抛 TypeGraphRenderError。
  member(id: string): MemberModel {
    const member = this.members.get(id)
    if (member === undefined) throw new TypeGraphRenderError(`type graph references missing member ${id}`)
    return member
  }

  /**
   * Render one type expression from the retained source structure.
   * @param id - type node id.
   * @param references - optional generated names for declaration references.
   * @returns TypeScript type text.
   */
  // 中文：把一个类型节点渲染成 TypeScript 类型文本。references 可选：当某个声明引用
  // 在生成文件里要换成别的名字（如导入后的别名）时，用它做"符号 id → 名字"的映射。
  renderType(id: TypeNodeId, references?: ReadonlyMap<SymbolId, string>): string {
    const node = this.node(id)
    switch (node.kind) {
      case 'keyword': return node.name
      case 'literal': return node.text
      case 'parenthesized': return `(${this.renderType(node.type, references)})`
      case 'reference': {
        // 中文：解析引用名：类型参数用登记过的参数名；本图声明用 references 映射的
        // 生成名（没有映射则退回源码名）；其余目标直接用节点名。有泛型实参时拼 <...>。
        const name = node.target.kind === 'type-parameter'
          ? this.parameterNames.get(node.target.parameter) ?? node.name
          : node.target.kind === 'declaration'
            ? references?.get(node.target.symbol) ?? node.name
            : node.name
        return node.arguments.length === 0
          ? name
          : `${name}<${node.arguments.map(argument => this.renderType(argument, references)).join(', ')}>`
      }
      case 'union': return node.types.map(type => this.renderType(type, references)).join(' | ')
      case 'intersection': return node.types.map(type => this.renderType(type, references)).join(' & ')
      case 'array': {
        const element = this.renderType(node.element, references)
        // 中文：元素是联合 / 交叉 / 函数等"低优先级"类型时加括号，保证 `(A | B)[]` 语义正确。
        const wrapped = needsArrayParentheses(this.node(node.element)) ? `(${element})` : element
        return `${wrapped}[]`
      }
      case 'tuple': {
        const elements = node.elements.map((element) => {
          const type = this.renderType(element.type, references)
          // 中文：带标签的元组元素渲染成 `标签?: 类型` 或 `...标签: 类型` 形态。
          if (element.name !== undefined) {
            return `${element.rest ? '...' : ''}${element.name}${element.optional ? '?' : ''}: ${type}`
          }
          return `${element.rest ? '...' : ''}${type}${element.optional ? '?' : ''}`
        })
        return `[${elements.join(', ')}]`
      }
      case 'object': return this.renderObject(node.members, references)
      case 'function': return `${this.renderSignatureHead(node.signature, references)} => ${this.renderType(node.signature.returns, references)}`
      case 'constructor': return `${node.abstract ? 'abstract ' : ''}new ${this.renderSignatureHead(node.signature, references)} => ${this.renderType(node.signature.returns, references)}`
      case 'indexed-access': return `${this.renderType(node.object, references)}[${this.renderType(node.index, references)}]`
      case 'operator': return `${node.operator} ${this.renderType(node.type, references)}`
      case 'conditional': {
        return `${this.renderType(node.check, references)} extends ${this.renderType(node.extends, references)} ? ${this.renderType(node.whenTrue, references)} : ${this.renderType(node.whenFalse, references)}`
      }
      case 'infer': return `infer ${this.renderTypeParameter(node.parameter, false, references)}`
      case 'mapped': {
        // 中文：映射类型三要素：readonly / 可选修饰符（add / remove / preserve 转成
        // 前缀或 - 前缀语法）、`参数 in 约束 [as 名称类型]`、值类型。
        const readonly = node.readonly === 'preserve' ? '' : node.readonly === 'remove' ? '-readonly ' : 'readonly '
        const optional = node.optional === 'preserve' ? '' : node.optional === 'remove' ? '-?' : '?'
        // 中文：映射类型缺约束无法渲染（`K in ?` 没有意义），视为内部不一致直接抛错。
        if (node.parameter.constraint === undefined) {
          throw new TypeGraphRenderError(`mapped type parameter ${node.parameter.name} has no constraint`)
        }
        const parameter = `${node.parameter.name} in ${this.renderType(node.parameter.constraint, references)}`
        const nameType = node.nameType === undefined ? '' : ` as ${this.renderType(node.nameType, references)}`
        const value = node.value === undefined ? 'unknown' : this.renderType(node.value, references)
        return `{ ${readonly}[${parameter}${nameType}]${optional}: ${value} }`
      }
      case 'template-literal': {
        const spans = node.spans.map(span => `\${${this.renderType(span.type, references)}}${escapeTemplate(span.text)}`).join('')
        return `\`${escapeTemplate(node.head)}${spans}\``
      }
      case 'type-query': {
        const argumentsText = node.arguments.length === 0
          ? ''
          : `<${node.arguments.map(argument => this.renderType(argument, references)).join(', ')}>`
        return `typeof ${node.expression}${argumentsText}`
      }
      case 'import-type': {
        const attributes = node.attributes === undefined ? '' : `, ${node.attributes}`
        const imported = `import(${quote(node.module)}${attributes})${node.qualifier === undefined ? '' : `.${node.qualifier}`}`
        const argumentsText = node.arguments.length === 0
          ? ''
          : `<${node.arguments.map(argument => this.renderType(argument, references)).join(', ')}>`
        return `${node.typeof ? 'typeof ' : ''}${imported}${argumentsText}`
      }
      case 'predicate': {
        const assertion = node.asserts ? 'asserts ' : ''
        return node.type === undefined
          ? `${assertion}${node.parameter}`
          : `${assertion}${node.parameter} is ${this.renderType(node.type, references)}`
      }
      case 'this': return 'this'
      default: return assertNever(node)
    }
  }

  /**
   * Render a callable signature without a member name.
   * @param signature - modeled signature.
   * @param references - optional generated names for declaration references.
   * @returns parameter list and return type.
   */
  // 中文：渲染一个"无名"的可调用签名（如方法、函数类型），输出 `参数列表: 返回类型` 形态。
  renderSignature(signature: SignatureModel, references?: ReadonlyMap<SymbolId, string>): string {
    return `${this.renderSignatureHead(signature, references)}: ${this.renderType(signature.returns, references)}`
  }

  /**
   * Render one class/interface member as a body-free declaration.
   * @param member - modeled member.
   * @param sourceModifiers - retain source-only modifiers for reflection text.
   * @param references - optional generated names for declaration references.
   * @returns one-line TypeScript member text.
   */
  // 中文：把类 / 接口成员渲染成"无函数体"的单行声明。sourceModifiers 为 true 时直接返回
  // 保留的源码文本（反射文本需要保留源码专属修饰符，如 private / protected）。
  renderMember(member: MemberModel, sourceModifiers = false, references?: ReadonlyMap<SymbolId, string>): string {
    if (sourceModifiers) return member.text
    const name = renderPropertyName(member.name)
    const optional = member.optional ? '?' : ''
    const readonly = member.readonly ? 'readonly ' : ''
    const abstract = member.abstract ? 'abstract ' : ''
    switch (member.kind) {
      case 'property': return `${abstract}${readonly}${name}${optional}: ${this.renderType(member.type, references)}`
      case 'method': return `${abstract}${name}${optional}${this.renderSignature(member.signature, references)}`
      case 'getter': return `${abstract}get ${name}()${this.renderReturn(member.signature, references)}`
      case 'setter': return `${abstract}set ${name}${this.renderSignatureHead(member.signature, references)}`
      case 'call': return this.renderSignature(member.signature, references)
      case 'construct': return `new ${this.renderSignature(member.signature, references)}`
      case 'index': {
        const parameters = member.signature.parameters.map(parameter => this.renderParameter(parameter, references)).join(', ')
        return `${readonly}[${parameters}]: ${this.renderType(member.signature.returns, references)}`
      }
      default: return assertNever(member)
    }
  }

  /**
   * Render a named declaration without JSDoc.
   * @param id - declaration symbol id.
   * @returns exported TypeScript declaration text.
   */
  // 中文：把一个命名声明渲染成多行"导出声明文本"（不含 JSDoc）：枚举、类型别名、
  // 接口 / 类分别拼装；类声明会带上 abstract 前缀与 extends / implements 继承列表。
  renderDeclaration(id: SymbolId): string {
    const declaration = this.declaration(id)
    const parameters = this.renderTypeParameters(declaration.typeParameters)
    if (declaration.kind === 'enum') {
      const members = declaration.enumMembers?.map(member =>
        `    ${renderPropertyName(member.name)}${member.initializer === undefined ? '' : ` = ${member.initializer}`},`) ?? []
      return [`export enum ${declaration.name} {`, ...members, '}'].join('\n')
    }
    if (declaration.kind === 'alias') {
      // 中文：别名必须有右侧类型节点，缺失即内部不一致，抛错而不是输出残缺文本。
      if (declaration.type === undefined) throw new TypeGraphRenderError(`alias ${id} has no type node`)
      return `export type ${declaration.name}${parameters} = ${this.renderType(declaration.type)};`
    }
    const extendsTypes = declaration.extends.map(type => this.renderType(type))
    const implementsTypes = declaration.implements.map(type => this.renderType(type))
    const heritage = [
      extendsTypes.length === 0 ? '' : ` extends ${extendsTypes.join(', ')}`,
      implementsTypes.length === 0 ? '' : ` implements ${implementsTypes.join(', ')}`,
    ].join('')
    const prefix = declaration.kind === 'class' && declaration.abstract ? 'abstract ' : ''
    const members = declaration.members.map(member => `    ${this.renderMember(member)};`)
    return [`export ${prefix}${declaration.kind} ${declaration.name}${parameters}${heritage} {`, ...members, '}'].join('\n')
  }

  /**
   * Find the transitive declaration closure referenced by members.
   * @param memberIds - business-API member ids.
   * @returns declarations in graph order, excluding no roots implicitly.
   */
  // 中文：从一组业务 API 成员出发，找出它们（传递闭包地）引用到的全部声明，
  // 按图中声明的原始顺序返回。
  declarationClosureForMembers(memberIds: readonly string[]): TypeDeclarationModel[] {
    return this.declarationClosure(memberIds, [])
  }

  /**
   * Find the transitive declaration closure referenced by type roots.
   * @param typeIds - graph type roots.
   * @returns declarations in graph order.
   */
  // 中文：从一组类型根节点出发，找出传递引用到的全部声明，按图中声明的原始顺序返回。
  declarationClosureForTypes(typeIds: readonly TypeNodeId[]): TypeDeclarationModel[] {
    return this.declarationClosure([], typeIds)
  }

  // 中文：声明闭包遍历核心：从成员与类型根双向出发做图搜索（带 found / visiting 两个集合
  // 防重复、防环），收集被传递引用的声明 id，最后按图顺序筛出这些声明。
  private declarationClosure(
    memberIds: readonly string[],
    typeIds: readonly TypeNodeId[],
  ): TypeDeclarationModel[] {
    const found = new Set<SymbolId>()
    const visiting = new Set<SymbolId>()
    // 中文：深度优先遍历一个类型节点：发现 declaration 引用就进入声明；再遍历子节点、
    // 函数签名与对象成员。
    const visitNode = (id: TypeNodeId): void => {
      const node = this.node(id)
      if (node.kind === 'reference' && node.target.kind === 'declaration') visitDeclaration(node.target.symbol)
      if (node.kind === 'import-type' && node.target?.kind === 'declaration') visitDeclaration(node.target.symbol)
      for (const child of childTypeNodeIds(node)) visitNode(child)
      for (const signature of nodeSignatures(node)) visitSignature(signature)
      if (node.kind === 'object') for (const member of node.members) visitMember(member)
    }
    // 中文：遍历签名的泛型约束 / 默认值、参数类型与返回类型。
    const visitSignature = (signature: SignatureModel): void => {
      for (const parameter of signature.typeParameters) {
        if (parameter.constraint !== undefined) visitNode(parameter.constraint)
        if (parameter.default !== undefined) visitNode(parameter.default)
      }
      for (const parameter of signature.parameters) visitNode(parameter.type)
      visitNode(signature.returns)
    }
    // 中文：按成员形态分流：属性看类型，其余看签名。
    const visitMember = (member: MemberModel): void => {
      if (member.kind === 'property') visitNode(member.type)
      else visitSignature(member.signature)
    }
    // 中文：遍历一个声明：先标记 visiting 防环，再遍历泛型参数、继承列表、别名右侧
    // 类型与全部成员，最后移出 visiting 并记入 found。
    const visitDeclaration = (id: SymbolId): void => {
      if (found.has(id) || visiting.has(id)) return
      visiting.add(id)
      const declaration = this.declaration(id)
      for (const parameter of declaration.typeParameters) {
        if (parameter.constraint !== undefined) visitNode(parameter.constraint)
        if (parameter.default !== undefined) visitNode(parameter.default)
      }
      for (const type of [...declaration.extends, ...declaration.implements]) visitNode(type)
      if (declaration.type !== undefined) visitNode(declaration.type)
      for (const member of declaration.members) visitMember(member)
      visiting.delete(id)
      found.add(id)
    }
    for (const id of memberIds) visitMember(this.member(id))
    for (const id of typeIds) visitNode(id)
    return this.graph.declarations.filter(declaration => found.has(declaration.id))
  }

  // 中文：渲染签名"头"：泛型参数 + 括号包裹的参数列表（不含返回类型与冒号）。
  private renderSignatureHead(signature: SignatureModel, references?: ReadonlyMap<SymbolId, string>): string {
    return `${this.renderTypeParameters(signature.typeParameters, references)}(${signature.parameters.map(parameter => this.renderParameter(parameter, references)).join(', ')})`
  }

  // 中文：渲染 getter 的返回类型片段（`: 返回类型`）。
  private renderReturn(signature: SignatureModel, references?: ReadonlyMap<SymbolId, string>): string {
    return `: ${this.renderType(signature.returns, references)}`
  }

  // 中文：渲染一个参数：`...名字?: 类型 = 默认值` 形态；有默认值时可选标记 ? 不输出
  // （有默认值本身就是可选），rest 参数输出 ... 前缀。
  private renderParameter(parameter: ParameterModel, references?: ReadonlyMap<SymbolId, string>): string {
    const name = parameter.binding === 'identifier' ? renderPropertyName(parameter.name) : parameter.name
    const optional = parameter.initializer === undefined && parameter.optional && !parameter.rest ? '?' : ''
    const initializer = parameter.initializer === undefined ? '' : ` = ${parameter.initializer}`
    return `${parameter.rest ? '...' : ''}${name}${optional}: ${this.renderType(parameter.type, references)}${initializer}`
  }

  // 中文：渲染泛型参数列表（为空时返回空串，避免输出多余的尖括号）。
  private renderTypeParameters(parameters: readonly TypeParameterModel[], references?: ReadonlyMap<SymbolId, string>): string {
    return parameters.length === 0
      ? ''
      : `<${parameters.map(parameter => this.renderTypeParameter(parameter, true, references)).join(', ')}>`
  }

  // 中文：渲染单个泛型参数：`const 方差 名字 extends 约束 = 默认值`；includeDefault
  // 控制是否输出默认值（infer 位置不允许有默认值，故传 false）。
  private renderTypeParameter(
    parameter: TypeParameterModel,
    includeDefault: boolean,
    references?: ReadonlyMap<SymbolId, string>,
  ): string {
    const variance = parameter.variance === undefined ? '' : `${parameter.variance === 'in-out' ? 'in out' : parameter.variance} `
    const constModifier = parameter.const ? 'const ' : ''
    const constraint = parameter.constraint === undefined ? '' : ` extends ${this.renderType(parameter.constraint, references)}`
    const fallback = !includeDefault || parameter.default === undefined ? '' : ` = ${this.renderType(parameter.default, references)}`
    return `${constModifier}${variance}${parameter.name}${constraint}${fallback}`
  }

  // 中文：渲染对象字面量类型：空成员输出 {}，否则成员以分号分隔、紧凑排进一对花括号。
  private renderObject(members: readonly MemberModel[], references?: ReadonlyMap<SymbolId, string>): string {
    if (members.length === 0) return '{}'
    return `{ ${members.map(member => `${this.renderMember(member, false, references)};`).join(' ')} }`
  }

  // 中文：把一批泛型参数登记进 parameterNames（id → 名字），供引用解析时查名。
  private indexParameters(parameters: readonly TypeParameterModel[]): void {
    for (const parameter of parameters) this.parameterNames.set(parameter.id, parameter.name)
  }
}

// 中文：取函数 / 构造类型节点上的签名（其余节点没有签名，返回空数组）。
function nodeSignatures(node: TypeNodeModel): SignatureModel[] {
  return node.kind === 'function' || node.kind === 'constructor' ? [node.signature] : []
}

// 中文：判断元素类型是否需要加数组括号：联合 / 交叉 / 函数 / 构造 / 条件类型
// 优先级低于 []，不加括号会改变语义。
function needsArrayParentheses(node: TypeNodeModel): boolean {
  return node.kind === 'union' || node.kind === 'intersection' || node.kind === 'function' || node.kind === 'constructor' || node.kind === 'conditional'
}

// 中文：把成员名渲染成可用的属性名：计算键（[...]）与合法标识符 / 数字原样保留，
// 其余一律加单引号（如含空格或连字符的 JSON 键）。
function renderPropertyName(name: string): string {
  if (name.startsWith('[') && name.endsWith(']')) return name
  if (/^(?:[$A-Z_a-z][$\w]*|\d+)$/u.test(name)) return name
  return quote(name)
}

// 中文：把字符串转成单引号字面量：转义反斜杠、单引号与换行。
function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`
}

// 中文：转义模板字面量文本：反斜杠、反引号与 ${ 插值起始符都要转义，避免语义漂移。
function escapeTemplate(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
}

// 中文：穷尽检查兜底：判别联合出现未处理变体时立即抛错（复用渲染错误类型）。
function assertNever(value: never): never {
  throw new TypeGraphRenderError(`unsupported model variant ${JSON.stringify(value)}`)
}
