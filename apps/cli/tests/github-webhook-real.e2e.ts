/** Real CLI and DeepSeek evidence for a GitHub webhook-created Session.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 github webhook real e2e 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'

/**
 * 常量说明：REPO_ROOT 用于处理 REPO_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/**
 * 常量说明：BUILT_BIN 用于处理 BUILT_BIN 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const BUILT_BIN = join(REPO_ROOT, 'apps/cli/lib/bin.js')
/**
 * 常量说明：OVERLAY 用于处理 OVERLAY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OVERLAY = fileURLToPath(new URL(
  './fixtures/github-webhook/cordis.yml',
  import.meta.url,
))
/**
 * 常量说明：SECRET 用于处理 SECRET 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SECRET = 'github-webhook-real-e2e-secret'
/**
 * 常量说明：DELIVERY 用于处理 DELIVERY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DELIVERY = 'github-webhook-real-e2e-delivery'
/**
 * 常量说明：MARKER 用于处理 MARKER 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MARKER = 'DSH_GITHUB_WEBHOOK_REAL_E2E_OK'
/**
 * 常量说明：TITLE 用于处理 TITLE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const TITLE = 'GitHub webhook real e2e'
/**
 * 常量说明：authenticatedCookies 用于处理 authenticatedCookies 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const authenticatedCookies = new Map<string, Promise<{ origin: string; cookie: string }>>()

/** Exchange the printed process token once for Node-side API probes.
 * @remarks 中文说明：功能说明：处理 authenticatedWeb 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：launchUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{
 * origin: string; cookie: string }>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 authenticatedWeb(launchUrl)，并按返回类型处理结果。 */
function authenticatedWeb(launchUrl: string): Promise<{ origin: string; cookie: string }> {
  /**
   * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const existing = authenticatedCookies.get(launchUrl)
  if (existing !== undefined) return existing
  /**
   * 常量说明：exchange 用于处理 exchange 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exchange = (/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const response = await fetch(launchUrl, { redirect: 'manual' })
      /**
     * 常量说明：setCookie 用于设置 Cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const setCookie = response.headers.get('set-cookie')
      if (response.status !== 303 || setCookie === null) {
        throw new Error(`dsh web authentication returned HTTP ${String(response.status)}`)
      }
      return { origin: new URL(launchUrl).origin, cookie: setCookie.split(';', 1)[0]! }
    })()
  authenticatedCookies.set(launchUrl, exchange)
  return exchange
}

interface SessionList {
  items: Array<{
    sessionId: string
    cwd?: string
    blank: boolean
    projections?: { values: { agentPreset?: string | null } }
  }>
}

interface WorkspaceBaseline {
  items: Array<{
    path: string
    sessionIds: string[]
  }>
}

interface HistoryPage {
  records: Array<{ type: 'event'; event: HistoryEvent }>
  hasMore: boolean
}

interface HistoryEvent {
  type: string
  data: unknown
}

interface ProcessObservation {
  readonly ready: Promise<string>
  readonly text: () => string
}

/**
 * 功能说明：判断是否为 Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRecord(value)，并按返回类型处理结果。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Capture bounded process output and resolve the public Web URL after settled boot.
 * @remarks 中文说明：功能说明：处理 observeProcess 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：child（ChildProcess）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ProcessObservation；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * observeProcess(child)，并按返回类型处理结果。 */
function observeProcess(child: ChildProcess): ProcessObservation {
  /**
   * 变量说明：output 用于处理 output 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let output = ''
  /**
   * 变量说明：settled 用于处理 settled 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let settled = false
  /**
   * 变量说明：resolveReady 用于解析 Ready 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let resolveReady!: (url: string) => void
  /**
   * 变量说明：rejectReady 用于处理 rejectReady 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let rejectReady!: (error: Error) => void
  /**
   * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ready = new Promise<string>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
  /**
   * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const timer = setTimeout(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
      if (!settled) rejectReady(new Error(`dsh web did not become ready within 90s:\n${output}`))
    }, 90_000)
  timer.unref()
  /**
   * 常量说明：append 用于处理 append 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。
   * @param chunk （Buffer | string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 append(chunk)，并按返回类型处理结果。
   */
  const append = (chunk: Buffer | string): void => {
    output = `${output}${String(chunk)}`.slice(-100_000)
    /**
     * 常量说明：match 用于处理 match 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
    if (settled || match?.[1] === undefined) return
    settled = true
    clearTimeout(timer)
    resolveReady(match[1].replace('0.0.0.0', '127.0.0.1'))
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.once('error', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
      if (!settled) rejectReady(error)
    })
  child.once('exit', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
 */ (code) => {
      if (!settled) rejectReady(new Error(`dsh web exited before readiness (code ${String(code)}):\n${output}`))
    })
  return { ready, text: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => output }
}

/** Reserve and release one loopback port for the isolated webhook listener.
 * @remarks 中文说明：功能说明：处理 freePort 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：Promise<number>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * freePort()，并按返回类型处理结果。 */
async function freePort(): Promise<number> {
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const server = createServer()
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
  /**
   * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      server.close(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
    })
  return port
}

/** Invoke one public Remote method over its HTTP carrier.
 * @remarks 中文说明：功能说明：处理 remoteRpc 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：baseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：endpoint（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：args（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 remoteRpc(baseUrl,
 * endpoint, args)，并按返回类型处理结果。 */
async function remoteRpc<T>(baseUrl: string, endpoint: string, args: object): Promise<T> {
  /**
   * 常量说明：authenticated 用于处理 authenticated 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const authenticated = await authenticatedWeb(baseUrl)
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = await fetch(`${authenticated.origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authenticated.cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `github-webhook-real-${endpoint}-${randomUUID()}`,
      method: endpoint,
      payload: { args },
    }),
  })
  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${String(response.status)}: ${await response.text()}`)
  }
  /**
   * 常量说明：envelope 用于处理 envelope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const envelope = await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (!envelope.result.ok) {
    throw new Error(`${endpoint} failed: ${envelope.result.error.code}: ${envelope.result.error.message}`)
  }
  return envelope.result.value
}

/** Read one opening item from a public Remote stream.
 * @remarks 中文说明：功能说明：处理 openingStreamItem 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：baseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：endpoint（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：args（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：accepts（(value:
 * unknown) => boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 openingStreamItem(baseUrl, endpoint, args, accepts)，
 * 并按返回类型处理结果。 */
async function openingStreamItem(
  baseUrl: string,
  endpoint: string,
  args: object,
  accepts: (value: unknown) => boolean,
): Promise<Record<string, unknown>> {
  /**
   * 常量说明：authenticated 用于处理 authenticated 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const authenticated = await authenticatedWeb(baseUrl)
  /**
   * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const socket = new WebSocket(`${authenticated.origin.replace(/^http/u, 'ws')}/api/remote.mux`, {
    headers: { cookie: authenticated.cookie },
  })
  /**
   * 常量说明：streamId 用于处理 streamId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const streamId = `github-webhook-real-${endpoint}-${randomUUID()}`
  try {
    await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      /**
       * 常量说明：cleanup 用于处理 cleanup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 cleanup 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 cleanup()，并按返回类型处理结果。
       */
        const cleanup = (): void => {
          socket.removeEventListener('open', opened)
          socket.removeEventListener('error', failed)
          socket.removeEventListener('close', closed)
        }
        /**
       * 常量说明：opened 用于处理 opened 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 opened 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 opened()，并按返回类型处理结果。
       */
        const opened = (): void => {
          cleanup()
          resolve()
        }
        /**
       * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 failed 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 failed()，并按返回类型处理结果。
       */
        const failed = (): void => {
          cleanup()
          reject(new Error(`${endpoint} carrier failed before opening`))
        }
        /**
       * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 closed 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 closed()，并按返回类型处理结果。
       */
        const closed = (): void => {
          cleanup()
          reject(new Error(`${endpoint} carrier closed before opening`))
        }
        socket.addEventListener('open', opened)
        socket.addEventListener('error', failed)
        socket.addEventListener('close', closed)
      })
    return await new Promise<Record<string, unknown>>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
      /**
       * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const timer = setTimeout(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { finish(new Error(`${endpoint} did not publish its opening item`)) }, 10_000)
        /**
       * 常量说明：cleanup 用于处理 cleanup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 cleanup 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 cleanup()，并按返回类型处理结果。
       */
        const cleanup = (): void => {
          clearTimeout(timer)
          socket.removeEventListener('message', message)
          socket.removeEventListener('error', failed)
          socket.removeEventListener('close', closed)
        }
        /**
       * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 finish 相关流程；使用场景由所在模块及调用位置决定。
       * @param error （Error | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param value （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 finish(error, value)，并按返回类型处理结果。
       */
        const finish = (error: Error | undefined, value?: Record<string, unknown>): void => {
          cleanup()
          if (error !== undefined) reject(error)
          else if (value === undefined) reject(new Error(`${endpoint} opening item was absent`))
          else resolve(value)
        }
        /**
       * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 message 相关流程；使用场景由所在模块及调用位置决定。
       * @param event （WebSocket.MessageEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 message(event)，并按返回类型处理结果。
       */
        const message = (event: WebSocket.MessageEvent): void => {
          try {
          /**
           * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
            const text = typeof event.data === 'string'
              ? event.data
              : Buffer.isBuffer(event.data) ? event.data.toString('utf8') : undefined
            if (text === undefined) throw new Error(`${endpoint} published a non-text frame`)
            /**
           * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
            const frame: unknown = JSON.parse(text)
            if (!isRecord(frame) || frame.streamId !== streamId) return
            if (frame.type === 'error') {
              finish(new Error(`${endpoint} failed: ${JSON.stringify(frame.error)}`))
              return
            }
            if (frame.type === 'end') {
              finish(new Error(`${endpoint} ended before its opening item`))
              return
            }
            if (frame.type === 'item' && isRecord(frame.value) && accepts(frame.value)) {
              finish(undefined, frame.value)
            }
          } catch (/* 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        }
        /**
       * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 failed 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 failed()，并按返回类型处理结果。
       */
        const failed = (): void => { finish(new Error(`${endpoint} carrier failed before its opening item`)) }
        /**
       * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 closed 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 closed()，并按返回类型处理结果。
       */
        const closed = (): void => { finish(new Error(`${endpoint} carrier closed before its opening item`)) }
        socket.addEventListener('message', message)
        socket.addEventListener('error', failed)
        socket.addEventListener('close', closed)
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
      })
  } finally {
    socket.close()
  }
}

/** Read the current Workspace baseline from a fresh follow generation.
 * @remarks 中文说明：功能说明：处理 workspaceBaseline 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：baseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<WorkspaceBaseline>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 workspaceBaseline(baseUrl)，并按返回类型处理结果。 */
async function workspaceBaseline(baseUrl: string): Promise<WorkspaceBaseline> {
  /**
   * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frame = await openingStreamItem(
    baseUrl,
    'workspace/follow',
    {},
    /*
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */ value => isRecord(value) && value.type === 'baseline' && isRecord(value.value),
  )
  return frame.value as WorkspaceBaseline
}

/** Read the complete opening page from a fresh Session follow generation.
 * @remarks 中文说明：功能说明：处理 history 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：baseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<HistoryPage>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * history(baseUrl, sessionId)，并按返回类型处理结果。 */
async function history(baseUrl: string, sessionId: string): Promise<HistoryPage> {
  /**
   * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frame = await openingStreamItem(
    baseUrl,
    'session/follow',
    { request: { address: { kind: 'session', sessionId }, maxMessages: 100 } },
    /*
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */ value => isRecord(value)
      && value.type === 'snapshot'
      && Array.isArray(value.records)
      && typeof value.hasMore === 'boolean',
  )
  return { records: frame.records as HistoryPage['records'], hasMore: frame.hasMore as boolean }
}

/** Poll a public observation until it satisfies the test's behavior predicate.
 * @remarks 中文说明：功能说明：处理 eventually 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：child（ChildProcess）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：processOutput（() => string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：probe（() =>
 * Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：accepts（(value: T) =>
 * boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：timeoutMs（number）：提供本次调用所需的数
 * 据；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 eventually(child, processOutput, label, probe,
 * accepts, timeoutMs)，并按返回类型处理结果。 */
async function eventually<T>(
  child: ChildProcess,
  processOutput: () => string,
  label: string,
  probe: () => Promise<T>,
  accepts: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  /**
   * 常量说明：deadline 用于处理 deadline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const deadline = Date.now() + timeoutMs
  /**
   * 变量说明：lastValue 用于处理 lastValue 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let lastValue: T | undefined
  /**
   * 变量说明：lastError 用于处理 lastError 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh web exited while waiting for ${label} (code ${String(child.exitCode)}):\n${processOutput()}`)
    }
    try {
      lastValue = await probe()
      if (accepts(lastValue)) return lastValue
    } catch (/* 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ error) {
      lastError = error
    }
    await delay(300)
  }
  throw new Error(
    `timed out waiting for ${label}; last value=${JSON.stringify(lastValue)}; `
    + `last error=${String(lastError)}; process output:\n${processOutput()}`,
  )
}

/** Return every text block from durable assistant messages.
 * @remarks 中文说明：功能说明：处理 assistantText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：page（HistoryPage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 assistantText(page)，
 * 并按返回类型处理结果。 */
function assistantText(page: HistoryPage): string {
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text: string[] = []
  for (const /* 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ event of historyEvents(page)) {
    if (event.type !== 'assistant/message' || !isRecord(event.data) || !isRecord(event.data.message)) continue
    /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const content = event.data.message.content
    if (!Array.isArray(content)) continue
    for (const /* 变量说明：block 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ block of content) {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') text.push(block.text)
    }
  }
  return text.join('\n')
}

/** Read scalar v2 history records for assertions over the public event stream. */
function historyEvents(page: HistoryPage): HistoryEvent[] {
  return page.records.map(record => record.event)
}

/** Stop the spawned CLI through its normal signal path, escalating only on a stuck teardown.
 * @remarks 中文说明：功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：child（ChildProcess）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stop(child)，并按返回类型处理结果。 */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  /**
   * 变量说明：resolveClosed 用于解析 Closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let resolveClosed!: () => void
  /**
   * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const closed = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { resolveClosed = resolve })
  child.once('close', resolveClosed)
  child.kill('SIGTERM')
  if (await Promise.race([closed.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => true), delay(10_000, false, { ref: false })])) return
  if (child.exitCode === null) child.kill('SIGKILL')
  await Promise.race([closed, delay(5_000, undefined, { ref: false })])
}

/** Send the sole synthetic external interaction: one signed GitHub delivery.
 * @remarks 中文说明：功能说明：处理 sendGitHubDelivery 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：origin（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<Response>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sendGitHubDelivery(origin)，并按返回类型处理结果。 */
async function sendGitHubDelivery(origin: string): Promise<Response> {
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = JSON.stringify({
    action: 'ready_for_review',
    number: 4242,
    repository: { full_name: 'deepseek-harness/deepseek-harness' },
    pull_request: {
      title: 'Real CLI webhook e2e',
      html_url: 'https://github.com/deepseek-harness/deepseek-harness/pull/4242',
      draft: false,
      user: { login: 'octocat' },
      base: { ref: 'master', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      head: { ref: 'webhook-e2e', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    },
  })
  /**
   * 常量说明：signature 用于处理 signature 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
  return await fetch(`${origin}/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': DELIVERY,
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    },
    body,
  })
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('GitHub webhook through the real dsh CLI and model', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('creates, attaches, prompts, and completes a Workspace Session', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        expect(existsSync(BUILT_BIN), `missing built CLI ${BUILT_BIN}; run pnpm run build:official`).toBe(true)
        /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const root = await mkdtemp(join(tmpdir(), 'dsh-github-webhook-real-'))
        /**
     * 常量说明：workspacePath 用于处理 workspacePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const workspacePath = join(root, 'workspace')
        await mkdir(workspacePath)
        /**
     * 常量说明：canonicalWorkspacePath 用于处理 canonicalWorkspacePath 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const canonicalWorkspacePath = await realpath(workspacePath)
        /**
     * 常量说明：webhookPort 用于处理 webhookPort 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const webhookPort = await freePort()
        /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const child = spawn(process.execPath, [
          BUILT_BIN,
          'web',
          '--patch', OVERLAY,
          '--no-open',
          '--host', '127.0.0.1',
          '--port', '0',
        ], {
          cwd: root,
          env: {
            ...process.env,
            DSH_AGENTS_HOME: join(root, '.agents'),
            DSH_GITHUB_E2E_MARKER: MARKER,
            DSH_GITHUB_E2E_WORKSPACE: workspacePath,
            DSH_GITHUB_WEBHOOK_PORT: String(webhookPort),
            DSH_GITHUB_WEBHOOK_SECRET: SECRET,
            DSH_HOME: join(root, '.dsh'),
            DSH_TELEMETRY_DISABLED: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        /**
     * 常量说明：observation 用于处理 observation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const observation = observeProcess(child)

        try {
          /**
       * 常量说明：baseUrl 用于处理 baseUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const baseUrl = await observation.ready
          /**
       * 常量说明：webhookOrigin 用于处理 webhookOrigin 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const webhookOrigin = `http://127.0.0.1:${String(webhookPort)}`

          expect((await fetch(`${webhookOrigin}/api`)).status).toBe(404)
          expect((await sendGitHubDelivery(new URL(baseUrl).origin)).status).not.toBe(202)
          expect((await sendGitHubDelivery(webhookOrigin)).status).toBe(202)

          /**
       * 常量说明：workspaces 用于处理 workspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const workspaces = await eventually(
            child,
            observation.text,
            'one Workspace-attached Session',
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */ async () => await workspaceBaseline(baseUrl),
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
         */ value => value.items.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：workspace（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(workspace)，并按返回类型处理结果。
 */ workspace =>
                workspace.path === canonicalWorkspacePath && workspace.sessionIds.length === 1),
            30_000,
          )
          /**
       * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const workspace = workspaces.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.path === canonicalWorkspacePath)
          /**
       * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const sessionId = workspace?.sessionIds[0]
          if (sessionId === undefined) throw new Error('workspace/follow did not expose the webhook Session')

          /**
       * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const sessions = await remoteRpc<SessionList>(baseUrl, 'session/list', { _request: {} })
          expect(sessions.items.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session)，并按返回类型处理结果。
 */ session => session.sessionId === sessionId)).toMatchObject({
            blank: false,
            cwd: canonicalWorkspacePath,
            projections: { values: { agentPreset: 'minimal' } },
          })

          /**
       * 常量说明：admitted 用于处理 admitted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const admitted = await eventually(
            child,
            observation.text,
            'webhook provenance, title, and permission events',
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */ async () => await history(baseUrl, sessionId),
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：page（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(page)，并按返回类型处理结果。
         */ (page) => {
              /**
           * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
              const events = historyEvents(page)
              /**
           * 常量说明：title 用于处理 title 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
              const title = events.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.type === 'session/title')
              /**
           * 常量说明：permission 用于处理 permission 相关数据，作用于当前作用域；初始化后不可重新赋值，
           * 但对象内部是否可变仍由其类型决定。
           */
              const permission = events.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event =>
                  event.type === 'permission/preset'
            && isRecord(event.data)
            && event.data.preset === 'read-only')
              /**
           * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
              const message = events.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event =>
                  event.type === 'user/message'
            && isRecord(event.data)
            && isRecord(event.data.source)
            && event.data.source.kind === 'webhook')
              return isRecord(title?.data) && title.data.title === TITLE
            && permission !== undefined
            && isRecord(message?.data) && isRecord(message.data.source)
            && message.data.source.provider === 'github'
            && message.data.source.deliveryId === DELIVERY
            },
            30_000,
          )
          /**
       * 常量说明：webhookMessage 用于处理 webhookMessage 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const webhookMessage = historyEvents(admitted)
            .find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */ event => event.type === 'user/message'
          && isRecord(event.data)
          && isRecord(event.data.source)
          && event.data.source.kind === 'webhook')
          expect(webhookMessage?.data).toMatchObject({
            content: [{ type: 'text', text: `Reply with exactly ${MARKER} and no other text. Do not call tools.` }],
            source: {
              kind: 'webhook',
              provider: 'github',
              deliveryId: DELIVERY,
              ruleId: 'github-real-e2e',
              source: 'github-real-e2e',
            },
          })

          /**
       * 常量说明：completed 用于处理 completed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const completed = await eventually(
            child,
            observation.text,
            'a real DeepSeek assistant response',
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */ async () => await history(baseUrl, sessionId),
            /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：page（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(page)，并按返回类型处理结果。
         */ page => assistantText(page).includes(MARKER),
            150_000,
          )
          expect(assistantText(completed)).toContain(MARKER)
        } finally {
          await stop(child)
          await rm(root, { recursive: true, force: true })
        }
      }, 330_000)
  })
