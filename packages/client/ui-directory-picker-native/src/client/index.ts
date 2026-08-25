/*
 * ================================ 文件注释 ================================
 * 【文件职责】目录选择（原生）包的浏览器侧入口：把无渲染的原生流程占用者注册进
 *             工作区的两个目录流程孔位，每次 open 驱动宿主打开系统目录选择器。
 * 【技术维度】Cordis 浏览器插件：ctx.slots.inject 嵌套注册两个孔位，
 *             生成器使两个注册成为一个事务效果；占用者无渲染（返回 null）。
 * 【产品维度】选择工作区目录时弹出操作系统原生单选目录对话框。
 * 【逻辑维度】1) 注入 pick 调用（ctx.workspaces.pickDirectory）；
 *             2) 把 NativeDirectoryFlow 注册进两个 directoryFlow 孔位。
 * 【关键边界】客户端代码不分支能力种类：挂载本包即组合原生交互的完整两端。
 * 【新手阅读建议】先看 flow.ts 的占用者（含 HMR 安全的 ref 逻辑），再看本文件接线。
 * ==========================================================================
 */
/**
 * Browser half of the native directory-picker backend: fills ui-workspace's
 * two directory-flow holes with a renderless occupant that answers each
 * `open` by driving `host.pickDirectory` (the node half's OS chooser) and
 * reporting the one outcome — picked path, cancellation, or failure — back
 * through the owner conversation. Mounting this package therefore composes
 * both sides of the native interaction with one cordis.yml row; no client
 * code branches on a capability kind.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { NativeFlowInjected } from './flow.ts'
import { NativeDirectoryFlow } from './flow.ts'


/** Required services (cordis fiber inject): the slot registry and the wire-facing workspace service. */
export const inject = ['slots', 'workspaces']

/**
 * Client plugin body: register the renderless native flow into both
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injected = (): NativeFlowInjected => ({ pick: () => ctx.workspaces.pickDirectory() })
  // Both declaration lifetimes must be live before the pair installs; the
  // generator makes the two registrations one transactional effect. The
  // outer/inner nesting order is arbitrary; neither hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
    }))
}
