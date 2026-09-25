/** 浏览式目录选择与原生选择分别装配，只复用唯一的官方工作区服务。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-qs-sessions/client'
import { BrowseDirectoryFlow } from './flow.tsx'
import type { BrowseOperations } from './browser-state.ts'
import { zh, en } from './locales.ts'

/** 双槽、Host 目录操作和语言字典的唯一提供者。 */
export const inject = ['slots', 'uiWorkspace', 'locale']

/**
 * 两个父槽都就绪后注册目录弹层，插件卸载同时释放字典和槽贡献。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-directory-browser', { zh, en }), 'qs-directory-browser: dictionaries')
  const injected = (): BrowseOperations => ({
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
  })
  ctx.slots.inject('qs.workspace.hero.directoryFlow', () =>
    ctx.slots.inject('qs.workspace.sidebar.directoryFlow', function* () {
      yield ctx.slots.register({ name: 'qs.workspace.hero.directoryFlow', locale: 'qs-directory-browser', inject: injected }, BrowseDirectoryFlow)
      yield ctx.slots.register({ name: 'qs.workspace.sidebar.directoryFlow', locale: 'qs-directory-browser', inject: injected }, BrowseDirectoryFlow)
    }))
}
