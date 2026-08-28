/*
 * ================================ 文件注释 ================================
 * 【文件职责】后台任务（jobs）包的浏览器侧入口：把"任务列表"动作贡献到会话头部，
 *             渲染该会话的 ctx.jobs 记录。
 * 【技术维度】Cordis 浏览器插件：数据完全来自 jobsBySession 列表镜像（不发起 RPC、
 *             不持有自有状态，除弹层可见性外）；注册一个头部动作槽位。
 * 【产品维度】会话头部显示后台任务数量与列表（运行/停止/完成/失败状态与耗时）。
 * 【逻辑维度】1) 注册字典；2) 把 JobListAction 注册进会话头部动作槽位。
 * 【关键边界】槽位顺序 20，位于子代理目录之后（先看会话血缘再看进程工作）。
 * 【新手阅读建议】组件实现见 JobListAction.tsx；数据来自镜像而非本地请求。
 * ==========================================================================
 */
/**
 * Background-job plugin, browser half: contributes one session-header action
 * that renders this session's `ctx.jobs` records. The data arrives entirely
 * through the `jobsBySession` list mirror, so the plugin issues no RPC and
 * holds no state of its own beyond popover visibility.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { JobListAction } from './JobListAction.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { en, NS, zh, type JobKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job list copy. */
    'job': JobKey
  }
}

export type { JobListActionProps } from './JobListAction.tsx'

/** Required services for locale registration and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'job-list',
      // After the subagent catalog: session lineage reads before process work.
      order: 20,
      locale: NS,
    }, JobListAction),
  )
}
