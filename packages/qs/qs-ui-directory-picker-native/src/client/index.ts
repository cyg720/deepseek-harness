/** 原生目录流程独立填充 QS 双入口，不复制官方 Host provider。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-qs-sessions/client'
import { NativeDirectoryFlow, type NativeFlowInjected } from './flow.ts'

/** 两个入口只依赖官方槽注册表和目录操作服务。 */
export const inject = ['slots', 'uiWorkspace']

/**
 * 随两个父槽的声明生命周期注册原生目录选择器。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  const injected = (): NativeFlowInjected => ({ pick: () => ctx.uiWorkspace.pickDirectory() })
  ctx.slots.inject('qs.workspace.hero.directoryFlow', () =>
    ctx.slots.inject('qs.workspace.sidebar.directoryFlow', function* () {
      yield ctx.slots.register({ name: 'qs.workspace.hero.directoryFlow', inject: injected }, NativeDirectoryFlow)
      yield ctx.slots.register({ name: 'qs.workspace.sidebar.directoryFlow', inject: injected }, NativeDirectoryFlow)
    }))
}
