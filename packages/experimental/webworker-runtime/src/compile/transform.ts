/**
 * The worker's module transform: one acorn parse turns an ES module into a
 * CommonJS body **and** routes every suspension point through the ambient-store
 * protocol.
 *
 * Both jobs live in one pass because they are two edits over one syntax tree;
 * running a lexer first and a parser second meant two scanners, two sets of
 * blind spots, and a second pass reading the first pass's output. Editing is
 * interval-based — the original text is sliced and spliced, never reprinted —
 * so **line numbers survive**: a stack frame in a transformed module points at
 * the same line as the built artifact it came from.
 *
 * The image packer is this transform's only caller: it lowers every JavaScript
 * entry it packs and records `LOWERING_VERSION` in the image manifest, so the
 * worker wraps those bodies without carrying a compiler of its own.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/compile/transform
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 transform 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { parse } from 'acorn'

/**
 * 常量说明：HELPER_SOURCE 用于处理 HELPER_SOURCE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const HELPER_SOURCE: Record<string, string> = {
  def: 'const __dsh$def=(t,k,get)=>Object.defineProperty(t,k,{enumerable:true,configurable:true,get});',
  default: 'const __dsh$default=(m)=>(m&&m.__esModule?m.default:m);',
  ns: 'const __dsh$ns=(m)=>(m&&m.__esModule?m:Object.assign({},m,{default:m}));',
  exportAll: 'const __dsh$exportAll=(t,m)=>{for(const k of Object.keys(m))if(k!=="default"&&!(k in t))__dsh$def(t,k,()=>m[k]);};',
  dynImport: 'const __dsh$dynImport=(s)=>Promise.resolve().then(()=>__dsh$ns(require(s)));',
}

/**
 * 常量说明：HELPER_DEPENDENCIES 用于处理 HELPER_DEPENDENCIES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const HELPER_DEPENDENCIES: Record<string, readonly string[]> = {
  exportAll: ['def'],
  dynImport: ['ns'],
}

/** Runtime identifier the suspension protocol reaches.
 * @remarks 中文说明：常量说明：ALS 用于处理 ALS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const ALS = '__als'

interface Node {
  readonly type: string
  readonly start: number
  readonly end: number
  readonly [key: string]: unknown
}

/** @returns Number of line breaks in a slice.
 * @remarks 中文说明：功能说明：处理 countNewlines 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 countNewlines(text)，并按返回类型处理结果。 */
function countNewlines(text: string): number {
  /**
   * 变量说明：count 用于处理 count 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let count = 0
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) count += 1
  return count
}

interface Edit {
  readonly start: number
  readonly end: number
  /** Rendered lazily so edits inside a replaced range still apply. */
  readonly render: (inner: (from: number, to: number) => string) => string
}

/** One binding to publish on `exports`. */
interface Binding {
  readonly exported: string
  readonly local: string
}

/**
 * 类说明：Transformer 用于集中封装 处理 Transformer 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
class Transformer {
  /**
   * 常量说明：edits 用于处理 edits 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly edits: Edit[] = []
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly source: string
  /**
   * 常量说明：helpers 用于处理 helpers 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly helpers = new Set<string>()
  /**
   * 常量说明：bindings 用于处理 bindings 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly bindings: Binding[] = []
  /**
   * 变量说明：modules 用于处理 modules 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private modules = 0
  /**
   * 变量说明：temporaries 用于处理 temporaries 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private temporaries = 0
  /**
   * 变量说明：moduleSyntax 用于处理 moduleSyntax 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private moduleSyntax = false
  /**
   * 常量说明：moduleRequests 用于处理 moduleRequests 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly moduleRequests = new Set<string>()
  /**
   * 常量说明：metaResolveRequests 用于处理 metaResolveRequests 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly metaResolveRequests = new Set<string>()
  /**
   * 常量说明：createRequireBindings 用于创建 Require Bindings 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly createRequireBindings = new Set<string>()

  /**
   * 功能说明：处理 Transformer 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new Transformer(source, path) 创建实例，并在所属生命周期内使用。
   */
  constructor(source: string, private readonly path: string) {
    // A `#!` line is only legal at offset zero, and the prologue takes that spot;
    // commenting it out in place keeps every offset and the line count intact.
    this.source = source.startsWith('#!') ? `//${source.slice(2)}` : source
  }

  /**
   * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
   * @param detail （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param index （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fail(detail, index)，并按返回类型处理结果。
   */
  private fail(detail: string, index: number): never {
    /**
     * 常量说明：line 用于处理 line 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const line = this.source.slice(0, index).split('\n').length
    throw new Error(`webworker transform: ${detail} (${this.path}:${line})`)
  }

  /**
   * 功能说明：处理 helper 相关流程；使用场景由所在模块及调用位置决定。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 helper(name)，并按返回类型处理结果。
   */
  private helper(name: string): string {
    /**
     * 变量说明：dependency 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dependency of HELPER_DEPENDENCIES[name] ?? []) this.helper(dependency)
    this.helpers.add(name)
    return `__dsh$${name}`
  }

  /**
   * 功能说明：处理 moduleTemp 相关流程；使用场景由所在模块及调用位置决定。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 moduleTemp()，并按返回类型处理结果。
   */
  private moduleTemp(): string {
    this.modules += 1
    return `__dsh$m${this.modules}`
  }

  /**
   * 功能说明：处理 alsTemp 相关流程；使用场景由所在模块及调用位置决定。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 alsTemp()，并按返回类型处理结果。
   */
  private alsTemp(): string {
    this.temporaries += 1
    return `__als$${this.temporaries}`
  }

  /**
   * Replace a range, keeping the module's line count.
   *
   * The padding is the newlines the original range held **minus** the ones the
   * replacement re-emits: a rewrite that splices the original body back in
   * (a desugared loop) already carries that body's newlines, and padding by the
   * whole range again would push every later line down.
   * @remarks 中文说明：功能说明：处理 edit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：start（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：end（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：build（(inner: (from:
   * number, to: number) => string) => string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 edit(start, end,
   * build)，并按返回类型处理结果。
   */
  private edit(start: number, end: number, build: (inner: (from: number, to: number) => string) => string): void {
    /**
     * 常量说明：original 用于处理 original 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const original = countNewlines(this.source.slice(start, end))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
     */
    this.edits.push({
      start,
      end,
      render: (inner) => {
        /**
         * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const text = build(inner)
        return text + '\n'.repeat(Math.max(0, original - countNewlines(text)))
      },
    })
  }

  /**
   * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
   * @param start （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param end （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replace(start, end, text)，并按返回类型处理结果。
   */
  private replace(start: number, end: number, text: string): void {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.edit(start, end, () => text)
  }

  /**
   * 功能说明：处理 insert 相关流程；使用场景由所在模块及调用位置决定。
   * @param at （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insert(at, text)，并按返回类型处理结果。
   */
  private insert(at: number, text: string): void {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.edits.push({ start: at, end: at, render: () => text })
  }

  /**
   * 功能说明：处理 structural 相关流程；使用场景由所在模块及调用位置决定。
   * @param start （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param end （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param render （Edit['render']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 structural(start, end, render)，并按返回类型处理结果。
   */
  private structural(start: number, end: number, render: Edit['render']): void {
    this.edit(start, end, render)
  }

  /**
   * 功能说明：处理 literal 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 literal(node)，并按返回类型处理结果。
   */
  private literal(node: Node): string {
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = node.value
    if (typeof value !== 'string') this.fail('a module specifier must be a string literal', node.start)
    this.moduleRequests.add(value)
    return JSON.stringify(value)
  }

  /** @returns Static module requests the body makes, in first-appearance order.
   * @remarks 中文说明：功能说明：处理 requests 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly
   * string[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 requests()，
   * 并按返回类型处理结果。 */
  requests(): readonly string[] {
    return [...this.moduleRequests]
  }

  /** @returns Literal `import.meta.resolve()` requests, in first-appearance order.
   * @remarks 中文说明：功能说明：处理 metaRequests 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly
   * string[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 metaRequests()，
   * 并按返回类型处理结果。 */
  metaRequests(): readonly string[] {
    return [...this.metaResolveRequests]
  }

  // --- module syntax --------------------------------------------------------

  /**
   * 功能说明：处理 importDeclaration 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 importDeclaration(node)，并按返回类型处理结果。
   */
  private importDeclaration(node: Node): void {
    this.moduleSyntax = true
    if (Array.isArray(node.attributes) && node.attributes.length > 0) {
      this.fail('import attributes are not supported', node.start)
    }
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = node.source as Node
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = `require(${this.literal(source)})`
    /**
     * 常量说明：specifiers 用于处理 specifiers 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const specifiers = node.specifiers as Node[]
    if (specifiers.length === 0) {
      this.replace(node.start, node.end, `${request};`)
      return
    }
    /**
     * 常量说明：held 用于处理 held 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const held = this.moduleTemp()
    /**
     * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lines = [`const ${held}=${request};`]
    /**
     * 变量说明：specifier 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const specifier of specifiers) {
      /**
       * 常量说明：local 用于处理 local 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const local = (specifier.local as Node).name as string
      if (specifier.type === 'ImportDefaultSpecifier') {
        lines.push(`const ${local}=${this.helper('default')}(${held});`)
        continue
      }
      if (specifier.type === 'ImportNamespaceSpecifier') {
        lines.push(`const ${local}=${this.helper('ns')}(${held});`)
        continue
      }
      /**
       * 常量说明：imported 用于处理 imported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const imported = specifier.imported as Node
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = imported.type === 'Identifier' ? imported.name as string : imported.value as string
      lines.push(`const ${local}=${held}[${JSON.stringify(name)}];`)
    }
    this.replace(node.start, node.end, lines.join(''))
  }

  /**
   * 功能说明：处理 exportNamed 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exportNamed(node)，并按返回类型处理结果。
   */
  private exportNamed(node: Node): void {
    this.moduleSyntax = true
    /**
     * 常量说明：declaration 用于处理 declaration 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const declaration = node.declaration as Node | null
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = node.source as Node | null
    /**
     * 常量说明：specifiers 用于处理 specifiers 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const specifiers = node.specifiers as Node[]

    if (declaration !== null) {
      // `export const x = 1` keeps its declaration; only the keyword goes.
      this.replace(node.start, declaration.start, '')
      /**
       * 变量说明：exported、local 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：detail（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(detail)，并按返回类型处理结果。
       */
      for (const { exported, local } of declaredBindings(declaration, detail => this.fail(detail, declaration.start))) {
        this.bindings.push({ exported, local })
      }
      return
    }
    if (source !== null) {
      /**
       * 常量说明：held 用于处理 held 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const held = this.moduleTemp()
      /**
       * 常量说明：define 用于处理 define 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const define = this.helper('def')
      /**
       * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const lines = [`const ${held}=require(${this.literal(source)});`]
      /**
       * 变量说明：specifier 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const specifier of specifiers) {
        /**
         * 常量说明：local 用于处理 local 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const local = nameOf(specifier.local as Node)
        /**
         * 常量说明：exported 用于处理 exported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const exported = nameOf(specifier.exported as Node)
        lines.push(`${define}(exports,${JSON.stringify(exported)},()=>${held}[${JSON.stringify(local)}]);`)
      }
      this.replace(node.start, node.end, lines.join(''))
      return
    }
    // A bare `export {}` is a module marker with nothing to publish.
    /**
     * 变量说明：specifier 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const specifier of specifiers) {
      this.bindings.push({ exported: nameOf(specifier.exported as Node), local: nameOf(specifier.local as Node) })
    }
    this.replace(node.start, node.end, '')
  }

  /**
   * 功能说明：处理 exportDefault 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exportDefault(node)，并按返回类型处理结果。
   */
  private exportDefault(node: Node): void {
    this.moduleSyntax = true
    /**
     * 常量说明：declaration 用于处理 declaration 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const declaration = node.declaration as Node
    this.replace(node.start, declaration.start, 'exports.default = ')
  }

  /**
   * 功能说明：处理 exportAll 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exportAll(node)，并按返回类型处理结果。
   */
  private exportAll(node: Node): void {
    this.moduleSyntax = true
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = `require(${this.literal(node.source as Node)})`
    /**
     * 常量说明：exported 用于处理 exported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exported = node.exported as Node | null
    if (exported === null) {
      this.replace(node.start, node.end, `${this.helper('exportAll')}(exports,${request});`)
      return
    }
    /**
     * 常量说明：held 用于处理 held 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const held = this.moduleTemp()
    /**
     * 常量说明：define 用于处理 define 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const define = this.helper('def')
    this.replace(
      node.start,
      node.end,
      `const ${held}=${this.helper('ns')}(${request});${define}(exports,${JSON.stringify(nameOf(exported))},()=>${held});`,
    )
  }

  // --- suspension points ----------------------------------------------------

  /**
   * 功能说明：处理 awaitExpression 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 awaitExpression(node)，并按返回类型处理结果。
   */
  private awaitExpression(node: Node): void {
    /**
     * 常量说明：keywordEnd 用于处理 keywordEnd 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const keywordEnd = node.start + 'await'.length
    if (this.source.slice(node.start, keywordEnd) !== 'await') this.fail('unexpected await layout', node.start)
    this.replace(node.start, keywordEnd, `${ALS}.resume(await ${ALS}.pause(`)
    this.insert(node.end, '))')
  }

  /**
   * `for await (L of R) B` becomes an explicit loop over the same protocol.
   * `iterator.return` runs only on abrupt completion, as the language says, and
   * is awaited so teardown still orders before the loop exits.
   * @remarks 中文说明：功能说明：处理 forAwait 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 forAwait(node)，并按返回类型处理结果。
   */
  private forAwait(node: Node): void {
    /**
     * 常量说明：left 用于处理 left 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const left = node.left as Node
    /**
     * 常量说明：right 用于处理 right 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const right = node.right as Node
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = node.body as Node
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = this.alsTemp()
    /**
     * 常量说明：step 用于处理 step 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const step = this.alsTemp()
    /**
     * 常量说明：exhausted 用于处理 exhausted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exhausted = this.alsTemp()
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 binding 相关流程；使用场景由所在模块及调用位置决定。
     * @param inner （(from: number, to: number) => string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。
     * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 binding(inner)，并按返回类型处理结果。
     */
    const binding = (inner: (from: number, to: number) => string): string => {
      if (left.type !== 'VariableDeclaration') return `(${inner(left.start, left.end)})=${step}.value;`
      /**
       * 常量说明：declarations 用于处理 declarations 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const declarations = left.declarations as Node[]
      /**
       * 常量说明：pattern 用于处理 pattern 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const pattern = declarations[0]?.id as Node | undefined
      if (declarations.length !== 1 || pattern === undefined) {
        this.fail('for-await must declare exactly one binding', left.start)
      }
      return `${String(left.kind)} ${inner(pattern.start, pattern.end)}=${step}.value;`
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
     */
    this.structural(node.start, node.end, inner => [
      `{const ${iterator}=${ALS}.iterator(${inner(right.start, right.end)});`,
      `let ${step};let ${exhausted}=false;`,
      `try{for(;;){${step}=${ALS}.resume(await ${ALS}.pause(${iterator}.next()));`,
      `if(${step}.done){${exhausted}=true;break}`,
      `{${binding(inner)}${body.type === 'BlockStatement' ? inner(body.start, body.end) : `{${inner(body.start, body.end)}}`}}}}`,
      `finally{if(!${exhausted})${ALS}.resume(await ${ALS}.pause(${ALS}.close(${iterator})))}}`,
    ].join(''))
  }

  /**
   * `yield` resumes with whatever the consumer sent, so the snapshot is taken
   * before suspending and restored when the call completes. `yield*` delegates,
   * which has no expression form here: it is desugared as a statement, and a
   * consumer's `throw()` is not forwarded into the inner iterator (`next` and
   * `return` are).
   * @remarks 中文说明：功能说明：处理 yieldExpression 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：statement（Node |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 yieldExpression(node, statement)，
   * 并按返回类型处理结果。
   */
  private yieldExpression(node: Node, statement: Node | undefined): void {
    if (node.delegate !== true) {
      this.insert(node.start, `${ALS}.afterYield(${ALS}.snapshot(),`)
      this.insert(node.end, ')')
      return
    }
    /**
     * 常量说明：argument 用于处理 argument 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const argument = node.argument as Node | null
    if (argument === null) this.fail('yield* without an operand', node.start)
    if (statement === undefined) this.fail('yield* is only supported as a statement', node.start)
    if ((statement.expression as Node) !== node) {
      // Anything around the delegation (`x = yield* g()`, `f(yield* g())`)
      // would be silently dropped by the statement-wide rewrite below; the
      // all-or-nothing lowering contract demands a loud refusal instead.
      this.fail('yield* is only supported as the whole statement expression', node.start)
    }
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = this.alsTemp()
    /**
     * 常量说明：step 用于处理 step 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const step = this.alsTemp()
    /**
     * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sent = this.alsTemp()
    /**
     * 常量说明：exhausted 用于处理 exhausted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exhausted = this.alsTemp()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：inner（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(inner)，并按返回类型处理结果。
     */
    this.structural(statement.start, statement.end, inner => [
      `{const ${iterator}=${ALS}.iterator(${inner(argument.start, argument.end)});`,
      `let ${sent};let ${exhausted}=false;`,
      `try{for(;;){const ${step}=${ALS}.resume(await ${ALS}.pause(${iterator}.next(${sent})));`,
      `if(${step}.done){${exhausted}=true;break}`,
      `${sent}=${ALS}.afterYield(${ALS}.snapshot(),yield ${step}.value)}}`,
      `finally{if(!${exhausted})${ALS}.resume(await ${ALS}.pause(${ALS}.close(${iterator})))}}`,
    ].join(''))
  }

  // --- traversal ------------------------------------------------------------

  /**
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param context （{ asyncGenerator: boolean functionDepth: number
   * moduleScope…）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(node, context)，并按返回类型处理结果。
   */
  private visit(node: unknown, context: {
    asyncGenerator: boolean
    functionDepth: number
    moduleScope: boolean
    statement?: Node
  }): void {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      /**
       * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const child of node) this.visit(child, context)
      return
    }
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = node as Node
    if (typeof record.type !== 'string') return
    /**
     * 变量说明：next 用于处理 next 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let next = context
    switch (record.type) {
      case 'ImportDeclaration': this.importDeclaration(record); break
      case 'ExportNamedDeclaration': this.exportNamed(record); break
      case 'ExportDefaultDeclaration': this.exportDefault(record); break
      case 'ExportAllDeclaration': this.exportAll(record); break
      case 'ImportExpression': {
        this.moduleSyntax = true
        if (!this.source.startsWith('import', record.start)) this.fail('unexpected dynamic import layout', record.start)
        this.replace(record.start, record.start + 'import'.length, this.helper('dynImport'))
        // A computed dynamic import stays out of the request list; resolution
        // then happens (and fails loud) at runtime, never silently at pack time.
        /**
         * 常量说明：argument 用于处理 argument 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const argument = record.source as Node | undefined
        if (argument !== undefined && typeof argument.value === 'string') this.moduleRequests.add(argument.value)
        break
      }
      case 'CallExpression': {
        // CommonJS bodies pass through untransformed, but literal calls through
        // the wrapper's `require` remain module requests. The ESM case accepts
        // only a direct module-scope createRequire call with the importer URL.
        /**
         * 常量说明：callee 用于处理 callee 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const callee = record.callee as Node
        /**
         * 常量说明：callArguments 用于处理 callArguments 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const callArguments = record.arguments as Node[]
        if (this.isRequireCall(callee, context.moduleScope) && callArguments.length === 1
          && typeof callArguments[0]?.value === 'string') {
          this.moduleRequests.add(callArguments[0].value)
        }
        // `import.meta.resolve('lit')` is the third static request face: the
        // loader answers it from the image, so the pack sweep must keep the
        // target. A computed argument stays out, same as dynamic import —
        // resolution then fails loud at runtime, never silently at pack time.
        if (callee.type === 'MemberExpression') {
          /**
           * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const object = callee.object as Node
          /**
           * 常量说明：property 用于处理 property 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const property = callee.property as Node
          if (object.type === 'MetaProperty' && (object.meta as Node).name === 'import'
            && property.type === 'Identifier' && property.name === 'resolve'
            && typeof callArguments[0]?.value === 'string') {
            this.metaResolveRequests.add(callArguments[0].value)
          }
        }
        break
      }
      case 'MetaProperty': {
        // `new.target` is a MetaProperty too, and it must survive untouched:
        // the abstract-seam guards in the roster read it (`new.target === X`).
        /**
         * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const meta = record.meta as Node
        if (meta.name === 'import') {
          this.moduleSyntax = true
          this.replace(record.start, record.end, '__dsh$meta')
        }
        break
      }
      case 'AwaitExpression':
        if (context.functionDepth === 0) {
          this.fail('top-level await cannot run as CommonJS in the worker', record.start)
        }
        this.awaitExpression(record)
        break
      case 'ForOfStatement':
        if (record.await === true) {
          if (context.functionDepth === 0) this.fail('a top-level for-await loop cannot run as CommonJS', record.start)
          this.forAwait(record)
        }
        next = { ...next, moduleScope: false }
        break
      case 'LabeledStatement': {
        /**
         * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const body = record.body as Node
        if (body.type === 'ForOfStatement' && body.await === true) {
          this.fail('a labeled for-await loop is not supported', record.start)
        }
        break
      }
      case 'YieldExpression':
        if (context.asyncGenerator) this.yieldExpression(record, context.statement)
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        next = {
          asyncGenerator: record.async === true && record.generator === true,
          functionDepth: context.functionDepth + 1,
          moduleScope: false,
        }
        break
      case 'BlockStatement':
      case 'CatchClause':
      case 'ClassBody':
      case 'ForStatement':
      case 'ForInStatement':
      case 'SwitchStatement':
        next = { ...next, moduleScope: false }
        break
      default: break
    }
    if (record.type === 'ExpressionStatement') next = { ...next, statement: record }
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of Object.entries(record)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      this.visit(value, next)
    }
  }

  /**
   * 功能说明：判断是否为 Create Require Call 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isCreateRequireCall(node)，并按返回类型处理结果。
   */
  private isCreateRequireCall(node: Node): boolean {
    if (node.type !== 'CallExpression') return false
    /**
     * 常量说明：callee 用于处理 callee 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const callee = node.callee as Node
    /**
     * 常量说明：args 用于处理 args 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const args = node.arguments as Node[]
    if (callee.type !== 'Identifier' || !this.createRequireBindings.has(nameOf(callee)) || args.length !== 1) {
      return false
    }
    /**
     * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const base = args[0] as Node
    if (base.type !== 'MemberExpression' || base.computed === true) return false
    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = base.object as Node
    /**
     * 常量说明：property 用于处理 property 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const property = base.property as Node
    return object.type === 'MetaProperty'
      && (object.meta as Node).name === 'import'
      && property.type === 'Identifier'
      && property.name === 'url'
  }

  /**
   * 功能说明：判断是否为 Require Call 相关流程；使用场景由所在模块及调用位置决定。
   * @param callee （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param moduleScope （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isRequireCall(callee, moduleScope)，并按返回类型处理结果。
   */
  private isRequireCall(callee: Node, moduleScope: boolean): boolean {
    return (callee.type === 'Identifier' && callee.name === 'require')
      || (moduleScope && this.isCreateRequireCall(callee))
  }

  /**
   * 功能说明：处理 indexCreateRequireImports 相关流程；使用场景由所在模块及调用位置决定。
   * @param program （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 indexCreateRequireImports(program)，并按返回类型处理结果。
   */
  private indexCreateRequireImports(program: Node): void {
    /**
     * 变量说明：statement 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const statement of program.body as Node[]) {
      if (statement.type !== 'ImportDeclaration') continue
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = statement.source as Node
      if (source.value !== 'node:module' && source.value !== 'module') continue
      /**
       * 变量说明：specifier 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const specifier of statement.specifiers as Node[]) {
        if (specifier.type !== 'ImportSpecifier' || nameOf(specifier.imported as Node) !== 'createRequire') continue
        this.createRequireBindings.add(nameOf(specifier.local as Node))
      }
    }
  }

  /**
   * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 run()，并按返回类型处理结果。
   */
  run(): string {
    // Transforming a lowered body again would nest the protocol inside itself:
    // it still runs, only slower and unreadable, so a mis-wired manifest must
    // surface here rather than as a silent tax on every load.
    if (this.source.includes(`${ALS}.pause(`) || this.source.includes('__als$')) {
      this.fail('the module is already lowered; check the image manifest wiring', 0)
    }
    /**
     * 变量说明：program 用于处理 program 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let program: Node
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      program = parse(this.source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
      }) as unknown as Node
    } catch (reason) {
      this.fail(`parse failed: ${(reason as Error).message}`, 0)
    }
    this.indexCreateRequireImports(program)
    this.visit(program, { asyncGenerator: false, functionDepth: 0, moduleScope: true })
    if (this.edits.length === 0 && !this.moduleSyntax) return this.source

    /**
     * 常量说明：prologue 用于处理 prologue 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prologue: string[] = []
    if (this.moduleSyntax) prologue.push('"use strict";Object.defineProperty(exports,"__esModule",{value:true});')
    if (this.bindings.length > 0) this.helper('def')
    /**
     * 变量说明：name、source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [name, source] of Object.entries(HELPER_SOURCE)) {
      if (this.helpers.has(name)) prologue.push(source)
    }
    /**
     * 变量说明：exported、local 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const { exported, local } of this.bindings) {
      prologue.push(`__dsh$def(exports,${JSON.stringify(exported)},()=>${local});`)
    }

    /**
     * 常量说明：sorted 用于处理 sorted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
     */
    const sorted = [...this.edits].sort((left, right) => left.start - right.start || left.end - right.end)
    /**
     * 常量说明：render 用于渲染 render 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：渲染 render 相关流程；使用场景由所在模块及调用位置决定。
     * @param from （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param to （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 render(from, to)，并按返回类型处理结果。
     */
    const render = (from: number, to: number): string => {
      /**
       * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let cursor = from
      /**
       * 变量说明：out 用于处理 out 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let out = ''
      /**
       * 变量说明：edit 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const edit of sorted) {
        if (edit.start < cursor || edit.end > to) continue
        out += this.source.slice(cursor, edit.start) + edit.render(render)
        cursor = edit.end
      }
      return out + this.source.slice(cursor, to)
    }
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = prologue.join('') + render(0, this.source.length)
    // Proof that the emitted body is CommonJS a wrapper can compile: any leftover
    // module syntax, or any mis-spliced interval, fails here rather than at load.
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: false })
    } catch (reason) {
      this.fail(`the transform produced code that does not parse: ${(reason as Error).message}`, 0)
    }
    return code
  }
}

/** @returns The name a specifier or identifier node carries.
 * @remarks 中文说明：功能说明：处理 nameOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：node（Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 nameOf(node)，并按返回类型处理结果。 */
function nameOf(node: Node): string {
  return node.type === 'Identifier' ? node.name as string : String(node.value)
}

/** Every binding an exported declaration introduces, including patterns.
 * @remarks 中文说明：功能说明：处理 declaredBindings 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：declaration（Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：fail（(detail:
 * string) => never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Binding[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * declaredBindings(declaration, fail)，并按返回类型处理结果。 */
function declaredBindings(declaration: Node, fail: (detail: string) => never): Binding[] {
  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = declaration.id as Node | null
    if (id === null) fail('an exported declaration must be named')
    /**
     * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const name = id.name as string
    return [{ exported: name, local: name }]
  }
  if (declaration.type !== 'VariableDeclaration') fail(`unsupported exported declaration ${declaration.type}`)
  /**
   * 常量说明：bindings 用于处理 bindings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bindings: Binding[] = []
  /**
   * 常量说明：collect 用于收集 collect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。
   * @param pattern （Node）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 collect(pattern)，并按返回类型处理结果。
   */
  const collect = (pattern: Node): void => {
    switch (pattern.type) {
      case 'Identifier':
        bindings.push({ exported: pattern.name as string, local: pattern.name as string })
        return
      case 'ObjectPattern':
        /**
         * 变量说明：property 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const property of pattern.properties as Node[]) {
          collect((property.type === 'RestElement' ? property.argument : property.value) as Node)
        }
        return
      case 'ArrayPattern':
        /**
         * 变量说明：element 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const element of pattern.elements as Array<Node | null>) if (element !== null) collect(element)
        return
      case 'AssignmentPattern':
        collect(pattern.left as Node)
        return
      case 'RestElement':
        collect(pattern.argument as Node)
        return
      default:
        fail(`unsupported binding pattern ${pattern.type}`)
    }
  }
  /**
   * 变量说明：declarator 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const declarator of declaration.declarations as Node[]) collect(declarator.id as Node)
  return bindings
}

interface TransformedModule {
  readonly code: string
  readonly moduleRequests: readonly string[]
  readonly metaResolveRequests: readonly string[]
}

/**
 * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const cache = new Map<string, TransformedModule>()

/**
 * Transform one module into a body for the worker wrapper.
 *
 * Results are cached by source text, so a module reached through two paths, or
 * a repeated build, parses once.
 * @param source - Module source, ESM or CommonJS.
 * @param path - Path used in diagnostics.
 * @returns The lowered body and the module requests found in it.
 * @remarks 中文说明：功能说明：处理 transformDetailed 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 返回值：TransformedModule；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * transformDetailed(source, path)，并按返回类型处理结果。
 */
function transformDetailed(source: string, path: string): TransformedModule {
  /**
   * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cached = cache.get(source)
  if (cached !== undefined) return cached
  /**
   * 常量说明：transformer 用于处理 transformer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const transformer = new Transformer(source, path)
  /**
   * 常量说明：transformed 用于处理 transformed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const transformed = { code: transformer.run(), moduleRequests: transformer.requests(), metaResolveRequests: transformer.metaRequests() }
  cache.set(source, transformed)
  return transformed
}

/** One module the collector considered. */
export interface LoweredModule {
  /** Transformed body, or the input unchanged when nothing needed lowering. */
  readonly code: string
  /** False means the entry may be packed as it is. */
  readonly lowered: boolean
  /**
   * Static module requests the body makes: import and re-export sources,
   * literal dynamic imports and calls through `require`, plus module-scope
   * direct literal calls through an imported `createRequire(import.meta.url)`.
   * Computed and rebased requests resolve (and fail loud) at runtime only.
   */
  readonly moduleRequests: readonly string[]
  /**
   * Literal `import.meta.resolve()` requests. These are URL mappings, not
   * loads: the pack sweep keeps a resolvable target and tolerates a missing
   * one, and the loader answers or throws at the call site.
   */
  readonly metaResolveRequests: readonly string[]
}

/**
 * Lower one module at image-pack time.
 *
 * The collector calls this for every JavaScript entry it packs and records
 * `LOWERING_VERSION` in the image manifest; the loader then wraps those entries
 * without parsing them. `lowered: false` reports that the transform would have
 * returned the input verbatim (already CommonJS, no suspension point), so the
 * entry may be packed as it is.
 *
 * Throwing is the intended failure mode: a module this transform cannot express
 * must fail the build rather than ship an image that breaks at load.
 * @param options - Virtual path inside the image and the module source.
 * @returns The code to pack and whether it changed.
 * @remarks 中文说明：功能说明：处理 lowerModuleSource 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（{ readonly filename: string; readonly source: string
 * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：LoweredModule；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 lowerModuleSource(options)，并按返回类型处理结果。
 */
export function lowerModuleSource(options: { readonly filename: string; readonly source: string }): LoweredModule {
  /**
   * 常量说明：code、moduleRequests、metaResolveRequests 用于处理
   * code、moduleRequests、metaResolveRequests 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { code, moduleRequests, metaResolveRequests } = transformDetailed(options.source, options.filename)
  return { code, lowered: code !== options.source, moduleRequests, metaResolveRequests }
}
