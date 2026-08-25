#!/usr/bin/env node
/**
 * Standalone process wrapper for the scriptable mock LLM server.
 * @module @deepseek-ai/dsh-llm-mock-server/src/bin
 */
/*
 * 文件职责：把可脚本化模拟 LLM 服务器包装成独立命令行进程和 JSON 行事件协议。
 * 技术维度：使用 Node 顶层 await、延时 Promise、信号处理和 stdout JSONL 状态事件。
 * 产品维度：供集成测试启动可预测的模型端点，包括先不可用再就绪等启动场景。
 * 逻辑维度：解析参数；帮助模式打印用法，否则可先报告 unavailable/延时，再启动并报告 ready；信号触发幂等关闭。
 * 关键边界：stdout 只输出用法或 JSON 行；错误写 stderr 并设置退出码 1，SIGINT/SIGTERM 使用标准退出码。
 * 新手阅读建议：先看 parsed 的 help/config 分支，再看 unavailable/ready 两个事件，最后看 close 和 catch。
 */

import { setTimeout as delay } from 'node:timers/promises'
import { MOCK_LLM_CLI_USAGE, parseMockLlmCliArgs } from './cli.ts'
import { startMockLlmServer } from './index.ts'

/* v8 ignore start -- thin process/signal glue; parser and server behavior are covered directly */
/* v8 忽略薄进程与信号胶水；参数解析器和服务器行为已有直接测试。 */
try {
  // 解析后的 CLI 结果，可能是 help 或已校验 config。
  const parsed = parseMockLlmCliArgs(process.argv.slice(2))
  if (parsed.kind === 'help') {
    process.stdout.write(MOCK_LLM_CLI_USAGE)
  } else {
    // 服务器选项、监听延时和起始不可用标志。
    const { server: serverOptions, listenDelayMs, startsUnavailable } = parsed.config
    // 对外报告的监听主机，未配置时使用回环地址。
    const host = serverOptions.host ?? '127.0.0.1'
    // 对外报告的监听端口，未配置时为 8000。
    const port = serverOptions.port ?? 8_000
    if (startsUnavailable) {
      process.stdout.write(`${JSON.stringify({
        type: 'unavailable',
        baseURL: `http://${host}:${port}/v1`,
        listenDelayMs,
      })}\n`)
      await delay(listenDelayMs)
    }
    // 已启动模拟服务器；onEvent 将每个脚本事件写成单行 JSON。
    const server = await startMockLlmServer({
      ...serverOptions,
      // 当前服务器事件，序列化后写入 stdout。
      onEvent: (event) => { process.stdout.write(`${JSON.stringify(event)}\n`) },
    })
    process.stdout.write(`${JSON.stringify({
      type: 'ready',
      baseURL: `${server.baseURL}/v1`,
      randomSeed: server.randomSeed,
    })}\n`)
    // 是否已开始关闭，防止两个信号重复执行清理。
    let closing = false
    /** 幂等关闭服务器。@param code 进程退出码。@returns 无。@example close(130)。 */
    const close = (code: number): void => {
      if (closing) return
      closing = true
      void server.close().finally(() => { process.exit(code) })
    }
    process.on('SIGINT', () => { close(130) })
    process.on('SIGTERM', () => { close(143) })
  }
} catch (error: unknown) {
  // 启动或参数错误；Error 取 message，其他值字符串化后连同用法输出。
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${MOCK_LLM_CLI_USAGE}`)
  process.exitCode = 1
}
/* v8 ignore stop */
