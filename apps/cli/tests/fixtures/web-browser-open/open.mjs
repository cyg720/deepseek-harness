/**
 * 文件职责：验证 apps/cli 中 open 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * 常量说明：handoffProbe 用于处理 handoffProbe 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const handoffProbe = `
const { writeFileSync } = require('node:fs')
const marker = process.argv[1]
const helperPid = Number(process.argv[2])
setTimeout(() => {
  let helperAlive = true
  if (process.platform === 'win32') {
    try {
      process.kill(helperPid, 0)
    } catch {
      helperAlive = false
    }
  }
  if (helperAlive) writeFileSync(marker, '')
}, 50)
`

/**
 * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
 * @param url （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 open(url)，并按返回类型处理结果。
 */
export default async function open(url) {
  if (process.env.BROWSER_OPEN_TEST_FAILURE !== undefined) {
    throw new Error(process.env.BROWSER_OPEN_TEST_FAILURE)
  }
  /**
   * 常量说明：exchange 用于处理 exchange 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exchange = await fetch(url, { redirect: 'manual' })
  /**
   * 常量说明：setCookie 用于设置 Cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const setCookie = exchange.headers.get('set-cookie')
  /**
   * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const location = exchange.headers.get('location')
  if (exchange.status !== 303 || setCookie === null || location === null) {
    throw new Error(`browser authentication exchange returned HTTP ${exchange.status}`)
  }
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = await fetch(new URL(location, url), {
    headers: { cookie: setCookie.split(';', 1)[0] },
  })
  /**
   * 常量说明：html 用于处理 html 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const html = await response.text()
  console.log(`dsh browser-open: ${JSON.stringify({
    url,
    status: response.status,
    bootManifest: html.includes('__DSH_BOOT__'),
    apiKeyPresent: process.env.DEEPSEEK_API_KEY !== undefined,
    dshHomePresent: process.env.DSH_HOME !== undefined,
  })}`)
  // The Windows launcher writes the server-exit marker only while its helper
  // remains alive, so the assembled test detects an early helper exit.
  /**
   * 常量说明：launcher 用于处理 launcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const launcher = spawn(process.execPath, [
    '--eval', handoffProbe,
    '--', join(process.cwd(), `.dsh-browser-open-${process.ppid}`), String(process.pid),
  ], { stdio: 'ignore' })
  launcher.unref()
  return launcher
}
