/**
 * 文件职责：验证 e2b/e2b 中 bin 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-fs-e2b'
import type {} from '@deepseek-ai/dsh-bash-local'
import type {} from '@deepseek-ai/dsh-lsp-stdio'
import type {} from '@deepseek-ai/dsh-terminal-bash'

/**
 * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('usage: bin.ts <cordis.yml>')

/**
 * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ctx = await boot('e2b-composition', resolve(configPath))
/**
 * 常量说明：ownerFiber 用于处理 ownerFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const ownerFiber = ctx.plugin(() => {})
/**
 * 常量说明：ownerId 用于处理 ownerId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ownerId = SessionId('e2b-live-owner')
/**
 * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const session = Session.create(ownerId)
/**
 * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：task（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(task)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const owner: Agent = {
  id: ownerId,
  options: {},
  session,
  inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
  status: 'idle',
  ctx: ownerFiber.ctx,
  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send()，并按返回类型处理结果。
   */
  send() {},
  /**
   * 功能说明：处理 followup 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 followup()，并按返回类型处理结果。
   */
  followup() {},
  /**
   * 功能说明：处理 steer 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 steer()，并按返回类型处理结果。
   */
  steer() {},
  /**
   * 功能说明：处理 inject 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 inject()，并按返回类型处理结果。
   */
  inject() {},
  /**
   * 功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancel()，并按返回类型处理结果。
   */
  cancel() {},
  runMaintenance: task => task(new AbortController().signal),
  whenIdle: () => Promise.resolve(),
}
/**
 * 常量说明：unregisterOwner 用于处理 unregisterOwner 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const unregisterOwner = ctx.agents.register(owner)
/**
 * 变量说明：terminalId 用于处理 terminalId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let terminalId: Awaited<ReturnType<typeof ctx.terminals.spawn>>['sessionId'] | undefined
try {
  /**
   * 常量说明：sandbox 用于处理 sandbox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sandbox = await ctx.e2b.getSandbox()
  /**
   * 常量说明：fromFs 用于处理 fromFs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fromFs = await ctx.fs.resolve('from-fs.txt')
  /**
   * 常量说明：written 用于处理 written 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const written = await ctx.fs.writeText(fromFs, 'written-by-fs\n', { kind: 'createIfAbsent' })
  /**
   * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observed = await ctx.fs.stat(fromFs)
  if (observed?.version !== written.version) {
    throw new Error(`E2B rename did not preserve version metadata: ${JSON.stringify({ written, observed })}`)
  }
  await ctx.fs.editText(
    fromFs,
    { oldString: 'written-by-fs', newString: 'versioned-by-fs', replaceAll: false },
    { version: observed.version },
  )
  /**
   * 常量说明：bashRead 用于处理 bashRead 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bashRead = await ctx.shell.run(ctx.shell.resolve({ command: 'cat from-fs.txt' }))
  if (bashRead.exitCode !== 0 || bashRead.stdout.text !== 'versioned-by-fs\n') {
    throw new Error(`E2B Bash could not read the FS write: ${JSON.stringify(bashRead)}`)
  }

  /**
   * 常量说明：bashWrite 用于处理 bashWrite 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bashWrite = await ctx.shell.run(ctx.shell.resolve({ command: "printf 'written-by-bash\\n' > from-bash.txt" }))
  if (bashWrite.exitCode !== 0) {
    throw new Error(`E2B Bash could not write the shared filesystem: ${JSON.stringify(bashWrite)}`)
  }
  /**
   * 常量说明：fromBash 用于处理 fromBash 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fromBash = await ctx.fs.resolve('from-bash.txt')
  /**
   * 常量说明：fsRead 用于处理 fsRead 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fsRead = await ctx.fs.readText(fromBash)

  /**
   * 常量说明：environmentHandle 用于处理 environmentHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const environmentHandle = ctx.subprocess.spawn({
    argv: ['env'],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 4_096 } },
    graceMs: 500,
    env: {
      'FOO-BAR': 'hyphen-value',
      DSH_EXPLICIT: 'managed-value',
      TOKEN_EXPLICIT: 'credential-value',
    },
  })
  /**
   * 常量说明：environmentOutcome 用于处理 environmentOutcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const environmentOutcome = await environmentHandle.done
  /**
   * 常量说明：environmentText 用于处理 environmentText 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const environmentText = environmentHandle.collected.stdout?.readFrom(0).text
  if (environmentOutcome.exitCode !== 0 || environmentText === undefined) {
    throw new Error(`E2B subprocess environment probe failed: ${JSON.stringify(environmentOutcome)}`)
  }
  /**
   * 常量说明：environmentLines 用于处理 environmentLines 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const environmentLines = new Set(environmentText.trimEnd().split('\n'))
  /**
   * 常量说明：explicitEnvironment 用于处理 explicitEnvironment 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  const explicitEnvironment = [
    'FOO-BAR=hyphen-value',
    'DSH_EXPLICIT=managed-value',
    'TOKEN_EXPLICIT=credential-value',
  ].every(entry => environmentLines.has(entry))
  if (!explicitEnvironment) throw new Error(`E2B subprocess dropped an explicit environment entry: ${environmentText}`)

  /**
   * 常量说明：splitUtf8Handle 用于处理 splitUtf8Handle 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const splitUtf8Handle = ctx.subprocess.spawn({
    argv: ['bash', '-c', "printf '\\344'; sleep 0.05; printf '\\275'; sleep 0.05; printf '\\240'; sleep 0.05; printf '\\345'; sleep 0.05; printf '\\245'; sleep 0.05; printf '\\275'"],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 32 }, stderr: { maxBytes: 4_096 } },
    graceMs: 500,
    env: {},
  })
  /**
   * 常量说明：splitUtf8Outcome 用于处理 splitUtf8Outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const splitUtf8Outcome = await splitUtf8Handle.done
  /**
   * 常量说明：splitUtf8Output 用于处理 splitUtf8Output 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const splitUtf8Output = splitUtf8Handle.collected.stdout?.readFrom(0).text
  if (splitUtf8Outcome.exitCode !== 0 || splitUtf8Output !== '你好') {
    throw new Error(`E2B subprocess corrupted split UTF-8 output: ${JSON.stringify({ splitUtf8Outcome, splitUtf8Output })}`)
  }

  /**
   * 常量说明：outputDrainStarted 用于处理 outputDrainStarted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const outputDrainStarted = Date.now()
  /**
   * 常量说明：outputDrainHandle 用于处理 outputDrainHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const outputDrainHandle = ctx.subprocess.spawn({
    argv: ['bash', '-c', "bash -c 'exec -a dsh-output-drain-descendant sleep 30' & printf 'leader-done\\n'"],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64 }, stderr: { maxBytes: 4_096 } },
    graceMs: 250,
    env: {},
  })
  /**
   * 常量说明：outputDrainOutcome 用于处理 outputDrainOutcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const outputDrainOutcome = await outputDrainHandle.done
  /**
   * 常量说明：outputDrainText 用于处理 outputDrainText 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const outputDrainText = outputDrainHandle.collected.stdout?.readFrom(0).text
  /**
   * 常量说明：outputDrainElapsedMs 用于处理 outputDrainElapsedMs 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const outputDrainElapsedMs = Date.now() - outputDrainStarted
  outputDrainHandle.terminate()
  /**
   * 常量说明：outputDrainExited 用于处理 outputDrainExited 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const outputDrainExited = await outputDrainHandle.waitForExit(AbortSignal.timeout(5_000))
  /**
   * 常量说明：outputDrainProcesses 用于处理 outputDrainProcesses 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const outputDrainProcesses = await sandbox.commands.list()
  /**
   * 常量说明：outputDrainClean 用于处理 outputDrainClean 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：processInfo（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(processInfo)，并按返回类型处理结果。
   */
  const outputDrainClean = !outputDrainProcesses.some(processInfo =>
    JSON.stringify([processInfo.cmd, processInfo.args]).includes('dsh-output-drain-descendant'),
  )
  if (outputDrainOutcome.exitCode !== 0 || outputDrainText !== 'leader-done\n'
    || outputDrainElapsedMs >= 10_000 || !outputDrainExited || !outputDrainClean) {
    throw new Error(`E2B subprocess did not bound descendant-held output: ${JSON.stringify({
      outputDrainOutcome, outputDrainText, outputDrainElapsedMs, outputDrainExited, outputDrainClean,
    })}`)
  }

  /**
   * 常量说明：lspFixture 用于处理 lspFixture 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const lspFixture = await readFile(new URL('./fixture-lsp.mjs', import.meta.url), 'utf8')
  /**
   * 常量说明：remoteLspFixture 用于处理 remoteLspFixture 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const remoteLspFixture = await ctx.fs.resolve('fixture-lsp.mjs')
  await ctx.fs.writeText(remoteLspFixture, lspFixture, { kind: 'createIfAbsent' })
  /**
   * 常量说明：remoteSource 用于处理 remoteSource 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const remoteSource = await ctx.fs.resolve('multibyte # file.ts')
  await ctx.fs.writeText(remoteSource, 'const café = "你好"\nconsole.log(café)\n', { kind: 'createIfAbsent' })
  /**
   * 常量说明：hover 用于处理 hover 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const hover = await ctx.lsp.query({
    operation: 'hover',
    filePath: 'multibyte # file.ts',
    position: { line: 0, character: 7 },
    workspaceRoot: process.cwd(),
  })
  /**
   * 常量说明：definition 用于处理 definition 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const definition = await ctx.lsp.query({
    operation: 'goToDefinition',
    filePath: 'multibyte # file.ts',
    position: { line: 0, character: 7 },
    workspaceRoot: process.cwd(),
  })

  /**
   * 常量说明：terminal 用于处理 terminal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const terminal = await ctx.terminals.spawn(owner, { type: 'shell' })
  terminalId = terminal.sessionId
  /**
   * 常量说明：terminalEcho 用于处理 terminalEcho 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const terminalEcho = await ctx.terminals.startSend(owner, terminal.sessionId, {
    text: "printf 'PTY-你好\\n'",
    submit: true,
  }).done
  /**
   * 常量说明：sleeping 用于处理 sleeping 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sleeping = ctx.terminals.startSend(owner, terminal.sessionId, {
    text: "printf 'DSH_SLEEP_%s\\n' READY; sleep 30",
    submit: true,
  })
  /**
   * 变量说明：sleepReadyOutput 用于处理 sleepReadyOutput 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let sleepReadyOutput = ''
  /**
   * 常量说明：sleepReadyDeadline 用于处理 sleepReadyDeadline 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const sleepReadyDeadline = Date.now() + 5_000
  while (!sleepReadyOutput.includes('DSH_SLEEP_READY\n')) {
    sleepReadyOutput += sleeping.readOutput().delta
    if (sleepReadyOutput.includes('DSH_SLEEP_READY\n')) break
    /**
     * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：result（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(result)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolveDelay（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolveDelay)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const settled = await Promise.race([
      sleeping.done.then(result => ({ result })),
      new Promise<undefined>(resolveDelay => setTimeout(() => { resolveDelay(undefined) }, 25)),
    ])
    if (settled !== undefined) {
      throw new Error(`E2B PTY successor settled before executing: ${JSON.stringify(settled.result)}`)
    }
    if (Date.now() >= sleepReadyDeadline) throw new Error(`E2B PTY successor did not execute: ${sleepReadyOutput}`)
  }
  /**
   * 常量说明：terminalSignal 用于处理 terminalSignal 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const terminalSignal = await ctx.terminals.signal(owner, terminal.sessionId, 'SIGINT')
  /**
   * 常量说明：interrupted 用于处理 interrupted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const interrupted = await sleeping.done
  /**
   * 常量说明：stubborn 用于处理 stubborn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stubborn = await ctx.terminals.startSend(owner, terminal.sessionId, {
    text: "bash -c 'trap \"\" TERM; exec sleep 30' & printf 'DSH_STUBBORN_PID=%s\\n' \"$!\"",
    submit: true,
  }).done
  /**
   * 常量说明：stubbornMatch 用于处理 stubbornMatch 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const stubbornMatch = /DSH_STUBBORN_PID=([1-9][0-9]*)/.exec(stubborn.viewport)
  if (stubbornMatch?.[1] === undefined) throw new Error(`E2B PTY did not report its stubborn child: ${stubborn.viewport}`)
  /**
   * 常量说明：stubbornPid 用于处理 stubbornPid 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const stubbornPid = Number(stubbornMatch[1])
  /**
   * 常量说明：terminalScrollback 用于处理 terminalScrollback 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const terminalScrollback = ctx.terminals.read(owner, terminal.sessionId, { count: 50 })
  await ctx.terminals.kill(owner, terminal.sessionId, 'live E2B composition complete')
  terminalId = undefined
  /**
   * 常量说明：stubbornProbe 用于处理 stubbornProbe 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const stubbornProbe = await sandbox.commands.run(`if kill -0 ${stubbornPid} 2>/dev/null; then printf alive; else printf gone; fi`)
  /**
   * 常量说明：terminalTreeCleanup 用于处理 terminalTreeCleanup 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const terminalTreeCleanup = stubbornProbe.stdout === 'gone'
  if (!terminalTreeCleanup) throw new Error(`E2B PTY left process ${stubbornPid} alive after close`)

  process.stdout.write(`${JSON.stringify({
    sandboxId: (await ctx.e2b.getSandbox()).sandboxId,
    bashRead: bashRead.stdout.text,
    fsRead,
    explicitEnvironment,
    splitUtf8Output,
    hover,
    definition,
    terminal: {
      motd: terminal.motd,
      echo: terminalEcho,
      signal: terminalSignal,
      interrupted,
      treeCleanup: terminalTreeCleanup,
      scrollback: terminalScrollback.text,
    },
  })}\n`)
} finally {
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
  */
  if (terminalId !== undefined) await ctx.terminals.kill(owner, terminalId, 'fixture cleanup').catch(() => false)
  unregisterOwner()
  await ownerFiber.dispose()
  await ctx.fiber.dispose()
}
