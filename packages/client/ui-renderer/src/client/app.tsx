/**
 * Real-UI assembly closure. The whole layout tree hangs from the built-in
 * `root` slot, which is the only ctx-level slot render in the application.
 */
/**
 * 文件职责：构建真实客户端 UI 的最外层 React 应用树。
 * 技术维度：使用 React 工厂、Cordis 插槽、会话快照选择器和动态文档标题组件。
 * 产品维度：把各插件贡献的根界面组合成应用，并让浏览器标题跟随当前会话。
 * 逻辑维度：取得 sessions 服务，绑定列表选择器，定义标题子组件，最终渲染标题和 root 插槽。
 * 关键边界：sessions 服务缺失时立即失败；应用中只有此处允许渲染上下文级 root 插槽。
 * 新手阅读建议：先看 AssemblyDeps，再跟踪 sessions、useSessions、SessionDocumentTitle 到返回工厂。
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from './bind.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type {} from '@deepseek-ai/dsh-client-runtime/client'

/** Inputs available after the UI renderer's inject set activates. */
/** UI renderer 的注入集合激活后可用的装配依赖。 */
export interface AssemblyDeps {
  /** Client context carrying the slots and sessions services. */
  /** 提供 slots 与 sessions 服务的客户端 Cordis 上下文。 */
  ctx: Context
}

/**
 * Build the assembled application factory.
 * @param deps - Active UI-renderer dependencies.
 * @returns Factory producing the application React tree.
 */
/**
 * 构建应用渲染工厂。
 * @param deps 已激活的 UI renderer 依赖。
 * @returns 每次调用都生成应用 React 树的无参函数。
 * @example const renderApp = buildRenderApp({ ctx }); renderApp()。
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  // 客户端 Cordis 上下文。
  const { ctx } = deps
  // 会话列表服务；缺失表示装配顺序错误，必须立即抛错。
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('ui renderer: sessions service unavailable')
  // 与 sessions.list 绑定的 React 快照选择 hook。
  const useSessions = bindSnapshotSelector(sessions.list)
  // 会话标题子组件；读取当前会话标题并投影到 document.title。
  const SessionDocumentTitle = (): ReactNode => {
    // 当前会话的可选标题；无当前会话或标题缺失时为 undefined。
    const title = useSessions((state) => {
      // 当前会话 id；可能尚未选择。
      const id = state.current
      return id === undefined ? undefined : state.byId[id]?.title
    })
    return <DocumentTitle {...title === undefined ? {} : { title }} />
  }
  return () => (
    <>
      <SessionDocumentTitle />
      {ctx.slots.renderSlot('root', {})}
    </>
  )
}
