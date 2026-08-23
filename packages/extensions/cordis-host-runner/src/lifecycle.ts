/**
 * ================================ 文件注释 ================================
 * 【文件职责】Host 半部 Fiber 生命周期助手：把沙箱产出的插件挂载为 cordis-dynamic
 *             组下的子 Fiber（失败的 Fiber 绝不残留），并报告"已挂载但仍在等待服务"
 *             的 Fiber 缺失了哪些服务。
 * 【技术维度】Fiber 是 Cordis 的可恢复插件运行单元：挂载前先 await 组、以守卫包裹
 *             插件启动、启动失败先 dispose 再抛错；missingServices 读取 fiber.inject
 *             键并与 ctx.get 的存在性比对。
 * 【产品维度】保证"AI 写出的插件"启动失败不留脏状态；插件声明的服务暂时缺失时，
 *             插件合法地保持 pending，等服务出现即自动激活（Cordis 语义）。
 * 【逻辑维度】startHostHalf：await 组 → 守卫插件挂载 → await 启动 → 失败先回收再
 *             抛错（含"名称已注册"冲突的教学提示）；missingServices：列出缺失服务名。
 * 【关键边界】启动碰撞（如新版本与旧运行同名注册）有专门的教学文案；停止不需要
 *             额外助手——普通 fiber.dispose() 即可卸载全部注册效果。
 * 【新手阅读建议】只需理解 startHostHalf 的"挂载-等待-失败回收"三步与
 *             missingServices 的"缺失服务 = 声明但不存在"判定。
 * ==========================================================================
 */

/**
 * Host-half fiber lifecycle over the `cordis-dynamic` group: settle a
 * sandbox-produced plugin as a child fiber (never leaving a failed fiber
 * mounted), and report the services a settled-but-pending fiber still waits
 * for. Stopping needs no helper — a host half unwinds through an ordinary
 * awaited `fiber.dispose()`, because everything the plugin registered is an
 * effect on its fiber.
 * @module @deepseek-ai/dsh-cordis-host-runner/lifecycle
 */

import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import { guardedPlugin } from './guard.ts'

/**
 * Await the group, start and settle one guarded child, and dispose it before rethrowing any
 * startup failure so a failed run never lingers. A valid unresolved inject may remain pending.
 * @param group - the `cordis-dynamic` group fiber every host half hangs under.
 * @param plugin - the plugin the sandbox returned; wrapped with the registration guard before starting.
 * @param reportGuardFailure - reports post-activation Host guard rejections to the owning Agent.
 * @returns the settled child fiber (possibly pending on unsatisfied `inject`).
 */
/**
 * 等待组 Fiber 就绪后，把沙箱返回的插件以守卫包裹挂载为子 Fiber，并等待其启动；
 * 启动失败先 dispose（绝不残留失败 Fiber）再抛出。若错误是"名称已注册"（最常见
 * 的启动冲突：新版本与旧运行同名），附带"先 cordis_stop 再运行新版本"的教学文案。
 * @returns 已就绪的子 Fiber（可能因 inject 服务未满足而处于 pending）
 */
export async function startHostHalf(
  group: Fiber,
  plugin: Plugin,
  reportGuardFailure: (error: Error) => void,
): Promise<Fiber> {
  await group.await()
  const fiber = group.ctx.plugin(guardedPlugin(plugin, reportGuardFailure))
  try {
    await fiber.await()
  } catch (error) {
    await fiber.dispose()
    const message = error instanceof Error ? error.message : String(error)
    // The commonest startup collision is running a NEW version of a package
    // while the old run still holds the name — teach the replace recipe.
    if (message.includes('already registered')) {
      throw new Error(
        `${message} — to REPLACE something an earlier dynamic package registered, first cordis_stop that package's id `
        + '(find it with cordis_runtime_inspect what:"temporary"), then run the new version.',
      )
    }
    throw error instanceof Error ? error : new Error(message)
  }
  return fiber
}

/**
 * The services a fiber declared in `inject` that do not exist yet — a settled
 * fiber that is not active is waiting on exactly these (legal cordis
 * semantics: it activates when the service appears).
 * @param ctx - the context to resolve service existence against.
 * @param fiber - the host-half fiber whose `inject` declarations are checked.
 * @returns the missing service names, in declaration order.
 */
/**
 * 计算一个已挂载但未激活的 Fiber 还缺哪些服务：遍历 fiber.inject 声明的服务名，
 * 凡 ctx.get 取不到的即记为缺失（Cordis 语义下服务出现时该 Fiber 会自动激活）。
 */
export function missingServices(ctx: Context, fiber: Fiber): string[] {
  return Object.keys(fiber.inject).filter(service => ctx.get(service) === undefined)
}
