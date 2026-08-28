/*
 * ================================ 文件注释 ================================
 * 【文件职责】typert 的 TypeScript 项目分析器：用 TypeScript 编译器 API（program /
 *             checker / AST）扫描工作区，提取"编译器无关"的 Typert 模型。
 *             Program、符号、语法节点都只是提取时的实现细节，调用方只拿到
 *             model.ts 里声明的模型。
 * 【技术维度】基于 typescript 编译器宿主（CompilerHost）与 Program；核心类
 *             WorkspaceAnalyzer（工作区级：注册发现、分批分析、诊断检查）与
 *             FaceAnalyzer（单编译面级：导出收集、服务 / 事件 / 远程调用提取、
 *             类型节点转换）。大量使用 checker 的符号解析与类型判断。
 * 【产品维度】这是"从源码到类型图"的第一步：把 TS 源码的公开 API 面（导出、服务、
 *             事件、对象、schema、远程方法）结构化，供 emitter 生成产物、供
 *             cordis-catalog 生成文档。write 模式还能自动补写缺失的类型标注。
 * 【逻辑维度】按代码顺序：① 错误类与配置类型；② WorkspaceCaches（跨分析器共享
 *             tsconfig / 编译宿主 / 源码文件缓存）；③ WorkspaceAnalyzer（analyze /
 *             analyzeInBatches / discoverPackages / indexSourceDeclarations 等）；
 *             ④ FaceAnalyzer（analyzePackage / collectServices / collectEvents /
 *             collectInvocations / 类型节点转换 convertType / 远程边界校验等）；
 *             ⑤ 模块级工具（manifest 解析、导出路径换算、文本工具、符号判断等）。
 * 【关键边界】分析是"失败即抛"（fail-closed）：缺类型标注、非法远程签名、跨包未声明
 *             引用等都抛 TypertAnalysisError；远程边界类型必须可投影为 JSON / Zod。
 *             caches 只对"不可变工作区快照"有效，写文件后必须 invalidate。
 * 【新手阅读建议】先读 WorkspaceAnalyzer.analyze 看整体流程，再读 FaceAnalyzer.
 *             analyzePackage 看一个包的提取内容，最后看 convertType 理解"AST 类型
 *             节点 → 类型图节点"的转换，以及 invocationModel 的远程调用校验。
 * ==========================================================================
 */

/**
 * TypeScript project analyzer for the compiler-independent Typert model.
 * Programs, symbols, and syntax nodes remain extraction-only implementation
 * details; callers receive only the model declared in {@link ./model.ts}.
 * @module @deepseek-ai/dsh-typert-generator/analyzer
 */
// 中文导读：本文件是 typert 生成链路的"前端"：TS 编译器对象只在这里出现，
// 一旦提取成模型，下游（渲染、发射、文档）就再也不碰 AST 了。

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type {
  CrossFaceLink,
  DocumentationModel,
  EventModel,
  EnumMemberModel,
  ExportModel,
  FaceModel,
  InvocationModel,
  InvocationParameterModel,
  JsDocTagModel,
  KeywordTypeName,
  MemberBase,
  MemberModel,
  MemberVisibility,
  ObjectModel,
  PackageModel,
  ParameterModel,
  RemoteBoundaryModel,
  RemoteTypeImportModel,
  SchemaModel,
  ServiceModel,
  SignatureModel,
  SourceDeclarationModel,
  SourceLocation,
  SymbolId,
  TypeDeclarationModel,
  TypeNodeId,
  TypeNodeModel,
  TypeOperatorName,
  TypeParameterModel,
  TypeTargetModel,
  TypertFace,
  WorkspaceModel,
} from './model.ts'

// 中文：类型工具——从模型类型里去掉只读的 id 字段（构造新节点时 id 由分配器生成）。
type WithoutId<T> = T extends { readonly id: TypeNodeId } ? Omit<T, 'id'> : never

// 中文：转换函数的入参类型：任何不带 id 的类型节点输入。
type TypeNodeInput = WithoutId<TypeNodeModel>

/** Analysis failure with a source-oriented diagnostic. */
// 中文：分析失败时抛出的专用错误：消息里带源码定位（文件:行:列 + 原因）。
export class TypertAnalysisError extends Error {
  override name = 'TypertAnalysisError'
}

// 中文：内部信号错误：write 模式发现缺类型标注时，先入队"补写"再抛它中断本次分析，
// 由上层 applyEdit 落盘后重新分析。
class SourceEditQueued extends Error {}

/** Missing-annotation handling at public business boundaries. */
// 中文：公开业务边界上"缺类型标注"的处理方式：check = 直接失败；
// write = 自动补写推断出的标注，然后基于干净源码重新分析。
export type AnalysisMode = 'check' | 'write'

/** Workspace analysis configuration. */
// 中文：工作区分析配置：根目录、host / client 聚合 tsconfig、可选的包子集、
// 编译面、诊断检查开关、标注模式与共享缓存。
export interface WorkspaceAnalyzerOptions {
  /** Workspace root containing the face tsconfigs. */
  // 中文：工作区根目录（存放各 face tsconfig）。
  readonly root: string
  /** Host aggregate path, relative to {@link root}; absent files are skipped. */
  // 中文：host 聚合配置路径（相对根目录）；文件不存在则跳过。
  readonly hostConfig?: string
  /** Client aggregate path, relative to {@link root}; absent files are skipped. */
  // 中文：client 聚合配置路径（相对根目录）；文件不存在则跳过。
  readonly clientConfig?: string
  /** Optional package-name subset for an incremental generation pass. */
  // 中文：可选的包名子集（做增量生成时只分析这些包）。
  readonly packages?: readonly string[]
  /** Independently compiled faces to materialize; both are analyzed by default. */
  // 中文：要实体化的独立编译面；默认 host 与 client 都分析。
  readonly faces?: readonly TypertFace[]
  /** Whether to repeat TypeScript project diagnostics before model extraction. */
  // 中文：提取模型前是否重复跑 TypeScript 项目诊断（TS 报错也会导致失败）。
  readonly checkDiagnostics?: boolean
  /** Whether missing annotations fail or are written before a clean re-analysis. */
  // 中文：缺标注时是失败（check）还是先补写再干净重分析（write）。
  readonly mode?: AnalysisMode
  /** Shared workspace memo; supply one instance to reuse parses across analyzers. */
  // 中文：共享工作区缓存；传入同一实例可在多个分析器间复用解析结果。
  readonly caches?: WorkspaceCaches
}

/** One package face whose public export graph contains Typert business declarations. */
// 中文：一个"公开导出图里含 Typert 业务声明"的包面：包名、根目录与它参与的编译面列表。
export interface DiscoveredTypertPackage {
  readonly package: string
  readonly root: string
  readonly faces: readonly TypertFace[]
}

/** One parsed tsconfig, memoizable per workspace snapshot. */
// 中文：一份解析好的 tsconfig（按工作区快照可记忆）：绝对路径 + TypeScript 解析结果。
export interface ParsedConfig {
  /** Absolute config path. */
  // 中文：配置的绝对路径。
  readonly path: string
  /** The TypeScript parse result. */
  // 中文：TypeScript 的解析结果。
  readonly parsed: ts.ParsedCommandLine
}

/** One package face registration discovered from an aggregate tsconfig. */
// 中文：从聚合 tsconfig 的 projectReferences 里发现的"一个包的某个面"注册信息：
// 面、包名、包根、包自己的 tsconfig、package.json 内容，以及双面包各自的导出子路径。
export interface PackageRegistration {
  /** The face whose aggregate references this package project. */
  // 中文：引用该包项目的编译面。
  readonly face: TypertFace
  /** The package manifest name. */
  // 中文：package.json 里的包名。
  readonly name: string
  /** Real package root directory. */
  // 中文：真实（符号链接解析后）的包根目录。
  readonly root: string
  /** The package's own parsed tsconfig. */
  // 中文：包自己的已解析 tsconfig。
  readonly config: ParsedConfig
  /** The parsed package.json content. */
  // 中文：解析后的 package.json 内容。
  readonly manifest: Record<string, unknown>
  /** Export subpaths owned by this face for dual-face packages. */
  // 中文：双面包中本面拥有的导出子路径。
  readonly exportSubpaths?: readonly string[]
}

// 中文：内部结构——一条导出记录：模型 + 符号 + 首选声明 + 所在源文件。
interface ExportRecord {
  readonly model: ExportModel
  readonly symbol: ts.Symbol
  readonly declaration: ts.Declaration
  readonly sourceFile: ts.SourceFile
}

// 中文：内部结构——一次待执行的源码编辑：在文件指定位置插入文本（write 模式补标注用）。
interface SourceEdit {
  readonly file: string
  readonly position: number
  readonly text: string
}

// 中文：内部结构——模块身份：包名 + 包内子路径（如 "@x/y" + "./sub"）。
interface ModuleIdentity {
  readonly package: string
  readonly subpath: string
}

// 中文：内部结构——静态查找声明（来自 TypertLookupMap）：key、Host 符号 id、
// 线格式类型节点与声明位置。
interface StaticLookupDeclaration {
  readonly key: string
  readonly hostSymbol: SymbolId
  readonly wireType: ts.TypeNode
  readonly site: ts.Node
}

// 中文：内部结构——静态 Context 声明（来自 TypertContextMap）：key、线格式类型与声明位置。
interface StaticContextDeclaration {
  readonly key: string
  readonly wireType: ts.TypeNode
  readonly site: ts.Node
}

// 中文：内部结构——网关绑定：服务键、命名空间与绑定声明位置。
interface GatewayBinding {
  readonly service: string
  readonly namespace: string
  readonly site: ts.Node
}

// 中文：内部类型——类型引用的三种 AST 形态（普通引用、继承子句、import 类型）。
type ReferenceSite = ts.TypeReferenceNode | ts.ExpressionWithTypeArguments | ts.ImportTypeNode

// 中文：空文档模型常量：没有 JSDoc 的成员统一用 `{ tags: [] }`，避免处处新建对象。
const EMPTY_DOCUMENTATION: DocumentationModel = { tags: [] }

// 中文：内部结构——单个编译面的编译器宿主：host 本体 + 已解析源文件缓存表。
interface FaceProgramHost {
  readonly host: ts.CompilerHost
  readonly files: Map<string, ts.SourceFile | undefined>
}

/**
 * Process-wide parse cache for the bundled TypeScript default libraries.
 * `typescript/lib/lib.*.d.ts` content is immutable for the process lifetime,
 * so parses are shared across every {@link WorkspaceCaches} instance; the key
 * carries the parse-affecting settings, keeping reuse exact.
 */
// 中文：进程级的标准库解析缓存：`typescript/lib/lib.*.d.ts` 的内容在进程生命周期内
// 不可变，因此各 WorkspaceCaches 实例共享同一份解析；键包含会影响解析结果的设置，
// 保证复用是精确的。
const defaultLibraryParses = new Map<string, ts.SourceFile | undefined>()

// 中文：构造标准库解析缓存键：文件名 + 影响解析的选项（语言版本 / 模块格式 / JSDoc
// 解析模式），不同设置组合得到不同缓存项。
function defaultLibraryKey(fileName: string, languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions): string {
  const options = typeof languageVersionOrOptions === 'object'
    ? languageVersionOrOptions
    : { languageVersion: languageVersionOrOptions }
  return [
    fileName,
    String(options.languageVersion),
    String(options.impliedNodeFormat ?? ''),
    String(options.jsDocParsingMode ?? ''),
  ].join('\0')
}

/**
 * Shared memo over one immutable workspace snapshot. Passing one instance to
 * several analyzers (the batched and write-mode children reuse their parent's
 * automatically) reuses parsed tsconfigs, the registration inventory, and
 * per-face compiler hosts whose parsed and bound source files and module
 * resolutions carry across programs. Callers that mutate workspace files
 * between analyses must start from a fresh instance; write-mode source edits
 * invalidate themselves through {@link invalidate}.
 */
// 中文：覆盖"一个不可变工作区快照"的共享记忆：把同一实例传给多个分析器（分批与
// write 模式的子分析器会自动复用父分析器的缓存），可复用已解析 tsconfig、注册清单、
// 每面编译器宿主（其解析 / 绑定过的源文件与模块解析可跨 Program 复用）。
// 两次分析之间改动过工作区文件的调用方必须新建实例；write 模式的源码编辑会通过
// invalidate 主动失效相关缓存。
export class WorkspaceCaches {
  /** Parsed tsconfig files by absolute config path. */
  // 中文：已解析的 tsconfig（按绝对配置路径索引）。
  readonly configs = new Map<string, ParsedConfig>()
  /** Registration inventories keyed by root and aggregate config paths. */
  // 中文：注册清单（按根目录 + 聚合配置路径索引）。
  readonly registrations = new Map<string, PackageRegistration[]>()
  // 中文：每面的编译宿主（含源文件缓存表），跨分析器共享。
  private readonly hosts = new Map<TypertFace, FaceProgramHost>()

  /**
   * Parse one tsconfig once per workspace snapshot.
   * @param path - absolute config path.
   * @returns the memoized parse result.
   */
  // 中文：每个工作区快照只解析一次 tsconfig；再次请求直接返回缓存。
  config(path: string): ParsedConfig {
    let parsed = this.configs.get(path)
    if (parsed === undefined) {
      parsed = parseConfig(path)
      this.configs.set(path, parsed)
    }
    return parsed
  }

  /**
   * Return the shared compiler host for one face. Every program of one face
   * is built from the same aggregate compiler options (the first call wins),
   * so parsed source files, binder state, and module resolutions are safe to
   * reuse across the face's batched programs.
   * @param face - the face whose programs share this host.
   * @param options - the face's effective compiler options.
   * @returns a compiler host with source-file and module-resolution caches.
   */
  // 中文：返回某面的共享编译器宿主：同一面的所有 Program 都用同一份聚合编译器选项
  // （首个调用者决定），因此解析过的源文件、绑定状态与模块解析可以在该面的多个
  // 分批 Program 间安全复用。
  programHost(face: TypertFace, options: ts.CompilerOptions): ts.CompilerHost {
    let entry = this.hosts.get(face)
    if (entry === undefined) {
      const host = ts.createCompilerHost(options)
      const files = new Map<string, ts.SourceFile | undefined>()
      // 中文：模块解析缓存：让跨 Program 的 import 解析结果可复用，显著提速。
      const resolutionCache = ts.createModuleResolutionCache(
        host.getCurrentDirectory(),
        fileName => host.getCanonicalFileName(fileName),
        options,
      )
      const base = host.getSourceFile.bind(host)
      // The snapshot contract makes shouldCreateNewSourceFile irrelevant: it
      // only fires under oldProgram reuse, which these fresh programs never
      // request, and invalidate() is the one supported re-read path.
      // 中文：快照契约让 shouldCreateNewSourceFile 失去意义：它只在复用 oldProgram 时
      // 触发，而这些全新 Program 从不请求复用；invalidate() 是唯一支持的重新读取路径。
      host.getSourceFile = (fileName, languageVersionOrOptions, onError) => {
        // 中文：标准库文件走进程级共享缓存；普通文件走本面的文件缓存表。
        if (isStandardLibraryFile(fileName)) {
          const key = defaultLibraryKey(fileName, languageVersionOrOptions)
          if (!defaultLibraryParses.has(key)) {
            defaultLibraryParses.set(key, base(fileName, languageVersionOrOptions, onError))
          }
          return defaultLibraryParses.get(key)
        }
        if (!files.has(fileName)) files.set(fileName, base(fileName, languageVersionOrOptions, onError))
        return files.get(fileName)
      }
      host.getModuleResolutionCache = () => resolutionCache
      entry = { host, files }
      this.hosts.set(face, entry)
    }
    return entry.host
  }

  /**
   * Drop cached parses of one edited source file so the next analysis reads
   * the written content.
   * @param file - path of the edited file.
   */
  // 中文：丢弃某个被编辑源文件的缓存解析，让下一次分析读到写盘后的新内容
  // （write 模式补写标注后调用）。
  invalidate(file: string): void {
    const target = realPath(file)
    for (const { files } of this.hosts.values()) {
      for (const key of [...files.keys()]) {
        if (realPath(key) === target) files.delete(key)
      }
    }
  }
}

/** Analyze host and client as independent TypeScript programs. */
// 中文：工作区分析器：把 host 与 client 当作两个独立 TypeScript Program 分析，
// 产出完整工作区模型；write 模式会先补写推断标注再干净重分析。
export class WorkspaceAnalyzer {
  // 中文：规范化后的分析选项（必填项带默认值，packages 保持可选）。
  private readonly options: Required<Pick<
    WorkspaceAnalyzerOptions,
    'root' | 'hostConfig' | 'clientConfig' | 'faces' | 'checkDiagnostics' | 'mode'
  >> & Pick<WorkspaceAnalyzerOptions, 'packages'>
  // 中文：write 模式入队的待执行源码编辑（一次分析最多一个）。
  private queuedEdit: SourceEdit | undefined
  // 中文：跨面链接表（key 为链接字段拼接，保证去重）。
  private readonly crossFaceLinks = new Map<string, CrossFaceLink>()
  // 中文：已做过诊断检查的项目（按配置路径去重，避免重复检查）。
  private readonly checkedProjects = new Set<string>()
  // 中文：当前分析的包注册清单。
  private registrations: PackageRegistration[] = []
  // 中文：共享缓存（传入或新建）。
  private readonly caches: WorkspaceCaches

  constructor(options: WorkspaceAnalyzerOptions) {
    // 中文：构造时规范化选项：根目录解析真实路径，其余字段取默认值。
    this.options = {
      root: realPath(options.root),
      hostConfig: options.hostConfig ?? 'tsconfig.host.json',
      clientConfig: options.clientConfig ?? 'tsconfig.client.json',
      faces: options.faces ?? ['host', 'client'],
      checkDiagnostics: options.checkDiagnostics ?? true,
      mode: options.mode ?? 'check',
      ...(options.packages === undefined ? {} : { packages: options.packages }),
    }
    this.caches = options.caches ?? new WorkspaceCaches()
  }

  /**
   * Build the workspace model. Write mode applies inferred annotations and then
   * returns a fresh check-mode analysis of the edited projects.
   * @returns the independent face models and their explicit cross-face links.
   */
  // 中文：构建工作区模型。流程：加载注册清单 → 逐面过滤出选定包 →（可选）跑诊断 →
  // 创建该面共享 Program 并交给 FaceAnalyzer 分析。write 模式：若分析中入队了源码
  // 编辑，先落盘再递归重分析；否则换 check 模式重分析一遍拿到干净结果。
  analyze(): WorkspaceModel {
    this.registrations = this.loadRegistrations()
    const selected = this.options.packages === undefined
      ? undefined
      : new Set(this.options.packages)
    const faces: FaceModel[] = []
    try {
      for (const face of this.options.faces) {
        const registrations = this.registrations.filter(registration =>
          registration.face === face && (selected === undefined || selected.has(registration.name)))
        if (registrations.length === 0) continue
        if (this.options.checkDiagnostics) {
          for (const registration of registrations) this.checkProject(registration)
        }
        const aggregatePath = resolve(this.options.root, face === 'host' ? this.options.hostConfig : this.options.clientConfig)
        const aggregate = this.caches.config(aggregatePath)
        // 中文：该面所有包的文件合并成 Program 根文件；聚合配置里的选项关掉增量编译相关项。
        const rootNames = [...new Set(registrations.flatMap(registration => registration.config.parsed.fileNames))]
        const options: ts.CompilerOptions = {
          ...aggregate.parsed.options,
          composite: false,
          incremental: false,
          noEmit: true,
        }
        const program = ts.createProgram({
          rootNames,
          options,
          host: this.caches.programHost(face, options),
        })
        faces.push(new FaceAnalyzer({
          root: this.options.root,
          face,
          program,
          registrations,
          allRegistrations: this.registrations,
          mode: this.options.mode,
          queueEdit: (edit) => { this.queueEdit(edit) },
          crossFaceLinks: this.crossFaceLinks,
        }).analyze())
      }
    } catch (error) {
      // 中文：write 模式下 SourceEditQueued 是"待补写"的正常信号，吞掉走补写流程；
      // 其余错误原样抛出。
      if (!(error instanceof SourceEditQueued) || this.options.mode !== 'write' || this.queuedEdit === undefined) throw error
    }

    if (this.queuedEdit !== undefined) {
      this.applyEdit(this.queuedEdit)
      return new WorkspaceAnalyzer({ ...this.options, caches: this.caches, mode: 'write' }).analyze()
    }

    if (this.options.mode === 'write') {
      return new WorkspaceAnalyzer({ ...this.options, caches: this.caches, mode: 'check' }).analyze()
    }

    return {
      faces,
      crossFaceLinks: [...this.crossFaceLinks.values()].sort(compareCrossFaceLinks),
    }
  }

  /**
   * Analyze an explicit package selection through bounded compiler programs.
   * The resulting model is identical in shape to {@link analyze}; stable graph
   * ids let repeated dependency declarations merge without flattening types.
   * @param batchSize - maximum selected packages in one face program.
   * @returns one merged workspace model.
   */
  // 中文：通过"有上限的编译器 Program"分析显式选中的包：把包按 batchSize 分批，每批
  // 一个小 Program（内存可控），再把各批结果合并。图 id 稳定，因此跨批重复出现的
  // 依赖声明能合并而不会摊平类型。
  analyzeInBatches(batchSize = 8): WorkspaceModel {
    if (this.options.packages === undefined) {
      throw new TypertAnalysisError('typert: batched analysis requires an explicit package selection')
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new TypertAnalysisError(`typert: batch size must be a positive integer, received ${String(batchSize)}`)
    }
    const batches: WorkspaceModel[] = []
    for (let index = 0; index < this.options.packages.length; index += batchSize) {
      batches.push(new WorkspaceAnalyzer({
        ...this.options,
        caches: this.caches,
        packages: this.options.packages.slice(index, index + batchSize),
      }).analyze())
    }
    return mergeWorkspaceModels(batches)
  }

  /**
   * Discover package faces from public-export-reachable Cordis augmentations
   * and explicit `@typert` roots without constructing a type-checker program.
   * @returns contributors grouped by package with deterministic face order.
   */
  // 中文：发现参与 typert 的包面：只做轻量语法扫描（不构造类型检查 Program）——
  // 从公开导出可达的模块声明与显式 @typert 标注判断。返回按包分组、面顺序确定的结果。
  discoverPackages(): DiscoveredTypertPackage[] {
    const registrations = this.loadRegistrations()
      .filter(registration => this.options.faces.includes(registration.face))
      .filter(registration => this.registrationHasSurface(registration))
    const packages = new Map<string, { root: string; faces: Set<TypertFace> }>()
    for (const registration of registrations) {
      const current = packages.get(registration.name) ?? {
        root: slash(relative(this.options.root, registration.root)),
        faces: new Set<TypertFace>(),
      }
      current.faces.add(registration.face)
      packages.set(registration.name, current)
    }
    return [...packages]
      .map(([packageName, value]) => ({
        package: packageName,
        root: value.root,
        faces: [...value.faces].sort(),
      }))
      .sort((left, right) => left.package.localeCompare(right.package))
  }

  /**
   * Index top-level exported type declarations without promoting them to graph
   * roots. Consumers use this lexical index for ambiguity checks while all
   * semantic traversal continues through {@link TypeGraph}.
   * @returns declarations from the selected faces and package projects.
   */
  // 中文：索引顶层导出类型声明（不把它们提升为类型图根）：供消费方做同名歧义检查，
  // 而语义遍历仍走 TypeGraph。返回选定面与包项目里、位于包 src 下的声明。
  indexSourceDeclarations(): SourceDeclarationModel[] {
    const selected = this.options.packages === undefined ? undefined : new Set(this.options.packages)
    const declarations: SourceDeclarationModel[] = []
    for (const registration of this.loadRegistrations()) {
      if (!this.options.faces.includes(registration.face)
        || (selected !== undefined && !selected.has(registration.name))) continue
      for (const file of registration.config.parsed.fileNames) {
        const relativeFile = slash(relative(this.options.root, file))
        // 中文：只索引"真实存在、位于包 src 下、扩展名是 ts/cts/mts"的文件。
        if (!existsSync(file)
          || !isWithin(realPath(file), join(registration.root, 'src'))
          || !/\.(?:cts|mts|ts)$/.test(file)
        ) continue
        const sourceFile = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
        for (const statement of sourceFile.statements) {
          // 中文：只收"带名字且带 export 修饰符"的顶层类型声明。
          if (!isTypeDeclaration(statement)
            || statement.name === undefined
            || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
          const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
          declarations.push({
            face: registration.face,
            package: registration.name,
            name: statement.name.text,
            kind: ts.isClassDeclaration(statement)
              ? 'class'
              : ts.isInterfaceDeclaration(statement)
                ? 'interface'
                : ts.isTypeAliasDeclaration(statement)
                  ? 'alias'
                  : 'enum',
            location: {
              file: relativeFile,
              line: position.line + 1,
              column: position.character + 1,
            },
            text: declarationText(statement),
          })
        }
      }
    }
    // 中文：按"面 + 位置 + 名字"去重，再按面 → 文件 → 行排序，保证结果稳定。
    return uniqueBy(declarations, declaration =>
      `${declaration.face}\0${declaration.location.file}\0${String(declaration.location.line)}\0${declaration.name}`)
      .sort((left, right) => left.face.localeCompare(right.face)
        || left.location.file.localeCompare(right.location.file)
        || left.location.line - right.location.line)
  }

  // 中文：加载（并缓存）包注册清单：遍历 host / client 聚合 tsconfig 的 projectReferences，
  // 解析每个引用的 tsconfig 与 package.json，生成注册项；双面包（manifest.dsh.client）
  // 会拆成 host / client 两条注册并各带自己的导出子路径。
  private loadRegistrations(): PackageRegistration[] {
    const inventoryKey = `${this.options.root}\0${this.options.hostConfig}\0${this.options.clientConfig}`
    const cached = this.caches.registrations.get(inventoryKey)
    if (cached !== undefined) return cached
    const registrations: PackageRegistration[] = []
    for (const face of ['host', 'client'] as const) {
      const aggregatePath = resolve(this.options.root, face === 'host' ? this.options.hostConfig : this.options.clientConfig)
      if (!existsSync(aggregatePath)) continue
      const aggregate = this.caches.config(aggregatePath)
      for (const reference of aggregate.parsed.projectReferences ?? []) {
        const configPath = projectConfigPath(reference.path)
        const packageRoot = dirname(configPath)
        // 中文：只登记位于仓库 packages/ 目录下的项目。
        if (!isWithin(realPath(packageRoot), join(this.options.root, 'packages'))) continue
        const manifestPath = join(packageRoot, 'package.json')
        if (!existsSync(manifestPath)) continue
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
        if (typeof manifest.name !== 'string') continue
        const registration: PackageRegistration = {
          face,
          name: manifest.name,
          root: realPath(packageRoot),
          config: this.caches.config(configPath),
          manifest,
        }
        // 中文：单面包直接登记；双面包按 tsconfig 形态决定拆法（共享 tsconfig.json 时
        // 一条拆成 host + client 两条，否则按当前面的归属给一条带子路径的注册）。
        if (!isDualFacePackage(manifest)) {
          registrations.push(registration)
        } else if (configPath === join(packageRoot, 'tsconfig.json')) {
          registrations.push(
            { ...registration, face: 'host', exportSubpaths: hostExportSubpaths(manifest) },
            { ...registration, face: 'client', exportSubpaths: clientExportSubpaths(manifest) },
          )
        } else {
          registrations.push({
            ...registration,
            exportSubpaths: face === 'host'
              ? hostExportSubpaths(manifest)
              : clientExportSubpaths(manifest),
          })
        }
      }
    }
    const inventory = uniqueBy(registrations, registration => `${registration.face}\0${registration.name}`)
      .sort((left, right) =>
        left.face.localeCompare(right.face) || left.name.localeCompare(right.name))
    this.caches.registrations.set(inventoryKey, inventory)
    return inventory
  }

  // 中文：计算一个包的"入口源文件路径"列表：从 package.json 的 exports 里挑出会落到
  // TypeScript 源码的条目（排除通配、typert 产物子路径、JSON / YAML），换算成源码路径。
  private entrySourcePaths(registration: PackageRegistration): string[] {
    return packageExportTargets(registration.manifest)
      .filter(([subpath, target]) => (registration.exportSubpaths === undefined
        || registration.exportSubpaths.includes(subpath))
        && !target.includes('*')
        && subpath !== './package.json'
        && subpath !== './typert'
        && subpath !== './client/typert'
        && subpath !== './remote'
        && !target.endsWith('.json'))
      .map(([, target]) => sourcePathForExport(registration.root, target))
      .filter(existsSync)
  }

  // 中文：判断一个注册包是否"有 typert 表面"：从入口文件出发做可达性 BFS（只走包内
  // 导入），任一文件含 @typert 标注、typertRemote 绑定、@Remote 装饰器或非空
  // Context / Events 模块声明即视为有表面。
  private registrationHasSurface(registration: PackageRegistration): boolean {
    const seen = new Set<string>()
    const queue = this.entrySourcePaths(registration)
    while (queue.length > 0) {
      const file = realPath(queue.shift() as string)
      if (seen.has(file) || !isWithin(file, registration.root)) continue
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      if (sourceFileHasSurface(sourceFile)) return true
      // 中文：沿 import 解析包内模块，继续 BFS。
      for (const imported of ts.preProcessFile(source).importedFiles) {
        const resolved = ts.resolveModuleName(
          imported.fileName,
          file,
          registration.config.parsed.options,
          ts.sys,
        ).resolvedModule
        if (resolved !== undefined && isWithin(resolved.resolvedFileName, registration.root)) {
          queue.push(resolved.resolvedFileName)
        }
      }
    }
    return false
  }

  // 中文：对一个包项目跑 TS 诊断（每个配置路径只查一次）；包内文件若有任何语法或
  // 语义错误，汇总成 TypertAnalysisError 抛出。rootDir 放宽到工作区根，避免源码面
  // 别名导入产生虚假的 TS6059 错误。
  private checkProject(registration: PackageRegistration): void {
    if (this.checkedProjects.has(registration.config.path)) return
    this.checkedProjects.add(registration.config.path)
    const program = ts.createProgram({
      rootNames: registration.config.parsed.fileNames,
      options: {
        ...registration.config.parsed.options,
        composite: false,
        incremental: false,
        noEmit: true,
        // Source-plane workspace aliases resolve referenced packages to source.
        // Widen only this diagnostic program's root so those imports do not
        // produce an artificial TS6059 before Typert checks the public edge.
        // 中文：源码面工作区别名会把被引用的包解析到源码；只放宽本诊断 Program 的
        // rootDir，让这些导入不会在 Typert 检查公开边界之前产生虚假的 TS6059。
        rootDir: this.options.root,
      },
    })
    const diagnostics = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ].filter((diagnostic): diagnostic is ts.DiagnosticWithLocation => diagnostic.file !== undefined
      && diagnostic.start !== undefined
      && isWithin(diagnostic.file.fileName, registration.root))
    if (diagnostics.length === 0) return
    throw new TypertAnalysisError(
      diagnostics
        .map(diagnostic => formatProgramDiagnostic(this.options.root, registration.face, diagnostic))
        .join('\n'),
    )
  }

  // 中文：入队一次源码编辑（write 模式由 FaceAnalyzer 触发）。
  private queueEdit(edit: SourceEdit): void {
    this.queuedEdit = edit
  }

  // 中文：把入队的编辑落盘（在指定位置插入文本），并失效该文件的解析缓存。
  private applyEdit(edit: SourceEdit): void {
    const source = readFileSync(edit.file, 'utf8')
    writeFileSync(edit.file, source.slice(0, edit.position) + edit.text + source.slice(edit.position))
    this.caches.invalidate(edit.file)
  }
}

// 中文：内部结构——FaceAnalyzer 的构造参数：根目录、面、Program、注册清单、
// 分析模式、编辑回调与跨面链接表。
interface FaceAnalyzerOptions {
  readonly root: string
  readonly face: TypertFace
  readonly program: ts.Program
  readonly registrations: readonly PackageRegistration[]
  readonly allRegistrations: readonly PackageRegistration[]
  readonly mode: AnalysisMode
  readonly queueEdit: (edit: SourceEdit) => void
  readonly crossFaceLinks: Map<string, CrossFaceLink>
}

// 中文：单编译面分析器：在一个面（host / client）的共享 Program 上做全部模型提取，
// 包括导出收集、服务 / 事件 / 远程调用分析，以及 AST 类型节点到类型图节点的转换。
class FaceAnalyzer {
  private readonly root: string
  private readonly face: TypertFace
  private readonly program: ts.Program
  private readonly checker: ts.TypeChecker
  private readonly registrations: readonly PackageRegistration[]
  private readonly allRegistrations: readonly PackageRegistration[]
  private readonly mode: AnalysisMode
  private readonly queueEdit: (edit: SourceEdit) => void
  private readonly crossFaceLinks: Map<string, CrossFaceLink>
  // 中文：真实路径 → 源文件 的索引（Program 内查源文件用）。
  private readonly sourceFiles = new Map<string, ts.SourceFile>()
  // 中文：已提取的声明模型表（SymbolId → 模型）。
  private readonly declarations = new Map<SymbolId, TypeDeclarationModel>()
  // 中文：正在构建中的声明符号（防循环引用：转换中再次遇到即跳过）。
  private readonly declarationStates = new Set<SymbolId>()
  // 中文：已提取的类型节点表（TypeNodeId → 节点模型）。
  private readonly nodes = new Map<TypeNodeId, TypeNodeModel>()
  // 中文：每包的导出记录表。
  private readonly exportsByPackage = new Map<string, ExportRecord[]>()
  // 中文：同一源码位置出现的序号（保证同位置多个节点 id 不冲突）。
  private readonly nodeOrdinals = new Map<string, number>()
  // 中文：静态查找声明缓存（TypertLookupMap 解析一次后复用）。
  private staticLookups: readonly StaticLookupDeclaration[] | undefined
  // 中文：静态 Context 声明缓存（TypertContextMap 解析一次后复用）。
  private staticContexts: ReadonlyMap<string, StaticContextDeclaration> | undefined

  constructor(options: FaceAnalyzerOptions) {
    this.root = options.root
    this.face = options.face
    this.program = options.program
    this.checker = options.program.getTypeChecker()
    this.registrations = options.registrations
    this.allRegistrations = options.allRegistrations
    this.mode = options.mode
    this.queueEdit = options.queueEdit
    this.crossFaceLinks = options.crossFaceLinks
    for (const sourceFile of this.program.getSourceFiles()) {
      this.sourceFiles.set(realPath(sourceFile.fileName), sourceFile)
    }
  }

  // 中文：分析当前面：先逐包收集导出，再逐包分析业务语义（过滤掉无表面的包），
  // 校验远程调用身份唯一性，最后组装 FaceModel（声明与节点按 id 排序，保证稳定）。
  analyze(): FaceModel {
    for (const registration of this.registrations) {
      this.exportsByPackage.set(registration.name, this.collectExports(registration))
    }
    const packages = this.registrations
      .map(registration => this.analyzePackage(registration))
      .filter(hasPackageSurface)
    this.validateInvocationIdentity(packages)
    return {
      face: this.face,
      packages,
      graph: {
        declarations: [...this.declarations.values()].sort((left, right) => left.id.localeCompare(right.id)),
        nodes: [...this.nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
      },
    }
  }

  // 中文：分析一个包：① 从可达文件里找 `declare module '@deepseek-ai/cordis'` 的
  // Context / Events 接口，收集服务与事件；② 收集显式 @typert service 标注的服务；
  // ③ 收集 @typert object / schema 标注的导出；④ host 面额外收集远程调用。
  private analyzePackage(registration: PackageRegistration): PackageModel {
    const records = this.exportsByPackage.get(registration.name) as ExportRecord[]
    const reachable = this.reachableFiles(registration, records.map(record => record.sourceFile))
    const services: ServiceModel[] = []
    const events: EventModel[] = []

    // 中文：扫描可达文件里的 Cordis 模块扩充，把 Context 接口成员解析成服务、
    // Events 接口成员解析成事件。
    for (const sourceFile of reachable) {
      for (const statement of sourceFile.statements) {
        if (!ts.isModuleDeclaration(statement)
          || !ts.isStringLiteral(statement.name)
          || statement.name.text !== '@deepseek-ai/cordis'
          || statement.body === undefined
          || !ts.isModuleBlock(statement.body)) continue
        for (const member of statement.body.statements) {
          if (!ts.isInterfaceDeclaration(member)) continue
          if (member.name.text === 'Context') {
            services.push(...this.collectServices(member, records))
          } else if (member.name.text === 'Events') {
            events.push(...this.collectEvents(member))
          }
        }
      }
    }
    const explicitServices = this.collectExplicitServices(records)

    const objects: ObjectModel[] = []
    const schemas: SchemaModel[] = []
    const seenBusinessSymbols = new Set<SymbolId>()
    for (const record of records) {
      const declaration = record.declaration
      if (!isTypeDeclaration(declaration)) continue
      // 中文：声明必须属于本面某包（跨面 / 外部声明不在此收集）。
      if (this.registrationForFile(declaration.getSourceFile().fileName) === undefined) continue
      const symbol = this.resolveSymbol(record.symbol)
      const symbolId = this.symbolId(symbol)
      if (seenBusinessSymbols.has(symbolId)) continue
      const mode = typertMode(declaration)
      if (mode !== 'object' && mode !== 'schema') continue
      seenBusinessSymbols.add(symbolId)
      this.ensureDeclaration(symbol, declaration)
      const documentation = documentationOf(declaration)
      // 中文：@typert object = 按引用传递的对象；@typert schema = 生成校验 schema 的类型。
      if (mode === 'object') {
        objects.push({
          ...documentation,
          export: record.model,
          symbol: symbolId,
          passing: 'reference',
        })
      } else {
        schemas.push({
          ...documentation,
          export: record.model,
          symbol: symbolId,
          type: this.referenceNode(symbol, declaration),
        })
      }
    }

    return {
      name: registration.name,
      root: slash(relative(this.root, registration.root)),
      exports: records.map(record => record.model)
        .sort((left, right) => left.subpath.localeCompare(right.subpath) || left.name.localeCompare(right.name)),
      services: uniqueBy([...explicitServices, ...services], service => service.key)
        .sort((left, right) => left.key.localeCompare(right.key)),
      events: uniqueBy(events, event => event.name).sort((left, right) => left.name.localeCompare(right.name)),
      objects: objects.sort((left, right) => left.export.name.localeCompare(right.export.name)),
      schemas: schemas.sort((left, right) => left.export.name.localeCompare(right.export.name)),
      invocations: this.face === 'host'
        ? this.collectInvocations(registration, reachable).sort((left, right) => left.id.localeCompare(right.id))
        : [],
    }
  }

  // 中文：收集一个包的全部公开导出记录：遍历 package.json exports 里每个子路径对应的
  // 源码模块，把模块导出的每个符号（含别名解析）记为一条记录；数据类导出跳过。
  private collectExports(registration: PackageRegistration): ExportRecord[] {
    const targets = packageExportTargets(registration.manifest)
      .filter(([subpath]) => registration.exportSubpaths === undefined
        || registration.exportSubpaths.includes(subpath))
    const records: ExportRecord[] = []
    for (const [subpath, target] of targets) {
      if (target.includes('*') || subpath === './package.json'
        || subpath === './typert' || subpath === './client/typert' || subpath === './remote'
        // Data exports (bundle patch lists, JSON manifests) carry no TypeScript API.
        // 中文：数据类导出（bundle 补丁清单、JSON 清单）不承载 TypeScript API，跳过。
        || target.endsWith('.json') || target.endsWith('.yml') || target.endsWith('.yaml')) continue
      const sourcePath = sourcePathForExport(registration.root, target)
      const sourceFile = this.sourceFiles.get(realPath(sourcePath))
      // 中文：导出目标必须在 Program 里有对应源文件，否则说明发布配置指向了不存在的源码。
      if (sourceFile === undefined) {
        throw new TypertAnalysisError(
          `typert(${this.face}): ${registration.name} export ${subpath} resolves to missing source ${sourcePath}`,
        )
      }
      const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) continue
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        const symbol = this.resolveSymbol(exported)
        const declaration = preferredDeclaration(symbol) as ts.Declaration
        // 中文：别名集合：导出名与解析后符号名不同时都记下来（生成代码里两种名都可能出现）。
        const aliases = exported === symbol || exported.name === symbol.name
          ? [exported.name]
          : [exported.name, symbol.name]
        records.push({
          model: {
            subpath,
            name: exported.name,
            symbol: this.symbolId(symbol),
            aliases,
          },
          symbol,
          declaration,
          sourceFile,
        })
      }
    }
    const unique = uniqueBy(records, record => `${record.model.subpath}\0${record.model.name}`)
    this.collectCrossFaceReExports(registration, unique)
    return unique
  }

  // 中文：收集"跨面再导出"链接：遍历可达文件里的 export ... from 语句，若再导出的
  // 是当前包公开符号且目标模块属于另一个面，则记录一条 CrossFaceLink（供下游
  // 跨面类型引用校验）。命名空间再导出（export * as ns）不支持，直接失败。
  private collectCrossFaceReExports(
    registration: PackageRegistration,
    records: readonly ExportRecord[],
  ): void {
    const publicSymbols = new Set(records.map(record => record.symbol))
    const entryFiles = uniqueBy(records, record => record.sourceFile.fileName).map(record => record.sourceFile)
    for (const sourceFile of this.reachableFiles(registration, entryFiles)) {
      for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement)
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const module = moduleIdentity(statement.moduleSpecifier.text)
        if (module === undefined) continue
        const toFace = this.allRegistrations
          .find(candidate => candidate.name === module.package && candidate.face !== this.face)?.face
        if (toFace === undefined) continue

        if (statement.exportClause !== undefined && ts.isNamespaceExport(statement.exportClause)) {
          const namespace = this.resolveSymbol(
            this.checker.getSymbolAtLocation(statement.exportClause.name) as ts.Symbol,
          )
          if (publicSymbols.has(namespace)) {
            this.fail(statement.exportClause, 'cross-face namespace re-exports are not supported')
          }
          continue
        }

        // 中文：解析再导出的具体符号：无 exportClause 时按"模块全部导出"处理。
        const exports = statement.exportClause === undefined
          ? this.moduleExports(statement.moduleSpecifier)
            .map(symbol => ({ symbol: this.resolveSymbol(symbol), requestedName: symbol.name, site: statement }))
          : statement.exportClause.elements.map(element => ({
            symbol: this.resolveSymbol(this.checker.getSymbolAtLocation(element.name) as ts.Symbol),
            requestedName: element.propertyName?.text ?? element.name.text,
            site: element,
          }))
        for (const exported of exports) {
          if (!publicSymbols.has(exported.symbol)) continue
          const name = this.packageExportName(module, exported.symbol, toFace, exported.requestedName)
          // 中文：再导出名必须在目标包的对应子路径里真实存在。
          if (name === undefined) {
            this.fail(
              exported.site,
              `cross-face re-export ${exported.requestedName} is not exported by ${module.package} at ${module.subpath}`,
            )
          }
          this.recordCrossFaceLink(registration.name, toFace, module, name)
        }
      }
    }
  }

  // 中文：取一个模块说明符（import 'x'）对应的模块符号的全部导出。
  private moduleExports(moduleSpecifier: ts.StringLiteral): ts.Symbol[] {
    /* v8 ignore next -- a semantically valid export declaration from a resolved module always has a module symbol. */
    const moduleSymbol = this.checker.getSymbolAtLocation(moduleSpecifier) as ts.Symbol
    return this.checker.getExportsOfModule(moduleSymbol)
  }

  // 中文：计算从入口文件出发、仅沿"包内 import / export"可达的源文件集合（BFS），
  // 按文件名排序返回；跨出包根的导入不会继续展开。
  private reachableFiles(
    registration: PackageRegistration,
    entryFiles: readonly ts.SourceFile[],
  ): ts.SourceFile[] {
    const reachable = new Map<string, ts.SourceFile>()
    const queue = [...entryFiles]
    while (queue.length > 0) {
      const sourceFile = queue.shift() as ts.SourceFile
      const fileName = realPath(sourceFile.fileName)
      if (reachable.has(fileName) || !isWithin(fileName, registration.root)) continue
      reachable.set(fileName, sourceFile)
      for (const statement of sourceFile.statements) {
        if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const resolved = ts.resolveModuleName(
          statement.moduleSpecifier.text,
          sourceFile.fileName,
          this.program.getCompilerOptions(),
          ts.sys,
        ).resolvedModule
        if (resolved === undefined) continue
        const resolvedPath = realPath(resolved.resolvedFileName)
        if (!isWithin(resolvedPath, registration.root)) continue
        queue.push(this.sourceFiles.get(resolvedPath) as ts.SourceFile)
      }
    }
    return [...reachable.values()].sort((left, right) => left.fileName.localeCompare(right.fileName))
  }

  // 中文：从 `interface Context` 的成员里收集服务：每个必填（非可选、非含 undefined）
  // 的属性签名，其类型解析到一个"本包导出的类或接口"即是一条服务；可选键不是服务
  // （它是启动 / 引导代码在树挂载前安装的值，插件无法提供）。
  private collectServices(
    context: ts.InterfaceDeclaration,
    records: readonly ExportRecord[],
  ): ServiceModel[] {
    const bySymbol = new Map<SymbolId, ExportRecord[]>()
    for (const record of records) {
      const id = this.symbolId(record.symbol)
      const matches = bySymbol.get(id) ?? []
      matches.push(record)
      bySymbol.set(id, matches)
    }
    const result: ServiceModel[] = []
    for (const member of context.members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) continue
      // An OPTIONAL key is not a service: `X | undefined` and `key?: X` both mark
      // a value the launcher or boot code installs before the tree mounts (a root
      // accessor, an environment snapshot), which no plugin provides and no
      // consumer can reach with `inject`. Describing one as a service would answer
      // "add the plugin that provides it" for a key where no such plugin exists.
      // 中文：可选的键不是服务：`X | undefined` 与 `key?: X` 都表示"启动 / 引导代码在
      // 树挂载前安装的值"（根访问器、环境快照），没有插件会提供它，消费方也无法用
      // inject 拿到；把它描述成服务会误导开发者去找一个不存在的提供插件。
      if (member.questionToken !== undefined
        || (ts.isUnionTypeNode(member.type)
          && member.type.types.some(node => node.kind === ts.SyntaxKind.UndefinedKeyword))) continue
      const authoredSymbol = this.symbolAtType(member.type)
      if (authoredSymbol === undefined) continue
      const authoredSymbolId = this.symbolId(authoredSymbol)
      // 中文：从导出记录里挑出与该类型同名的条目（缺省兜底：任意一条）。
      const exported = bySymbol.get(authoredSymbolId)?.find(record => record.model.name === authoredSymbol.name)
        ?? bySymbol.get(authoredSymbolId)?.find(record => record.model.name !== 'default')
        ?? bySymbol.get(authoredSymbolId)?.[0]
      if (exported === undefined) continue
      let symbol = authoredSymbol
      let declaration = preferredDeclaration(symbol)
      const aliases = new Set<ts.Symbol>()
      // 中文：沿类型别名链解引用，直到真正的类 / 接口声明（别名环会终止）。
      while (declaration !== undefined && ts.isTypeAliasDeclaration(declaration)) {
        if (aliases.has(symbol)) break
        aliases.add(symbol)
        const target = this.symbolAtType(declaration.type)
        if (target === undefined) break
        symbol = target
        declaration = preferredDeclaration(symbol)
      }
      if (declaration === undefined || (!ts.isClassDeclaration(declaration) && !ts.isInterfaceDeclaration(declaration))) {
        this.fail(member, `service ${memberName(member.name)} does not resolve to an exported class or interface`)
      }
      const memberOwner = this.registrationForFile(member.getSourceFile().fileName)
      const declarationOwner = this.registrationForFile(declaration.getSourceFile().fileName)
      // 中文：Context 成员与声明必须属于同一个包（跨包注入的键不由本包文档化）。
      if (memberOwner?.name !== declarationOwner?.name) continue
      const symbolId = this.symbolId(symbol)
      const model = this.ensureDeclaration(symbol, declaration)
      const exposed = model.members
        .filter(exposableMember)
        .map(publicMember => publicMember.id)
      result.push({
        ...documentationOf(declaration),
        key: memberName(member.name),
        symbol: symbolId,
        export: exported.model,
        members: exposed,
        location: this.location(member),
      })
    }
    return result
  }

  // 中文：收集显式 @typert service 标注的服务：标注必须给出"一个非空的、不含 / 的
  // Cordis 服务键"，且声明必须是导出类；结果按符号去重。
  private collectExplicitServices(records: readonly ExportRecord[]): ServiceModel[] {
    const result: ServiceModel[] = []
    const seen = new Set<SymbolId>()
    for (const record of records) {
      const tag = typertServiceTag(record.declaration)
      if (tag === undefined) continue
      const words = (ts.getTextOfJSDocComment(tag.comment) ?? '').trim().split(/\s+/)
      if (words.length !== 2 || !isRemoteSegment(words[1] ?? '')) {
        this.fail(tag, '@typert service requires exactly one nonempty Cordis service key without "/"')
      }
      if (!ts.isClassDeclaration(record.declaration)) {
        this.fail(record.declaration, '@typert service requires an exported class')
      }
      const symbol = this.resolveSymbol(record.symbol)
      const symbolId = this.symbolId(symbol)
      if (seen.has(symbolId)) continue
      seen.add(symbolId)
      const model = this.ensureDeclaration(symbol, record.declaration)
      result.push({
        ...documentationOf(record.declaration),
        key: words[1] as string,
        symbol: symbolId,
        export: record.model,
        members: model.members.filter(exposableMember).map(member => member.id),
        location: this.location(record.declaration),
      })
    }
    return result
  }

  // 中文：收集一个包的远程调用：扫描可达文件里的类声明，找出带 @Remote / @RemoteScope
  // 装饰器的方法（必须是公开实例方法），解析类的网关绑定（继承 TypertRemoteService 或
  // 声明 typertRemote 字段），逐方法生成 InvocationModel。
  private collectInvocations(
    registration: PackageRegistration,
    reachable: readonly ts.SourceFile[],
  ): InvocationModel[] {
    const result: InvocationModel[] = []
    for (const sourceFile of reachable) {
      for (const statement of sourceFile.statements) {
        if (!ts.isClassDeclaration(statement)) continue
        const marked = statement.members.flatMap((member) => {
          const invocation = this.remoteMarker(member)
          if (invocation === undefined) return []
          if (!ts.isMethodDeclaration(member)) {
            this.fail(member, 'Remote decorators require a public instance method')
          }
          return [{ method: member, invocation }]
        })
        const first = marked[0]
        if (first === undefined) continue
        const binding = this.gatewayBinding(statement)
        // 中文：有远程方法就必须有网关绑定，否则无法确定 service key 与命名空间。
        if (binding === undefined) {
          this.fail(
            first.method,
            'Remote methods require TypertRemoteService or readonly typertGateway = bindTypertRemote(this, serviceKey)',
          )
        }
        for (const { method, invocation } of marked) {
          result.push(this.invocationModel(registration, binding, method, invocation))
        }
      }
    }
    return result
  }

  // 中文：把"一个远程方法"严格校验后投影成 InvocationModel。校验项：公开实例方法、
  // 有具体实现、标识符方法名、无泛型；参数逐个处理（取消信号必须是最后一个、命名为
  // signal 的全局 AbortSignal；lookup 参数必须与 TypertLookupMap 声明一致；其余必须是
  // JSON 可序列化类型）；作用域化调用校验 TypertContextMap 并分配 wire 字段；结果类型
  // 剥掉 Promise 包装。任何违规都直接失败。
  private invocationModel(
    registration: PackageRegistration,
    binding: GatewayBinding,
    method: ts.MethodDeclaration,
    invocation:
      | { readonly kind: 'direct'; readonly exportName?: string; readonly mode?: 'stream' }
      | { readonly kind: 'context'; readonly context: string; readonly exportName?: string },
  ): InvocationModel {
    if (visibilityOf(method) !== 'public' || hasModifier(method, ts.SyntaxKind.StaticKeyword)) {
      this.fail(method, 'Remote decorators require a public instance method')
    }
    if (hasModifier(method, ts.SyntaxKind.AbstractKeyword) || method.body === undefined) {
      this.fail(method, 'Remote methods must have a concrete implementation')
    }
    if (!ts.isIdentifier(method.name)) {
      this.fail(method, 'Remote method names must be identifiers')
    }
    if ((method.typeParameters?.length ?? 0) > 0) {
      this.fail(method, 'generic Remote methods are not supported')
    }
    const methodName = method.name.text
    const exportedMethod = invocation.exportName ?? methodName

    const lookups = this.lookupDeclarations()
    const lookupByHost = new Map(lookups.map(lookup => [lookup.hostSymbol, lookup]))
    const parameters: InvocationParameterModel[] = []
    let cancellation: InvocationModel['cancellation']
    const wires = new Set<string>()
    for (const [parameterIndex, parameter] of method.parameters.entries()) {
      if (!ts.isIdentifier(parameter.name)) {
        this.fail(parameter, 'Remote parameters must use identifier bindings')
      }
      if (parameter.dotDotDotToken !== undefined) this.fail(parameter, 'Remote parameters cannot be rest parameters')
      if (parameter.initializer !== undefined) this.fail(parameter, 'Remote parameters cannot have default values')
      if (parameter.name.text === 'this') this.fail(parameter, 'Remote methods cannot declare an explicit this parameter')
      const optional = parameter.questionToken !== undefined
      const authoredType = this.requiredType(parameter, parameter.type, 'parameter')
      // 中文：取消信号识别：参数名必须叫 signal 且类型是全局 AbortSignal，且必须是最后一个参数。
      const cancellationName = parameter.name.text === 'signal'
      const cancellationType = this.isGlobalAbortSignal(authoredType)
      if (cancellationName || cancellationType) {
        if (!cancellationName || !cancellationType) {
          this.fail(parameter, 'Remote cancellation must use a parameter named signal with the global AbortSignal type')
        }
        if (parameterIndex !== method.parameters.length - 1) {
          this.fail(parameter, 'Remote cancellation signal must be the final parameter')
        }
        cancellation = { parameter: 'signal' }
        continue
      }
      const hostSymbol = this.symbolAtType(authoredType)
      const lookup = hostSymbol === undefined ? undefined : lookupByHost.get(this.symbolId(hostSymbol))
      let modeled: InvocationParameterModel
      // 中文：lookup 参数：按声明映射成 `keyId` 线字段；JSON 参数：直接同名传输。
      if (lookup !== undefined) {
        if (optional) this.fail(parameter, `lookup parameter for ${lookup.key} cannot be optional`)
        if (parameter.name.text !== lookup.key) {
          this.fail(parameter, `lookup parameter for ${lookup.key} must also be named ${lookup.key}`)
        }
        const boundary = this.remoteBoundary(
          lookup.wireType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:${lookup.key}Id`,
          true,
        )
        modeled = {
          name: parameter.name.text,
          wire: `${lookup.key}Id`,
          source: 'lookup',
          lookup: lookup.key,
          boundary,
        }
      } else {
        // 中文：非 JSON 的工作区类参数必须声明 TypertLookupMap 条目，否则无法传输。
        if (hostSymbol !== undefined && this.isWorkspaceClass(hostSymbol)) {
          this.fail(parameter, `non-JSON class parameter ${hostSymbol.name} requires a TypertLookupMap entry`)
        }
        modeled = {
          name: parameter.name.text,
          wire: parameter.name.text,
          source: 'json',
          ...optional ? { optional: true as const } : {},
          boundary: this.remoteBoundary(
            authoredType,
            `${registration.name}#${binding.namespace}/${exportedMethod}:${parameter.name.text}`,
            false,
            'undefined',
            optional,
          ),
        }
      }
      // 中文：线字段必须唯一（作用域 / 上下文 wire 也占用同一命名空间）。
      if (wires.has(modeled.wire)) this.fail(parameter, `duplicate Remote wire field ${modeled.wire}`)
      wires.add(modeled.wire)
      parameters.push(modeled)
    }

    let receiver: InvocationModel['invocation'] = { kind: 'direct' }
    // 中文：作用域化调用：校验 TypertContextMap 里有对应声明，wire 字段用 `contextId`。
    if (invocation.kind === 'context') {
      const context = this.contextDeclarations().get(invocation.context)
      if (context === undefined) {
        this.fail(method, `Remote Scope ${invocation.context} has no TypertContextMap entry`)
      }
      const wire = `${invocation.context}Id`
      if (wires.has(wire)) this.fail(method, `Remote Scope wire field ${wire} conflicts with a method parameter`)
      receiver = {
        kind: 'context',
        context: invocation.context,
        wire,
        boundary: this.remoteBoundary(
          context.wireType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:${wire}`,
          true,
        ),
      }
    }

    // 中文：直连调用若恰好有一个"lookup 参数"且该 lookup 同时是 TypertContextMap 的
    // key，则生成 scope 投影：调用方的 Context 身份自动替换该参数，且要求两边 wire
    // 类型符号一致。
    let scope: InvocationModel['scope']
    if (invocation.kind === 'direct') {
      const lookupParameters = parameters.filter(parameter => parameter.source === 'lookup')
      const parameter = lookupParameters.length === 1 ? lookupParameters[0] : undefined
      const context = parameter?.lookup === undefined
        ? undefined
        : this.contextDeclarations().get(parameter.lookup)
      if (parameter !== undefined && context !== undefined) {
        const contextBoundary = this.remoteBoundary(
          context.wireType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:scope:${context.key}`,
          true,
        )
        if (contextBoundary.typeSymbol !== parameter.boundary.typeSymbol) {
          this.fail(
            method,
            `Remote scope ${context.key} wire type ${contextBoundary.typeSymbol} does not match lookup wire type ${parameter.boundary.typeSymbol}`,
          )
        }
        scope = { context: context.key, wire: parameter.wire }
      }
    }

    const mode = invocation.kind === 'direct' ? invocation.mode : undefined
    const resultType = this.remoteResultType(method, mode)
    return {
      id: `${registration.name}#${binding.namespace}/${exportedMethod}`,
      service: binding.service,
      namespace: binding.namespace,
      method: exportedMethod,
      ...(exportedMethod === methodName ? {} : { implementation: methodName }),
      ...(mode === undefined ? {} : { mode }),
      invocation: receiver,
      ...(scope === undefined ? {} : { scope }),
      parameters,
      ...(cancellation === undefined ? {} : { cancellation }),
      result: this.remoteBoundary(
        resultType,
        `${registration.name}#${binding.namespace}/${exportedMethod}:result`,
        false,
        'undefined-or-void',
      ),
      location: this.location(method.name),
    }
  }

  // 中文：解析类的网关绑定：typertRemote 字段绑定与 TypertRemoteService 继承绑定
  // 二选一，同时存在视为错误。
  private gatewayBinding(declaration: ts.ClassDeclaration): GatewayBinding | undefined {
    const field = this.gatewayFieldBinding(declaration)
    const base = this.gatewayServiceBinding(declaration)
    if (field !== undefined && base !== undefined) {
      this.fail(field.site, 'TypertRemoteService subclasses must not declare a second typertRemote binding')
    }
    return field ?? base
  }

  // 中文：解析字段式绑定：`readonly typertRemote = bindTypertRemote(this, key, options?)`；
  // 要求公开只读实例字段且初始化器必须是 bindTypertRemote 调用（1 个 this + 1~2 个参数）。
  private gatewayFieldBinding(declaration: ts.ClassDeclaration): GatewayBinding | undefined {
    const candidates = declaration.members.filter((member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) && memberName(member.name) === 'typertRemote')
    const [property, duplicate] = candidates
    if (property === undefined) return undefined
    if (duplicate !== undefined) this.fail(duplicate, 'Service has more than one typertGateway field')
    if (visibilityOf(property) !== 'public'
      || hasModifier(property, ts.SyntaxKind.StaticKeyword)
      || !hasModifier(property, ts.SyntaxKind.ReadonlyKeyword)) {
      this.fail(property, 'typertGateway must be a public readonly instance field')
    }
    if (property.initializer === undefined
      || !ts.isCallExpression(property.initializer)
      || !this.isTypeMetaSymbol(property.initializer.expression, 'bindTypertRemote')) {
      this.fail(property, 'typertGateway must call bindTypertRemote()')
    }
    const call = property.initializer
    if (call.arguments.length < 2 || call.arguments.length > 3) {
      this.fail(call, 'bindTypertRemote() requires this, service key, and an optional options object')
    }
    if (call.arguments[0]?.kind !== ts.SyntaxKind.ThisKeyword) {
      this.fail(call.arguments[0] ?? call, 'bindTypertRemote() first argument must be this')
    }
    return this.gatewayBindingArguments(call, property)
  }

  // 中文：解析继承式绑定：类 extends TypertRemoteService，构造器必须直接调用
  // super(ctx, serviceKey, options?)，从 super 调用里取绑定参数。
  private gatewayServiceBinding(declaration: ts.ClassDeclaration): GatewayBinding | undefined {
    const heritage = (declaration.heritageClauses ?? [])
      .filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap(clause => [...clause.types])
      .find(type => this.isTypeMetaSymbol(type.expression, 'TypertRemoteService'))
    if (heritage === undefined) return undefined

    const constructor = declaration.members.find(ts.isConstructorDeclaration)
    if (constructor?.body === undefined) {
      this.fail(heritage, 'TypertRemoteService subclasses must declare a constructor with super(ctx, serviceKey)')
    }
    // 中文：找到构造器里第一个直接调用 super() 的表达式语句。
    const call = constructor.body.statements.flatMap((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return []
      return statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword ? [statement.expression] : []
    })[0]
    if (call === undefined) {
      this.fail(constructor, 'TypertRemoteService constructor must call super(ctx, serviceKey) directly')
    }
    if (call.arguments.length < 2 || call.arguments.length > 3) {
      this.fail(call, 'TypertRemoteService super() requires context, service key, and an optional options object')
    }
    return this.gatewayBindingArguments(call, heritage)
  }

  // 中文：从绑定调用（bindTypertRemote 或 super）的参数里解析 service key 与可选
  // namespace：键必须是字符串字面量且是合法 RPC 分段；options 必须是只含 namespace
  // 的对象字面量。
  private gatewayBindingArguments(call: ts.CallExpression, site: ts.Node): GatewayBinding {
    const serviceArgument = call.arguments[1]
    if (serviceArgument === undefined) this.fail(call, 'Gateway service key must be a string literal')
    const service = stringLiteralValue(serviceArgument)
    if (service === undefined) this.fail(serviceArgument, 'Gateway service key must be a string literal')
    let namespace = service
    const options = call.arguments[2]
    if (options !== undefined) {
      if (!ts.isObjectLiteralExpression(options)) {
        this.fail(options, 'bindTypertRemote() options must be an object literal')
      }
      for (const propertyOption of options.properties) {
        if (!ts.isPropertyAssignment(propertyOption)
          || memberName(propertyOption.name) !== 'namespace') {
          this.fail(propertyOption, 'bindTypertRemote() only supports a namespace option')
        }
        const value = stringLiteralValue(propertyOption.initializer)
        if (value === undefined) this.fail(propertyOption.initializer, 'Gateway namespace must be a string literal')
        namespace = value
      }
    }
    if (!isRemoteSegment(service)) this.fail(serviceArgument, 'Gateway service key must contain only RPC endpoint segment characters')
    if (!isRemoteSegment(namespace)) this.fail(options ?? call, 'Gateway namespace must contain only RPC endpoint segment characters')
    return { service, namespace, site }
  }

  // 中文：识别成员上的远程装饰器标记：@Remote（直连，可选别名）、@Remote('别名')、
  // @RemoteScope('contextKey'[, '别名'])；一个方法最多一个远程装饰器。
  private remoteMarker(
    member: ts.ClassElement,
  ):
    | { readonly kind: 'direct'; readonly exportName?: string; readonly mode?: 'stream' }
    | { readonly kind: 'context'; readonly context: string; readonly exportName?: string }
    | undefined {
    let found:
      | { readonly kind: 'direct'; readonly exportName?: string; readonly mode?: 'stream' }
      | { readonly kind: 'context'; readonly context: string; readonly exportName?: string }
      | undefined
    for (const decorator of ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []) {
      const expression = decorator.expression
      let marker: typeof found
      // 中文：@Remote 无参用法。
      if (this.isTypeMetaSymbol(expression, 'Remote')) {
        marker = { kind: 'direct' }
      } else if (ts.isCallExpression(expression)
        && this.isTypeMetaSymbol(expression.expression, 'Remote')) {
        if (expression.arguments.length !== 1) this.fail(expression, 'Remote() requires one name or options object')
        const argument = expression.arguments[0]
        if (argument === undefined) this.fail(expression, 'Remote() requires one name or options object')
        const exportName = stringLiteralValue(argument)
        if (exportName !== undefined) {
          if (!isRemoteSegment(exportName)) {
            this.fail(argument, 'Remote() name must contain only RPC endpoint segment characters')
          }
          marker = { kind: 'direct', exportName }
        } else {
          if (!ts.isObjectLiteralExpression(argument) || argument.properties.length !== 1) {
            this.fail(argument, 'Remote() options must contain exactly mode: "stream"')
          }
          const [property] = argument.properties
          if (property === undefined) this.fail(argument, 'Remote() options must contain exactly mode: "stream"')
          if (!ts.isPropertyAssignment(property)
            || memberName(property.name) !== 'mode'
            || stringLiteralValue(property.initializer) !== 'stream') {
            this.fail(property, 'Remote() options must contain exactly mode: "stream"')
          }
          marker = { kind: 'direct', mode: 'stream' }
        }
      } else if (ts.isCallExpression(expression)
        && this.isTypeMetaSymbol(expression.expression, 'RemoteScope')) {
        // 中文：@RemoteScope(key[, 导出名]) 用法：key 必须已声明、可选导出名合法。
        if (expression.arguments.length < 1 || expression.arguments.length > 2) {
          this.fail(expression, 'RemoteScope() requires a Context key and optional exported method name')
        }
        const context = stringLiteralValue(expression.arguments[0])
        if (context === undefined || !isRemoteSegment(context)) {
          this.fail(expression.arguments[0] ?? expression, 'RemoteScope() key must be a string literal containing only RPC endpoint segment characters')
        }
        const exportArgument = expression.arguments[1]
        const exportName = exportArgument === undefined ? undefined : stringLiteralValue(exportArgument)
        if (exportArgument !== undefined && (exportName === undefined || !isRemoteSegment(exportName))) {
          this.fail(exportArgument, 'RemoteScope() name must be a string literal containing only RPC endpoint segment characters')
        }
        marker = { kind: 'context', context, ...exportName === undefined ? {} : { exportName } }
      } else {
        continue
      }
      if (found !== undefined) this.fail(decorator, 'a method can have only one Remote invocation decorator')
      found = marker
    }
    return found
  }

  private remoteResultType(method: ts.MethodDeclaration, mode?: 'stream'): ts.TypeNode {
    const authored = this.requiredType(method, method.type, 'return')
    if (ts.isTypeReferenceNode(authored)) {
      const symbol = this.checker.getSymbolAtLocation(authored.typeName)
      const resolved = symbol === undefined ? undefined : this.resolveSymbol(symbol)
      const resultType = authored.typeArguments?.[0]
      const wrappers = mode === 'stream' ? ['Iterable', 'AsyncIterable'] : ['Promise']
      const declaration = resolved === undefined ? undefined : preferredDeclaration(resolved)
      if (resolved !== undefined
        && wrappers.includes(resolved.name)
        && resultType !== undefined
        && authored.typeArguments?.length === 1
        && declaration !== undefined
        && isStandardLibraryFile(declaration.getSourceFile().fileName)) {
        return resultType
      }
    }
    if (mode === 'stream') {
      this.fail(method, 'stream Remote methods must return Iterable<T> or AsyncIterable<T>')
    }
    return authored
  }

  // 中文：判断类型节点是否引用"全局标准库的 AbortSignal"。
  private isGlobalAbortSignal(type: ts.TypeNode): boolean {
    const symbol = this.symbolAtType(type)
    if (symbol?.name !== 'AbortSignal') return false
    return symbol.declarations?.some(declaration =>
      isStandardLibraryFile(declaration.getSourceFile().fileName)) === true
  }

  // 中文：解析（并缓存）TypertLookupMap 的静态声明：每个条目必须是
  // `key: TypertLookup<Host, Wire>` 且 key / Host 均唯一；Host 必须是命名类型。
  private lookupDeclarations(): readonly StaticLookupDeclaration[] {
    if (this.staticLookups !== undefined) return this.staticLookups
    const byKey = new Map<string, StaticLookupDeclaration>()
    const byHost = new Map<SymbolId, StaticLookupDeclaration>()
    for (const declaration of this.typeMetaMapMembers('TypertLookupMap')) {
      if (!ts.isPropertySignature(declaration) || declaration.type === undefined) {
        this.fail(declaration, 'TypertLookupMap entries must be required properties')
      }
      const key = memberName(declaration.name)
      if (!isRemoteSegment(key)) this.fail(declaration.name, 'TypertLookupMap key must contain only RPC endpoint segment characters')
      if (!ts.isTypeReferenceNode(declaration.type)
        || !this.isTypeMetaSymbol(declaration.type.typeName, 'TypertLookup')
        || declaration.type.typeArguments?.length !== 2) {
        this.fail(declaration.type, 'TypertLookupMap values must be TypertLookup<Host, Wire>')
      }
      const hostType = declaration.type.typeArguments[0]
      const wireType = declaration.type.typeArguments[1]
      if (hostType === undefined || wireType === undefined) {
        this.fail(declaration.type, 'TypertLookupMap values must be TypertLookup<Host, Wire>')
      }
      const host = this.symbolAtType(hostType)
      if (host === undefined) this.fail(hostType, 'TypertLookup Host must be a named type')
      const entry: StaticLookupDeclaration = {
        key,
        hostSymbol: this.symbolId(host),
        wireType,
        site: declaration,
      }
      if (byKey.has(key)) this.fail(declaration, `duplicate TypertLookupMap key ${key}`)
      if (byHost.has(entry.hostSymbol)) this.fail(declaration, `Host type ${host.name} has more than one Typert lookup`)
      byKey.set(key, entry)
      byHost.set(entry.hostSymbol, entry)
    }
    this.staticLookups = [...byKey.values()]
    return this.staticLookups
  }

  // 中文：解析（并缓存）TypertContextMap 的静态声明：每个条目必须是
  // `key: TypertContext<Wire>` 且 key 唯一。
  private contextDeclarations(): ReadonlyMap<string, StaticContextDeclaration> {
    if (this.staticContexts !== undefined) return this.staticContexts
    const result = new Map<string, StaticContextDeclaration>()
    for (const declaration of this.typeMetaMapMembers('TypertContextMap')) {
      if (!ts.isPropertySignature(declaration) || declaration.type === undefined) {
        this.fail(declaration, 'TypertContextMap entries must be required properties')
      }
      const key = memberName(declaration.name)
      if (!isRemoteSegment(key)) this.fail(declaration.name, 'TypertContextMap key must contain only RPC endpoint segment characters')
      if (!ts.isTypeReferenceNode(declaration.type)
        || !this.isTypeMetaSymbol(declaration.type.typeName, 'TypertContext')
        || declaration.type.typeArguments?.length !== 1) {
        this.fail(declaration.type, 'TypertContextMap values must be TypertContext<Wire>')
      }
      if (result.has(key)) this.fail(declaration, `duplicate TypertContextMap key ${key}`)
      const wireType = declaration.type.typeArguments[0]
      if (wireType === undefined) this.fail(declaration.type, 'TypertContextMap values must be TypertContext<Wire>')
      result.set(key, {
        key,
        wireType,
        site: declaration,
      })
    }
    this.staticContexts = result
    return result
  }

  // 中文：从 Program 的 `declare module '@deepseek-ai/dsh-typert-protocol'` 模块扩充里
  // 收集指定可合并映射表（TypertLookupMap / TypertContextMap）的成员。
  private typeMetaMapMembers(name: 'TypertLookupMap' | 'TypertContextMap'): ts.TypeElement[] {
    const result: ts.TypeElement[] = []
    for (const sourceFile of this.program.getSourceFiles()) {
      for (const statement of sourceFile.statements) {
        if (!ts.isModuleDeclaration(statement)
          || !ts.isStringLiteral(statement.name)
          || statement.name.text !== '@deepseek-ai/dsh-typert-protocol'
          || statement.body === undefined
          || !ts.isModuleBlock(statement.body)) continue
        for (const nested of statement.body.statements) {
          if (ts.isInterfaceDeclaration(nested) && nested.name.text === name) result.push(...nested.members)
        }
      }
    }
    return result
  }

  // 中文：把"作者书写的边界类型"投影成 RemoteBoundaryModel：type 是作者类型（供消费端
  // 声明引用），codecType 是"解析后的具体类型"（供发射运行时 codec）；同时收集边界里
  // 引用的公开类型导入。requireNamed = true 时要求根类型是命名公开类型。
  private remoteBoundary(
    authoredType: ts.TypeNode,
    fallbackTypeSymbol: string,
    requireNamed: boolean,
    topLevelAbsence: 'reject' | 'undefined' | 'undefined-or-void' = 'reject',
    optional = false,
  ): RemoteBoundaryModel {
    const type = this.convertType(authoredType)
    const declaredType = this.checker.getTypeFromTypeNode(authoredType)
    // An optional parameter's authored node carries no `undefined`; the codec
    // still has to accept the omitted wire field the consumer sends.
    // 中文：可选参数的作者节点不含 undefined，但 codec 仍必须接受消费端省略该字段
    // 的情况，因此这里显式把 undefined 并入解析后的类型。
    const resolvedType = optional
      ? this.checker.getNullableType(declaredType, ts.TypeFlags.Undefined)
      : declaredType
    const codecType = this.resolvedRemoteCodecType(authoredType, resolvedType, topLevelAbsence)
    const acceptsUndefined = topLevelAbsence !== 'reject' && this.includesRemoteAbsence(resolvedType)
    const rootSymbol = this.namedWorkspaceType(authoredType)
    // 中文：遍历作者类型树，收集所有"属于本工作区包"的类型引用作为导入需求。
    const imports = new Map<SymbolId, RemoteTypeImportModel>()
    const visit = (node: ts.Node): void => {
      if ((ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node))) {
        const symbol = ts.isTypeReferenceNode(node)
          ? this.checker.getSymbolAtLocation(node.typeName)
          : node.qualifier === undefined ? undefined : this.checker.getSymbolAtLocation(node.qualifier)
        if (symbol !== undefined) {
          const resolved = this.resolveSymbol(symbol)
          const declaration = preferredDeclaration(resolved)
          if (declaration !== undefined
            && !isStandardLibraryFile(declaration.getSourceFile().fileName)
            && this.registrationForFile(declaration.getSourceFile().fileName) !== undefined) {
            const imported = this.publicRemoteType(resolved, node)
            imports.set(imported.symbol, imported)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(authoredType)
    if (rootSymbol !== undefined) {
      // 中文：根类型是工作区命名类型时，typeSymbol 用它的公开导入身份（包#名）。
      const imported = this.publicRemoteType(rootSymbol, authoredType)
      return {
        type,
        codecType,
        acceptsUndefined,
        typeSymbol: `${imported.specifier}#${imported.name}`,
        imports: [...imports.values()].sort((left, right) =>
          left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name)),
      }
    }
    if (requireNamed) this.fail(authoredType, 'lookup and Context wire types must be named public types')
    return {
      type,
      codecType,
      acceptsUndefined,
      typeSymbol: fallbackTypeSymbol,
      imports: [...imports.values()].sort((left, right) =>
        left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name)),
    }
  }

  /**
   * Project one authored Remote boundary through the complete face Program.
   * Consumer declarations retain the authored alias, while codecs use this
   * concrete graph so declaration-merged mapped and conditional types are
   * validated without teaching the compiler-independent emitter TypeScript's
   * type evaluator.
   */
  // 中文：把作者书写的 Remote 边界投影成"解析后的具体类型图"：消费端声明保留作者别名，
  // 而 codec 用这份具体图，这样声明合并出的映射 / 条件类型也能被校验，而不必给
  // 编译器无关的发射器引入 TypeScript 的类型求值器。先做 JSON 可序列化断言，再把
  // checker 的 ts.Type 递归转换成类型图节点（带活动集处理递归类型）。
  private resolvedRemoteCodecType(
    authoredType: ts.TypeNode,
    resolvedType: ts.Type,
    topLevelAbsence: 'reject' | 'undefined' | 'undefined-or-void',
  ): TypeNodeId {
    this.assertRemoteJsonType(
      resolvedType,
      authoredType,
      new Set(),
      topLevelAbsence !== 'reject',
      topLevelAbsence === 'undefined-or-void',
    )
    const completed = new Map<ts.Type, TypeNodeId>()
    const active = new Map<ts.Type, TypeNodeId>()
    const recursiveDeclarations = new Map<ts.Type, SymbolId>()
    // 中文：递归转换：已完成表防重复；活动表记录"正在转换的类型"用于检测递归结构
    // （递归处用 z.lazy 风格的名引用，即 resolvedCycleReference 生成的别名声明）。
    const convert = (type: ts.Type): TypeNodeId => {
      const cached = completed.get(type)
      if (cached !== undefined) return cached
      const activeId = active.get(type)
      if (activeId !== undefined) {
        // 中文：类型正在转换中再次出现 = 递归；数组递归可直接生成 array 节点引用元素，
        // 其余递归类型生成"RemoteCodec 别名声明"引用。
        if (this.checker.isArrayType(type) || this.checker.isArrayLikeType(type)) {
          const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number)
          const elementId = element === undefined ? undefined : active.get(element)
          if (element !== undefined && elementId !== undefined) {
            return this.addNode(authoredType, {
              kind: 'array',
              element: this.resolvedCycleReference(
                element,
                authoredType,
                elementId,
                recursiveDeclarations,
              ),
            })
          }
        }
        return this.resolvedCycleReference(type, authoredType, activeId, recursiveDeclarations)
      }
      const id = this.allocateNodeId(authoredType)
      active.set(type, id)
      try {
        const add = (model: TypeNodeInput): TypeNodeId => {
          this.nodes.set(id, { id, ...model })
          completed.set(type, id)
          return id
        }
        const flags = type.flags
        // 中文：按类型标志逐个映射：关键字 / 字面量 / 联合交叉 / 元组 / 数组 / 对象成员。
        if ((flags & ts.TypeFlags.Any) !== 0) return add({ kind: 'keyword', name: 'any' })
        if ((flags & ts.TypeFlags.Unknown) !== 0) return add({ kind: 'keyword', name: 'unknown' })
        if ((flags & ts.TypeFlags.Never) !== 0) return add({ kind: 'keyword', name: 'never' })
        if ((flags & ts.TypeFlags.String) !== 0) return add({ kind: 'keyword', name: 'string' })
        if ((flags & ts.TypeFlags.Number) !== 0) return add({ kind: 'keyword', name: 'number' })
        if ((flags & ts.TypeFlags.BigInt) !== 0) return add({ kind: 'keyword', name: 'bigint' })
        if ((flags & ts.TypeFlags.Boolean) !== 0) return add({ kind: 'keyword', name: 'boolean' })
        if ((flags & ts.TypeFlags.ESSymbol) !== 0) return add({ kind: 'keyword', name: 'symbol' })
        if ((flags & ts.TypeFlags.Undefined) !== 0) return add({ kind: 'keyword', name: 'undefined' })
        if ((flags & ts.TypeFlags.Void) !== 0) return add({ kind: 'keyword', name: 'void' })
        if ((flags & ts.TypeFlags.Null) !== 0) return add({ kind: 'literal', value: null, text: 'null' })
        if ((flags & ts.TypeFlags.StringLiteral) !== 0) {
          const value = (type as ts.StringLiteralType).value
          return add({ kind: 'literal', value, text: JSON.stringify(value) })
        }
        if ((flags & ts.TypeFlags.NumberLiteral) !== 0) {
          const value = (type as ts.NumberLiteralType).value
          return add({ kind: 'literal', value, text: String(value) })
        }
        if ((flags & ts.TypeFlags.BigIntLiteral) !== 0) {
          const value = (type as ts.BigIntLiteralType).value
          const text = `${value.negative ? '-' : ''}${value.base10Value}n`
          return add({ kind: 'literal', value: BigInt(`${value.negative ? '-' : ''}${value.base10Value}`), text })
        }
        if ((flags & ts.TypeFlags.BooleanLiteral) !== 0) {
          const value = (type as ts.Type & { readonly intrinsicName?: string }).intrinsicName === 'true'
          return add({ kind: 'literal', value, text: String(value) })
        }
        if (type.isUnionOrIntersection()) {
          return add({
            kind: (flags & ts.TypeFlags.Union) !== 0 ? 'union' : 'intersection',
            types: type.types.map(convert),
          })
        }
        if ((flags & ts.TypeFlags.TypeParameter) !== 0) {
          this.fail(authoredType, 'Remote codec contains an unresolved type parameter')
        }
        if ((flags & ts.TypeFlags.Object) === 0) {
          this.fail(
            authoredType,
            `Remote codec type ${this.checker.typeToString(type, authoredType, ts.TypeFormatFlags.NoTruncation)} has no concrete Zod projection`,
          )
        }
        if (this.checker.isTupleType(type)) {
          const reference = type as ts.TypeReference
          const target = reference.target as ts.TupleType
          const arguments_ = this.checker.getTypeArguments(reference)
          return add({
            kind: 'tuple',
            elements: arguments_.map((argument, index) => {
              const elementFlags = target.elementFlags[index] ?? ts.ElementFlags.Required
              return {
                type: convert(argument),
                optional: (elementFlags & ts.ElementFlags.Optional) !== 0,
                rest: (elementFlags & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)) !== 0,
              }
            }),
          })
        }
        if (this.checker.isArrayType(type) || this.checker.isArrayLikeType(type)) {
          const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number)
          if (element === undefined) this.fail(authoredType, 'Remote codec array has no element type')
          return add({ kind: 'array', element: convert(element) })
        }
        if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
          this.fail(authoredType, 'Remote codec cannot contain callable or constructable values')
        }
        // 中文：对象类型：把属性与索引签名逐个转成成员模型（symbol 键记为 computed）。
        const members: MemberModel[] = []
        for (const property of this.checker.getPropertiesOfType(type)) {
          const declaration = property.valueDeclaration ?? property.declarations?.[0]
          const propertyType = this.checker.getTypeOfSymbolAtLocation(property, declaration ?? authoredType)
          const symbolKey = property.getName()
          members.push({
            ...EMPTY_DOCUMENTATION,
            id: `${id}#${symbolKey}`,
            name: symbolKey,
            ...(symbolKey.startsWith('__@') ? { computed: 'symbol' as const } : {}),
            optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
            readonly: declaration !== undefined && hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword),
            async: false,
            abstract: false,
            static: false,
            visibility: 'public',
            location: this.location(authoredType),
            text: '',
            kind: 'property',
            type: convert(propertyType),
          })
        }
        for (const [index, info] of this.checker.getIndexInfosOfType(type).entries()) {
          members.push({
            ...EMPTY_DOCUMENTATION,
            id: `${id}#index:${String(index)}`,
            name: '(index)',
            optional: false,
            readonly: info.isReadonly,
            async: false,
            abstract: false,
            static: false,
            visibility: 'public',
            location: this.location(authoredType),
            text: '',
            kind: 'index',
            signature: {
              typeParameters: [],
              parameters: [{
                name: 'key',
                binding: 'identifier',
                type: convert(info.keyType),
                optional: false,
                rest: false,
                receiver: false,
              }],
              returns: convert(info.type),
            },
          })
        }
        return add({ kind: 'object', members })
      } finally {
        active.delete(type)
      }
    }
    return convert(resolvedType)
  }

  // 中文：断言一个 ts.Type 可以安全地跨进程以 JSON 传输：显式允许 undefined / void
  //（按策略）；any / unknown、bigint / symbol、类实例、可调用值、symbol 键属性等
  // 一律失败；联合 / 交叉 / 元组 / 数组 / 对象递归检查（带活动集防环）。
  private assertRemoteJsonType(
    type: ts.Type,
    site: ts.TypeNode,
    active: Set<ts.Type>,
    allowUndefined: boolean,
    allowVoid: boolean,
  ): void {
    const flags = type.flags
    if ((flags & ts.TypeFlags.Undefined) !== 0 && allowUndefined) return
    if ((flags & ts.TypeFlags.Void) !== 0 && allowVoid) return
    if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      this.fail(site, `Remote boundary contains unconstrained ${this.checker.typeToString(type)} data`)
    }
    if ((flags & (ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
      this.fail(site, `Remote boundary contains non-JSON type ${this.checker.typeToString(type)}`)
    }
    if ((flags & (ts.TypeFlags.StringLike
      | ts.TypeFlags.NumberLike
      | ts.TypeFlags.BooleanLike
      | ts.TypeFlags.Null
      | ts.TypeFlags.Never)) !== 0) return
    if (type.isUnion()) {
      for (const member of type.types) {
        this.assertRemoteJsonType(member, site, active, allowUndefined, allowVoid)
      }
      return
    }
    if (type.isIntersection()) {
      // 中文：交叉类型里只检查"实质成员"：幻影约束（纯 symbol 键对象）不参与 JSON 形状。
      const material = type.types.filter(member => !this.isRemotePhantomConstraint(member))
      if (material.length === 0) this.fail(site, 'Remote boundary contains a symbol-only object')
      for (const member of material) this.assertRemoteJsonType(member, site, active, false, false)
      return
    }
    if ((flags & ts.TypeFlags.TypeParameter) !== 0) {
      this.fail(site, 'Remote boundary contains an unresolved type parameter')
    }
    if ((flags & ts.TypeFlags.Object) === 0) {
      this.fail(site, `Remote boundary contains non-JSON type ${this.checker.typeToString(type)}`)
    }
    const symbol = type.getSymbol()
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    // 中文：类实例（哪怕是对象形状）不能直接 JSON 化，必须走 lookup。
    if (declaration !== undefined && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
      this.fail(site, `Remote boundary contains class instance ${symbol?.name ?? this.checker.typeToString(type)}`)
    }
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
      this.fail(site, 'Remote boundary contains callable or constructable data')
    }
    if (active.has(type)) return
    active.add(type)
    try {
      if (this.checker.isTupleType(type)) {
        const reference = type as ts.TypeReference
        const target = reference.target as ts.TupleType
        const arguments_ = this.checker.getTypeArguments(reference)
        arguments_.forEach((argument, index) => {
          const elementFlags = target.elementFlags[index] ?? ts.ElementFlags.Required
          this.assertRemoteJsonType(
            argument,
            site,
            active,
            (elementFlags & ts.ElementFlags.Optional) !== 0,
            false,
          )
        })
        return
      }
      if (this.checker.isArrayType(type) || this.checker.isArrayLikeType(type)) {
        const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number)
        if (element === undefined) this.fail(site, 'Remote boundary array has no element type')
        this.assertRemoteJsonType(element, site, active, false, false)
        return
      }
      const properties = this.checker.getPropertiesOfType(type)
      if (properties.some(property => property.getName().startsWith('__@'))) {
        this.fail(site, 'Remote boundary contains a symbol-keyed property')
      }
      for (const property of properties) {
        const propertyDeclaration = property.valueDeclaration ?? property.declarations?.[0]
        const propertyType = this.checker.getTypeOfSymbolAtLocation(property, propertyDeclaration ?? site)
        this.assertRemoteJsonType(
          propertyType,
          site,
          active,
          (property.flags & ts.SymbolFlags.Optional) !== 0,
          false,
        )
      }
      for (const info of this.checker.getIndexInfosOfType(type)) {
        if ((info.keyType.flags & ts.TypeFlags.ESSymbolLike) !== 0) {
          this.fail(site, 'Remote boundary contains a symbol index signature')
        }
        this.assertRemoteJsonType(info.type, site, active, false, false)
      }
    } finally {
      active.delete(type)
    }
  }

  // 中文：判断类型里是否含 undefined / void（顶层或联合成员），用于决定 acceptsUndefined。
  private includesRemoteAbsence(type: ts.Type): boolean {
    if ((type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) return true
    return type.isUnion() && type.types.some(member => this.includesRemoteAbsence(member))
  }

  // 中文：判断一个类型是否为"幻影约束"（只有 symbol 键属性的对象、无调用/构造/索引签名）：
  // 它只用于品牌标记，不构成 JSON 数据形状，交叉时被排除。
  private isRemotePhantomConstraint(type: ts.Type): boolean {
    if ((type.flags & ts.TypeFlags.Unknown) !== 0) return true
    if ((type.flags & ts.TypeFlags.Any) !== 0 || (type.flags & ts.TypeFlags.Object) === 0) return false
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false
    if (this.checker.getIndexInfosOfType(type).length > 0) return false
    return this.checker.getPropertiesOfType(type).every(property => property.getName().startsWith('__@'))
  }

  // 中文：把递归类型"转正"成一个命名别名声明：为解析后的递归类型生成
  // `<原类型名>RemoteCodec` 的 alias 声明（其右侧就是正在构建中的节点 id），
  // 引用处返回指向该别名的 reference 节点，从而打破转换死循环。
  private resolvedCycleReference(
    type: ts.Type,
    site: ts.TypeNode,
    resolvedType: TypeNodeId,
    recursiveDeclarations: Map<ts.Type, SymbolId>,
  ): TypeNodeId {
    const symbol = type.aliasSymbol ?? type.getSymbol()
    if (symbol === undefined) this.fail(site, 'Remote codec contains an unnamed recursive type')
    const resolved = this.resolveSymbol(symbol)
    const declaration = preferredDeclaration(resolved)
    // 中文：递归类型必须是本工作区的命名类型（标准库 / 无声明者无法生成别名）。
    if (declaration === undefined || isStandardLibraryFile(declaration.getSourceFile().fileName)) {
      this.fail(site, `Remote codec recursive type ${resolved.name} has no workspace declaration`)
    }
    const owner = this.registrationForFile(declaration.getSourceFile().fileName)
    if (owner === undefined) this.fail(site, `Remote codec recursive type ${resolved.name} is not owned by this face`)
    let id = recursiveDeclarations.get(type)
    if (id === undefined) {
      id = `${this.symbolId(resolved)}#remote-codec:${resolvedType}`
      recursiveDeclarations.set(type, id)
      this.declarations.set(id, {
        ...EMPTY_DOCUMENTATION,
        id,
        package: owner.name,
        name: `${resolved.name}RemoteCodec`,
        kind: 'alias',
        abstract: false,
        exported: false,
        location: this.location(declaration),
        text: '',
        typeParameters: [],
        extends: [],
        implements: [],
        members: [],
        type: resolvedType,
      })
    }
    return this.addNode(site, {
      kind: 'reference',
      name: `${resolved.name}RemoteCodec`,
      target: { kind: 'declaration', symbol: id },
      arguments: [],
    })
  }

  // 中文：取作者类型节点的"根命名工作区类型"：类型必须是命名引用（TypeReference /
  // ImportType）且解析到本工作区包的声明；否则返回 undefined。
  private namedWorkspaceType(node: ts.TypeNode): ts.Symbol | undefined {
    if (!ts.isTypeReferenceNode(node) && !ts.isImportTypeNode(node)) return undefined
    const symbol = ts.isTypeReferenceNode(node)
      ? this.checker.getSymbolAtLocation(node.typeName)
      : node.qualifier === undefined ? undefined : this.checker.getSymbolAtLocation(node.qualifier)
    if (symbol === undefined) return undefined
    const resolved = this.resolveSymbol(symbol)
    const declaration = preferredDeclaration(resolved)
    if (declaration === undefined
      || isStandardLibraryFile(declaration.getSourceFile().fileName)
      || this.registrationForFile(declaration.getSourceFile().fileName) === undefined) return undefined
    return resolved
  }

  // 中文：为一个边界类型符号找"公开导入身份"：它必须从所属包的某个"非根非 typert 产物"
  // 子路径公开导出（选字典序最小的那个），供生成的 Remote 声明 import。
  private publicRemoteType(symbol: ts.Symbol, site: ts.Node): RemoteTypeImportModel {
    const declaration = preferredDeclaration(symbol)
    if (declaration === undefined) this.fail(site, `type ${symbol.name} has no declaration`)
    const registration = this.registrationForFile(declaration.getSourceFile().fileName)
    if (registration === undefined) this.fail(site, `type ${symbol.name} is not owned by a workspace package`)
    const candidates: RemoteTypeImportModel[] = []
    for (const [subpath, target] of packageExportTargets(registration.manifest)) {
      if (subpath === '.' || subpath === './package.json' || subpath === './typert'
        || subpath === './client/typert' || subpath === './remote' || target.includes('*')) continue
      const sourceFile = this.sourceFiles.get(realPath(sourcePathForExport(registration.root, target)))
      if (sourceFile === undefined) continue
      const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) continue
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        if (this.resolveSymbol(exported) !== symbol) continue
        candidates.push({
          symbol: this.symbolId(symbol),
          specifier: packageExportSpecifier(registration.name, subpath),
          name: exported.name,
        })
      }
    }
    const selected = candidates.sort((left, right) =>
      left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name))[0]
    if (selected === undefined) {
      this.fail(site, `Remote boundary type ${symbol.name} must be exported from a public non-root type subpath`)
    }
    return selected
  }

  // 中文：判断符号是否为"本工作区包的类"（用于拦截未声明 lookup 的非 JSON 类参数）。
  private isWorkspaceClass(symbol: ts.Symbol): boolean {
    const declaration = preferredDeclaration(symbol)
    return declaration !== undefined
      && ts.isClassDeclaration(declaration)
      && this.registrationForFile(declaration.getSourceFile().fileName) !== undefined
  }

  // 中文：判断一个 AST 节点是否引用"typert-protocol 包导出的指定符号"（如 Remote、
  // bindTypertRemote、TypertLookup）：先解析符号名，再确认声明属于该包（或位于该包的
  // 模块扩充声明里）。
  private isTypeMetaSymbol(node: ts.Node, name: string): boolean {
    const symbol = this.checker.getSymbolAtLocation(node)
    if (symbol === undefined) return false
    const resolved = this.resolveSymbol(symbol)
    if (resolved.name !== name) return false
    const declaration = preferredDeclaration(resolved)
    if (declaration === undefined) return false
    const registration = this.registrationForFile(declaration.getSourceFile().fileName)
    if (registration?.name === '@deepseek-ai/dsh-typert-protocol') return true
    for (let current: ts.Node | undefined = declaration; current !== undefined; current = optionalParent(current)) {
      if (ts.isModuleDeclaration(current)
        && ts.isStringLiteral(current.name)
        && current.name.text === '@deepseek-ai/dsh-typert-protocol') return true
    }
    return false
  }

  // 中文：校验远程调用身份全局唯一：同一面上任何两个调用的 endpoint
  //（namespace/method）与 id 都不得冲突，否则网关无法路由。
  private validateInvocationIdentity(packages: readonly PackageModel[]): void {
    const endpoints = new Map<string, InvocationModel>()
    const ids = new Map<string, InvocationModel>()
    for (const invocation of packages.flatMap(packageModel => packageModel.invocations)) {
      const endpoint = `${invocation.namespace}/${invocation.method}`
      const existingEndpoint = endpoints.get(endpoint)
      if (existingEndpoint !== undefined) {
        throw new TypertAnalysisError(
          `typert(${this.face}): ${invocation.location.file}:${String(invocation.location.line)}:${String(invocation.location.column)}: Remote endpoint ${endpoint} conflicts with ${existingEndpoint.id}`,
        )
      }
      const existingId = ids.get(invocation.id)
      if (existingId !== undefined) {
        throw new TypertAnalysisError(
          `typert(${this.face}): ${invocation.location.file}:${String(invocation.location.line)}:${String(invocation.location.column)}: Remote invocation id ${invocation.id} conflicts with ${existingId.id}`,
        )
      }
      endpoints.set(endpoint, invocation)
      ids.set(invocation.id, invocation)
    }
  }

  // 中文：从 `interface Events` 收集事件：方法签名成员与"带类型的属性签名"都算事件，
  // 保留 JSDoc 文档、@mode 标签、签名文本与源位置。
  private collectEvents(events: ts.InterfaceDeclaration): EventModel[] {
    const result: EventModel[] = []
    for (const member of events.members) {
      const documentation = documentationOf(member)
      const mode = documentation.tags.find(tag => tag.name === 'mode')?.comment?.trim()
      if (ts.isMethodSignature(member)) {
        const signature = this.signature(member, member.type)
        result.push({
          ...documentation,
          name: memberName(member.name),
          signature: this.addNode(member, { kind: 'function', signature }),
          text: memberText(member),
          ...(mode === undefined ? {} : { mode }),
          location: this.location(member),
        })
      } else if (ts.isPropertySignature(member) && member.type !== undefined) {
        result.push({
          ...documentation,
          name: memberName(member.name),
          signature: this.convertType(member.type),
          text: memberText(member),
          ...(mode === undefined ? {} : { mode }),
          location: this.location(member),
        })
      }
    }
    return result
  }

  // 中文：确保一个符号的声明被提取成 TypeDeclarationModel（已存在则复用）。处理合并
  // 接口（多个声明片段合并成一个模型、泛型参数合并）；枚举 / 别名 / 类 / 接口分别
  // 组装；用 declarationStates 标记"正在构建"，防循环。
  private ensureDeclaration(
    symbol: ts.Symbol,
    selected: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  ): TypeDeclarationModel {
    const resolved = this.resolveSymbol(symbol)
    const id = this.symbolId(resolved)
    const existing = this.declarations.get(id)
    if (existing !== undefined) return existing
    const declarationParts = (resolved.declarations as ts.Declaration[]).filter(isTypeDeclaration)
    // 中文：多个声明片段只允许"全部是接口"（接口合并合法），其余合并形态不支持。
    if (declarationParts.length > 1 && !declarationParts.every(ts.isInterfaceDeclaration)) {
      this.fail(
        selected,
        `merged ${ts.SyntaxKind[selected.kind]} declaration ${resolved.name} is not supported`,
      )
    }
    if (selected.name === undefined) {
      this.fail(selected, `anonymous ${ts.SyntaxKind[selected.kind]} cannot be represented as a named type declaration`)
    }
    const owner = this.registrationForFile(selected.getSourceFile().fileName) as PackageRegistration

    this.declarationStates.add(id)
    if (declarationParts.length > 1) {
      // 中文：合并接口：逐片段分析（各自的位置、泛型、继承、成员），再合并泛型参数，
      // 成员平铺，parts 保留各片段模型。
      const analyzedParts = declarationParts.map((declarationPart) => {
        const part = declarationPart as ts.InterfaceDeclaration
        const partOwner = this.registrationForFile(part.getSourceFile().fileName)
        if (partOwner === undefined) {
          this.fail(part, `merged interface ${resolved.name} contains a declaration outside this face`)
        }
        const typeParameters = this.typeParameters(part.typeParameters)
        const heritage = this.heritage(part)
        const members = this.members(part.members, id)
        return {
          typeParameters,
          heritage,
          members,
          model: {
            ...documentationOf(part),
            package: partOwner.name,
            location: this.location(part),
            typeParameters,
            extends: heritage.extends,
            members: members.map(member => member.id),
          },
        }
      })
      const parameters = this.mergeTypeParameters(analyzedParts.map(part => part.typeParameters), selected, resolved.name)
      const model: TypeDeclarationModel = {
        ...documentationOf(selected),
        id,
        package: owner.name,
        name: declarationName(selected),
        kind: 'interface',
        abstract: false,
        exported: hasModifier(selected, ts.SyntaxKind.ExportKeyword),
        location: this.location(selected),
        text: declarationText(selected),
        typeParameters: parameters,
        extends: analyzedParts.flatMap(part => part.heritage.extends),
        implements: [],
        members: analyzedParts.flatMap(part => part.members),
        parts: analyzedParts.map(part => part.model),
      }
      this.declarations.set(id, model)
      this.declarationStates.delete(id)
      return model
    }
    // 中文：单声明：按种类组装（枚举无泛型 / 继承；别名含右侧类型；类接口含成员与继承）。
    const parameters = ts.isEnumDeclaration(selected) ? [] : this.typeParameters(selected.typeParameters)
    const heritage = ts.isTypeAliasDeclaration(selected) || ts.isEnumDeclaration(selected)
      ? { extends: [] as TypeNodeId[], implements: [] as TypeNodeId[] }
      : this.heritage(selected)
    const kind = ts.isClassDeclaration(selected)
      ? 'class'
      : ts.isInterfaceDeclaration(selected)
        ? 'interface'
        : ts.isTypeAliasDeclaration(selected)
          ? 'alias'
          : 'enum'
    const model: TypeDeclarationModel = {
      ...documentationOf(selected),
      id,
      package: owner.name,
      name: declarationName(selected),
      kind,
      abstract: hasModifier(selected, ts.SyntaxKind.AbstractKeyword),
      exported: hasModifier(selected, ts.SyntaxKind.ExportKeyword),
      location: this.location(selected),
      text: declarationText(selected),
      typeParameters: parameters,
      extends: heritage.extends,
      implements: heritage.implements,
      members: ts.isTypeAliasDeclaration(selected) || ts.isEnumDeclaration(selected)
        ? []
        : this.members(selected.members, id),
      ...(ts.isTypeAliasDeclaration(selected) ? { type: this.convertType(selected.type) } : {}),
      ...(ts.isEnumDeclaration(selected) ? { enumMembers: this.enumMembers(selected) } : {}),
    }
    this.declarations.set(id, model)
    this.declarationStates.delete(id)
    return model
  }

  // 中文：提取枚举成员：名字、可选初始化器文本与位置。
  private enumMembers(declaration: ts.EnumDeclaration): EnumMemberModel[] {
    return declaration.members.map(member => ({
      ...documentationOf(member),
      name: memberName(member.name),
      ...(member.initializer === undefined ? {} : { initializer: member.initializer.getText() }),
      location: this.location(member),
    }))
  }

  // 中文：提取类 / 接口的继承信息：extends 与 implements 各自转换成引用节点列表。
  private heritage(
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
  ): { extends: TypeNodeId[]; implements: TypeNodeId[] } {
    const result = { extends: [] as TypeNodeId[], implements: [] as TypeNodeId[] }
    for (const clause of declaration.heritageClauses ?? []) {
      const target = clause.token === ts.SyntaxKind.ExtendsKeyword ? result.extends : result.implements
      for (const type of clause.types) target.push(this.convertHeritage(type))
    }
    return result
  }

  // 中文：把继承子句（ExpressionWithTypeArguments）转换成引用节点。
  private convertHeritage(node: ts.ExpressionWithTypeArguments): TypeNodeId {
    const symbol = this.checker.getSymbolAtLocation(node.expression) as ts.Symbol
    return this.addNode(node, {
      kind: 'reference',
      name: node.expression.getText(),
      target: this.targetForReference(this.resolveSymbol(symbol), node),
      arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
    })
  }

  // 中文：提取成员的模型列表：跳过 typertRemote 绑定字段、带函数体的方法（被无体签名
  // 覆盖的）、非公开 / static / 构造器成员；按成员形态分流成属性 / 方法 / 访问器 /
  // 调用 / 构造 / 索引签名。
  private members(
    members: ts.NodeArray<ts.TypeElement | ts.ClassElement>,
    ownerId: string,
  ): MemberModel[] {
    const result: MemberModel[] = []
    for (const member of members) {
      // 中文：typertRemote 绑定字段是内部接线，不进公开模型。
      if (ts.isPropertyDeclaration(member)
        && memberName(member.name) === 'typertRemote'
        && member.initializer !== undefined
        && ts.isCallExpression(member.initializer)
        && this.isTypeMetaSymbol(member.initializer.expression, 'bindTypertRemote')) continue
      // 中文：同一名字既有实现方法又有签名声明时，签名声明胜出（实现体不进模型）。
      if (ts.isMethodDeclaration(member) && member.body !== undefined
        && members.some(candidate => candidate !== member
          && (ts.isMethodDeclaration(candidate) || ts.isMethodSignature(candidate))
          && memberName(candidate.name) === memberName(member.name)
          && (!ts.isMethodDeclaration(candidate) || candidate.body === undefined))) continue
      const visibility = visibilityOf(member)
      const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword)
      if (visibility !== 'public' || isStatic || ts.isConstructorDeclaration(member)) continue
      const base = this.memberBase(member, ownerId, visibility, isStatic)
      if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
        const type = this.requiredType(member, member.type, 'property')
        result.push({ ...base, kind: 'property', type: this.convertType(type) })
      } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
        result.push({ ...base, kind: 'method', signature: this.signature(member, member.type) })
      } else if (ts.isGetAccessorDeclaration(member)) {
        result.push({ ...base, kind: 'getter', signature: this.signature(member, member.type) })
      } else if (ts.isSetAccessorDeclaration(member)) {
        result.push({ ...base, kind: 'setter', signature: this.signature(member, member.type) })
      } else if (ts.isCallSignatureDeclaration(member)) {
        result.push({ ...base, kind: 'call', signature: this.signature(member, member.type) })
      } else if (ts.isConstructSignatureDeclaration(member)) {
        result.push({ ...base, kind: 'construct', signature: this.signature(member, member.type) })
      } else if (ts.isIndexSignatureDeclaration(member)) {
        result.push({ ...base, kind: 'index', signature: this.signature(member, member.type) })
      }
    }
    return result
  }

  // 中文：构造成员的公共字段（MemberBase）：文档、稳定 id（所有者 id + 名字 + 源码偏移）、
  // 名字、可选 / 只读 / async / abstract / static / 可见性、位置与无体文本。
  private memberBase(
    member: ts.TypeElement | ts.ClassElement,
    ownerId: string,
    visibility: MemberVisibility,
    isStatic: boolean,
  ): MemberBase {
    const identity = member.name !== undefined
      ? this.memberIdentity(member.name)
      : {
        name: ts.isCallSignatureDeclaration(member)
          ? '(call)'
          : ts.isConstructSignatureDeclaration(member)
            ? '(construct)'
            : '(index)',
      }
    return {
      ...documentationOf(member),
      id: `${ownerId}#${identity.name}@${String(member.getStart())}`,
      ...identity,
      optional: 'questionToken' in member && member.questionToken !== undefined,
      readonly: hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
      async: hasModifier(member, ts.SyntaxKind.AsyncKeyword),
      abstract: hasModifier(member, ts.SyntaxKind.AbstractKeyword),
      static: isStatic,
      visibility,
      location: this.location(member),
      text: memberText(member),
    }
  }

  // 中文：解析成员名身份：普通名字直接返回；字面量计算键（字符串 / 数字 / 模板）记
  // jsonName；其余计算键按 checker 类型区分 symbol（品牌键）与 dynamic。
  private memberIdentity(name: ts.PropertyName): Pick<MemberBase, 'name' | 'jsonName' | 'computed'> {
    if (!ts.isComputedPropertyName(name)) return { name: memberName(name) }
    const expression = name.expression
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)
      || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { name: memberName(name), jsonName: expression.text }
    }
    const type = this.checker.getTypeAtLocation(expression)
    return {
      name: memberName(name),
      computed: (type.flags & ts.TypeFlags.UniqueESSymbol) !== 0 ? 'symbol' : 'dynamic',
    }
  }

  // 中文：提取函数签名模型：参数（名字、绑定形态、类型、可选 / 剩余 / 接收者、默认值）
  // + 泛型参数 + 返回类型（setter 返回 void）。
  private signature(
    node: ts.SignatureDeclarationBase,
    explicitReturn: ts.TypeNode | undefined,
  ): SignatureModel {
    const parameters: ParameterModel[] = node.parameters.map(parameter => ({
      name: memberName(parameter.name),
      binding: ts.isIdentifier(parameter.name)
        ? 'identifier'
        : ts.isObjectBindingPattern(parameter.name)
          ? 'object'
          : 'array',
      type: this.convertType(this.requiredType(parameter, parameter.type, 'parameter')),
      optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
      rest: parameter.dotDotDotToken !== undefined,
      receiver: ts.isIdentifier(parameter.name) && parameter.name.text === 'this',
      ...(parameter.initializer === undefined ? {} : { initializer: parameter.initializer.getText() }),
    }))
    return {
      typeParameters: this.typeParameters(node.typeParameters),
      parameters,
      returns: ts.isSetAccessorDeclaration(node)
        ? this.addNode(node, { kind: 'keyword', name: 'void' })
        : this.convertType(this.requiredType(node, explicitReturn, 'return')),
    }
  }

  // 中文：提取泛型参数模型：id（位置 + 名字）、名字、const、约束 / 默认值 / 方差修饰符。
  private typeParameters(
    parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
  ): TypeParameterModel[] {
    return parameters?.map(parameter => ({
      id: `${this.locationKey(parameter)}#${parameter.name.text}`,
      name: parameter.name.text,
      const: hasModifier(parameter, ts.SyntaxKind.ConstKeyword),
      ...(parameter.constraint === undefined ? {} : { constraint: this.convertType(parameter.constraint) }),
      ...(parameter.default === undefined ? {} : { default: this.convertType(parameter.default) }),
      ...(hasModifier(parameter, ts.SyntaxKind.InKeyword) && hasModifier(parameter, ts.SyntaxKind.OutKeyword)
        ? { variance: 'in-out' as const }
        : hasModifier(parameter, ts.SyntaxKind.InKeyword)
          ? { variance: 'in' as const }
          : hasModifier(parameter, ts.SyntaxKind.OutKeyword)
            ? { variance: 'out' as const }
            : {}),
    })) ?? []
  }

  // 中文：合并多个接口片段的同名泛型参数：约束 / 默认值取第一个非空者，const 取或，
  // 方差必须一致（不一致即失败）。
  private mergeTypeParameters(
    parts: readonly (readonly TypeParameterModel[])[],
    site: ts.Node,
    declarationName: string,
  ): TypeParameterModel[] {
    const first = parts[0] as readonly TypeParameterModel[]
    return first.map((parameter, index) => {
      const peers = parts.map(part => part[index] as TypeParameterModel)
      const constraint = peers.find(peer => peer.constraint !== undefined)?.constraint
      const fallback = peers.find(peer => peer.default !== undefined)?.default
      const variances = [...new Set(peers.flatMap(peer => peer.variance === undefined ? [] : [peer.variance]))]
      if (variances.length > 1) {
        this.fail(site, `merged interface ${declarationName} has incompatible variance modifiers`)
      }
      return {
        id: parameter.id,
        name: parameter.name,
        const: peers.some(peer => peer.const),
        ...(constraint === undefined ? {} : { constraint }),
        ...(fallback === undefined ? {} : { default: fallback }),
        ...(variances[0] === undefined ? {} : { variance: variances[0] }),
      }
    })
  }

  // 中文：取公开边界的必需类型标注：已标注直接用；未标注时 check 模式直接失败，
  // write 模式用 checker 推断类型、排队补写标注并抛 SourceEditQueued 中断本次分析。
  private requiredType(
    owner: ts.Node,
    type: ts.TypeNode | undefined,
    purpose: 'property' | 'parameter' | 'return',
  ): ts.TypeNode {
    if (type !== undefined) return type
    if (this.mode === 'check') {
      this.fail(owner, `public ${purpose} is missing an explicit type annotation`)
    }
    const inferred = this.inferType(owner, purpose)
    const rendered = ts.createPrinter().printNode(ts.EmitHint.Unspecified, inferred, owner.getSourceFile())
    const position = annotationPosition(owner, purpose)
    this.queueEdit({ file: realPath(owner.getSourceFile().fileName), position, text: `: ${rendered}` })
    throw new SourceEditQueued()
  }

  // 中文：用 checker 推断某个公开成员的显式类型（返回类型或位置类型），返回可打印的类型节点。
  private inferType(
    owner: ts.Node,
    purpose: 'property' | 'parameter' | 'return',
  ): ts.TypeNode {
    let type: ts.Type
    if (purpose === 'return') {
      const signature = this.checker.getSignatureFromDeclaration(owner as ts.SignatureDeclaration) as ts.Signature
      type = this.checker.getReturnTypeOfSignature(signature)
    } else {
      type = this.checker.getTypeAtLocation(owner)
    }
    return this.checker.typeToTypeNode(
      type,
      owner,
      ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope,
    ) as ts.TypeNode
  }

  // 中文：把 AST 类型节点转换成类型图节点（核心转换器）：按语法种类逐类处理——关键字、
  // 括号、字面量、引用（含目标解析）、联合 / 交叉、数组、元组、对象字面量、函数 /
  // 构造、索引访问、运算符、条件、infer、映射、模板字面量、type query、import 类型、
  // 类型谓词、this；未知节点失败（fail-loud）。
  private convertType(node: ts.TypeNode): TypeNodeId {
    const id = this.allocateNodeId(node)
    const add = (model: TypeNodeInput): TypeNodeId => {
      this.nodes.set(id, { id, ...model })
      return id
    }

    const keyword = keywordName(node.kind)
    if (keyword !== undefined) return add({ kind: 'keyword', name: keyword })
    if (ts.isParenthesizedTypeNode(node)) {
      return add({ kind: 'parenthesized', type: this.convertType(node.type) })
    }
    if (ts.isLiteralTypeNode(node)) return add(literalModel(node))
    if (ts.isTypeReferenceNode(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.typeName) as ts.Symbol
      return add({
        kind: 'reference',
        name: node.typeName.getText(),
        target: this.targetForReference(this.resolveSymbol(symbol), node),
        arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
      })
    }
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      return add({
        kind: ts.isUnionTypeNode(node) ? 'union' : 'intersection',
        types: node.types.map(type => this.convertType(type)),
      })
    }
    if (ts.isArrayTypeNode(node)) return add({ kind: 'array', element: this.convertType(node.elementType) })
    if (ts.isTupleTypeNode(node)) {
      // 中文：元组元素支持命名成员（标签）、可选 / 剩余修饰符。
      return add({
        kind: 'tuple',
        elements: node.elements.map((element) => {
          const named = ts.isNamedTupleMember(element) ? element : undefined
          const raw = named?.type ?? element
          const optional = named?.questionToken !== undefined || ts.isOptionalTypeNode(raw)
          const rest = named?.dotDotDotToken !== undefined || ts.isRestTypeNode(raw)
          const type = ts.isOptionalTypeNode(raw) || ts.isRestTypeNode(raw) ? raw.type : raw
          return {
            ...(named === undefined ? {} : { name: named.name.text }),
            type: this.convertType(type),
            optional,
            rest,
          }
        }),
      })
    }
    if (ts.isTypeLiteralNode(node)) return add({ kind: 'object', members: this.members(node.members, id) })
    if (ts.isFunctionTypeNode(node)) {
      return add({ kind: 'function', signature: this.signature(node, node.type) })
    }
    if (ts.isConstructorTypeNode(node)) {
      return add({
        kind: 'constructor',
        abstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword),
        signature: this.signature(node, node.type),
      })
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      return add({
        kind: 'indexed-access',
        object: this.convertType(node.objectType),
        index: this.convertType(node.indexType),
      })
    }
    if (ts.isTypeOperatorNode(node)) {
      return add({
        kind: 'operator',
        operator: ts.tokenToString(node.operator) as TypeOperatorName,
        type: this.convertType(node.type),
      })
    }
    if (ts.isConditionalTypeNode(node)) {
      return add({
        kind: 'conditional',
        check: this.convertType(node.checkType),
        extends: this.convertType(node.extendsType),
        whenTrue: this.convertType(node.trueType),
        whenFalse: this.convertType(node.falseType),
      })
    }
    if (ts.isInferTypeNode(node)) {
      return add({ kind: 'infer', parameter: this.typeParameters(ts.factory.createNodeArray([node.typeParameter]))[0] as TypeParameterModel })
    }
    if (ts.isMappedTypeNode(node)) {
      const parameter = this.typeParameters(ts.factory.createNodeArray([node.typeParameter]))[0] as TypeParameterModel
      return add({
        kind: 'mapped',
        parameter,
        ...(node.nameType === undefined ? {} : { nameType: this.convertType(node.nameType) }),
        ...(node.type === undefined ? {} : { value: this.convertType(node.type) }),
        readonly: modifierMode(node.readonlyToken),
        optional: modifierMode(node.questionToken),
      })
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      return add({
        kind: 'template-literal',
        head: node.head.text,
        spans: node.templateSpans.map(span => ({ type: this.convertType(span.type), text: span.literal.text })),
      })
    }
    if (ts.isTypeQueryNode(node)) {
      return add({
        kind: 'type-query',
        expression: node.exprName.getText(),
        arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
      })
    }
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument as ts.LiteralTypeNode & { readonly literal: ts.StringLiteral }
      const symbol = node.qualifier === undefined ? undefined : this.checker.getSymbolAtLocation(node.qualifier)
      return add({
        kind: 'import-type',
        module: argument.literal.text,
        ...(node.qualifier === undefined ? {} : { qualifier: node.qualifier.getText() }),
        arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
        typeof: node.isTypeOf,
        ...(node.attributes === undefined ? {} : { attributes: importTypeAttributesText(node) }),
        ...(symbol === undefined ? {} : { target: this.targetForReference(this.resolveSymbol(symbol), node) }),
      })
    }
    if (ts.isTypePredicateNode(node)) {
      return add({
        kind: 'predicate',
        asserts: node.assertsModifier !== undefined,
        parameter: node.parameterName.getText(),
        ...(node.type === undefined ? {} : { type: this.convertType(node.type) }),
      })
    }
    // 中文：以上覆盖了 TypeScript 接受的全部源类型节点种类；此分支保证未来新增的
    // 编译器种类会响亮地失败而不是静默丢类型。
    /* v8 ignore else -- every source TypeNode kind accepted by TypeScript is handled above; this arm keeps
     * future compiler kinds fail-loud. */
    if (ts.isThisTypeNode(node)) return add({ kind: 'this' })
    /* v8 ignore next -- paired with the exhaustive TypeNode guard above. */
    this.fail(node, `unsupported TypeScript type node ${ts.SyntaxKind[node.kind]}`)
  }

  // 中文：新建一个类型图节点（id 由位置分配器生成）。
  private addNode(site: ts.Node, model: TypeNodeInput): TypeNodeId {
    const id = this.allocateNodeId(site)
    this.nodes.set(id, { id, ...model })
    return id
  }

  // 中文：为符号构造"指向其声明"的引用节点（用于 schema / object 的根引用）。
  private referenceNode(symbol: ts.Symbol, site: ts.Node): TypeNodeId {
    return this.addNode(site, {
      kind: 'reference',
      name: symbol.name,
      target: { kind: 'declaration', symbol: this.symbolId(symbol) },
      arguments: [],
    })
  }

  // 中文：解析类型引用的目标：类型参数 → type-parameter；标准库 → standard；
  // 本工作区声明 → declaration（跨包引用必须带显式 import，跨面引用记 CrossFaceLink）；
  // 其余 → external；都匹配不上则失败。
  private targetForReference(symbol: ts.Symbol, site: ReferenceSite): TypeTargetModel {
    const declaration = preferredDeclaration(symbol)
    /* v8 ignore next -- a symbol from a semantically valid source type reference always has a declaration. */
    if (declaration === undefined) this.fail(site, `type symbol ${symbol.name} has no declaration`)
    if (ts.isTypeParameterDeclaration(declaration)) {
      return {
        kind: 'type-parameter',
        parameter: `${this.locationKey(declaration)}#${declaration.name.text}`,
      }
    }
    if (isStandardLibraryFile(declaration.getSourceFile().fileName)) {
      return { kind: 'standard', name: symbol.name }
    }

    const moduleSpecifier = moduleSpecifierOf(site)
    const module = moduleSpecifier === undefined ? undefined : moduleIdentity(moduleSpecifier)
    const from = this.registrationForFile(site.getSourceFile().fileName) as PackageRegistration
    const owner = this.registrationForFile(declaration.getSourceFile().fileName)
    if (owner !== undefined) {
      if (owner.name !== from.name) {
        // 中文：跨包引用必须带显式包导入，且导入名必须在目标包的子路径里公开导出。
        if (module === undefined) {
          this.fail(site, `reference to ${symbol.name} crosses a package without an explicit package import`)
        }
        const exportName = authoredExportName(site, moduleSpecifier as string)
        if (this.packageExportName(module, symbol, owner.face, exportName) === undefined) {
          this.fail(site, `package reference ${exportName} is not exported by ${module.package} at ${module.subpath}`)
        }
      }
      const typeDeclaration = declaration as ts.ClassDeclaration | ts.InterfaceDeclaration
        | ts.TypeAliasDeclaration | ts.EnumDeclaration
      if (!this.declarationStates.has(this.symbolId(symbol))) this.ensureDeclaration(symbol, typeDeclaration)
      return { kind: 'declaration', symbol: this.symbolId(symbol) }
    }

    // 中文：声明不在本工作区：若包同时存在于另一个面，记跨面链接并返回 cross-face；
    // 否则是外部模块，返回 external（含按文件推断 node_modules 身份的情况）。
    const packageFaces = module === undefined
      ? []
      : [...new Set(this.allRegistrations.filter(candidate => candidate.name === module.package).map(candidate => candidate.face))]
    const otherFace = packageFaces.find(face => face !== this.face)
    if (otherFace !== undefined && module !== undefined) {
      const requestedName = authoredExportName(site, moduleSpecifier as string)
      const exportName = this.packageExportName(module, symbol, otherFace, requestedName)
      if (exportName === undefined) {
        this.fail(site, `cross-face reference ${requestedName} is not exported by ${module.package} at ${module.subpath}`)
      }
      this.recordCrossFaceLink(from.name, otherFace, module, exportName)
      return {
        kind: 'cross-face',
        face: otherFace,
        package: module.package,
        subpath: module.subpath,
        name: exportName,
      }
    }

    if (module !== undefined) {
      return {
        kind: 'external',
        module: module.package,
        subpath: module.subpath,
        name: symbol.name,
      }
    }

    const external = externalModuleIdentityForFile(declaration.getSourceFile().fileName)
    if (external !== undefined) {
      return {
        kind: 'external',
        module: external.package,
        subpath: external.subpath,
        name: symbol.name,
      }
    }

    this.fail(site, `reference to ${symbol.name} crosses a package or face without an explicit import`)
  }

  // 中文：记录一条跨面链接（以字段拼接做去重键，同一条边只记一次）。
  private recordCrossFaceLink(
    fromPackage: string,
    toFace: TypertFace,
    module: ModuleIdentity,
    name: string,
  ): void {
    const link: CrossFaceLink = {
      fromFace: this.face,
      fromPackage,
      toFace,
      toPackage: module.package,
      subpath: module.subpath,
      name,
    }
    const key = [
      link.fromFace,
      link.fromPackage,
      link.toFace,
      link.toPackage,
      link.subpath,
      link.name,
    ].join('\0')
    this.crossFaceLinks.set(key, link)
  }

  // 中文：确认某个符号在"目标面 + 目标包子路径"里的公开导出名：目标模块按
  // requestedName 导出且解析到同一符号时返回导出名，否则 undefined。
  private packageExportName(
    module: ModuleIdentity,
    symbol: ts.Symbol,
    face: TypertFace,
    requestedName: string,
  ): string | undefined {
    const registration = this.allRegistrations.find(candidate =>
      candidate.face === face && candidate.name === module.package) as PackageRegistration
    const target = packageExportTargets(registration.manifest)
      .find(([subpath]) => subpath === module.subpath)?.[1]
    if (target === undefined) return undefined
    const sourceFile = this.sourceFiles.get(realPath(sourcePathForExport(registration.root, target))) as ts.SourceFile
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile) as ts.Symbol
    const exported = this.checker.getExportsOfModule(moduleSymbol)
      .find(candidate => candidate.name === requestedName && this.resolveSymbol(candidate) === symbol)
    return exported?.name
  }

  // 中文：取类型节点对应的解析后符号（引用节点取 typeName，其余取类型本身的符号）。
  private symbolAtType(node: ts.TypeNode): ts.Symbol | undefined {
    if (ts.isTypeReferenceNode(node)) {
      return this.resolveSymbol(this.checker.getSymbolAtLocation(node.typeName) as ts.Symbol)
    }
    const type = this.checker.getTypeAtLocation(node)
    const symbol = type.aliasSymbol ?? type.getSymbol()
    return symbol === undefined ? undefined : this.resolveSymbol(symbol)
  }

  // 中文：解析符号别名：别名符号（如 import 别名 / 再导出名）解到真正的目标符号。
  private resolveSymbol(symbol: ts.Symbol): ts.Symbol {
    return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : this.checker.getAliasedSymbol(symbol)
  }

  // 中文：构造符号的稳定 id：`包名:相对路径#符号名`（无声明时退化为 `symbol:名字`）。
  private symbolId(symbol: ts.Symbol): SymbolId {
    const declaration = preferredDeclaration(symbol)
    if (declaration === undefined) return `symbol:${symbol.name}`
    const location = this.location(declaration)
    return `${this.packageNameForFile(declaration.getSourceFile().fileName)}:${location.file}#${symbol.name}`
  }

  // 中文：按文件找它所属的（当前面的）包注册；不在任何包内返回 undefined。
  private registrationForFile(file: string): PackageRegistration | undefined {
    const path = realPath(file)
    return this.allRegistrations
      .find(registration => registration.face === this.face && isWithin(path, registration.root))
  }

  // 中文：按文件找包名（不限面；找不到记 `<external>`）。
  private packageNameForFile(file: string): string {
    const path = realPath(file)
    return this.allRegistrations.find(registration => isWithin(path, registration.root))?.name ?? '<external>'
  }

  // 中文：分配类型节点 id：`type:位置#序号`（同一位置出现多次时序号递增，保证唯一）。
  private allocateNodeId(site: ts.Node): TypeNodeId {
    const location = this.locationKey(site)
    const ordinal = (this.nodeOrdinals.get(location) ?? 0) + 1
    this.nodeOrdinals.set(location, ordinal)
    return `type:${location}#${String(ordinal)}`
  }

  // 中文：节点的位置键：`相对路径:行:列`。
  private locationKey(node: ts.Node): string {
    const location = this.location(node)
    return `${location.file}:${String(location.line)}:${String(location.column)}`
  }

  // 中文：计算节点源位置（文件相对工作区根、行 / 列从 1 开始）。
  private location(node: ts.Node): SourceLocation {
    const sourceFile = node.getSourceFile()
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return {
      file: slash(relative(this.root, sourceFile.fileName)),
      line: position.line + 1,
      column: position.character + 1,
    }
  }

  // 中文：统一失败出口：抛带面名与源码定位的 TypertAnalysisError。
  private fail(node: ts.Node, message: string): never {
    const location = this.location(node)
    throw new TypertAnalysisError(
      `typert(${this.face}): ${location.file}:${String(location.line)}:${String(location.column)}: ${message}`,
    )
  }
}

// 中文：合并多个分批分析的工作区模型：包按名字覆盖合并，声明与节点按 id 去重合并，
// 跨面链接按字段拼接去重；结果按确定顺序排序（host 在前，其余按名字）。
function mergeWorkspaceModels(models: readonly WorkspaceModel[]): WorkspaceModel {
  const faces = new Map<TypertFace, {
    packages: Map<string, PackageModel>
    declarations: Map<SymbolId, TypeDeclarationModel>
    nodes: Map<TypeNodeId, TypeNodeModel>
  }>()
  const links = new Map<string, CrossFaceLink>()
  for (const model of models) {
    for (const face of model.faces) {
      const merged = faces.get(face.face) ?? {
        packages: new Map(),
        declarations: new Map(),
        nodes: new Map(),
      }
      for (const packageModel of face.packages) merged.packages.set(packageModel.name, packageModel)
      for (const declaration of face.graph.declarations) {
        if (!merged.declarations.has(declaration.id)) merged.declarations.set(declaration.id, declaration)
      }
      for (const node of face.graph.nodes) {
        if (!merged.nodes.has(node.id)) merged.nodes.set(node.id, node)
      }
      faces.set(face.face, merged)
    }
    for (const link of model.crossFaceLinks) {
      links.set([
        link.fromFace,
        link.fromPackage,
        link.toFace,
        link.toPackage,
        link.subpath,
        link.name,
      ].join('\0'), link)
    }
  }
  return {
    faces: [...faces].sort(([left], [right]) =>
      (left === 'host' ? 0 : 1) - (right === 'host' ? 0 : 1)).map(([face, model]) => ({
      face,
      packages: [...model.packages.values()].sort((left, right) => left.name.localeCompare(right.name)),
      graph: {
        declarations: [...model.declarations.values()].sort((left, right) => left.id.localeCompare(right.id)),
        nodes: [...model.nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
      },
    })),
    crossFaceLinks: [...links.values()].sort(compareCrossFaceLinks),
  }
}

// 中文：读取并解析一个 tsconfig：任何解析错误都会以 TypertAnalysisError 形式失败。
function parseConfig(path: string): ParsedConfig {
  const compilerPath = path.split(sep).join('/')
  const read = ts.readConfigFile(compilerPath, file => ts.sys.readFile(file))
  if (read.error !== undefined) throw new TypertAnalysisError(formatDiagnostic(read.error))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(compilerPath), undefined, compilerPath)
  if (parsed.errors.length > 0) throw new TypertAnalysisError(parsed.errors.map(formatDiagnostic).join('\n'))
  return { path, parsed }
}

// 中文：把 project reference 的路径规范成 tsconfig 路径：已是 .json 直接用，否则拼
// tsconfig.json（目录引用）。
function projectConfigPath(path: string): string {
  if (extname(path) === '.json') return path
  return join(path, 'tsconfig.json')
}

// 中文：轻量判断一个源文件是否"含 typert 表面"：有 @typert object / schema / service
// 标注、typertRemote 绑定字段、@Remote / @RemoteScope 装饰器，或非空 Context / Events
// 模块扩充声明。
function sourceFileHasSurface(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if ((ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement))
      && (typertMode(statement) !== undefined || typertServiceTag(statement) !== undefined)) return true
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (ts.isPropertyDeclaration(member)
          && memberName(member.name) === 'typertRemote'
          && member.initializer !== undefined
          && ts.isCallExpression(member.initializer)
          && expressionName(member.initializer.expression) === 'bindTypertRemote') return true
        for (const decorator of ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []) {
          const expression = ts.isCallExpression(decorator.expression)
            ? decorator.expression.expression
            : decorator.expression
          const name = expressionName(expression)
          if (name === 'Remote' || name === 'RemoteScope') return true
        }
      }
    }
    if (!ts.isModuleDeclaration(statement)
      || !ts.isStringLiteral(statement.name)
      || statement.name.text !== '@deepseek-ai/cordis'
      || statement.body === undefined
      || !ts.isModuleBlock(statement.body)) continue
    if (statement.body.statements.some(member => ts.isInterfaceDeclaration(member)
      && (member.name.text === 'Context' || member.name.text === 'Events')
      && member.members.length > 0)) return true
  }
  return false
}

// 中文：判断一个包模型是否有任何业务表面（服务 / 事件 / 对象 / schema / 远程调用任一非空），
// 空包不进入最终模型。
function hasPackageSurface(model: PackageModel): boolean {
  return model.services.length > 0
    || model.events.length > 0
    || model.objects.length > 0
    || model.schemas.length > 0
    || model.invocations.length > 0
}

// 中文：判断 manifest 是否为"双面包"：dsh.client 存在且列出 client 导出子路径。
function isDualFacePackage(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh
  const client = dsh !== null && typeof dsh === 'object'
    ? (dsh as Record<string, unknown>).client
    : undefined
  return client !== null
    && typeof client === 'object'
    && clientExportSubpaths(manifest).length > 0
}

// 中文：host 面的导出子路径：除 ./client / ./client/... / ./remote 之外的全部子路径。
function hostExportSubpaths(manifest: Record<string, unknown>): string[] {
  return packageExportTargets(manifest)
    .map(([subpath]) => subpath)
    .filter(subpath => subpath !== './client'
      && !subpath.startsWith('./client/')
      && subpath !== './remote')
}

// 中文：client 面的导出子路径：仅 ./client 与 ./client/... 前缀的子路径。
function clientExportSubpaths(manifest: Record<string, unknown>): string[] {
  return packageExportTargets(manifest)
    .map(([subpath]) => subpath)
    .filter(subpath => subpath === './client' || subpath.startsWith('./client/'))
}

// 中文：把 package.json 的 exports 字段压平成 `[子路径, 目标路径]` 列表：兼容字符串 /
// 对象（条件导出）/ 数组 / types 兜底四种形态，结果按子路径排序。
function packageExportTargets(manifest: Record<string, unknown>): [string, string][] {
  const exportsField = manifest.exports
  if (typeof exportsField === 'string') return [['.', exportsField]]
  if (exportsField === null || typeof exportsField !== 'object') {
    const types = manifest.types
    return typeof types === 'string' ? [['.', types]] : []
  }
  if (Array.isArray(exportsField)
    || !Object.keys(exportsField).some(key => key.startsWith('.'))) {
    const target = exportTarget(exportsField)
    return target === undefined ? [] : [['.', target]]
  }
  const result: [string, string][] = []
  for (const [subpath, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (!subpath.startsWith('.')) continue
    const target = exportTarget(value)
    if (target !== undefined) result.push([subpath, target])
  }
  return result.sort(([left], [right]) => left.localeCompare(right))
}

// 中文：从条件导出值里解析出目标路径：字符串直接用；数组按顺序找第一个可解析项；
// 对象优先取 types / import / default 条件，再兜底遍历其余条件。
function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportTarget(candidate)
      if (target !== undefined) return target
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const conditions = value as Record<string, unknown>
  for (const key of ['types', 'import', 'default']) {
    const target = exportTarget(conditions[key])
    if (target !== undefined) return target
  }
  for (const candidate of Object.values(conditions)) {
    const target = exportTarget(candidate)
    if (target !== undefined) return target
  }
  return undefined
}

// 中文：把导出目标路径（通常指向 lib 产物）换算回源码路径：lib/types/* 与 lib/* 前缀
// 映射到 src/ 下对应 .ts；其余按原样解析。
function sourcePathForExport(packageRoot: string, target: string): string {
  const normalized = target.replace(/^\.\//, '')
  if (normalized.startsWith('lib/types/')) {
    return resolve(packageRoot, 'src', normalized.slice('lib/types/'.length).replace(/\.d\.(?:mts|cts|ts)$/, '.ts'))
  }
  if (normalized.startsWith('lib/')) {
    return resolve(packageRoot, 'src', normalized.slice('lib/'.length).replace(/\.(?:mjs|cjs|js|d\.ts)$/, '.ts'))
  }
  return resolve(packageRoot, normalized)
}

// 中文：取符号的"首选声明"：优先类型声明，其次值声明，最后第一个声明。
function preferredDeclaration(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.declarations?.find(isTypeDeclaration)
    ?? symbol.valueDeclaration
    ?? symbol.declarations?.[0]
}

// 中文：安全地取节点的父节点（TS 的 parent 属性在结构化类型里可选）。
function optionalParent(node: ts.Node): ts.Node | undefined {
  return (node as ts.Node & { readonly parent?: ts.Node }).parent
}

// 中文：类型守卫——节点是否是类 / 接口 / 类型别名 / 枚举声明。
function isTypeDeclaration(
  node: ts.Node,
): node is ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration {
  return ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
}

// 中文：取类型声明的名字（调用方已保证名字存在）。
function declarationName(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
): string {
  return (declaration.name as ts.Identifier).text
}

// 中文：提取成员的"无函数体"文本：去掉函数体，压缩空白，去掉尾部可选分号。
function memberText(member: ts.TypeElement | ts.ClassElement): string {
  const sourceFile = member.getSourceFile()
  const full = member.getText(sourceFile)
  const body = (member as { body?: ts.Node }).body
  const signature = body === undefined ? full : full.slice(0, full.length - body.getText(sourceFile).length)
  return signature.replace(/\s*;?\s*$/, '').replace(/\s+/g, ' ').trim()
}

// 中文：渲染声明的规范文本（去注释）：类声明先投影成"类形状"（去私有成员与函数体）。
function declarationText(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
): string {
  const printer = ts.createPrinter({ removeComments: true })
  const projected = ts.isClassDeclaration(declaration) ? classShape(declaration) : declaration
  return printer.printNode(ts.EmitHint.Unspecified, projected, declaration.getSourceFile()).replace(/\r/g, '')
}

// 中文：把类声明投影成"公开形状"：剔除 private / protected / #私有字段成员，
// 方法 / 构造器 / 访问器 / 属性的函数体清空（保留签名），便于生成紧凑的声明文本。
function classShape(node: ts.ClassDeclaration): ts.ClassDeclaration {
  const nonPublic = (member: ts.ClassElement): boolean =>
    (ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined)?.some(modifier =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword) ?? false
  const members = node.members.flatMap((member): ts.ClassElement[] => {
    if (nonPublic(member) || (ts.isPropertyDeclaration(member) && ts.isPrivateIdentifier(member.name))) return []
    if (ts.isMethodDeclaration(member)) {
      return [ts.factory.updateMethodDeclaration(
        member,
        member.modifiers,
        member.asteriskToken,
        member.name,
        member.questionToken,
        member.typeParameters,
        member.parameters,
        member.type,
        undefined,
      )]
    }
    if (ts.isConstructorDeclaration(member)) {
      return [ts.factory.updateConstructorDeclaration(member, member.modifiers, member.parameters, undefined)]
    }
    if (ts.isGetAccessorDeclaration(member)) {
      return [ts.factory.updateGetAccessorDeclaration(
        member,
        member.modifiers,
        member.name,
        member.parameters,
        member.type,
        undefined,
      )]
    }
    if (ts.isSetAccessorDeclaration(member)) {
      return [ts.factory.updateSetAccessorDeclaration(
        member,
        member.modifiers,
        member.name,
        member.parameters,
        undefined,
      )]
    }
    if (ts.isPropertyDeclaration(member)) {
      return [ts.factory.updatePropertyDeclaration(
        member,
        member.modifiers,
        member.name,
        member.questionToken ?? member.exclamationToken,
        member.type,
        undefined,
      )]
    }
    return [member]
  })
  return ts.factory.updateClassDeclaration(
    node,
    node.modifiers,
    node.name,
    node.typeParameters,
    node.heritageClauses,
    members,
  )
}

// 中文：提取节点的文档模型：描述（含摘要）、结构化标签表与原始 JSDoc 文本；
// 无 JSDoc 时返回 EMPTY_DOCUMENTATION。
function documentationOf(node: ts.Node): DocumentationModel {
  const blocks = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
  const block = blocks.at(-1)
  if (block === undefined) return EMPTY_DOCUMENTATION
  const description = normalizedDocText(ts.getTextOfJSDocComment(block.comment))
  const tags: JsDocTagModel[] = ts.getJSDocTags(node).map((tag) => {
    const named = tag as ts.JSDocTag & { name?: ts.Node }
    const comment = normalizedDocText(ts.getTextOfJSDocComment(tag.comment))
    return {
      name: tag.tagName.text,
      ...(named.name === undefined ? {} : { argument: named.name.getText() }),
      ...(comment === undefined ? {} : { comment }),
      text: tag.getText(tag.getSourceFile()).trim(),
    }
  })
  return {
    ...(description === undefined ? {} : {
      description,
      summary: firstSentence(description),
    }),
    tags,
    jsDoc: rawJsDoc(node),
  }
}

// 中文：规范化文档文本：连续空白压成单个空格并去首尾；空白文本归一为 undefined。
function normalizedDocText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  /* v8 ignore next -- TypeScript represents whitespace-only JSDoc as undefined before this helper is called. */
  return normalized.length === 0 ? undefined : normalized
}

// 中文：取一段文本的第一句（到第一个句号 / 感叹号 / 问号为止）。
function firstSentence(value: string): string {
  return (/^(.*?[.!?])(?:\s|$)/.exec(value)?.[1] ?? value).trim()
}

// 中文：提取节点原始 JSDoc 文本（含 /** 与 * / 定界符），相对声明行做去缩进，供文档
// 生成与运行时投影使用。
function rawJsDoc(node: ts.Node): string {
  const sourceFile = node.getSourceFile()
  const source = sourceFile.getFullText()
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) as ts.CommentRange[]
  const range = ranges.filter(candidate => source.slice(candidate.pos, candidate.pos + 3) === '/**').at(-1) as ts.CommentRange
  const raw = source.slice(range.pos, range.end)
  const { line } = sourceFile.getLineAndCharacterOfPosition(range.pos)
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0)
  const indent = source.slice(lineStart, range.pos)
  return raw.split('\n')
    .map((text, index) => index > 0 && text.startsWith(indent) ? text.slice(indent.length) : text)
    .join('\n')
}

// 中文：读 @typert 标注的模式：object = 按引用传递；schema / type / 空 = 生成校验 schema。
function typertMode(node: ts.Node): 'object' | 'schema' | undefined {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== 'typert') continue
    const mode = (ts.getTextOfJSDocComment(tag.comment) ?? '').trim().split(/\s+/, 1)[0]
    if (mode === 'object') return 'object'
    if (mode === '' || mode === 'schema' || mode === 'type') return 'schema'
  }
  return undefined
}

// 中文：找 @typert service 标注（第一个词必须是 service）。
function typertServiceTag(node: ts.Node): ts.JSDocTag | undefined {
  return ts.getJSDocTags(node).find(tag => tag.tagName.text === 'typert'
    && (ts.getTextOfJSDocComment(tag.comment) ?? '').trim().split(/\s+/, 1)[0] === 'service')
}

// 中文：成员名归一：标识符 / 字符串 / 数字 / 模板取文本，计算键包成 `[表达式]`。
function memberName(name: ts.PropertyName | ts.BindingName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)
    || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText()}]`
  return name.getText()
}

// 中文：取字符串字面量 / 无替换模板的值；其他节点返回 undefined。
function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined
}

// 中文：判断字符串是否为合法 RPC 端点分段。
function isRemoteSegment(value: string): boolean {
  // Generation bootstraps workspace artifacts before dsh-typert-protocol is built,
  // so this extraction-only copy must mirror isTypertRemoteSegment().
  // 中文：生成流程要在 dsh-typert-protocol 构建完成之前引导工作区产物，因此这里的
  // 提取专用副本必须与 isTypertRemoteSegment() 保持一致。
  return value !== '.' && value !== '..' && /^[A-Za-z0-9_$.-]+$/.test(value)
}

// 中文：取表达式名字：标识符直接取文本，属性访问取成员名，其余返回 undefined。
function expressionName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  return undefined
}

// 中文：由包名与子路径拼出完整导入说明符（根子路径 "." 直接返回包名）。
function packageExportSpecifier(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

// 中文：判断节点可见性：# 私有标识符与 private 修饰符都是 private；protected 居中；其余 public。
function visibilityOf(node: ts.Node): MemberVisibility {
  if ('name' in node && node.name !== undefined && ts.isPrivateIdentifier(node.name as ts.Node)) return 'private'
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return 'private'
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return 'protected'
  return 'public'
}

// 中文：判断节点是否带指定修饰符。
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(modifier => modifier.kind === kind) ?? false
}

// 中文：成员可否公开暴露（非 private / protected 且非 static）。
function exposableMember(member: MemberModel): boolean {
  return member.visibility === 'public' && !member.static
}

// 中文：把 TS 语法关键字映射成模型关键字名（不支持的返回 undefined）。
function keywordName(kind: ts.SyntaxKind): KeywordTypeName | undefined {
  switch (kind) {
    case ts.SyntaxKind.AnyKeyword: return 'any'
    case ts.SyntaxKind.BigIntKeyword: return 'bigint'
    case ts.SyntaxKind.BooleanKeyword: return 'boolean'
    case ts.SyntaxKind.NeverKeyword: return 'never'
    case ts.SyntaxKind.NumberKeyword: return 'number'
    case ts.SyntaxKind.ObjectKeyword: return 'object'
    case ts.SyntaxKind.StringKeyword: return 'string'
    case ts.SyntaxKind.SymbolKeyword: return 'symbol'
    case ts.SyntaxKind.UndefinedKeyword: return 'undefined'
    case ts.SyntaxKind.UnknownKeyword: return 'unknown'
    case ts.SyntaxKind.VoidKeyword: return 'void'
    default: return undefined
  }
}

// 中文：把字面量类型节点转成模型字面量：字符串 / 模板 / 数字 / bigint / 布尔 / null /
// 带符号数字（如 -1n），其余语法抛错（fail-loud）。
function literalModel(node: ts.LiteralTypeNode): Omit<Extract<TypeNodeModel, { kind: 'literal' }>, 'id'> {
  const literal = node.literal
  if (ts.isStringLiteral(literal)) return { kind: 'literal', value: literal.text, text: literal.getText() }
  if (ts.isNoSubstitutionTemplateLiteral(literal)) {
    return { kind: 'literal', value: literal.text, text: literal.getText() }
  }
  if (ts.isNumericLiteral(literal)) return { kind: 'literal', value: Number(literal.text), text: literal.getText() }
  if (ts.isBigIntLiteral(literal)) return { kind: 'literal', value: BigInt(literal.text.slice(0, -1)), text: literal.getText() }
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true, text: 'true' }
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false, text: 'false' }
  if (literal.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null, text: 'null' }
  /* v8 ignore else -- all remaining LiteralTypeNode syntax is a signed numeric or bigint literal. */
  if (ts.isPrefixUnaryExpression(literal)
    && (ts.isNumericLiteral(literal.operand) || ts.isBigIntLiteral(literal.operand))) {
    return {
      kind: 'literal',
      value: ts.isBigIntLiteral(literal.operand)
        ? BigInt(literal.getText().slice(0, -1))
        : Number(literal.getText()),
      text: literal.getText(),
    }
  }
  /* v8 ignore next -- TypeScript's LiteralTypeNode grammar is exhausted above; this contains future compiler syntax. */
  throw new TypertAnalysisError(`typert: unsupported literal type ${literal.getText()}`)
}

// 中文：把映射类型上的修饰符 token 转成 add / remove / preserve：+ 是 add、- 是 remove、
// 无 token 是 preserve、裸 token（readonly / ?）也是 add。
function modifierMode(token: ts.ReadonlyKeyword | ts.PlusToken | ts.MinusToken | ts.QuestionToken | undefined):
  'add' | 'remove' | 'preserve' {
  if (token?.kind === ts.SyntaxKind.PlusToken) return 'add'
  if (token?.kind === ts.SyntaxKind.MinusToken) return 'remove'
  return token === undefined ? 'preserve' : 'add'
}

// 中文：计算 write 模式补写标注的插入位置：返回类型插在参数列表结束符后一位；
// 属性 / 参数插在名字结束处。
function annotationPosition(
  node: ts.Node,
  purpose: 'property' | 'parameter' | 'return',
): number {
  if (purpose === 'return') return (node as ts.SignatureDeclarationBase).parameters.end + 1
  return (node as ts.ParameterDeclaration | ts.PropertyDeclaration | ts.PropertySignature).name.end
}

// 中文：找出类型引用所在文件的 import 语句里、与引用名匹配的模块说明符（普通导入 /
// 命名空间导入 / 命名导入都查）。
function moduleSpecifierOf(node: ReferenceSite): string | undefined {
  if (ts.isImportTypeNode(node)) {
    const argument = node.argument as ts.LiteralTypeNode & { readonly literal: ts.StringLiteral }
    return argument.literal.text
  }
  const symbol = ts.isTypeReferenceNode(node)
    ? node.typeName
    : node.expression
  const sourceFile = node.getSourceFile()
  const first = ts.isIdentifier(symbol) ? symbol.text : symbol.getFirstToken(sourceFile)?.getText(sourceFile)
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined
      || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (statement.importClause.name?.text === first) return statement.moduleSpecifier.text
    const bindings = statement.importClause.namedBindings
    if (bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === first) {
      return statement.moduleSpecifier.text
    }
    if (bindings !== undefined && ts.isNamedImports(bindings)
      && bindings.elements.some(element => element.name.text === first)) return statement.moduleSpecifier.text
  }
  return undefined
}

// 中文：恢复"作者书写的导出名"：根据 import 形态（默认 / 命名 / 命名空间）还原目标
// 包导出的原始名字，供跨包导出校验使用。
function authoredExportName(node: ReferenceSite, moduleSpecifier: string): string {
  if (ts.isImportTypeNode(node)) return (node.qualifier as ts.EntityName).getText().split('.')[0] as string

  const referenced = ts.isTypeReferenceNode(node)
    ? node.typeName.getText().split('.')
    : node.expression.getText().split('.')
  const localName = referenced[0] as string
  for (const statement of node.getSourceFile().statements) {
    if (!ts.isImportDeclaration(statement)
      || statement.importClause === undefined
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== moduleSpecifier) continue
    if (statement.importClause.name?.text === localName) return 'default'
    const bindings = statement.importClause.namedBindings
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      const imported = bindings.elements.find(element => element.name.text === localName)
      if (imported !== undefined) return imported.propertyName?.text ?? imported.name.text
    }
    if (bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === localName) {
      return referenced[1] as string
    }
  }
  /* v8 ignore next -- moduleSpecifierOf returns only the matching import inspected by this loop. */
  throw new TypertAnalysisError(`typert: cannot recover export name for ${localName} from ${moduleSpecifier}`)
}

// 中文：提取 import 类型（import('x', { ... })）的 attributes 文本：括号内逗号到右括号
// 之间的原始源码。
function importTypeAttributesText(node: ts.ImportTypeNode): string {
  const sourceFile = node.getSourceFile()
  const children = node.getChildren(sourceFile)
  const comma = children.find(child => child.kind === ts.SyntaxKind.CommaToken) as ts.Node
  const close = children.find(child => child.kind === ts.SyntaxKind.CloseParenToken) as ts.Node
  return sourceFile.text.slice(comma.end, close.pos).trim()
}

// 中文：把模块说明符解析成包身份：相对 / 绝对路径返回 undefined；scoped 包取前两段，
// 普通包取第一段；子路径归一成 `./x` 形态。
function moduleIdentity(specifier: string): ModuleIdentity | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined
  const parts = specifier.split('/')
  const packageLength = specifier.startsWith('@') ? 2 : 1
  const packageName = parts.slice(0, packageLength).join('/')
  const rest = parts.slice(packageLength).join('/')
  return {
    package: packageName,
    subpath: rest.length === 0 ? '.' : `./${rest}`,
  }
}

// 中文：按文件路径推断外部模块身份：从 node_modules 段之后的路径还原包名
//（scoped 包取两段）。
function externalModuleIdentityForFile(file: string): ModuleIdentity | undefined {
  const normalized = slash(file)
  const marker = '/node_modules/'
  const index = normalized.lastIndexOf(marker)
  if (index < 0) return undefined
  const parts = normalized.slice(index + marker.length).split('/')
  const packageLength = (parts[0] as string).startsWith('@') ? 2 : 1
  const packageName = parts.slice(0, packageLength).join('/')
  return { package: packageName, subpath: '.' }
}

// 中文：判断文件是否为 TypeScript 自带的标准库声明（typescript/lib/lib.*.d.ts）。
function isStandardLibraryFile(file: string): boolean {
  const base = file.replaceAll('\\', '/')
  return /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(base)
}

// 中文：把 TS 诊断信息压平成单行文本。
function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

// 中文：把带位置的 Program 诊断格式化成 `typert(面): 文件:行:列: TSxxx: 消息` 的报错行。
function formatProgramDiagnostic(root: string, face: TypertFace, diagnostic: ts.DiagnosticWithLocation): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  const file = slash(relative(root, diagnostic.file.fileName))
  return `typert(${face}): ${file}:${String(position.line + 1)}:${String(position.character + 1)}: TypeScript TS${String(diagnostic.code)}: ${message}`
}

// 中文：真实路径缓存（进程级）：已存在的路径做符号链接解析并记忆，避免重复 IO；
// 不存在的路径直接返回，不做缓存（路径可能稍后出现）。
const realPathCache = new Map<string, string>()

// 中文：解析真实路径（带进程级缓存）。只对已存在的路径做记忆：分析只改写文件内容、
// 不改目录树，因此已存在路径的规范形态在进程生命周期内稳定。
function realPath(path: string): string {
  const absolute = resolve(path)
  const cached = realPathCache.get(absolute)
  if (cached !== undefined) return cached
  // Only existing paths are memoized: a path can come into existence later,
  // but an existing path's canonical form is stable for the process lifetime
  // (analysis edits rewrite file contents, never the directory tree).
  // 中文：只记忆已存在的路径：路径可以稍后才出现，而已存在路径的规范形态在进程
  // 生命周期内稳定（分析只改写文件内容，从不改动目录树）。
  if (!existsSync(absolute)) return absolute
  const resolved = realpathSync(absolute)
  realPathCache.set(absolute, resolved)
  return resolved
}

// 中文：判断 path 是否位于 root 之内（含 root 本身）。
function isWithin(path: string, root: string): boolean {
  const absolute = realPath(path)
  const parent = realPath(root)
  return absolute === parent || absolute.startsWith(parent + sep)
}

// 中文：把路径分隔符统一成斜杠。
function slash(value: string): string {
  return value.replaceAll('\\', '/')
}

// 中文：按 key 函数去重（保留首个出现项）。
function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const result = new Map<string, T>()
  for (const value of values) if (!result.has(key(value))) result.set(key(value), value)
  return [...result.values()]
}

// 中文：跨面链接的确定性排序：按 源面 → 源包 → 目标面 → 目标包 → 子路径 → 名字。
function compareCrossFaceLinks(left: CrossFaceLink, right: CrossFaceLink): number {
  return left.fromFace.localeCompare(right.fromFace)
    || left.fromPackage.localeCompare(right.fromPackage)
    || left.toFace.localeCompare(right.toFace)
    || left.toPackage.localeCompare(right.toPackage)
    || left.subpath.localeCompare(right.subpath)
    || left.name.localeCompare(right.name)
}
