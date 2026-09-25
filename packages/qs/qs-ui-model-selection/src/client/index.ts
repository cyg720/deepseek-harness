/** 独立对应官方 ui-model-selection，仅替换呈现，复用唯一 modelDirectories。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import { ModelSeat, type ModelSeatInjected } from './ModelSeat.tsx'
import { modelChoices, selectionOf } from './selection.ts'
import { zh, en } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'qs-ui-model-selection': keyof typeof zh } }
/** 模型目录由官方插件安装；本插件不创建解析器或并行目录。 */
export const inject = ['slots', 'locale', 'sessions', 'modelDirectories', 'commandUi']
/**
 * 安装输入模型选择器和同源命令装饰器，随 QS 槽释放。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-model-selection', { zh, en }), 'qs model: dictionaries')
  const t = ctx.locale.bind('qs-ui-model-selection')
  ctx.slots.inject('qs.composer.model', () => ctx.slots.register({
    name: 'qs.composer.model', locale: 'qs-ui-model-selection',
    inject: (sessionId): ModelSeatInjected => {
      const available = ctx.sessions.subagentAddress(sessionId) === undefined
      const directory = ctx.modelDirectories.directoryFor(sessionId)
      return { available, hooks: { directory: directory.store },
        load: () => { if (available) void directory.load().catch(() => { /* 官方目录发布读取失败状态。 */ }) },
        select: selection => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
      }
    },
  }, ModelSeat))
  // 双界面使用不同优先级贡献；离开 QS 后恢复官方命令呈现。
  ctx.slots.inject('qs.composer.model', () => ctx.commandUi.decorate({
    name: 'model', priority: 1, available: session => ctx.sessions.subagentAddress(session.sessionId) === undefined,
    ui: { kind: 'popupSelect',
      options: async (session) => {
        if (ctx.sessions.subagentAddress(session.sessionId) !== undefined) throw new Error(t('unavailable'))
        const state = await ctx.modelDirectories.directoryFor(session.sessionId).load()
        return modelChoices(state).map(row => ({ id: row.id, label: row.label, detail: row.provider,
          ...(row.selection.provider === state.current?.provider && row.selection.model === state.current.model ? { active: true } : {}),
        }))
      },
      onSelect: async (option, session) => {
        if (ctx.sessions.subagentAddress(session.sessionId) !== undefined) throw new Error(t('unavailable'))
        const directory = ctx.modelDirectories.directoryFor(session.sessionId)
        const selection = selectionOf(directory.store.getSnapshot(), option.id)
        if (selection === undefined) throw new Error(t('failed'))
        await directory.select(selection)
      },
    },
  }))
}
