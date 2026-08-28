/**
 * Real-UI assembly closure. The whole layout tree hangs from the built-in
 * `root` slot, which is the only ctx-level slot render in the application.
 */
/*
 * 文件职责：构建真实客户端 UI 的最外层 React 应用树。
 * 技术维度：使用 React 工厂、Cordis 插槽、会话快照选择器和动态文档标题组件。
 * 产品维度：把各插件贡献的根界面组合成应用，并让浏览器标题跟随当前会话。
 * 逻辑维度：取得 sessions 服务，绑定列表选择器，定义标题子组件，最终渲染标题和 root 插槽。
 * 关键边界：sessions 服务缺失时立即失败；应用中只有此处允许渲染上下文级 root 插槽。
 * 新手阅读建议：先看 AssemblyDeps，再跟踪 sessions、useSessions、SessionDocumentTitle 到返回工厂。
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

/** Inputs available after the UI renderer's inject set activates. */
/* UI renderer 的注入集合激活后可用的装配依赖。 */
export interface AssemblyDeps {
  /** Client context carrying the renderer-owned Slot registry. */
  ctx: Context
}

/**
 * Build the assembled application factory.
 * @param deps - Active UI-renderer dependencies.
 * @returns Factory producing the application React tree.
 */
/*
 * 构建应用渲染工厂。
 * @param deps 已激活的 UI renderer 依赖。
 * @returns 每次调用都生成应用 React 树的无参函数。
 * @example const renderApp = buildRenderApp({ ctx }); renderApp()。
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  // 客户端 Cordis 上下文。
  const { ctx } = deps
  return () => ctx.slots.renderSlot('root', {})
}
