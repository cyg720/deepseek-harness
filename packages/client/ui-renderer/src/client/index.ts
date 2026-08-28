/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器 UI 渲染器：在 Cordis 依赖激活后安装槽位渲染器，并暴露
 *             web 启动内核在客户端花名册就绪后使用的挂载操作。
 * 【技术维度】React 18 + react-dom：createSlotRenderer 安装槽位渲染、buildRenderApp
 *             组装应用；挂载时保留框架无关的启动 DOM（hydrate 接力）。
 * 【产品维度】应用在浏览器中的渲染与启动接管（boot DOM → React 应用）。
 * 【逻辑维度】apply 安装槽位渲染器并提供 uiRenderer.mount → mountApp 选择
 *             hydrate（有 boot DOM）或 createRoot（无）。
 * 【关键边界】uiRenderer 是框架无关启动内核的唯一挂载入口；
 *             客户端渲染（CSR）专用，无服务端快照接线。
 * 【新手阅读建议】先看 mountApp 的 hydrate 分支，再看 apply 的安装。
 * ==========================================================================
 */
/**
 * Browser UI renderer. It installs the slot renderer after its Cordis
 * dependencies activate and exposes the mount operation used by the web boot
 * kernel after the complete client roster settles.
 */
import { createElement, useLayoutEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { createSlotRenderer } from './scoped-slots.tsx'
import { buildRenderApp } from './app.tsx'
import { SlotRegistry } from './registry.ts'

export { SlotRegistry } from './registry.ts'
export type { RootOwnerProps } from './registry.ts'

export type {
  ChainRenderOpts, HostObservable, RenderOpts, SnapshotSelectorHook, SlotRenderer,
  ScopedStandardSourceBinding, SlotRendererHost, SlotScopeAdapter,
  StandardSourceBinding, StoreInstanceLike,
} from '@deepseek-ai/dsh-client-ui-slots'

/** Mount operation exposed to the framework-free boot kernel. */
export interface UiRendererService {
  /**
   * Mount the assembled application into the supplied element.
   * @param container - Application mount point.
   * @returns Disposer that unmounts the React root.
   */
  mount: (container: HTMLElement) => () => void
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A slot declaration or registration set changed.
     * @mode emit
     * @param key - mutated SlotMap key.
     */
    'slots/changed'(key: string): void
  }
  interface Context {
    /** Renderer-owned UI composition registry. */
    slots: SlotRegistry
    /** Mount face provided after the UI renderer activates. */
    uiRenderer: UiRendererService
  }
}

/** Services required before application assembly. */
export const inject: string[] = []

interface BootSnapshot {
  className: string
  html: string
}

/** Hydrate the kernel-owned loading DOM before replacing it with the application. */
function BootHandoff(props: { app: () => ReactNode; boot: BootSnapshot }): ReactNode {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => { setReady(true) }, [])
  if (ready) return props.app()
  return createElement('div', {
    className: props.boot.className,
    'data-dsh-boot': '',
    dangerouslySetInnerHTML: { __html: props.boot.html },
  })
}

/** Mount React while preserving the framework-free boot DOM through hydration. */
function mountApp(container: HTMLElement, app: () => ReactNode): Root {
  const boot = container.querySelector<HTMLElement>(':scope > [data-dsh-boot]')
  if (boot !== null) {
    return hydrateRoot(container, createElement(BootHandoff, {
      app,
      boot: { className: boot.className, html: boot.innerHTML },
    }))
  }
  const root = createRoot(container)
  flushSync(() => { root.render(app()) })
  return root
}

/**
 * Install the slot renderer and provide the application mount face.
 * @param ctx - Plugin context.
 */
export function apply(ctx: Context): void {
  const slots = new SlotRegistry(ctx)
  slots.install(createSlotRenderer())
  ctx.reflect.provide('uiRenderer', {
    mount: (container: HTMLElement): (() => void) => {
      const root = mountApp(container, buildRenderApp({ ctx }))
      return () => { root.unmount() }
    },
  })
}
