/*
 * ================================ 文件注释 ================================
 * 【文件职责】在"编译器无关的 typert 模型"之上做 Cordis 目录（catalog）专属投影：
 *             校验并抽取服务 / 事件的 JSDoc 契约，渲染模型面 API 目录与文档页区域。
 *             调用方提供仓库专属的类型分类（policy）与继承数据。
 * 【技术维度】复用 WorkspaceAnalyzer / WorkspaceCaches 做分析，TypeGraphRenderer 渲染
 *             签名；自带 JSDoc 解析器（parseJsDoc）、契约校验（checkParams /
 *             checkReturns / checkTypeLinks）与多段文本渲染器（renderRuntimeApi /
 *             renderPageRegion / renderInheritedPage）。
 * 【产品维度】这是文档与模型之间的"单一事实来源"：docs/cordis-catalog 页面与模型面的
 *             cordis_inspect 数据都由同一 AST 遍历产出，保证文档与数据不会分叉；
 *             生成内容以标记区间（REGION_BEGIN / REGION_END）嵌入页面。
 * 【逻辑维度】按代码顺序：① 类型链接校验（checkTypeLinks / reportTypeLinkViolations）；
 *             ② 条目类型（EventEntry / ServiceEntry / InheritedEntry）与策略 / 模型接口；
 *             ③ CordisCatalogProjector（project → collectEvents / renderableServices /
 *             collectServices / runtimeTypes）；④ 顶层入口（projectCordisCatalog /
 *             collectEvents / collectServices）；⑤ JSDoc 解析与契约校验工具；
 *             ⑥ 渲染工具（referencedTypes / renderRuntimeApi / typeLinks /
 *             renderEvent / renderService / renderPageRegion / renderInheritedPage）。
 * 【关键边界】校验是"失败即抛"（fail-closed）：缺 @mode、缺 @param、空描述、未分类
 *             类型链接等都会抛错；@deprecated 条目被跳过；waterfall 事件必须有 next 参数。
 * 【新手阅读建议】先读 collectEvents 看事件的完整校验流程，再看 parseJsDoc 理解 JSDoc
 *             解析，最后看 renderPageRegion 理解生成内容如何嵌进文档页。
 * ==========================================================================
 */

/**
 * Cordis catalog-specific projection over the compiler-independent Typert
 * model. This module owns Cordis validation and text projection mechanics;
 * callers supply repository-specific type classifications and inherited data.
 * @module @deepseek-ai/dsh-typert-generator
 */
// 中文导读：本文件是"文档生成 + 模型数据"双通道的公共骨架：同一份模型既渲染成
// 文档页区域，又生成模型可读的 API 目录，两者永不偏离。

import { WorkspaceAnalyzer, WorkspaceCaches } from './analyzer.ts'
import { childTypeNodeIds } from './model.ts'
import { TypeGraphRenderer } from './renderer.ts'
import type {
  FaceModel,
  MemberModel,
  ParameterModel,
  ServiceModel,
  SignatureModel,
  SourceDeclarationModel,
  SourceLocation,
  TypertFace,
  TypeNodeId,
} from './model.ts'

// 中文：事件派发模式（来自 JSDoc 的 @mode 标签）：emit = 通知式；bail = 首个拒绝即停；
// waterfall = 串行传递并允许 next() 委托；parallel / serial = 并行 / 串行执行监听器。
type Mode = 'emit' | 'bail' | 'waterfall' | 'parallel' | 'serial'

/** The fenced-block info string for generated signature blocks (skipped by
 * doc-typecheck, since a bare signature fragment is not standalone-compilable). */
// 中文：生成签名代码块用的 fence 语言标识。签名是"孤立片段"、不能独立编译，
// 因此 doc-typecheck 会跳过这种 fence，避免把残缺签名当完整代码检查。
const FENCE = 'ts cordis-catalog'

/** Append fail-closed signature type-link violations from the retained type tree. */
// 中文：逐个检查签名里出现的类型名是否已分类：未在 linkedTypePages、foundationTypeNames
// 或 typeLinkExemptions 里的名字都会被记为违规（fail-closed——文档缺链接宁可报错）。
function checkTypeLinks(
  where: string,
  names: readonly string[],
  policy: CordisCatalogPolicy,
  violations: string[],
): void {
  for (const name of names) {
    if (Object.hasOwn(policy.linkedTypePages, name)
      || policy.foundationTypeNames.has(name)
      || Object.hasOwn(policy.typeLinkExemptions, name)) continue
    violations.push(
      `${where} references unclassified type '${name}'. Add it to linkedTypePages with its documentation page, `
      + 'to foundationTypeNames if TypeScript or the framework owns it, or to typeLinkExemptions with '
      + 'the non-catalog documentation owner.',
    )
  }
}

/** Throw one aggregated diagnostic for every unclassified signature type. */
// 中文：把全部类型链接违规合并成一条错误抛出（有违规就失败，绝不静默放行）。
function reportTypeLinkViolations(gate: string, violations: string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `${gate}: ${violations.length} signature type-link coverage violation(s):\n`
    + violations.map(violation => `  ${violation}`).join('\n'),
  )
}

/** One harness event, extracted from an `interface Events` block. */
// 中文：一条 harness 事件（从 `interface Events` 块提取）：含作用域名、签名文本、
// JSDoc、派发模式、描述与源指针，是文档页与模型 API 目录共用的中间表示。
export interface EventEntry {
  /** Scoped name, e.g. `agent/request`. */
  // 中文：带作用域的事件名，如 `agent/request`。
  name: string
  /** The scope prefix, e.g. `agent` (everything before the first `/`). */
  // 中文：作用域前缀，如 `agent`（第一个 `/` 之前的部分）。
  scope: string
  /** Full signature text (the method-signature member, JSDoc stripped). */
  // 中文：完整签名文本（方法签名成员，已剥离 JSDoc）。
  signature: string
  /** Original declaration JSDoc, dedented from its containing interface. */
  // 中文：原始声明 JSDoc（已相对所在接口做去缩进）。
  jsDoc: string
  /** Dispatch mode from the `@mode` tag. */
  // 中文：来自 @mode 标签的派发模式。
  mode: Mode
  /** Description prose (JSDoc minus the `@mode` tag), one line per paragraph. */
  // 中文：描述正文（JSDoc 去掉 @mode 标签），每段一行。
  doc: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  // 中文：声明位置的源指针 `packages/…/file.ts:line`。
  source: string
}

/** One public service method and the source contract attached to it. */
// 中文：一个公开服务方法及其源码契约：签名（剥掉函数体）与原始 JSDoc；
// 策略（policy）补充的方法可以省略 kind。
export interface ServiceMethodEntry {
  /** Compiler member category; policy-supplied methods may omit it. */
  // 中文：编译器成员类别（method / property）；策略补充的方法可以省略。
  kind?: 'method' | 'property'
  /** Public method signature (body stripped). */
  // 中文：公开方法签名（已剥离函数体）。
  signature: string
  /** Original method JSDoc, dedented from its containing class. */
  // 中文：原始方法 JSDoc（已相对所在类去缩进）。
  jsDoc: string
}

/** One harness service, extracted from an `interface Context` block. */
// 中文：一条 harness 服务（从 `interface Context` 块提取）：ctx 键、服务类型名、
// 是否抽象（接缝接口）、类级描述、公开方法与源指针。
export interface ServiceEntry {
  /** The `ctx.<key>` name, e.g. `llm`. */
  // 中文：`ctx.<key>` 名字，如 `llm`。
  key: string
  /** The service class/interface name, e.g. `LlmRuntime`. */
  // 中文：服务类 / 接口名，如 `LlmRuntime`。
  type: string
  /** Whether the service class is abstract (a seam interface). */
  // 中文：服务类是否抽象（作为接缝接口）。
  abstract: boolean
  /** Class-level JSDoc prose, one line per paragraph. */
  // 中文：类级 JSDoc 正文，每段一行。
  doc: string
  /** Public methods (bodies stripped), in source order. */
  // 中文：公开方法（已剥离函数体），按源码顺序。
  methods: ServiceMethodEntry[]
  /** Source pointer of the class declaration. */
  // 中文：类声明的源指针。
  source: string
}

/** A terse inherited-tier entry supplied by the catalog policy. */
// 中文：由目录策略提供的"继承层"精简条目：显示名、一句话摘要与源指针。
export interface InheritedEntry {
  /** Display name of the inherited event or context member group. */
  // 中文：继承的事件或上下文成员组的显示名。
  name: string
  /** One-line description rendered into the catalog. */
  // 中文：渲染进目录的一行描述。
  summary: string
  /** Source pointer such as `vendor/…:line`. */
  // 中文：源指针，如 `vendor/…:line`。
  source: string
}

/** Repository policy consumed by the Cordis catalog parsing and rendering logic. */
// 中文：Cordis 目录解析与渲染逻辑消费的"仓库策略"：由调用方（脚本）提供仓库专属的
// 类型分类、继承数据与运行时目录的增删配置。
export interface CordisCatalogPolicy {
  /** Type names linked from signatures to their documentation pages. */
  // 中文：签名里出现的、要链接到各自文档页的类型名表。
  readonly linkedTypePages: Readonly<Record<string, string>>
  /** TypeScript or framework types that need no repository documentation link. */
  // 中文：由 TypeScript 或框架拥有的类型（无需仓库文档链接）。
  readonly foundationTypeNames: ReadonlySet<string>
  /** Repository types deliberately documented outside the linked data catalog. */
  // 中文：故意在链接数据目录之外记录的仓库类型。
  readonly typeLinkExemptions: Readonly<Record<string, string>>
  /** Framework Services included in the model-facing runtime catalog but not the harness documentation partition. */
  // 中文：只进"模型面运行时目录"、不进 harness 文档分区的框架服务。
  readonly runtimeServices?: readonly ServiceEntry[]
  /** Harness Services omitted from the model-facing runtime catalog because dynamic Plugins must not call them. */
  // 中文：从模型面运行时目录排除的 harness 服务（动态插件不允许调用它们）。
  readonly runtimeServiceExclusions?: ReadonlySet<string>
  /** Manually curated framework events inherited by every plugin. */
  // 中文：手工整理的、每个插件都会继承的框架事件。
  readonly inheritedEvents: readonly InheritedEntry[]
  /** Manually curated framework context members inherited by every plugin. */
  // 中文：手工整理的、每个插件都会继承的框架上下文成员。
  readonly inheritedServices: readonly InheritedEntry[]
}

/** Complete model-level Cordis projection used by every text renderer. */
// 中文：完整的模型级 Cordis 投影结果：全部已验证的事件与服务条目，供所有文本渲染器消费。
export interface CordisCatalogModel {
  readonly events: readonly EventEntry[]
  readonly services: readonly ServiceEntry[]
}

/** Repository-specific Cordis validation and projection over one Typert face. */
// 中文：在某一个 typert 编译面（host / client）上做"仓库专属"Cordis 校验与投影的投影器：
// 负责把模型里的服务 / 事件抽取成条目，并在抽取过程中强制 JSDoc 契约完整。
export class CordisCatalogProjector {
  // 中文：类型图渲染器：把签名与声明渲染成文本。
  private readonly renderer: TypeGraphRenderer

  /**
   * @param face - analyzed Host or Client face containing package business semantics.
   * @param sourceDeclarations - exported declarations available to the runtime type closure.
   * @param policy - caller-owned type classifications and inherited Cordis data.
   */
  // 中文：绑定编译面、源码声明（供运行时类型闭包使用）与仓库策略。
  constructor(
    private readonly face: FaceModel,
    private readonly sourceDeclarations: readonly SourceDeclarationModel[],
    private readonly policy: CordisCatalogPolicy,
  ) {
    this.renderer = new TypeGraphRenderer(face.graph)
  }

  /**
   * Validate and project the host model's Cordis API.
   * @returns every validated service and event projected from the host model.
   */
  // 中文：校验并投影当前面的 Cordis API：先收集事件（严格校验），再收集服务（严格校验），
  // 任何违规都会抛错，返回的全是"通过校验"的条目。
  project(): CordisCatalogModel {
    return {
      events: this.collectEvents(),
      services: this.collectServices(),
    }
  }

  /**
   * Render the model-facing static API consumed by `tool-cordis`.
   * @param model - validated Cordis catalog projection from this projector.
   * @returns the model-facing TypeScript catalog source.
   */
  // 中文：渲染"模型面"静态 API 目录源码（tool-cordis 消费）：合并策略补充的运行时服务、
  // 剔除策略排除的服务，按 key 排序后交给 renderRuntimeApi 生成 TypeScript 文本。
  renderRuntimeApi(model: CordisCatalogModel): string {
    const services = [...model.services, ...(this.policy.runtimeServices ?? [])]
      .filter(service => !this.policy.runtimeServiceExclusions?.has(service.key))
      .sort((left, right) => left.key.localeCompare(right.key))
    return renderRuntimeApi(
      services,
      model.events,
      this.runtimeTypes(services, model.events),
      this.policy.inheritedServices,
    )
  }

  // 中文：收集并校验全部事件条目。校验规则：签名必须是函数类型；host 面还要检查签名
  // 类型链接；必须有合法 @mode 且与签名结构自洽（waterfall 必须有 next 参数、有 next
  // 的非 waterfall 必须改标签）；必须有描述正文；参数必须有 @param。@deprecated 跳过。
  private collectEvents(): EventEntry[] {
    const entries: EventEntry[] = []
    const violations: string[] = []
    const typeLinkViolations: string[] = []
    for (const packageModel of this.face.packages) {
      for (const event of packageModel.events) {
        const parsed = parseJsDoc(event.jsDoc ?? '')
        if (parsed.deprecated) continue
        const source = pointer(event.location)
        const where = `event '${event.name}' (${source})`
        const node = this.renderer.node(event.signature)
        // 中文：事件必须能用可调用类型表示（函数签名）。
        if (node.kind !== 'function') {
          violations.push(`${where} is not represented by a callable type.`)
          continue
        }
        if (this.face.face === 'host') {
          checkTypeLinks(where, signatureTypeNames(this.renderer, node.signature), this.policy, typeLinkViolations)
        }
        const mode = event.mode
        // 中文：@mode 标签必须存在且取值合法。
        if (!isMode(mode)) {
          violations.push(`${where} is missing an @mode tag. Add '@mode emit|bail|waterfall|parallel|serial' to its JSDoc (see AGENTS.md).`)
        }
        const last = node.signature.parameters.at(-1)
        const hasNext = last?.name === 'next'
        // 中文：签名带尾参 next 说明结构上是 waterfall，标签必须一致，否则两处都不放过。
        if (isMode(mode) && hasNext && mode !== 'waterfall') {
          violations.push(`${where} has a trailing 'next' parameter (structurally a waterfall) but is tagged '@mode ${mode}'. Fix the tag or the signature.`)
        }
        if (isMode(mode) && !hasNext && mode === 'waterfall') {
          violations.push(`${where} is tagged '@mode waterfall' but has no trailing 'next' parameter. A waterfall delegates via next().`)
        }
        // 中文：事件必须有描述正文（说明发生了什么 / 监听者可做什么）。
        if (parsed.doc === '') {
          violations.push(`${where} has no description prose. Say what happened / what a listener may do, above the block tags.`)
        }
        checkParams(
          where,
          'event',
          node.signature.parameters,
          parsed.params,
          parameter => parameter.receiver || (hasNext && parameter === last),
          violations,
        )
        if (isMode(mode)) {
          entries.push({
            name: event.name,
            scope: event.name.split('/')[0] ?? event.name,
            signature: event.text,
            jsDoc: event.jsDoc ?? '',
            mode,
            doc: parsed.doc,
            source,
          })
        }
      }
    }
    reportViolations('gen-cordis-catalog', violations)
    reportTypeLinkViolations('gen-cordis-catalog', typeLinkViolations)
    return entries
  }

  /**
   * The services this projection describes, one per `ctx.<key>`: those whose
   * Context merge sits one level under a package's `src` and whose declaration
   * belongs to that same package.
   *
   * Interfaces qualify beside classes, because an interface-typed key
   * (`lsp: LspService`) has its Service Definition — and, by repository
   * convention, its member documentation — on the interface; requiring a class
   * would drop a real injectable service from every catalog. The declaration may
   * live in any file of the package (`types.ts` is the usual home), while a
   * declaration from ANOTHER package is not this package's surface to document.
   *
   * One key can have both kinds of candidate across packages: `ctx.typert` is
   * typed by a merge-extensible interface in `type-meta` and implemented by a
   * class in `registry`. The CLASS wins — it carries the documentation and is the
   * object a caller meets — and picking before validating is what keeps a
   * discarded candidate's missing JSDoc from failing the gate.
   */
  // 中文：选出"本投影要描述"的服务，每个 ctx.<key> 一个：要求声明（类或接口皆可，因为
  // 接口类型键的 Service Definition 与成员文档都在接口上）与所在包一致，且位于包 src 的
  // 一级目录（host）或 src/client 下（client）。同一 key 有多个候选（如类型元接口 + registry
  // 实现类）时，类优先——它携带文档且是调用方实际面对的对象；先选再校验保证被淘汰候选
  // 的缺 JSDoc 不会让门禁误报。
  private renderableServices(): ServiceModel[] {
    const chosen = new Map<string, ServiceModel>()
    for (const packageModel of this.face.packages) {
      for (const service of packageModel.services) {
        const declaration = this.renderer.declaration(service.symbol)
        const owner = /^packages\/[^/]+\/[^/]+\/src\//.exec(service.location.file)?.[0]
        if ((declaration.kind !== 'class' && declaration.kind !== 'interface')
          || owner === undefined
          || (this.face.face === 'host'
            ? !/^packages\/[^/]+\/[^/]+\/src\/[^/]+\.ts$/.test(service.location.file)
            : !/^packages\/[^/]+\/[^/]+\/src\/client\/.+\.tsx?$/.test(service.location.file))
          || !declaration.location.file.startsWith(owner)) continue
        const current = chosen.get(service.key)
        // 中文：已有候选且是类时保持现状（类优先，接口候选不覆盖类候选）。
        if (current !== undefined && this.renderer.declaration(current.symbol).kind === 'class') continue
        chosen.set(service.key, service)
      }
    }
    return [...chosen.values()]
  }

  // 中文：收集并校验全部服务条目：类级必须有 JSDoc 描述；方法跳过计算键成员（[...]）与
  // @deprecated；属性成员只有带 JSDoc 才收录；方法必须有 JSDoc、描述正文、@param（接收者
  // 参数豁免）、非 void 返回的 @returns；host 面还检查类型链接。结果按 key 排序。
  private collectServices(): ServiceEntry[] {
    const entries: ServiceEntry[] = []
    const violations: string[] = []
    const typeLinkViolations: string[] = []
    for (const service of this.renderableServices()) {
      const declaration = this.renderer.declaration(service.symbol)
      const parsedDeclaration = parseJsDoc(declaration.jsDoc ?? '')
      if (parsedDeclaration.deprecated) continue
      const doc = parsedDeclaration.doc
      const source = pointer(declaration.location)
      if (doc === '') {
        violations.push(`service ctx.${service.key} (${source}): ${declaration.kind} ${declaration.name} has no JSDoc.`)
      }
      const methods: ServiceMethodEntry[] = []
      for (const memberId of service.members) {
        const member = this.renderer.member(memberId)
        if (member.name.startsWith('[')) continue
        const parsed = parseJsDoc(member.jsDoc ?? '')
        if (parsed.deprecated) continue
        // 中文：属性成员只在带 JSDoc 时才作为属性条目收录（无文档的属性不构成 API 契约）。
        if (member.kind === 'property') {
          if (member.jsDoc === undefined) continue
          methods.push({ kind: 'property', signature: member.text, jsDoc: member.jsDoc })
          continue
        }
        if (member.kind !== 'method') continue
        const where = `service method ctx.${service.key}.${member.name} (${pointer(member.location)})`
        if (this.face.face === 'host') {
          checkTypeLinks(where, signatureTypeNames(this.renderer, member.signature), this.policy, typeLinkViolations)
        }
        methods.push({ kind: 'method', signature: member.text, jsDoc: member.jsDoc ?? '' })
        if (member.jsDoc === undefined) {
          violations.push(`${where} has no JSDoc.`)
          continue
        }
        if (parsed.doc === '') violations.push(`${where} has no description prose above its block tags.`)
        checkParams(where, 'service', member.signature.parameters, parsed.params,
          parameter => parameter.receiver, violations)
        checkReturns(where, member.signature, parsed.returns, this.renderer, violations)
      }
      entries.push({
        key: service.key,
        type: declaration.name,
        abstract: declaration.abstract,
        doc,
        methods,
        source,
      })
    }
    reportViolations('gen-cordis-catalog', violations)
    reportTypeLinkViolations('gen-cordis-catalog', typeLinkViolations)
    return entries.sort((left, right) => left.key.localeCompare(right.key))
  }

  // 中文：计算模型面 API 目录要附带的"引用类型闭包"：收集当前面、非枚举、位于包 src 的
  // 顶层声明（同名歧义则剔除），超长声明截断成桩文本，最后用种子文本（服务方法签名 +
  // 事件签名）做词边界匹配，找出被传递引用的类型。
  private runtimeTypes(
    services: readonly ServiceEntry[],
    events: readonly EventEntry[],
  ): { name: string; declaration: string }[] {
    const declarations = new Map<string, string>()
    const ambiguous = new Set<string>()
    for (const declaration of this.sourceDeclarations) {
      if (declaration.face !== this.face.face || declaration.kind === 'enum'
        || !/^packages\/[^/]+\/[^/]+\/src\/.+\.tsx?$/.test(declaration.location.file)) continue
      // 中文：同名声明出现第二个即标记歧义（无法确定引用的是哪个）。
      if (declarations.has(declaration.name)) {
        ambiguous.add(declaration.name)
        continue
      }
      declarations.set(
        declaration.name,
        declaration.text.length > MAX_DECL_CHARS
          ? `${declaration.text.slice(0, MAX_DECL_CHARS)} /* …truncated — full shape in source */`
          : declaration.text,
      )
    }
    for (const name of ambiguous) declarations.delete(name)
    return referencedTypes([
      ...services.flatMap(service => service.methods.map(method => method.signature)),
      ...events.map(event => event.signature),
    ], declarations)
  }
}

/**
 * Analyze the host project once and return both the model and its projection.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned type classifications and inherited Cordis data.
 * @param targetFace - Host or Client Typert face to project.
 * @returns the configured projector and its validated catalog model.
 */
// 中文：一次性地分析项目并返回"投影器 + 校验过的目录模型"。流程：先发现目标面上的包，
// 再分析这些包（复用同一组 caches 避免重复编译），找到目标 face，索引源码声明，
// 最后构造投影器并立即投影。
export function projectCordisCatalog(scanRoot: string, policy: CordisCatalogPolicy, targetFace: TypertFace = 'host'): {
  readonly projector: CordisCatalogProjector
  readonly model: CordisCatalogModel
} {
  // 中文：共享缓存：三次 WorkspaceAnalyzer 构造复用同一编译缓存，避免重复做类型检查。
  const caches = new WorkspaceCaches()
  const discovery = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    checkDiagnostics: false,
    caches,
  }).discoverPackages()
  // 中文：只保留在目标面上有贡献的包。
  const packages = discovery.filter(candidate => candidate.faces.includes(targetFace))
    .map(candidate => candidate.package)
  const workspace = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    packages,
    checkDiagnostics: false,
    caches,
  }).analyzeInBatches()
  const face = workspace.faces.find(candidate => candidate.face === targetFace)
  // 中文：目标面不存在说明分析产出异常（fail-closed）。
  if (face === undefined) throw new Error(`gen-cordis-catalog: Typert produced no ${targetFace} face`)
  const sourceDeclarations = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    checkDiagnostics: false,
    caches,
  }).indexSourceDeclarations()
  const projector = new CordisCatalogProjector(face, sourceDeclarations, policy)
  return { projector, model: projector.project() }
}

/**
 * Collect all modeled events for relationship-document consumers.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned Cordis catalog policy.
 * @returns all validated event entries.
 */
// 中文：为"关系文档"类消费方收集全部已校验的事件条目（返回副本，防止外部改动内部数组）。
export function collectEvents(scanRoot: string, policy: CordisCatalogPolicy): EventEntry[] {
  return [...projectCordisCatalog(scanRoot, policy).model.events]
}

/**
 * Collect all modeled services for relationship-document consumers.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned Cordis catalog policy.
 * @returns all validated service entries.
 */
// 中文：为"关系文档"类消费方收集全部已校验的服务条目（返回副本）。
export function collectServices(scanRoot: string, policy: CordisCatalogPolicy): ServiceEntry[] {
  return [...projectCordisCatalog(scanRoot, policy).model.services]
}

// 中文：内部结构——解析后的 JSDoc：正文段落、@param 表、@returns、@throws 列表与
// @deprecated 标记。
interface ParsedJsDoc {
  readonly doc: string
  readonly params: ReadonlyMap<string, string>
  readonly returns: string | null
  readonly throws: readonly string[]
  readonly deprecated: boolean
}

// 中文：把原始 JSDoc 文本解析成 ParsedJsDoc：正文按空行 / 列表分段，@param / @returns /
// @throws 支持多行续写（sink 机制），标签行之后不再收集正文，@deprecated 置标记。
function parseJsDoc(raw: string): ParsedJsDoc {
  const lines = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let item: string[] = []
  let inTags = false
  // 中文：join 把段落的多行合并成一句（连续空白压成单个空格）。
  const join = (parts: readonly string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim()
  const flushItem = (): void => {
    if (item.length > 0) list.push(join(item))
    item = []
  }
  const flushList = (): void => {
    flushItem()
    if (list.length > 0) blocks.push(list.join('\n'))
    list = []
  }
  const flushParagraph = (): void => {
    flushList()
    if (paragraph.length > 0) blocks.push(join(paragraph))
    paragraph = []
  }
  for (const line of lines) {
    const tagLine = line.trimStart()
    // 中文：遇到 @ 开头即进入标签区：之前的内容全部收尾，之后的行不再进正文。
    if (tagLine.startsWith('@')) {
      flushParagraph()
      inTags = true
      continue
    }
    if (inTags) continue
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    // 中文：以 "- " 开头的行开始一个列表项；列表项开始前若有未收尾的段落先收尾。
    if (/^-\s+/.test(line)) {
      flushItem()
      if (paragraph.length > 0) {
        blocks.push(join(paragraph))
        paragraph = []
      }
      item.push(line)
      continue
    }
    if (item.length > 0) item.push(line)
    else paragraph.push(line)
  }
  flushParagraph()

  // 中文：第二遍扫描：只处理标签行。@param 支持 [name] 可选标记写法；标签的续行
  // 通过 sink 回调追加到最近一个标签的值里。
  const params = new Map<string, string>()
  let returns: string | null = null
  const throws: string[] = []
  let deprecated = false
  let sink: ((text: string) => void) | undefined
  for (const line of lines) {
    if (/^@deprecated(?:\s|$)/.test(line)) {
      deprecated = true
      sink = undefined
      continue
    }
    const param = /^@param\s+(\[?[\w$]+\]?)\s*(?:[-—–]\s*)?(.*)$/.exec(line)
    if (param !== null) {
      const name = (param[1] ?? '').replace(/^\[|\]$/g, '')
      let value = param[2] ?? ''
      params.set(name, value)
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        params.set(name, value)
      }
      continue
    }
    const returnsTag = /^@returns?(?:\s+[-—–]?\s*(.*))?$/.exec(line)
    if (returnsTag !== null) {
      let value = returnsTag[1] ?? ''
      returns = value
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        returns = value
      }
      continue
    }
    const throwsTag = /^@throws?(?:\s+[-—–]?\s*(.*))?$/.exec(line)
    if (throwsTag !== null) {
      let value = throwsTag[1] ?? ''
      throws.push(value)
      const index = throws.length - 1
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        throws[index] = value
      }
      continue
    }
    if (line.startsWith('@') || line.trim() === '') sink = undefined
    else sink?.(line.trim())
  }
  return {
    // 中文：正文块合并；{@link 目标} 保留目标文本本身作为链接文字。
    doc: blocks.join('\n\n').replace(/\{@link\s+([^}]+)\}/g, '$1').trim(),
    params,
    returns,
    throws,
    deprecated,
  }
}

// 中文：校验参数与 @param 标签的对应关系：每个参数（绑定模式除外、豁免参数除外）都
// 必须有非空 @param；反过来，每个 @param 标签都必须匹配一个标识符参数（防陈旧标签）。
function checkParams(
  where: string,
  apiKind: string,
  parameters: readonly ParameterModel[],
  tags: ReadonlyMap<string, string>,
  isExempt: (parameter: ParameterModel) => boolean,
  violations: string[],
): void {
  for (const parameter of parameters) {
    if (parameter.binding !== 'identifier') {
      violations.push(`${where}: parameter '${parameter.name}' is a binding pattern; the ${apiKind} API needs simple identifier parameters so @param can name them.`)
      continue
    }
    if (isExempt(parameter)) continue
    const description = tags.get(parameter.name)
    if (description === undefined) violations.push(`${where} is missing @param ${parameter.name}.`)
    else if (description.trim() === '') violations.push(`${where}: @param ${parameter.name} has an empty description.`)
  }
  for (const tag of tags.keys()) {
    if (!parameters.some(parameter => parameter.binding === 'identifier' && parameter.name === tag)) {
      violations.push(`${where}: @param ${tag} does not match any parameter (stale tag?).`)
    }
  }
}

// 中文：校验非 void 返回值必须有非空 @returns（void / Promise<void> 豁免）。
function checkReturns(
  where: string,
  signature: SignatureModel,
  returns: string | null,
  renderer: TypeGraphRenderer,
  violations: string[],
): void {
  const type = renderer.renderType(signature.returns)
  if (type === 'void' || type === 'Promise<void>') return
  if (returns === null) violations.push(`${where} is missing @returns (return type: ${type}).`)
  else if (returns.trim() === '') violations.push(`${where}: @returns has an empty description.`)
}

// 中文：把全部 JSDoc 完整性违规合并成一条错误抛出（fail-closed）。
function reportViolations(gate: string, violations: readonly string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `${gate}: ${String(violations.length)} JSDoc completeness violation(s) (see AGENTS.md):\n`
    + violations.map(violation => `  ${violation}`).join('\n'),
  )
}

// 中文：把源位置渲染成 `文件:行号` 指针。
function pointer(location: SourceLocation): string {
  return `${location.file}:${String(location.line)}`
}

// 中文：判断字符串是否为合法的事件派发模式。
function isMode(mode: string | undefined): mode is Mode {
  return mode === 'emit' || mode === 'bail' || mode === 'waterfall' || mode === 'parallel' || mode === 'serial'
}

// 中文：收集签名里出现的全部类型名（去重排序）：遍历签名（含泛型约束 / 默认值 / 参数 /
// 返回类型）及其嵌套的类型节点，reference 的目标不是类型参数时记名字，type-query 记表达式；
// 供 checkTypeLinks 检查文档链接覆盖。
function signatureTypeNames(renderer: TypeGraphRenderer, signature: SignatureModel): string[] {
  const names = new Set<string>()
  const visited = new Set<TypeNodeId>()
  const visitSignature = (current: SignatureModel): void => {
    for (const parameter of current.typeParameters) {
      if (parameter.constraint !== undefined) visit(parameter.constraint)
      if (parameter.default !== undefined) visit(parameter.default)
    }
    for (const parameter of current.parameters) visit(parameter.type)
    visit(current.returns)
  }
  const visitMember = (member: MemberModel): void => {
    if (member.kind === 'property') visit(member.type)
    else visitSignature(member.signature)
  }
  const visit = (id: TypeNodeId): void => {
    if (visited.has(id)) return
    visited.add(id)
    const node = renderer.node(id)
    if (node.kind === 'reference' && node.target.kind !== 'type-parameter') names.add(node.name)
    if (node.kind === 'type-query') names.add(node.expression)
    for (const child of childTypeNodeIds(node)) visit(child)
    if (node.kind === 'object') for (const member of node.members) visitMember(member)
    if (node.kind === 'function' || node.kind === 'constructor') visitSignature(node.signature)
  }
  visitSignature(signature)
  return [...names].sort()
}

/** Declarations longer than this render as a truncated stub. */
// 中文：声明文本超过该长度时渲染成截断桩（防止生成的目录文件被巨型声明撑爆）。
const MAX_DECL_CHARS = 1500

/** Render one value as a single-quoted TypeScript literal. */
// 中文：把字符串渲染成单引号 TypeScript 字面量（转义反斜杠、单引号与换行）。
function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`
}

/** Render a compact TypeScript string-array literal. */
// 中文：把字符串数组渲染成紧凑的 TypeScript 数组字面量。
function quoteList(values: readonly string[]): string {
  return `[${values.map(quote).join(', ')}]`
}

/** Render structured parameter documentation as a compact TypeScript literal. */
// 中文：把参数文档表渲染成 `{ name, description }` 对象数组字面量。
function renderParameters(parameters: ReadonlyMap<string, string>): string {
  const values = [...parameters].map(([name, description]) => (
    `{ name: ${quote(name)}, description: ${quote(description)} }`
  ))
  return `[${values.join(', ')}]`
}

/** Resolve and sort the word-bounded transitive type closure referenced by seed text. */
// 中文：从种子文本出发，用"词边界正则"做传递闭包匹配：先找签名里直接出现的声明，
// 再在已入选声明的文本里继续找被引用的声明，直至不再新增；结果按名字排序。
function referencedTypes(
  seeds: readonly string[],
  declarations: ReadonlyMap<string, string>,
): { name: string; declaration: string }[] {
  const included = new Map<string, string>()
  let frontier = [...seeds]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const [name, declaration] of declarations) {
      if (included.has(name)) continue
      const pattern = new RegExp(`\\b${name}\\b`)
      if (frontier.some(text => pattern.test(text))) {
        included.set(name, declaration)
        next.push(declaration)
      }
    }
    frontier = next
  }
  return [...included]
    .map(([name, declaration]) => ({ name, declaration }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

// 中文：取一段文档的第一句（到第一个句号 / 感叹号 / 问号为止）。
function firstSentence(doc: string): string {
  const line = doc.split('\n', 1)[0] ?? ''
  const match = /^(.*?[.!?])(?:\s|$)/.exec(line)
  return (match?.[1] ?? line).trim()
}

/** Render the byte-compatible model-facing API catalog. */
// 中文：渲染"模型面 API 目录"的 TypeScript 源码（tool-cordis 用 cordis_inspect 读取）。
// 生成内容分四块：SERVICE_API（服务 + 方法契约）、EVENT_API（事件 + 监听器契约）、
// TYPE_API（签名引用的类型声明闭包）、INHERITED_CTX_API（继承的 ctx API），
// 另附 referencedTypeClosure / queryServiceApi / queryEventApi 三个查询函数。
// 大段生成文本用字符串字面量直接拼装，jscpd 忽略区间保护它不被当成重复代码。
function renderRuntimeApi(
  services: readonly ServiceEntry[],
  events: readonly EventEntry[],
  types: readonly { name: string; declaration: string }[],
  inheritedServices: readonly InheritedEntry[],
): string {
  const lines: string[] = [
    '/**',
    ' * Generated by scripts/gen-cordis-api.ts — do not edit by hand; run',
    ' * `pnpm run gen-cordis-api` to regenerate (freshness-gated by',
    ' * `pnpm run verify-cordis-api` in doc-sync).',
    ' *',
    ' * The machine-readable cordis API catalog `cordis_inspect` serves to the',
    ' * model: harness services (summary + structured public method contracts),',
    ' * harness events (mode + structured listener contracts), and the inherited `ctx` API. Produced by',
    ' * the same AST walk as docs/cordis-catalog, so this data and the rendered',
    ' * docs cannot diverge.',
    ' *',
    ' * @module @deepseek-ai/dsh-tool-cordis/api-catalog',
    ' */',
    '',
    '/* 【文件职责】从源码声明和 JSDoc 生成服务、事件及 Context API 目录，供 cordis_inspect 查询。 */',
    '',
    '/* jscpd:ignore-start */',
    '/** One named parameter in a Service method or Event listener. */',
    'export interface ApiParameter {',
    '  /** Parameter name from the exact signature. */',
    '  name: string',
    '  /** Source-owned parameter contract. */',
    '  description: string',
    '}',
    '',
    '/** One public service member and its source-owned contract. */',
    'export interface ServiceApiMethod {',
    '  /** Public method signature with its body stripped. */',
    '  signature: string',
    '  /** Method purpose and behavior. */',
    '  description: string',
    '  /** Named parameters in signature order. */',
    '  parameters: readonly ApiParameter[]',
    '  /** Non-void result contract when documented. */',
    '  returns?: string',
    '  /** Documented failure conditions. */',
    '  throws?: readonly string[]',
    '}',
    '',
    '/** One harness `ctx.<key>` service and its public methods. */',
    'export interface ServiceApiEntry {',
    '  /** The `ctx.<key>` name, e.g. `tools`. */',
    '  key: string',
    '  /** First sentence of the service class JSDoc. */',
    '  summary: string',
    '  /** Complete service description. */',
    '  description: string',
    '  /** Public methods, bodies stripped, in source order. */',
    '  methods: readonly ServiceApiMethod[]',
    '}',
    '',
    '/** One harness event: its dispatch mode, exact signature, and listener contract. */',
    'export interface EventApiEntry {',
    '  /** The scoped event name, e.g. `agent/status`. */',
    '  name: string',
    '  /** The dispatch mode from the declaration\'s `@mode` tag. */',
    '  mode: string',
    '  /** The exact listener signature, whitespace-normalized. */',
    '  signature: string',
    '  /** First sentence of the event JSDoc. */',
    '  summary: string',
    '  /** Complete event description. */',
    '  description: string',
    '  /** Named listener parameters in signature order. */',
    '  parameters: readonly ApiParameter[]',
    '}',
    '',
    '/** One inherited (cordis core + loader/hmr/timer) `ctx` member group with its summary. */',
    'export interface InheritedApiEntry {',
    '  /** The `ctx` member name(s), e.g. `ctx.on / ctx.once`. */',
    '  name: string',
    '  /** One-line summary of what the member does. */',
    '  summary: string',
    '}',
    '',
    '/** One named type declaration referenced by a Service or Event signature. */',
    'export interface TypeApiEntry {',
    '  /** The exported type/interface name, e.g. `ShellRunResult`. */',
    '  name: string',
    '  /** The full declaration text, comments stripped. */',
    '  declaration: string',
    '}',
    '',
    '/** Every harness `ctx.<key>` service, sorted by key. */',
    'export const SERVICE_API: readonly ServiceApiEntry[] = [',
  ]
  for (const service of services) {
    lines.push('  {')
    lines.push(`    key: ${quote(service.key)},`)
    lines.push(`    summary: ${quote(firstSentence(service.doc))},`)
    lines.push(`    description: ${quote(service.doc)},`)
    if (service.methods.length === 0) {
      lines.push('    methods: [],')
    } else {
      lines.push('    methods: [')
      for (const method of service.methods) {
        // 中文：每个方法的契约（描述 / 参数 / 返回 / 抛出）从它的 JSDoc 重新解析得到。
        const contract = parseJsDoc(method.jsDoc)
        lines.push('      {')
        lines.push(`        signature: ${quote(method.signature)},`)
        lines.push(`        description: ${quote(contract.doc)},`)
        lines.push(`        parameters: ${renderParameters(contract.params)},`)
        if (contract.returns !== null) lines.push(`        returns: ${quote(contract.returns)},`)
        if (contract.throws.length > 0) lines.push(`        throws: ${quoteList(contract.throws)},`)
        lines.push('      },')
      }
      lines.push('    ],')
    }
    lines.push('  },')
  }
  lines.push(
    ']',
    '',
    '/** Every harness event, sorted by name. */',
    'export const EVENT_API: readonly EventApiEntry[] = [',
  )
  // 中文：事件按名字排序后逐条展开（含解析自 JSDoc 的参数契约）。
  for (const event of [...events].sort((left, right) => left.name.localeCompare(right.name))) {
    const contract = parseJsDoc(event.jsDoc)
    lines.push('  {')
    lines.push(`    name: ${quote(event.name)},`)
    lines.push(`    mode: ${quote(event.mode)},`)
    lines.push(`    signature: ${quote(event.signature)},`)
    lines.push(`    summary: ${quote(firstSentence(event.doc))},`)
    lines.push(`    description: ${quote(event.doc)},`)
    lines.push(`    parameters: ${renderParameters(contract.params)},`)
    lines.push('  },')
  }
  lines.push(
    ']',
    '',
    '/** Shapes of every exported type the Service and Event signatures reference (transitively), sorted by name. */',
    'export const TYPE_API: readonly TypeApiEntry[] = [',
  )
  for (const type of types) {
    lines.push('  {')
    lines.push(`    name: ${quote(type.name)},`)
    lines.push(`    declaration: ${quote(type.declaration)},`)
    lines.push('  },')
  }
  lines.push(
    ']',
    '',
    '/** The inherited `ctx` API (cordis core + loader/hmr/timer), in curated order. */',
    'export const INHERITED_CTX_API: readonly InheritedApiEntry[] = [',
  )
  for (const inherited of inheritedServices) {
    lines.push(`  { name: ${quote(inherited.name)}, summary: ${quote(inherited.summary)} },`)
  }
  lines.push(
    ']',
    '',
    'function referencedTypeClosure(seeds: readonly string[]): TypeApiEntry[] {',
    '  const included = new Set<string>()',
    '  let frontier = [...seeds]',
    '  while (frontier.length > 0) {',
    '    const next: string[] = []',
    '    for (const entry of TYPE_API) {',
    '      if (included.has(entry.name)) continue',
    '      const pattern = new RegExp(`\\\\b${entry.name}\\\\b`)',
    '      if (!frontier.some(text => pattern.test(text))) continue',
    '      included.add(entry.name)',
    '      next.push(entry.declaration)',
    '    }',
    '    frontier = next',
    '  }',
    '  return TYPE_API.filter(entry => included.has(entry.name))',
    '}',
    '',
    'function contextProperty(key: string): string {',
    '  return /^[A-Za-z_$][\\w$]*$/.test(key) ? `ctx.${key}` : `ctx[${JSON.stringify(key)}]`',
    '}',
    '',
    '/**',
    ' * Project the Service Catalog as a compact directory or one exact coding contract.',
    ' * @param key - exact Service key; omit it to list all Services and method signatures.',
    ' * @param services - platform-specific visible Service entries.',
    ' * @returns compact navigation data or one detailed Service with its referenced type closure.',
    ' */',
    'export function queryServiceApi(key?: string, services: readonly ServiceApiEntry[] = SERVICE_API): object {',
    '  if (key === undefined) {',
    '    return {',
    "      mode: 'catalog',",
    '      services: services.map(service => ({',
    '        key: service.key,',
    '        description: service.summary,',
    '        methods: service.methods.map(method => ({ signature: method.signature })),',
    '      })),',
    '    }',
    '  }',
    '  const service = services.find(candidate => candidate.key === key)',
    '  if (service === undefined) throw new Error(`no catalogued Service named "${key}"`)',
    '  return {',
    "    mode: 'service',",
    '    service: {',
    '      key: service.key,',
    '      description: service.description,',
    '      access: {',
    '        optional: { expression: `ctx.get(${JSON.stringify(service.key)})`, requiresUndefinedCheck: true },',
    '        hardDependency: { inject: [service.key], expression: contextProperty(service.key) },',
    '      },',
    '      methods: service.methods,',
    '    },',
    '    referencedTypes: referencedTypeClosure(service.methods.map(method => method.signature)),',
    '  }',
    '}',
    '',
    '/**',
    ' * Project the Event Catalog as a compact directory or one exact listener contract.',
    ' * @param name - exact Event name; omit it to list all Events and listener signatures.',
    ' * @param events - platform-specific visible Event entries.',
    ' * @returns compact navigation data or one detailed Event with its referenced type closure.',
    ' */',
    'export function queryEventApi(name?: string, events: readonly EventApiEntry[] = EVENT_API): object {',
    '  if (name === undefined) {',
    '    return {',
    "      mode: 'catalog',",
    '      events: events.map(event => ({',
    '        name: event.name,',
    '        description: event.summary,',
    '        mode: event.mode,',
    '        signature: event.signature,',
    '      })),',
    '    }',
    '  }',
    '  const event = events.find(candidate => candidate.name === name)',
    '  if (event === undefined) throw new Error(`no catalogued Event named "${name}"`)',
    '  return {',
    "    mode: 'event',",
    '    event: {',
    '      name: event.name,',
    '      description: event.description,',
    '      mode: event.mode,',
    '      signature: event.signature,',
    '      parameters: event.parameters,',
    '    },',
    '    referencedTypes: referencedTypeClosure([event.signature]),',
    '  }',
    '}',
    '/* jscpd:ignore-end */',
    '',
  )
  return lines.join('\n')
}
/** Opening region delimiter; injected content lives between the pair and the page owns everything outside. */
// 中文：生成内容区间的起始标记：两个标记之间的内容由本工具注入，
// 标记之外的页面内容归页面自己维护（手动编辑不会被覆盖）。
export const REGION_BEGIN = '<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->'
/** Closing region delimiter matching {@link REGION_BEGIN}. */
// 中文：与 REGION_BEGIN 配对的结束标记。
export const REGION_END = '<!-- END GENERATED cordis-surface -->'

/**
 * Render the cross-link "Types:" line for a signature relative to one
 * subsystems page, or '' if none apply. A type whose primary page IS the
 * rendering page would link as a fragmentless self-link readers already sit
 * on, so it is dropped instead.
 */
// 中文：为某个签名渲染"Types:" 交叉链接行（相对某个子系统页），没有可链接类型时返回空串。
// 类型的主页就是当前渲染页时，链接会变成读者已身处页面的无片段自链接，因此直接丢弃。
function typeLinks(signature: string, onPage: string, linkedTypePages: Readonly<Record<string, string>>): string {
  const seen = new Set<string>()
  for (const name of Object.keys(linkedTypePages)) {
    if (new RegExp(`\\b${name}\\b`).test(signature)) seen.add(name)
  }
  const links = [...seen].sort()
    .filter(name => linkedTypePages[name] !== onPage)
    .map(name => `[${name}](${linkedTypePages[name]})`)
  if (links.length === 0) return ''
  return `Types: ${links.join(' · ')}`
}

/**
 * GitHub's heading-slug algorithm (lowercase; drop everything but letters,
 * numbers, spaces, hyphens; spaces become hyphens). Region headings carry
 * backticks and em-dashes, which VitePress slugifies differently, so each
 * generated heading is preceded by an explicit `<a id>` carrying this slug —
 * the historical flat-catalog anchor — making `#ctx<key>--<class>` fragments
 * resolve identically on GitHub and the published site.
 */
// 中文：GitHub 的标题 slug 算法（转小写；只保留字母 / 数字 / 空格 / 连字符；空格变连字符）。
// 区域标题带反引号与破折号，VitePress 的 slug 规则不同，因此每个生成标题前都放一个
// 显式 `<a id>` 锚点（即历史平铺目录的锚），让 `#ctx<key>--<class>` 片段在 GitHub 与
// 发布站点上解析结果一致。
function githubSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replaceAll(' ', '-')
}

/** The explicit-anchor line emitted before one generated heading. */
// 中文：生成标题前输出的显式锚点行（空行结尾，避免紧跟标题）。
function anchorFor(headingText: string): string[] {
  return [`<a id="${githubSlug(headingText)}"></a>`, '']
}

/** Render a subsystem `file:line` source pointer as a file-only link. */
// 中文：把 `文件:行号` 源指针渲染成"仅文件"的相对链接（指向仓库内源码文件）。
function sourceLink(source: string): string {
  const file = source.split(':')[0]
  return `[\`${file}\`](../../${file})`
}

/** Render one harness event entry onto its owning page, nested under its scope heading. */
// 中文：把一条事件条目渲染到所属页面上（嵌在作用域标题下）：锚点 + 标题 + 描述 +
// 签名代码块（JSDoc + 签名）+ 类型链接 + 源链接。
function renderEvent(e: EventEntry, onPage: string, linkedTypePages: Readonly<Record<string, string>>): string[] {
  const out = [...anchorFor(`${e.name} — ${e.mode}`), `#### \`${e.name}\` — ${e.mode}`, '']
  if (e.doc) out.push(e.doc, '')
  out.push('```' + FENCE, e.jsDoc, e.signature, '```', '')
  const links = typeLinks(e.signature, onPage, linkedTypePages)
  if (links) out.push(links, '')
  out.push(`Source: ${sourceLink(e.source)}`, '')
  return out
}

/** Render one harness service entry onto its owning page. */
// 中文：把一条服务条目渲染到所属页面上：锚点 + 标题（抽象接缝有标注）+ 描述 +
// 方法签名代码块（仅方法，属性成员不渲染）+ 类型链接 + 源链接。
function renderService(s: ServiceEntry, onPage: string, linkedTypePages: Readonly<Record<string, string>>): string[] {
  const kind = s.abstract ? ' (abstract seam)' : ''
  const out = [...anchorFor(`ctx.${s.key} — ${s.type}${kind}`), `### \`ctx.${s.key}\` — \`${s.type}\`${kind}`, '']
  if (s.doc) out.push(s.doc, '')
  const methods = s.methods.filter(member => member.kind !== 'property')
  if (methods.length) {
    // 中文：每个方法输出"JSDoc + 签名"两行，方法之间空一行分隔。
    const declarations = methods.flatMap((method, index) => [
      ...(index > 0 ? [''] : []),
      method.jsDoc,
      method.signature,
    ])
    out.push('```' + FENCE, ...declarations, '```', '')
    const links = typeLinks(methods.map(method => method.signature).join('\n'), onPage, linkedTypePages)
    if (links) out.push(links, '')
  }
  out.push(`Source: ${sourceLink(s.source)}`, '')
  return out
}

/** The shared generated-file banner comment. */
// 中文：继承页与整页生成共用的文件头横幅（提示勿手改 + 再生成命令）。
const BANNER = [
  '<!-- Generated by scripts/gen-cordis-catalog.ts — do not edit by hand.',
  '     Run `pnpm run gen-cordis-catalog` to regenerate. -->',
  '',
]

/** The shared GENERATED + freshness-gate + fence notice paragraph. */
// 中文：共用的"生成声明 + 新鲜度门禁 + fence 说明"段落：说明文件由脚本生成、
// 由 verify-cordis-catalog 校验、签名代码块带源码 JSDoc 且 doc-typecheck 会跳过。
const GATE_NOTICE = 'This file is GENERATED from source (`scripts/gen-cordis-catalog.ts`) and verified fresh by `pnpm run verify-cordis-catalog` (part of `doc-sync`) — do not edit it by hand. Signature blocks use a `ts cordis-catalog` fence and include the original source JSDoc immediately before each event or service method. doc-typecheck skips these bare declaration fragments; type names in a signature link to the page that documents them.'

/**
 * Render one page's generated Cordis API region: the services mapped to
 * the page, then the event scopes mapped to it, markers included. Pure and
 * deterministic given sorted inputs; identical bytes land in both pair sides.
 * @param page - the owning `docs/subsystems/` page basename, e.g. `core.md`.
 * @param services - validated services mapped to this page.
 * @param events - validated events whose scopes map to this page.
 * @param policy - type links supplied by the caller.
 * @returns the complete marker-delimited region text.
 */
// 中文：渲染单个页面里的生成区域：先该页映射到的服务，再按作用域分组的事件，
// 首尾夹着 REGION_BEGIN / REGION_END 标记。给定排序输入时纯函数、结果确定，
// 两种语言侧页面会得到完全相同的字节（只有配对文档路径不同）。
export function renderPageRegion(page: string, services: ServiceEntry[], events: EventEntry[], policy: CordisCatalogPolicy): string {
  const lines: string[] = [
    REGION_BEGIN,
    '',
    '<a id="cordis-surface"></a>',
    '',
    '## Cordis API',
    '',
    'Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).',
    '',
  ]
  for (const s of services) lines.push(...renderService(s, page, policy.linkedTypePages))
  // 中文：事件按作用域分组、每组一个小标题，组内按名字排序。
  const scopes = [...new Set(events.map(e => e.scope))].sort()
  for (const scope of scopes) {
    lines.push(...anchorFor(`${scope}/* events`), `### \`${scope}/*\` events`, '')
    for (const e of events.filter(x => x.scope === scope).sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(...renderEvent(e, page, policy.linkedTypePages))
    }
  }
  while (lines.at(-1) === '') lines.pop()
  lines.push(REGION_END)
  return lines.join('\n')
}

/**
 * Render the inherited (pinned vendor) tier as its own generated page.
 * @param policy - inherited events and services supplied by the caller.
 * @returns the complete generated Markdown document.
 */
// 中文：把"继承层"（固定的 vendor 源码，如 cordis 核心 + loader/hmr/timer）渲染成
// 独立的生成页：横幅 + 简介 + 继承 ctx 成员列表 + 继承事件列表，全部来自策略数据。
export function renderInheritedPage(policy: CordisCatalogPolicy): string {
  const lines: string[] = [
    ...BANNER,
    '# Inherited Cordis API',
    '',
    'The framework `ctx` members and events every plugin sees beyond the harness tier — pinned vendor source ([vendoring policy](../../vendor/README.md)), summarized tersely so the harness pages stay focused on repository-owned vocabulary. Detailed Context, Fiber, Registry, and Service APIs are generated in [context.md](context.md), [fiber.md](fiber.md), [registry.md](registry.md), and [service.md](service.md); the event-dispatch methods in [events.md](events.md).',
    '',
    GATE_NOTICE,
    '',
    '## Inherited `ctx` members (cordis core + loader/hmr/timer)',
    '',
  ]
  for (const s of policy.inheritedServices) {
    lines.push(`- \`${s.name}\` — ${s.summary} ([\`${s.source}\`](../../${s.source.split(':')[0]}))`)
  }
  lines.push(
    '',
    '## Inherited events (cordis core + loader/hmr/timer)',
    '',
  )
  for (const e of policy.inheritedEvents) {
    lines.push(`- \`${e.name}\` — ${e.summary} ([\`${e.source}\`](../../${e.source.split(':')[0]}))`)
  }
  lines.push('')
  return lines.join('\n')
}
