/**
 * 文件职责：验证代码运行时的 built-lib.e2e.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止代码运行时协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * Keyless built-artifact smoke: plain Node imports the package by name through its exports map,
 * then exercises type stripping, sibling `worker.cjs` loading, bindings, and logs. Unit tests use
 * `src/worker.ts`; this pins the downstream `lib/index.js` path. It skips when `lib/` is absent,
 * and CI runs it after the build.
 */

/** 中文说明：测试局部值 pkgDir，由紧邻初始化决定。 */
const pkgDir = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：测试局部值 built，由紧邻初始化决定。 */
const built = ['lib/index.js', 'lib/worker.cjs'].every(file => existsSync(join(pkgDir, file)))
  && existsSync(join(pkgDir, '../code-runtime/lib/index.js'))

describe.skipIf(!built)('built lib real load path (plain node)', () => {
  it('runs a TypeScript program with a binding through lib/index.js and its lib/worker.cjs entry', async () => {
    /** 中文说明：测试局部值 script，由紧邻初始化决定。 */
    const script = `
      /** 中文说明：测试局部值 { Context }，由紧邻初始化决定。 */
      const { Context } = await import('@deepseek-ai/cordis')
      /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
      const { WorkerThreadCodeRuntime } = await import('@deepseek-ai/dsh-code-runtime-worker-thread')
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      await ctx.plugin(WorkerThreadCodeRuntime, {})
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.codeRuntime.run({
        program: 'const doubled: number = await tools.double({ n: 21 }); console.log("halfway", doubled); let failure; try { await tools.fail({}) } catch (error) { failure = { typed: error instanceof ToolCallError, name: error.name, toolName: error.toolName, message: error.message } } return { doubled, failure };',
        bindings: [{
          global: 'tools',
          /** 中文说明：函数 s 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
          functions: {
            double: async args => args.n * 2,
            fail: async () => { throw new Error('denied') },
          },
          errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
        }],
      })
      console.log(JSON.stringify(result))
      process.exit(0)
    `
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { exitCode, stdout, stderr } = await execa(process.execPath, ['--input-type=module', '-e', script], {
      cwd: pkgDir,
      stdin: 'ignore',
      timeout: 55_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    expect(exitCode, `stderr:\n${stderr}`).toBe(0)
    /** 中文说明：测试局部值 lastLine，由紧邻初始化决定。 */
    const lastLine = stdout.trim().split('\n').at(-1) ?? ''
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = JSON.parse(lastLine) as { value?: unknown; logs: string[]; error?: unknown }
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({
      doubled: 42,
      failure: { typed: true, name: 'ToolCallError', toolName: 'fail', message: 'denied' },
    })
    expect(result.logs).toContain('halfway 42')
  })
})
