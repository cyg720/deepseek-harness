/**
 * ================================ 文件注释 ================================
 * 【文件职责】动态插件 Host 半部求值所用的 node:vm 沙箱：创建全新的 realm（全局
 *             环境），注入带标签的 console、harness 注册助手、编码原语，以及对
 *             Node API（fs/网络/进程/定时器）的"重定向陷阱"——把这些能力引导到
 *             ctx.fs / ctx.web / ctx.bash 与 Cordis 定时器上。
 * 【技术维度】createContext/runInContext/Script 来自 node:vm；双 realm instanceof
 *             修补让沙箱值能通过宿主的 instanceof 检查；代码以"异步函数体"包装后
 *             求值（return 插件）；vmTimeoutMs 只约束同步段。
 * 【产品维度】让"AI 现场写的插件"在受限环境里安全运行：既可用文件/网络/进程等
 *             能力（经 Cordis 服务），又保持可检查、可回收；但注意这是"约定约束"
 *             而非完整隔离（宿主侧闭包仍是逃逸通道）。
 * 【逻辑维度】HOST_BUILTIN_INSPECTION 能力清单 → taggedConsole/陷阱构造 →
 *             createSandbox 组装环境 → precheckCode/prettyParseContext 定义期预检 →
 *             evaluateHostCode 运行期求值（含语法错误的教学化）。
 * 【关键边界】浏览器端从不使用本模块（Client 半部在闭包中求值，有独立门面）；
 *             沙箱缺 Web API（btoa/atob/TextEncoder 显式补齐）；TypeScript 语法
 *             不被接受，报错会提示移除类型标注。
 * 【新手阅读建议】先读 createSandbox 看沙箱里有什么，再读 precheckCode 与
 *             evaluateHostCode 两个入口，最后看 NODE_API_REDIRECTS 理解被禁能力。
 * ==========================================================================
 */

/**
 * The `node:vm` sandbox a dynamic package's HOST half evaluates in: a fresh realm whose globals
 * are a tagged write-through console, the `harness` registration helpers, the encoding primitives
 * a bare vm context lacks, and callable traps over the Node APIs the sandbox deliberately
 * withholds. Traps steer filesystem, network, process, and timer work to `ctx.fs`, `ctx.web`,
 * `ctx.bash`, and Cordis timers. This keeps cooperative packages inspectable and disposable but
 * is not containment: host-realm helper functions remain an escape route.
 *
 * The browser half never reaches this module — it is evaluated by the client-side runner in a
 * closure, with its own facade.
 * @module @deepseek-ai/dsh-cordis-host-runner/sandbox
 */

import { createContext, runInContext, Script } from 'node:vm'
import { sandboxDefineTool, sandboxRegisterTool } from './guard.ts'

/** Exact Host closure symbols exposed by the sandbox and guarded Context. */
/**
 * 沙箱与守卫 ctx 实际暴露的 Host 闭包符号清单：供 inspect 工具向模型展示
 * "沙箱里有什么、怎么用"（名称/说明/签名）。
 */
export const HOST_BUILTIN_INSPECTION = [
  {
    name: 'ctx',
    description: 'Restricted Cordis Context. Prefer ctx.get(name) with an undefined check; use inject for hard dependencies.',
    signatures: [
      'ctx.get(name: string): unknown | undefined',
      'ctx.on(name: string, listener: Function): () => void',
      'ctx.provide(name: string, value: unknown): () => void',
      'ctx.effect(callback: Function, label?: string): () => void',
    ],
  },
  {
    name: 'harness',
    description: 'Host helpers for Package-private Client RPC and model-visible dynamic Tools.',
    signatures: [
      'harness.handle(method: string, handler: (args: JsonValue) => JsonValue | Promise<JsonValue>): () => void',
      'harness.defineTool(definition: ToolDefinition): ToolDefinition',
      'harness.registerTool(ctx: Context, tool: ToolDefinition): () => void',
    ],
  },
  { name: 'console', description: 'Package-tagged Host logging.', signatures: ['console.log(...values): void', 'console.error(...values): void'] },
  { name: 'btoa', description: 'Encode UTF-8 text as base64.', signatures: ['btoa(value: string): string'] },
  { name: 'atob', description: 'Decode base64 as UTF-8 text.', signatures: ['atob(value: string): string'] },
  { name: 'TextEncoder', description: 'Standard UTF-8 encoder constructor.', signatures: ['new TextEncoder()'] },
  { name: 'TextDecoder', description: 'Standard text decoder constructor.', signatures: ['new TextDecoder(label?: string)'] },
] as const

/**
 * A write-through console for one package, tagging every line with the package
 * id. Write-through (host stdout/stderr), NOT buffered into the tool result:
 * a registered listener fires long after the run call returned, and its output
 * must land somewhere the user can see — for a terminal entry point, the host terminal.
 */
/**
 * 为单个插件构造"直写式" console：每行输出都带 [cordis:插件ID] 标签，直接写到宿主
 * 标准输出/错误（不缓存进工具结果——监听器可能在调用返回很久后才触发，输出必须
 * 落在用户可见的地方）。
 */
function taggedConsole(id: string): Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...args: unknown[]) => void> {
  const tag = `[cordis:${id}]`
  const log = (...args: unknown[]): void => { console.log(tag, ...args) }
  const error = (...args: unknown[]): void => { console.error(tag, ...args) }
  return { log, info: log, warn: log, debug: log, error }
}

/**
 * Patch only VM constructors so `instanceof` accepts both VM values and host values passed as
 * arguments, events, or service results; host intrinsics remain untouched.
 */
/**
 * 只修补 VM 构造器的 Symbol.hasInstance，使 instanceof 同时接受 VM 值（沙箱产生的）
 * 与宿主值（作为参数/事件/服务结果传入的）；宿主内建构造器保持原样。
 */
const DUAL_REALM_INSTANCEOF_PRELUDE = `
(hostIntrinsics) => {
  'use strict'
  const ordinary = Function.prototype[Symbol.hasInstance]
  for (const name of Object.keys(hostIntrinsics)) {
    const VmCtor = globalThis[name]
    const HostCtor = hostIntrinsics[name]
    if (typeof VmCtor !== 'function' || typeof HostCtor !== 'function') continue
    Object.defineProperty(VmCtor, Symbol.hasInstance, {
      value: (instance) => ordinary.call(VmCtor, instance) || ordinary.call(HostCtor, instance),
      configurable: true,
    })
  }
}
`

/** Run {@link DUAL_REALM_INSTANCEOF_PRELUDE} in a freshly created sandbox, handing it the host intrinsics to pair up. */
/**
 * 在新沙箱中执行双 realm instanceof 修补：把宿主侧的核心构造器清单交给预置脚本，
 * 让沙箱的 instanceof 同时承认两种 realm 的实例。
 */
function patchDualRealmInstanceof(sandbox: object): void {
  const patch = runInContext(DUAL_REALM_INSTANCEOF_PRELUDE, sandbox) as (intrinsics: Record<string, unknown>) => void
  patch({ Object, Array, Function, Error, TypeError, RangeError, SyntaxError, Promise, RegExp, Date, Map, Set })
}

const TIMER_REDIRECT
  = 'Node timers are unavailable. Use the cordis timer service instead: declare inject: [\'timer\'] on your plugin '
    + 'and call ctx.timeout / ctx.interval after querying Host Service.listService for the exact overloads. '
    + 'Those calls are fiber effects, cleaned up automatically when stopped.'

/**
 * The callable Node APIs the sandbox deliberately disables, each mapped to the
 * cordis alternative its trap error names. Only function-valued globals are
 * trapped; a data-valued global such as `process` stays `undefined`, because a
 * throwing accessor would detonate the common `typeof process` feature probe
 * at resolution time.
 */
// 沙箱故意禁用的 Node API → 报错文案里指向的 Cordis 替代方案。
// 只陷阱"函数型"全局；数据型全局（如 process）保持 undefined——若用抛错访问器，
// 会在解析阶段炸掉常见的 `typeof process` 特性探测。
const NODE_API_REDIRECTS: Record<string, string> = {
  require:
    'Node modules are unavailable. Use the cordis services on ctx instead — e.g. inject: [\'fs\'] for files, '
    + '[\'web\'] for HTTP, [\'bash\'] for processes; query Service.listService with cordis_inspect_query first.',
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  setImmediate: TIMER_REDIRECT,
  clearTimeout: TIMER_REDIRECT,
  clearInterval: TIMER_REDIRECT,
  fetch:
    'Network access goes through the cordis web service: declare inject: [\'web\'] and call ctx.web '
    + '(query Host Service.listService with cordis_inspect_query for its methods).',
}

/** Build the trap functions for {@link NODE_API_REDIRECTS}: calling one throws the redirect. */
/**
 * 为被禁的 Node API 构建陷阱函数：调用即抛出指向 Cordis 替代方案的错误。
 */
function nodeApiTraps(): Record<string, () => never> {
  const traps: Record<string, () => never> = {}
  for (const [name, redirect] of Object.entries(NODE_API_REDIRECTS)) {
    traps[name] = () => {
      throw new Error(`${name} is not available in the dynamic package sandbox — ${redirect}`)
    }
  }
  return traps
}

/**
 * Build the vm context one host half evaluates in: the tagged console, the
 * `harness` registration helpers, the encoding primitives, the Node-API traps,
 * and the dual-realm `instanceof` patch, already `createContext`-ed.
 * @param id - the package id (`dyn-<n>`), used as the console tag and filename stem.
 * @param harnessExtras - per-package `harness` verbs beyond the registration pair (`handle`).
 * @returns the contextified sandbox object to pass to {@link evaluateHostCode}.
 */
/**
 * 组装一个 Host 半部求值用的 vm 上下文：陷阱、带标签 console、harness 助手、
 * 编码原语齐备，并完成 createContext 与双 realm instanceof 修补。
 */
export function createSandbox(id: string, harnessExtras: Record<string, unknown> = {}): object {
  const sandbox = {
    ...nodeApiTraps(),
    console: taggedConsole(id),
    harness: { defineTool: sandboxDefineTool, registerTool: sandboxRegisterTool, ...harnessExtras },
    // Web APIs absent from fresh vm contexts — made available so the model
    // can encode/decode base64 without Buffer (which is also absent). Host
    // closures over Buffer, never Buffer itself.
    btoa: (s: string) => Buffer.from(s, 'utf-8').toString('base64'),
    atob: (s: string) => Buffer.from(s, 'base64').toString('utf-8'),
    TextEncoder,
    TextDecoder,
  }
  createContext(sandbox)
  patchDualRealmInstanceof(sandbox)
  return sandbox
}

/**
 * Cross-realm SyntaxError detection: a compile failure inside `runInContext`
 * constructs its error in the SANDBOX realm, so a host `instanceof
 * SyntaxError` is silently false — the `name` property is the realm-safe tag.
 */
// 跨 realm 的 SyntaxError 判定：runInContext 内的编译错误在沙箱 realm 构造，
// 宿主的 instanceof SyntaxError 会静默返回 false——用 name 属性作为跨 realm 安全标签
function isSyntaxError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'SyntaxError'
}

/**
 * The parse-failure context a vm `SyntaxError` carries: the vm prints the
 * offending source line and a caret before the message, which is exactly what
 * a model needs to self-correct — surface it instead of the bare message.
 * Falls back to `String(error)` when the stack carries no such prelude.
 * @param error - the `SyntaxError` (host- or sandbox-realm) thrown while compiling package code.
 * @returns the stack prefix up to and including the `SyntaxError: …` line.
 */
/**
 * 提取语法错误的"出问题源码行 + 行首标记 + 消息"前缀：vm 的 SyntaxError 堆栈里
 * 就带这段预演，正是模型自我修正所需；无此类前缀时退回 String(error)。
 */
export function syntaxErrorContext(error: Error): string {
  const lines = (error.stack ?? '').split('\n')
  const messageIndex = lines.findIndex(line => line.startsWith('SyntaxError'))
  if (messageIndex === -1) return String(error)
  return lines.slice(0, messageIndex + 1).join('\n')
}

/**
 * The teaching text one parse failure produces, shared by the define-time
 * precheck and the run-time evaluation so a model reads the same diagnosis
 * whichever verb caught it.
 * @param half - which half failed to parse, named as the define argument that carried it.
 * @param context - the {@link syntaxErrorContext} of the failure.
 * @returns the model-facing error message.
 */
/**
 * 生成一次解析失败的教学文案（定义期预检与运行期求值共用同一措辞）：
 * 命中 TypeScript 标注特征（出错行含 `as`）提示移除类型标注，否则提示括号配平。
 */
export function parseErrorMessage(half: 'code.host' | 'code.client', context: string): string {
  // Scope the TypeScript heuristic to the OFFENDING line, not the whole code:
  // an ` as ` inside an ordinary description string must not turn a plain
  // syntax error into a misleading remove-annotations message.
  const offendingLine = context.split('\n')[1] ?? ''
  if (/\bas\b/.test(offendingLine)) {
    return `dynamic package \`${half}\` failed to parse:\n${context}\n`
      + 'The sandbox runs plain JavaScript, not TypeScript. Remove type annotations:\n'
      + '  ✗ { type: \'text\' as const, text: x }\n'
      + '  ✓ { type: \'text\', text: x }'
  }
  return `dynamic package \`${half}\` failed to parse:\n${context}\n`
    + 'Note: it runs as the BODY of an async function (line numbers are offset by the 1-line wrapper). '
    + 'Check bracket balance — ending the returned plugin object with `});` closes a call that was never opened; '
    + 'a plain `return { … }` ends with `}` (an optional `;`), never `)`.'
}

/**
 * Parse one half's source without running it: the define-time precheck that
 * keeps unparseable code out of the registry, so a model fixes it and defines
 * again instead of discovering the failure at run time. `new Function` is the
 * gate — hosts without a real `node:vm` (the browser worker) still refuse
 * unparseable code — and `vm.Script` is only the best-effort prettifier: on a
 * Node host its failure carries the source-line-and-caret prelude the
 * teaching text builds on, and where the vm is a stub the message stays bare.
 * The two parsers' syntax faces differ at the margin (`new.target` parses in
 * a function body but not at the vm wrapper's top level), an accepted cost of
 * a vm-free gate; and under a page CSP without `'unsafe-eval'`, `new Function`
 * throws `EvalError`, which propagates unwrapped.
 * @param code - the model-written function body.
 * @param half - which define argument carried it, for the error text.
 * @throws when the body does not parse, with the offending line and a teaching hint.
 */
/**
 * 定义期预检：用 new Function 编译"异步函数体"而不执行，保证无法解析的代码进不了
 * 注册表（模型改对了再 define，而不是运行期才暴露）；vm.Script 仅作为美化错误上下
 * 文的尽力尝试。
 */
export function precheckCode(code: string, half: 'code.host' | 'code.client'): void {
  const wrapped = `(async () => {\n${code}\n})()`
  try {
    // Compile-only: constructing the function parses the source and runs nothing.
    // oxlint-disable-next-line typescript/no-implied-eval -- parse gate over model-written code; nothing is invoked
    new Function(wrapped)
  } catch (error) {
    if (!isSyntaxError(error)) throw error
    throw new Error(parseErrorMessage(half, prettyParseContext(wrapped, half, error)))
  }
}

/**
 * Best-effort vm recompile of a body `new Function` already refused, for the
 * source-line-and-caret prelude only.
 * @param wrapped - the wrapped source that failed to parse.
 * @param half - which define argument carried it, for the vm filename.
 * @param refusal - the gate's own `SyntaxError`, the fallback context source.
 * @returns the vm prelude when a real vm produced one, else the bare refusal.
 */
/**
 * 尽力用 vm.Script 重编译一次被 new Function 拒绝的代码，只为拿到"源码行 + 标记"
 * 前缀；vm 不可用（如浏览器 worker 的桩实现）时退回门面自己的错误文本。
 */
function prettyParseContext(wrapped: string, half: 'code.host' | 'code.client', refusal: Error): string {
  try {
    new Script(wrapped, { filename: `cordis-dyn-${half}.js` })
  } catch (vmError) {
    if (isSyntaxError(vmError)) return syntaxErrorContext(vmError)
    // A stubbed vm (the browser worker) refuses Script itself; the gate's
    // error is the only context there is.
  }
  return String(refusal)
}

/**
 * Evaluate a host half as the body of an async function inside the sandbox. `vmTimeoutMs` only
 * bounds the SYNCHRONOUS portion; an async body escapes it — acceptable under the module's
 * trust stance. Parse errors include the offending line and a TypeScript-removal or bracket-
 * balance hint.
 * @param sandbox - the contextified object from {@link createSandbox}.
 * @param code - the model-written function body; must `return` a plugin.
 * @param id - the package id, used as the vm filename (`cordis-dyn-<id>.js`).
 * @param vmTimeoutMs - the synchronous evaluation bound in milliseconds.
 * @returns whatever the code returned, still un-narrowed (the run lifecycle checks plugin shape).
 */
/**
 * 在沙箱中把 Host 半部作为异步函数体求值：vmTimeoutMs 只约束同步段（异步体可逃逸，
 * 属模块信任立场的可接受代价）；解析错误同样走教学文案。
 */
export async function evaluateHostCode(sandbox: object, code: string, id: string, vmTimeoutMs: number): Promise<unknown> {
  try {
    return await runInContext(
      `(async () => {\n${code}\n})()`,
      sandbox,
      { filename: `cordis-dyn-${id}.js`, timeout: vmTimeoutMs },
    )
  } catch (error) {
    if (!isSyntaxError(error)) throw error
    throw new Error(parseErrorMessage('code.host', syntaxErrorContext(error)))
  }
}
