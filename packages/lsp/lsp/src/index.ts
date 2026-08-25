/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-lsp 包的入口与运行时实现：定义 LSP 能力缝 ctx.lsp 的 Service 类（Lsp）、结构化错误 LspError、扩展名规范化工具，统一 re-export 类型与品牌，并把服务挂到 Cordis 的 Context 上。
 * 【技术维度】基于 vendored Cordis 的 Service 基类实现服务；注册采用"先校验后提交"的原子方式（ctx.effect 生命周期控制器管理注册与释放）；通过声明合并（declare module）把 lsp 服务挂到全局 Context 类型上。
 * 【产品维度】这是"代码语义查询"能力的产品入口：任何插件只要注册一个 LSP 提供者（如 lsp-stdio），模型就能通过 ctx.lsp.query 使用跳转定义、查找引用、跳转实现、悬停四种能力。
 * 【逻辑维度】re-export 类型与品牌 → 声明合并注册 ctx.lsp → LspError 错误类 → finalExtension 扩展名提取
 *   → EXTENSION_PATTERN 与 Route 内部类型 → Lsp 服务类（registerProvider 原子注册 / query 按扩展名
 *   路由）→ normalizeExtension 辅助函数 → 默认导出 Lsp。
 * 【关键边界】只暴露四种语义操作、无 JSON-RPC 逃生口；注册必须全部校验通过才发布（all-or-nothing，失败零副作用）；扩展名归一化为小写前导点形式；查询选择与注册顺序无关。
 * 【新手阅读建议】先读 registerProvider 理解"原子注册"如何用 ctx.effect 管理生命周期，再读 query 理解路由选择，最后对照 types.ts 的契约看实现如何满足接口。
 * ==========================================================================
 */
/**
 * Service Definition for the LSP capability seam (`ctx.lsp`): a language-server provider registry and per-query,
 * order-independent selection over normalized goToDefinition/findReferences/goToImplementation/
 * hover queries.
 *
 * A provider reserves a branded id and an exclusive set of file extensions atomically:
 * {@link Lsp.registerProvider} validates and conflict-checks everything before mutating, so an
 * invalid or conflicting registration publishes nothing, and its disposer releases every
 * reservation together. Selection routes a query by the file's final extension; it never depends on
 * registration order. The seam exposes exactly the four operations and no JSON-RPC escape hatch.
 * @module @deepseek-ai/dsh-lsp
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { LspProviderId } from './brand.ts'
import type {
  LspProvider,
  LspQueryRequest,
  LspQueryResult,
  LspService,
} from './types.ts'

// 同时导出品牌类型与工厂函数（同名），并 re-export 全部类型契约，供外部以 @deepseek-ai/dsh-lsp 单一入口引用。
export { LspProviderId } from './brand.ts'
export type {
  LspHover,
  LspLocation,
  LspOperation,
  LspPosition,
  LspProvider,
  LspProviderQuery,
  LspQueryRequest,
  LspQueryResult,
  LspRange,
  LspService,
} from './types.ts'

// 声明合并：把 lsp 服务挂到 Cordis 全局 Context 类型上，插件内可直接通过 ctx.lsp 访问。
declare module '@deepseek-ai/cordis' {
  interface Context {
    lsp: LspService
  }
}

/**
 * Structured LSP failure. Extends {@link HarnessError} with a stable `code`
 * (`LSP_INVALID_PROVIDER`, `LSP_CONFLICT`, `LSP_UNAVAILABLE`, `LSP_DISPOSED`,
 * `LSP_UNSUPPORTED_OPERATION`, `LSP_MALFORMED_RESPONSE`, …) that callers route on instead of
 * parsing `message`.
 */
// 结构化 LSP 失败：继承 HarnessError 并携带稳定 code（如 LSP_INVALID_PROVIDER、LSP_CONFLICT、LSP_UNAVAILABLE 等），调用方按 code 路由处理，而不是解析 message 文本。
export class LspError extends HarnessError {}

/**
 * Extract a file's final extension as a normalized, lowercase, leading-dot key (e.g. `Foo.TS` →
 * `.ts`, `foo.d.ts` → `.ts`). Returns `''` for a name with no extension or a leading-dot dotfile
 * (`.bashrc`), which no route ever matches. Splits on both `/` and `\` so a caller's path separator
 * does not change the result.
 * @param filePath - the source path to inspect.
 * @returns the normalized extension, or `''` when there is none.
 */
// 提取文件最终扩展名并规范化为小写前导点形式（如 Foo.TS → .ts、foo.d.ts → .ts）；无扩展名或前导点隐藏文件（.bashrc）返回 ''，任何路由都不会命中。同时兼容 / 与 \ 分隔符，调用方路径写法不影响结果。
export function finalExtension(filePath: string): string {
  // 路径中最后一个目录分隔符的位置（兼容 / 与 \）。
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  // 去掉目录前缀后得到的文件名部分。
  const base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath
  // 文件名中最后一个点的位置。
  const dot = base.lastIndexOf('.')
  // dot <= 0 covers both "no dot" (-1) and a leading-dot dotfile (0): neither has an extension.
  // dot <= 0 同时覆盖"无点"(-1) 与前导点隐藏文件(0)：二者都没有扩展名。
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

/** A well-formed normalized extension: a dot followed by one or more non-dot, non-separator chars. */
// 合法扩展名的校验正则：一个点后跟一个及以上"非点、非路径分隔符"字符（如 .ts）。
const EXTENSION_PATTERN = /^\.[^./\\]+$/

/** One selection route: the provider to run plus the language id to synchronize the document with. */
// 一条选择路由：要运行的提供者 + 用于同步文档的语言 id，注册时写入路由表。
interface Route {
  // 选中的提供者。
  readonly provider: LspProvider
  // 该扩展名对应的 LSP 语言 id。
  readonly languageId: string
}

/**
 * `ctx.lsp`. Holds the id reservations and the extension→route table; both are populated and cleared
 * together per provider so a route always has a live provider.
 */
// ctx.lsp 的服务实现：持有 id 保留集合与"扩展名 → 路由"表；两者按提供者成对填充与清除，保证路由永远指向存活的提供者。
export class Lsp extends Service implements LspService {
  // 已保留的提供者 id 集合：注册冲突检测与释放的依据。
  private readonly providerIds = new Set<LspProviderId>()
  // 扩展名 → 路由表：query 时按文件扩展名查找目标提供者。
  private readonly routes = new Map<string, Route>()

  constructor(ctx: Context) {
    // super 的 'lsp' 参数向 Cordis 声明本服务的名字，此后插件可用 ctx.lsp 访问。
    super(ctx, 'lsp')
  }

  // 注册提供者：全部校验与冲突检查通过后，才在一个生命周期控制器中同时保留 id 与全部扩展名路由；返回的释放函数成对移除它们。
  registerProvider(provider: LspProvider): () => void {
    // Validate and conflict-check everything BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    // 先校验与冲突检查、后变更：非法或冲突的注册必须零副作用（要么全部发布、要么什么都不发布，且失败时大声报错）。
    const id = provider.id
    if (id.trim() === '') {
      throw new LspError('an LSP provider id must be a non-empty string', 'LSP_INVALID_PROVIDER')
    }
    if (this.providerIds.has(id)) {
      throw new LspError(`an LSP provider with id "${id}" is already registered`, 'LSP_CONFLICT')
    }

    const entries = Object.entries(provider.extensionToLanguage)
    if (entries.length === 0) {
      throw new LspError(`LSP provider "${id}" registers no file extensions`, 'LSP_INVALID_PROVIDER')
    }

    // Normalize into this provider's route set, catching intra-provider duplicates (e.g. `.TS` and
    // `.ts`) before checking cross-provider conflicts.
    // 先把本提供者的映射归一化进临时集合，捕获提供者内部的重复（如 .TS 与 .ts），再做跨提供者的冲突检查。
    const pending = new Map<string, Route>()
    for (const [rawExt, languageId] of entries) {
      const ext = normalizeExtension(rawExt)
      if (!EXTENSION_PATTERN.test(ext)) {
        throw new LspError(`LSP provider "${id}" maps an invalid extension "${rawExt}"`, 'LSP_INVALID_PROVIDER')
      }
      if (languageId.trim() === '') {
        throw new LspError(`LSP provider "${id}" maps extension "${ext}" to an empty language id`, 'LSP_INVALID_PROVIDER')
      }
      if (pending.has(ext)) {
        throw new LspError(`LSP provider "${id}" maps extension "${ext}" more than once`, 'LSP_INVALID_PROVIDER')
      }
      pending.set(ext, { provider, languageId })
    }
    for (const ext of pending.keys()) {
      if (this.routes.has(ext)) {
        throw new LspError(`extension "${ext}" is already handled by another LSP provider`, 'LSP_CONFLICT')
      }
    }

    // All checks passed: reserve id and every extension in one lifecycle controller so disposal
    // releases them together.
    // 所有检查通过：在一个生命周期控制器中同时保留 id 与全部扩展名，释放时成对移除。
    const dispose = this.ctx.effect(function* (this: Lsp) {
      this.providerIds.add(id)
      for (const [ext, route] of pending) this.routes.set(ext, route)
      yield () => {
        this.providerIds.delete(id)
        for (const ext of pending.keys()) this.routes.delete(ext)
      }
    }.bind(this), 'lsp.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    // ctx.effect 的释放函数返回 Promise<void>，而我们的释放 API 是同步"发出即忘"——丢弃这个必然已解决的 Promise。
    return () => void dispose()
  }

  // 按文件最终扩展名查找路由并转发查询；无匹配时抛 LSP_UNAVAILABLE。
  async query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult> {
    // 路由表以归一化后的文件扩展名为键。
    const route = this.routes.get(finalExtension(request.filePath))
    if (route === undefined) {
      throw new LspError(`no LSP provider handles "${request.filePath}"`, 'LSP_UNAVAILABLE')
    }
    // 补上提供者映射的语言 id 后转发给选中的提供者。
    return route.provider.query({ ...request, languageId: route.languageId }, signal)
  }
}

/** Lowercase an extension and ensure it carries a leading dot; `EXTENSION_PATTERN` rejects the rest. */
// 小写化扩展名并确保带前导点（.TS → .ts、TS → .ts）；其余非法形式由 EXTENSION_PATTERN 在注册时拒绝。
function normalizeExtension(ext: string): string {
  const lower = ext.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

export default Lsp
