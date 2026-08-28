/**
 * 文件职责：验证 apps/cli 中 agent team headless e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

/**
 * 常量说明：dshBinScript 用于处理 dshBinScript 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
/**
 * 常量说明：tsconfigPath 用于处理 tsconfigPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/**
 * 常量说明：fixturePlugin 用于处理 fixturePlugin 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const fixturePlugin = pathToFileURL(fileURLToPath(
  new URL('./profiles/headless/tests/fixtures/team-llm.mjs', import.meta.url),
)).href

/**
 * 功能说明：处理 records 相关流程；使用场景由所在模块及调用位置决定。
 * @param content （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 records(content)，并按返回类型处理结果。
 */
function records(content: string): Record<string, unknown>[] {
  return content.split('\n').filter(Boolean).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
 */ line => JSON.parse(line) as Record<string, unknown>)
}

describe('dsh run with Agent Teams enabled', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('runs two teammates, durable peer mail, dependent tasks, waiting, and final aggregation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cwd = await mkdtemp(join(tmpdir(), 'dsh-agent-team-headless-'))
        try {
          /**
       * 常量说明：home 用于处理 home 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const home = join(cwd, '.dsh')
          /**
       * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const sessions = join(home, 'sessions')
          /**
       * 常量说明：profileDir 用于处理 profileDir 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const profileDir = join(home, 'profiles', 'headless')
          await mkdir(profileDir, { recursive: true })
          await writeFile(join(profileDir, 'package.json'), JSON.stringify({
            name: 'dsh-profile-headless',
            private: true,
            dependencies: {
              '@deepseek-ai/dsh-experimental-agent-team-profile': 'workspace:^',
            },
            dsh: {
              profile: {
                bundles: [
                  '@deepseek-ai/dsh-base',
                  '@deepseek-ai/dsh-headless',
                  '@deepseek-ai/dsh-experimental-agent-team-profile',
                ],
              },
            },
          }, undefined, 2) + '\n')
          await writeFile(join(profileDir, 'cordis.patch.yml'), [
            '- id: llm-deepseek',
            '  disabled: true',
            '- id: session-persistence-jsonl',
            '  config:',
            `    root: '${sessions}'`,
            '    compression: none',
            '- insert:',
            '    - id: team-fixture-llm',
            `      name: '${fixturePlugin}'`,
            '',
          ].join('\n'))
          /**
       * 常量说明：launch 用于处理 launch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const launch = resolveExampleLaunch({
            srcBin: dshBinScript,
            configArgs: ['--profile', 'headless', '请明确使用 Agent Teams，把调研和实现拆给两个 teammate，等待完成后汇总。'],
            tsconfigPath,
            env: {
              DSH_HOME: home,
              DSH_AGENTS_HOME: join(cwd, '.agents'),
              DSH_TELEMETRY_DISABLED: '1',
              DEEPSEEK_API_KEY: '',
              NODE_OPTIONS: [
                process.env.NODE_OPTIONS,
                '--disable-warning=ExperimentalWarning',
                '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
              ].filter(Boolean).join(' '),
            },
          })
          /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const result = await execa(launch.command, launch.args, {
            cwd,
            env: launch.env,
            input: '',
            timeout: 90_000,
            killSignal: 'SIGKILL',
            reject: false,
          })
          expect(
            result.exitCode,
            `dsh headless profile exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          ).toBe(0)
          expect(result.stderr).toBe('')
          expect(result.stdout).toContain('TEAM_WORKFLOW_OK')

          /**
       * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const files = (await readdir(sessions, { recursive: true }))
            .filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
 * 并按返回类型处理结果。
 */ file => file.endsWith('.jsonl'))
          expect(files).toHaveLength(3)
          /**
       * 常量说明：logs 用于处理 logs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const logs = await Promise.all(files.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
 * 并按返回类型处理结果。
 */ file => readFile(join(sessions, file), 'utf8')))
          /**
       * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const parsed = logs.map(records)
          /**
       * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const root = parsed.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：log（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(log)，并按返回类型处理结果。
 */ (log) => {
              /**
         * 常量说明：header 用于处理 header 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
              const header = log[0]
              return header?.type === 'session' && typeof header.parentSession !== 'string'
            })
          expect(root).toBeDefined()
          /**
       * 常量说明：eventTypes 用于处理 eventTypes 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const eventTypes = root!.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.type)
          expect(eventTypes.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：type（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(type)，并按返回类型处理结果。
 */ type => type === 'team/member')).toHaveLength(4)
          expect(eventTypes).toContain('team/message/queued')
          expect(eventTypes).toContain('team/message/delivered')
          /**
       * 常量说明：taskEvents 用于处理 taskEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const taskEvents = root!.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.type === 'team/task')
          expect(taskEvents.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ (record) => {
              /**
         * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
              const data = record.data as { task?: { status?: string } } | undefined
              return data?.task?.status === 'completed'
            })).toHaveLength(2)
          /**
       * 常量说明：toolNames 用于处理 toolNames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const toolNames = root!.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.type === 'tool/call')
            .map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => (record.data as { name?: string } | undefined)?.name)
          expect(toolNames).toContain('wait_agent')
          expect(toolNames).toContain('team_task_list')
          expect(toolNames).toContain('list_agents')
        } finally {
          await rm(cwd, { recursive: true, force: true })
        }
      }, 105_000)
  })
