/** Plain-Node smoke for the built Agent Teams service and Remote contribution.
 * @remarks 文件说明：文件职责：验证 experimental/agent-team 中 built lib e2e 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 常量说明：packageDir 用于处理 packageDir 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const packageDir = fileURLToPath(new URL('..', import.meta.url))
/**
 * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const root = resolve(packageDir, '../../..')
/**
 * 常量说明：artifact 用于处理 artifact 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 artifact 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 artifact(path)，并按返回类型处理结果。
 */
const artifact = (path: string): string => join(root, path)
/**
 * 常量说明：artifactUrl 用于处理 artifactUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 artifactUrl 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 artifactUrl(path)，并按返回类型处理结果。
 */
const artifactUrl = (path: string): string => pathToFileURL(artifact(path)).href

/**
 * 常量说明：requiredArtifacts 用于处理 requiredArtifacts 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
 * 并按返回类型处理结果。
 */
const requiredArtifacts = [
  'packages/experimental/agent-team/lib/index.js',
  'packages/experimental/agent-team/lib/typert.remote-client.js',
].every(path => existsSync(artifact(path)))

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe.skipIf(!requiredArtifacts)('Agent Teams built LIB service', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('loads the Host service and its generated browser contribution under plain Node', async () => {
    /**
     * 常量说明：urls 用于处理 urls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const urls = {
      host: artifactUrl('packages/experimental/agent-team/lib/index.js'),
      remote: artifactUrl('packages/experimental/agent-team/lib/typert.remote-client.js'),
    }
    /**
     * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const script = `
      const host = await import(${JSON.stringify(urls.host)})
      const remote = await import(${JSON.stringify(urls.remote)})
      console.log(JSON.stringify({
        className: host.default.name,
        methods: remote.default.descriptors.map(descriptor => descriptor.id),
      }))
    `

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await runPlainNode(script)
    expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0)
    /**
     * 常量说明：output 用于处理 output 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const output = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
      className: string
      methods: string[]
    }
    expect(output).toEqual({
      className: 'TeamService',
      methods: [
        '@deepseek-ai/dsh-experimental-agent-team#agentTeams/createTask',
        '@deepseek-ai/dsh-experimental-agent-team#agentTeams/updateTask',
        '@deepseek-ai/dsh-experimental-agent-team#agentTeams/view',
      ],
    })
  })
})

/**
 * 功能说明：执行 Plain Node 相关流程；使用场景由所在模块及调用位置决定。
 * @param script （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<{ readonly exitCode: number | null readonly stdout:
 * string re…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 runPlainNode(script)，并按返回类型处理结果。
 */
function runPlainNode(script: string): Promise<{
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolveRun（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolveRun)，并按返回类型处理结果。
   */
  return new Promise((resolveRun) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：stdout（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：stderr（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error, stdout, stderr)，
     * 并按返回类型处理结果。
     */
    execFile(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      resolveRun({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        stdout,
        stderr,
      })
    })
  })
}
