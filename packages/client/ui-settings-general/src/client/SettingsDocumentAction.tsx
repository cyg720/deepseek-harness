/** Optional settings-header action for opening a file-backed Host document. */
/*
 * 中文说明：
 * - 文件职责：在设置页标题区按 Host 能力显示“打开设置文档”操作及错误状态。
 * - 技术维度：使用 React 函数组件、Effect、外部快照订阅、依赖注入和 CSS Modules。
 * - 产品维度：让用户可从界面直接打开文件型设置来源，便于高级编辑和故障排查。
 * - 逻辑维度：组件挂载时加载元数据，读取控制器快照，准备完成后渲染错误提示与按钮。
 * - 关键边界：Host 未就绪时不渲染；点击和加载均为异步操作，错误由控制器状态表达。
 * - 新手阅读建议：先看 Injected/Props 的数据来源，再按 load、status 判断、open 的顺序阅读组件。
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsDocumentStore } from './settings-document-store.ts'
import css from './SettingsDocumentAction.module.css'

/** Registrant-owned dependencies of {@link SettingsDocumentAction}. */
/* 中文：注册方注入给设置文档操作组件的控制器和响应式状态接口。 */
export interface SettingsDocumentActionInjected {
  /** Provider metadata and action state owner. */
  /* 中文：拥有提供者元数据、加载流程和打开动作的状态控制器。 */
  controller: SettingsDocumentStore
  hooks: {
    /** Controller snapshot bound by the UI renderer as useSnapshot. */
    /* 中文：由 UI 渲染器绑定的控制器快照，组件通过 useSnapshot 订阅读取。 */
    snapshot: SettingsDocumentStore['store']
  }
}

/** Header-action owner share, localized copy, and the registrant's state face. */
/* 中文：组件属性类型，合并标题操作运行时信息、设置文案和注入状态接口。 */
export type SettingsDocumentActionProps =
  PropsRuntime<'settings.action'> & PropsLocale<'settings'> & InjectFace<SettingsDocumentActionInjected>

/**
 * Render the open-document action only after Host metadata confirms document availability.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the action, or null while unavailable or unresolved.
 */
/* 中文：渲染打开文档按钮；props 提供控制器、快照订阅和翻译，未就绪时返回 null。示例：<SettingsDocumentAction {...props} />。 */
export function SettingsDocumentAction({ controller, useSnapshot, t }: SettingsDocumentActionProps): ReactNode {
  /** 控制器的当前完整状态；更新时组件会重新渲染。 */
  const state = useSnapshot(snapshot => snapshot)

  useEffect(() => {
    void controller.load()
  }, [controller])

  if (state.status !== 'ready') return null

  return (
    <div className={css.action}>
      {state.error === null ? null : <span className={css.error} role="alert">{t('openDocument.error')}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={state.opening}
        onClick={() => { void controller.open() }}
      >
        {t('openDocument')}
      </Button>
    </div>
  )
}
