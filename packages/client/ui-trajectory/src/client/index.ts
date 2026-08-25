/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器端轨迹插件的装配点：注册本地化字典、各事件状态机定义（消息 / 请求头 /
 *             assistant / 工具 / 压缩）、轨迹视图快照构建器，并向会话视图槽位注入"轨迹"页签。
 * 【技术维度】Cordis 插件（apply / inject）；conversationEvents.register 注册业务状态机；
 *             conversationViews.register 注册视图构建器；slots.inject + slots.register
 *             往 conversation.view 槽位加一个 tab；locale.register 注册双语字典。
 * 【产品维度】会话详情中多出"轨迹"页签：按回合 / 步骤折叠展示消息、工具调用、压缩、
 *             系统提示词变更的完整执行轨迹，并可加载更早记录。
 * 【逻辑维度】1) 声明依赖服务；2) apply 里注册字典与各 Definition；3) 创建时长偏好存储；
 *             4) 注入 'conversation.view' 槽位（含 label、inject 回调）。
 * 【关键边界】所有 register 走 ctx.effect 包装（插件卸载自动清理）；注册期文本用 translate
 *             thunk 读取以跟随当前语言；会话不可用时 inject 抛错。
 * 【新手阅读建议】先看 register* 系列各注册了什么，再看 slots.inject 回调里提供的三样能力。
 * ==========================================================================
 */
/**
 * Browser trajectory plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { en, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import { registerTrajectoryConversationView } from './trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'

/** Required services: the conversation slot, registries, ordinary Session paging, and the locale service. */
// 依赖的服务：会话视图槽位、事件 / 视图注册表、普通会话分页与本地化服务。
export const inject = ['slots', 'conversationEvents', 'conversationViews', 'sessions', 'locale']

/**
 * Client plugin body: register the trajectory view tab. The registration
 * rides the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
/*
 * 浏览器端插件主体：注册轨迹视图页签。注册挂在槽位服务的 effect 包装上，
 * 插件卸载时页签随之移除。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-trajectory: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  // 注册期的文案（页签标签）以 thunk 方式读取绑定好的翻译函数，
  // 因此语言切换时无需重新注册。
  const t = ctx.locale.bind(NS)
  // 全浏览器共享的时长偏好源，通过 inject 的 hooks 暴露给视图组件。
  const duration = createTrajectoryDurationStore()
  // 逐个注册各业务状态机定义（消息 / 请求头 / assistant / 工具 / 压缩）。
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  // 注册轨迹视图目标（快照构建器）。
  registerTrajectoryConversationView(ctx)
  // 向会话视图槽位注入 'trajectory' 页签；slots.inject 等待槽位声明后再注册，
  // 槽位被重新声明时本贡献自动重建。
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'trajectory',
    order: 10,
    locale: NS,
    label: () => t('view.trajectory'),
    inject: (sessionId: SessionId): TrajectoryViewInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) {
        throw new Error(`ui-trajectory: session "${sessionId}" is unavailable`)
      }
      return {
        hooks: { duration },
        // 加载更早的轨迹：加载前后对比轨迹视图计数，判断是否真的翻页了。
        loadOlder: async () => {
          const before = session.getSnapshot().views.get('trajectory')
          await session.loadOlder()
          return session.getSnapshot().views.get('trajectory') !== before
        },
        setActualDuration: (value) => { duration.set(value) },
      }
    },
  }, TrajectoryView))
}
