/** Run the complete repository build and bind its client artifacts to their public environment. */
/**
 * 中文说明：
 * - 文件职责：串行执行仓库库构建和 Web 构建，并记录客户端产物对应的公开构建环境。
 * - 技术维度：使用 Node spawnSync、命令行参数解析、环境变量分层和构建记录文件。
 * - 产品维度：确保发布的客户端静态产物与 profile、提交哈希等公开配置可追溯地绑定。
 * - 逻辑维度：解析 profile，建立父/客户端/构建环境，删除旧记录，执行两项构建后写入新记录。
 * - 关键边界：任一子命令启动或退出失败都会中止；只有直接运行本文件时才执行 main。
 * - 新手阅读建议：先看三个 environment 的递进关系，再跟踪 build:lib、build:web、记录写入顺序。
 */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  clientBuildProcessEnvironment,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Run one package script through the package manager that invoked this build. */
/** 中文：在 environment 下运行一个 pnpm script；失败时抛错，无返回值。示例：runScript('build:web', env)。 */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  /** 当前包管理器命令、参数和平台调用方式。 */
  const invocation = pnpmInvocation(['run', script], environment)
  /** 同步子进程结果；标准输入输出直接继承当前终端。 */
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Run the full build selected by `--profile` or `DSH_BUILD_CLIENT_PROFILE`. */
/** 中文：解析构建 profile 并完成库、Web 与记录构建；无参数和返回值。 */
function main(): void {
  /** 命令行解析结果；values.profile 可省略。 */
  const { values } = parseArgs({
    options: { profile: { type: 'string' } },
    allowPositionals: false,
  })
  /** 仓库根目录绝对路径。 */
  const root = resolve(import.meta.dirname, '..')
  /** 继承当前环境并补入仓库提交哈希的父构建环境。 */
  const parentEnvironment = {
    ...process.env,
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env),
  }
  /** 解析 profile 后允许公开给客户端的构建环境。 */
  const clientEnvironment = resolveClientBuildEnvironment(parentEnvironment, values.profile)
  /** 真正传给构建子进程的环境，包含客户端公开值。 */
  const buildEnvironment = clientBuildProcessEnvironment(parentEnvironment, clientEnvironment)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  runScript('build:lib', buildEnvironment)
  runScript('build:web', buildEnvironment)
  /** 写入后的客户端构建记录，用于报告产物和公开值数量。 */
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) main()
