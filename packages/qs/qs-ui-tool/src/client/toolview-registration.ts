/** 工具子视图的注册助手：等待子槽声明后注册一个键，并遵守官方 slots.inject/disposer 协议。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
// 仅类型：引入 ctx.slots 服务合并。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { QsToolviewProps } from './contract.ts'

/** 本包的本地化命名空间。 */
export const NS = 'qs-ui-tool'

/** 工具子视图组件签名：只读取 owner 输入与 locale 座席。 */
export type ToolviewComponent = (props: QsToolviewProps) => ReactNode

/**
 * 注册一个工具子视图。
 *
 * `ctx.slots.inject` 会等待声明者注册子槽；注册返回的 disposer 由槽框架持有，
 * 因此插件卸载时该键立即从候选消失，转写行随之回到兜底卡。
 * @param ctx - 浏览器根上下文。
 * @param key - Wire 工具名（子槽的分派键）。
 * @param component - 该工具的视图组件。
 */
export function registerToolview(ctx: ClientContext, key: string, component: ToolviewComponent): void {
  ctx.slots.inject('qs.tool.call.toolview', () => ctx.slots.register({
    name: 'qs.tool.call.toolview',
    key,
    locale: NS,
    ...(key === 'read_image' ? { children: { 'qs.tool.call.images': { kind: 'single' as const, scope: 'session' as const } } } : {}),
  }, component))
}
