/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器半部的"闭包求值"：包源码作为异步函数体运行，其形参就是符号
 *             表面——用同名形参遮蔽（setTimeout/fetch/require/…）把浏览器全局变成
 *             教学重定向，同时不污染页面。
 * 【技术维度】new Function 构造闭包（形参即表面）；注入 React/console/styles/host/
 *             harness/陷阱/process/Buffer；SyntaxError 作为引擎分歧兜底；样式经
 *             DynamicCordisStyles 记账，随卸载自动移除。
 * 【产品维度】动态包拿到"够用且可教学"的浏览器环境：React 可用但无 JSX 变换、
 *             host.call 走私有 JSON RPC、样式按包归属清理；误用全局时错误直接
 *             告诉作者该怎么改。
 * 【逻辑维度】类型 → DYNAMIC_CLIENT_REDIRECTS 重定向表 → 陷阱/console/样式 →
 *             isDynamicCordisPlugin 收窄 → evaluateClientHalf 求值主入口。
 * 【关键边界】Host 在 define 时已做语法预检，这里只做引擎分歧兜底；process/Buffer
 *             以 undefined 注入以保 typeof 探测安全；错误文案面向模型作者。
 * 【新手阅读建议】先读 evaluateClientHalf 的形参表与闭包调用，再看
 *             DYNAMIC_CLIENT_REDIRECTS 与 closureTraps。
 * ==========================================================================
 */

/**
 * Browser-half closure evaluation: the package source runs as the body of an
 * async function whose parameters ARE the symbol surface. Shadowing parameters
 * (setTimeout/fetch/require/…) turn the ambient browser globals into teaching
 * redirects without touching the page. The host syntax-prechecked the source at
 * define time; SyntaxError handling here is the engine-divergence fallback and
 * reaches the model through the load report.
 */

import * as React from 'react'
import type { CordisDynamicPluginId } from '@deepseek-ai/dsh-api-remotes/client'

/** A mountable plugin as the closure must return it (FUNCTION or OBJECT form). */
export interface DynamicCordisEvaluatedPlugin {
  /** Optional plugin name; the runner overwrites it with the module id. */
  name?: string
  /** Services the browser half declares; the runner overwrites it from the dispatched row. */
  inject?: string[]
  /** Plugin body receiving the guard facade. */
  apply: (ctx: unknown, config?: unknown) => unknown
}

/** What the evaluator needs from the runner to build one package's closure. */
export interface DynamicCordisClosureEnv {
  /** Route `host.call` to this package's host half over the wire. */
  invoke(method: string, args: unknown): Promise<unknown>
  /** Mirror one runtime error text into the load report (console.error copies). */
  noteError(message: string): void
}

const TIMER_REDIRECT
  = 'browser timer globals are unavailable in dynamic packages. Declare inject: [\'timer\'] on the returned plugin, '
    + 'query Client Service.listService for the exact API, and close over that plugin ctx. In React, create timers '
    + 'from an event handler or React.useEffect and return callback-form disposers from the effect cleanup.'

/**
 * Where each withheld browser global sends the author instead. One home for two
 * consumers: the closure traps below throw these, and a render crash whose
 * message names one of them gets the same redirect appended — a package that
 * reached the global some other way (`window.setInterval`) crashes with the
 * engine's own bare text, and the author needs the redirect either way.
 */
export const DYNAMIC_CLIENT_REDIRECTS: Readonly<Record<string, string>> = {
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  clearTimeout: TIMER_REDIRECT,
  clearInterval: TIMER_REDIRECT,
  fetch:
    'network belongs to the HOST half: register a handler there with harness.handle(method, fn) and call it here via host.call(method, args).',
  require:
    'modules cannot be imported here. React arrives as the `React` closure symbol; everything else goes through ctx services or host.call.',
}

/** Callable teaching traps shadowing the ambient globals the closure must not reach. */
/**
 * 构造可调用的教学陷阱：覆盖闭包不应触碰的环境全局（调用即抛带重定向的错误）。
 */
function closureTraps(): Record<string, () => never> {
  const traps: Record<string, () => never> = {}
  for (const [name, redirect] of Object.entries(DYNAMIC_CLIENT_REDIRECTS)) {
    traps[name] = (): never => {
      throw new Error(`${name} is not available in a dynamic client half — ${redirect}`)
    }
  }
  return traps
}

/** The `harness` seat exists only host-side; any touch teaches the split. */
/**
 * harness 只存在于 Host 侧：任何触碰都报"两端分工"的教学错误。
 */
function harnessTrap(): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      throw new Error(
        `harness.${String(prop)} belongs to the HOST half (\`code\`): register handlers there with harness.handle(method, fn); `
        + 'the browser half calls them via host.call(method, args).',
      )
    },
  })
}

/** Per-package style-tag bookkeeping behind the `styles.insert` symbol. */
export class DynamicCordisStyles {
  private readonly tags = new Set<HTMLStyleElement>()

  /** @param pluginId - owning Plugin ID, stamped as `data-dyn` on every tag. */
  constructor(private readonly pluginId: CordisDynamicPluginId) {}

  /**
   * Inject one stylesheet, removed automatically on package unload.
   * @param css - raw CSS text.
   * @returns disposer removing this one tag early.
   */
  insert(css: string): () => void {
    if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
    const tag = document.createElement('style')
    tag.dataset.dyn = this.pluginId
    tag.textContent = css
    document.head.append(tag)
    this.tags.add(tag)
    return () => {
      this.tags.delete(tag)
      tag.remove()
    }
  }

  /** Live tag count (load-report contribution summary). */
  get count(): number {
    return this.tags.size
  }

  /** Remove every tag this package still owns (unload path). */
  dispose(): void {
    for (const tag of this.tags) tag.remove()
    this.tags.clear()
  }
}

/** Stringify one console argument for the error mirror. */
/**
 * 把一条 console 参数转成文本供错误镜像；不可序列化的值给出占位文案。
 */
function errorText(arg: unknown): string {
  if (arg instanceof Error) return arg.message
  if (typeof arg === 'string') return arg
  if (arg === undefined) return 'undefined'
  try {
    return JSON.stringify(arg)
  } catch {
    // A circular or otherwise non-serializable console argument: the mirror
    // carries the message, and nothing else here can fail.
    return '[unserializable console argument]'
  }
}

/** Tagged write-through console; error lines additionally copy into the load report. */
/**
 * 带包标签的直写 console；error 行额外镜像进加载报告（截断到 500 字符）。
 */
function taggedConsole(pluginId: CordisDynamicPluginId, noteError: (message: string) => void): Console {
  const tag = `[cordis:${pluginId}]`
  const forward = (level: 'log' | 'info' | 'warn' | 'error' | 'debug') => (...args: unknown[]): void => {
    console[level](tag, ...args)
    if (level !== 'error') return
    noteError(args.map(errorText).join(' ').slice(0, 500))
  }
  return {
    ...console,
    log: forward('log'),
    info: forward('info'),
    warn: forward('warn'),
    error: forward('error'),
    debug: forward('debug'),
  }
}

/**
 * Narrow a closure return value to a mountable plugin (host guard mirror).
 * @param value - whatever the closure returned.
 * @returns whether the value is mountable.
 */
/**
 * 收窄闭包返回值是否为可挂载插件（Host 守卫的镜像）：函数或带 apply 的对象。
 */
export function isDynamicCordisPlugin(value: unknown): value is DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown) {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null
    && typeof (value as { apply?: unknown }).apply === 'function'
}

/**
 * Evaluate one package's browser half and return the (un-guarded) plugin.
 * @param pluginId - stable Plugin ID (console tag and style ownership).
 * @param clientCode - the browser half's source: an async function body returning a plugin.
 * @param env - runner wiring for `host.call` and error mirroring.
 * @param styles - the package's style bookkeeping (owned by the caller so unload can dispose it).
 * @returns the plugin the closure returned.
 * @throws teaching errors for syntax failures and non-plugin returns.
 */
/**
 * 求值一个包的浏览器半部并返回（未守卫的）插件：以形参注入符号表面，校验返回值
 * 是插件；语法/非插件返回值抛教学错误。
 */
export async function evaluateClientHalf(
  pluginId: CordisDynamicPluginId,
  clientCode: string,
  env: DynamicCordisClosureEnv,
  styles: DynamicCordisStyles,
): Promise<DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown)> {
  const traps = closureTraps()
  const parameters = ['React', 'console', 'styles', 'host', 'harness', ...Object.keys(traps), 'process', 'Buffer']
  let closure: (...args: unknown[]) => Promise<unknown>
  try {
    // The wrapper mirrors the host precheck exactly, so line offsets match.
    // Evaluating a definition's browser half IS this package's product: the
    // source arrived from a host process that accepted and prechecked it.
    // oxlint-disable-next-line typescript/no-implied-eval -- see above
    const factory = new Function(...parameters, `return (async () => {\n${clientCode}\n})()`)
    closure = factory as (...args: unknown[]) => Promise<unknown>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    // Engine-divergence fallback: the host precheck already carried the
    // line/caret teaching; browsers give only the message.
    throw new Error(
      `client half failed to parse in this browser: ${error.message}\n`
      + 'The browser half is plain JavaScript (no JSX, no TypeScript); build elements with React.createElement.',
    )
  }
  const host = {
    /**
     * Call a host-half handler of THIS package (harness.handle pairing). A call
     * with nothing to pass omits the argument: it arrives at the handler as
     * `null`, because the wire carries JSON and `undefined` is not JSON —
     * requiring `host.call('m', {})` would be a ritual, and defaulting to `{}`
     * would invent an empty argument the caller never wrote.
     */
    call: (method: string, args: unknown = null): Promise<unknown> => env.invoke(method, args),
  }
  const returned = await closure(
    React,
    taggedConsole(pluginId, (message) => { env.noteError(message) }),
    styles,
    host,
    harnessTrap(),
    ...Object.values(traps),
    undefined, // process: undefined keeps `typeof process` probes safe
    undefined, // Buffer
  )
  if (!isDynamicCordisPlugin(returned)) {
    if (returned === undefined) {
      throw new Error(
        'client half returned `undefined` — did you forget `return`?\n'
        + '  ✓ return (ctx) => { … }\n'
        + '  ✓ return { name: \'…\', inject: [\'slots\'], apply(ctx) { … } }',
      )
    }
    throw new Error('client half must `return` a plugin: a function, or an object with an `apply(ctx)` method')
  }
  return returned
}
