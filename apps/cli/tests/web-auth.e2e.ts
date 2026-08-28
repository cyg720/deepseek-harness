/** Real `dsh web` authentication against a temporary Harness home.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 web auth e2e 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 常量说明：REPO_ROOT 用于处理 REPO_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/**
 * 常量说明：DSH_SOURCE_BIN 用于处理 DSH_SOURCE_BIN 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DSH_SOURCE_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
/**
 * 常量说明：TSX_LOADER 用于处理 TSX_LOADER 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const TSX_LOADER = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href

interface RunningWeb {
  readonly child: ChildProcess
  readonly launchUrl: string
  readonly output: () => string
}

interface HttpResult {
  readonly status: number
  readonly body: string
}

/**
 * 功能说明：处理 redact 相关流程；使用场景由所在模块及调用位置决定。
 * @param output （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 redact(output)，并按返回类型处理结果。
 */
function redact(output: string): string {
  return output.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

/** Reserve one concrete loopback port, then release it for the CLI process.
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

/**
 * 功能说明：处理 cleanEnvironment 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param dshHome （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns NodeJS.ProcessEnv；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cleanEnvironment(root, dshHome)，并按返回类型处理结果。
 */
function cleanEnvironment(root: string, dshHome: string): NodeJS.ProcessEnv {
  /**
   * 常量说明：env 用于处理 env 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const env = Object.fromEntries(Object.entries(process.env).filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name])，并按返回类型处理结果。
 */ ([name]) =>
      !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  return {
    ...env,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    SSH_CONNECTION: '',
    SSH_TTY: '',
    TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
  }
}

/** Start the public source CLI and wait for its authenticated readiness URL.
 * @remarks 中文说明：功能说明：启动 Web 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：dshHome（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：port（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<RunningWeb>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 startWeb(root, dshHome,
 * port)，并按返回类型处理结果。 */
async function startWeb(root: string, dshHome: string, port: number): Promise<RunningWeb> {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    'web',
    '--no-open',
    '--port', String(port),
  ], {
    cwd: root,
    env: cleanEnvironment(root, dshHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  /**
   * 变量说明：output 用于处理 output 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let output = ''
  /**
   * 常量说明：launchUrl 用于处理 launchUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const launchUrl = await new Promise<string>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
    /**
     * 变量说明：settled 用于处理 settled 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
      let settled = false
      /**
     * 常量说明：fail 用于处理 fail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
     * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 fail(error)，并按返回类型处理结果。
     */
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      /**
     * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const timer = setTimeout(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
          fail(new Error(`dsh web did not become ready:\n${redact(output)}`))
        }, 90_000)
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
        resolve(match[1])
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.once('error', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
          fail(error)
        })
      child.once('exit', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
 */ (code) => {
          fail(new Error(`dsh web exited before readiness (${String(code)}):\n${redact(output)}`))
        })
    })
  return { child, launchUrl, output: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => output }
}

/**
 * 功能说明：停止 Web 相关流程；使用场景由所在模块及调用位置决定。
 * @param running （RunningWeb）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stopWeb(running)，并按返回类型处理结果。
 */
async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  /**
   * 常量说明：exited 用于处理 exited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exited = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { running.child.once('exit', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }) })
  running.child.kill('SIGTERM')
  /**
   * 常量说明：forced 用于处理 forced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const forced = setTimeout(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
  clearTimeout(forced)
}

/** POST one real Remote envelope while controlling the wire Host header.
 * @remarks 中文说明：功能说明：处理 describeSettings 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：port（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：host（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：cookie（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<HttpResult>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * describeSettings(port, host, cookie)，并按返回类型处理结果。 */
function describeSettings(port: number, host: string, cookie?: string): Promise<HttpResult> {
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'web-auth-real-cli',
    method: 'settings/describe',
    payload: { args: {} },
  })
  return new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
    /**
     * 常量说明：req 用于处理 req 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const req = httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/settings/describe',
        method: 'POST',
        headers: {
          host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...cookie === undefined ? {} : { cookie },
        },
      }, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：res（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(res)，并按返回类型处理结果。
 */ (res) => {
      /**
       * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const chunks: Uint8Array[] = []
        res.on('data', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（Buffer）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
 */ (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
          })
      })
      req.once('error', reject)
      req.end(body)
    })
}

describe('dsh web authentication through the real CLI', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('rejects a forged loopback Host and preserves the browser cookie across restart', { timeout: 180_000 }, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const root = await mkdtemp(join(tmpdir(), 'dsh-web-auth-real-cli-'))
        /**
     * 常量说明：dshHome 用于处理 dshHome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const dshHome = join(root, '.dsh')
        /**
     * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const port = await freePort()
        /**
     * 变量说明：first 用于处理 first 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let first: RunningWeb | undefined
        /**
     * 变量说明：second 用于处理 second 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let second: RunningWeb | undefined
        try {
          first = await startWeb(root, dshHome, port)
          /**
       * 常量说明：firstUrl 用于处理 firstUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const firstUrl = new URL(first.launchUrl)
          expect(firstUrl.origin).toBe(`http://127.0.0.1:${String(port)}`)
          expect(firstUrl.pathname).toBe('/')
          expect(firstUrl.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/u)

          expect(await describeSettings(port, `localhost:${String(port)}`)).toEqual({
            status: 401,
            body: 'unauthorized',
          })

          /**
       * 常量说明：exchange 用于处理 exchange 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const exchange = await fetch(first.launchUrl, { redirect: 'manual' })
          expect(exchange.status).toBe(303)
          expect(exchange.headers.get('location')).toBe('/')
          /**
       * 常量说明：setCookie 用于设置 Cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const setCookie = exchange.headers.get('set-cookie')
          if (setCookie === null) throw new Error('real CLI token exchange omitted Set-Cookie')
          expect(setCookie).toContain('HttpOnly')
          expect(setCookie).toContain('SameSite=Strict')
          expect(setCookie).not.toContain('Secure')
          /**
       * 常量说明：cookie 用于处理 cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const cookie = setCookie.split(';', 1)[0]!

          /**
       * 常量说明：authenticated 用于处理 authenticated 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const authenticated = await describeSettings(port, firstUrl.host, cookie)
          expect(authenticated.status).toBe(200)
          /**
       * 常量说明：authenticatedBody 用于处理 authenticatedBody 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const authenticatedBody = JSON.parse(authenticated.body) as unknown
          expect(authenticatedBody).toMatchObject({
            type: 'server-response',
            rpcId: 'web-auth-real-cli',
            result: { ok: true, value: { namespaces: expect.any(Array) as unknown } },
          })

          await stopWeb(first)
          first = undefined
          second = await startWeb(root, dshHome, port)
          /**
       * 常量说明：secondUrl 用于处理 secondUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const secondUrl = new URL(second.launchUrl)
          expect(secondUrl.searchParams.get('token')).not.toBe(firstUrl.searchParams.get('token'))
          expect((await describeSettings(port, secondUrl.host, cookie)).status).toBe(200)

          /**
       * 常量说明：credentialMode 用于处理 credentialMode 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const credentialMode = (await stat(join(dshHome, '.credentials.yaml'))).mode & 0o777
          expect(credentialMode).toBe(0o600)
        } catch (/* 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ error) {
          /**
       * 常量说明：evidence 用于处理 evidence 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const evidence = [first?.output(), second?.output()].filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ value => value !== undefined).join('\n')
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(evidence)}`, { cause: error })
        } finally {
          if (second !== undefined) await stopWeb(second)
          if (first !== undefined) await stopWeb(first)
          await rm(root, { recursive: true, force: true })
        }
      })
  })
