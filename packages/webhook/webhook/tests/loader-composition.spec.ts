/**
 * 文件职责：验证 webhook/webhook 中 loader composition spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
import WebhookRuntime, {
  WebhookDeliveryId,
  WebhookRuleId,
  WebhookSourceId,
} from '../src/index.ts'

/**
 * 变量说明：root 用于处理 root 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let root: string | undefined
/**
 * 变量说明：context 用于处理 context 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let context: Context | undefined

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('real Loader composition', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('loads the default Service export and an effect-scoped rule', { timeout: 60_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-webhook-loader-'))
    /**
     * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-webhook'",
      '- name: fixture-rule',
      '',
    ].join('\n'))

    /**
     * 常量说明：called 用于处理 called 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const called = Promise.withResolvers<boolean>()
    /**
     * 常量说明：dependencies 用于处理 dependencies 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const dependencies = {
      name: 'fixture-dependencies',
      /**
       * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
       * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
       */
      apply(ctx: Context) {
        /**
         * 变量说明：service 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const service of [
          'agents', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry',
        ]) {
          ctx.provide(service as never, {} as never)
        }
      },
    }
    /**
     * 常量说明：rule 用于处理 rule 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rule = {
      name: 'fixture-rule',
      inject: ['webhookRuntime'],
      /**
       * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
       * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
       */
      apply(ctx: Context) {
        ctx.webhookRuntime.register({
          id: WebhookRuleId('loader-rule'),
          kind: 'fixture',
          /**
           * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
           * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
           * @example 在完成前置校验后调用 run()，并按返回类型处理结果。
           */
          run() {
            called.resolve(true)
            return null
          },
        })
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    /**
     * 常量说明：modules 用于处理 modules 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-webhook', WebhookRuntime],
      ['fixture-rule', rule],
    ])
    context.loader.internal = {
      version: 'v2',
      /**
       * 功能说明：处理 import 相关流程；使用场景由所在模块及调用位置决定。
       * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 import(specifier)，并按返回类型处理结果。
       */
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    context.webhookRuntime.dispatch({
      kind: 'fixture',
      source: WebhookSourceId('loader'),
      deliveryId: WebhookDeliveryId('loader-delivery'),
      event: {},
      receivedAt: 1,
    })
    await called.promise
  })
})
