/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-brand-official 包在浏览器侧的插件入口：把官方品牌标识（logo 与名称）
 *             注册进侧边栏与新会话页的通用品牌槽位。
 * 【技术维度】Cordis 浏览器插件：先检查构建环境变量，再按嵌套顺序注册三个槽位，
 *             使三个注册同属一个事务（一并生效、一并清理）。
 * 【产品维度】官方构建下，应用各处的品牌位置显示 DeepSeek Harness 官方标识；
 *             非官方构建（如第三方品牌）则整体跳过注册。
 * 【逻辑维度】apply()：DSH_CLIENT_BUILD_PROFILE 非 official 时直接返回；
 *             否则依次注入 sidebar.brand.mark、sidebar.brand.name、
 *             conversation.hero.brand.mark 三个槽位并注册对应组件。
 * 【关键边界】依赖环境变量控制是否生效；槽位注入是嵌套的，清理时按声明逆序执行。
 * 【新手阅读建议】结合 Brand.tsx 了解具体渲染内容，注意生成器函数与槽位注册的写法。
 * ==========================================================================
 */
/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
// 本插件只依赖槽位注册服务。
export const inject = ['slots']

/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * @param ctx - Client root context.
 */
// 填充全部品牌槽位：非官方构建直接返回；官方构建以嵌套方式注册三个槽位，
// 使它们作为一个整体注册与清理。
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark)
      })))
}
