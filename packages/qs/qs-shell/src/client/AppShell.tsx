/**
 * 工作台根 occupant（root 槽的贡献组件）。
 *
 * 首屏分支（见 06-槽位与状态设计 第三节）：
 * - qs-login 未加载 ⇒ 显式"登录组件未加载"故障面，**不静默直通**；
 * - 未登录 ⇒ 只渲染 `qs.gate`，且不挂载任何 session 子树；
 * - 已登录 ⇒ 渲染三栏工作台。
 *
 * 分支提成两个组件，是因为 auth 座席的有无取决于 qs-login 是否装配；
 * AppShell 自身不调用任何 hook，因此这条分支不改变 hook 调用顺序。
 */
import { clsx } from 'clsx'
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { PanelResize } from './PanelResize.tsx'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { QsShellRootInjected, UseQsAuth } from './contract.ts'
import { createQsLayoutStore, matchesViewport, RIGHT_OPEN_QUERY } from './layout-store.ts'
import { QsFaultPage, QsRootErrorBoundary, type QsFaultCopy } from './FaultPage.tsx'
import styles from './shell.module.css'

/** 登录座席缺失时的诊断文本（诊断信息是界面契约的一部分，因此抽成常量）。 */
export const LOGIN_SEAT_MISSING_DETAIL = "qs-shell: root contribution 'auth' is absent — the qs-login plugin is not loaded"

/** 工作台根声明并渲染的子槽。 */
export type AppShellChildKeys =
  | 'qs.gate' | 'qs.chrome' | 'qs.sidebar' | 'qs.stage' | 'qs.inspector' | 'qs.status' | 'qs.overlay'

/** 工作台根 occupant 的完整 props：四份共享面齐备。 */
export type AppShellProps =
  PropsRuntime<'root'>
  & PropsRenderSlots<AppShellChildKeys>
  & PropsStore<ReturnType<typeof createQsLayoutStore>>
  & InjectFace<QsShellRootInjected>
  & PropsLocale<'qs-shell'>

/** 语言座席类型别名，供子组件显式标注。 */
export type QsShellTranslate = TranslateNS<'qs-shell'>
/**
 * 工作台根 occupant。
 * @param props - 四份框架共享面。
 * @returns 工作台、登录页或故障面。
 */
export function AppShell(props: AppShellProps): ReactNode {
  // auth 座席由 qs-login 的 provideRoot 发布，因此在共享接口上声明为可选成员：
  // 缺失时渲染显式故障面，而不是静默直通（R22/R30）。
  const useQsAuth = props.useQsAuth
  if (useQsAuth === undefined) return <LoginPluginMissingFault t={props.t} />
  return <WorkbenchShell {...props} useQsAuth={useQsAuth} />
}

/** 登录插件缺失时的固定故障面（**不**回落官方 UI，也不直通工作台）。 */
function LoginPluginMissingFault({ t }: { t: QsShellTranslate }): ReactNode {
  return (
    <div className="qs-root">
      <QsFaultPage
        copy={faultCopy(t)}
        detail={LOGIN_SEAT_MISSING_DETAIL}
      />
    </div>
  )
}

/** 组装故障页文案。 */
export function faultCopy(t: QsShellTranslate): QsFaultCopy {
  return {
    title: t('fault.title'),
    lead: t('fault.lead'),
    retry: t('fault.retry'),
    reload: t('fault.reload'),
    detail: t('fault.detail'),
  }
}

interface WorkbenchProps extends AppShellProps {
  readonly useQsAuth: UseQsAuth
}

function WorkbenchShell(props: WorkbenchProps): ReactNode {
  const { useQsAuth, useQsTheme, useStore, actions, renderSlot, t } = props
  const authenticated = useQsAuth(s => s.authenticated)
  const user = useQsAuth(s => s.user)
  const scheme = useQsTheme(s => s.scheme)
  const layout = useStore(s => s)

  useViewportSync(actions)

  return (
    <div className={clsx('qs-root', styles.root, scheme === 'dark' && 'qs-dark')} data-qs-root>
      <QsRootErrorBoundary copy={faultCopy(t)}>
        {authenticated
          ? (
            <div className={styles.app}>
              <header className={styles.topbar}>{renderSlot('qs.chrome', {})}</header>
              {layout.storageNotice !== undefined ? <div className={styles.layoutNotice} role="status" data-qs-layout-notice>
                <span>{t(layout.storageNotice === 'recovered' ? 'layout.recovered' : 'layout.memory')}</span>
                <button type="button" onClick={() => { actions.reset() }}>{t('layout.reset')}</button>
              </div> : null}
              <div className={styles.bodyLayout} style={{
                '--qs-left-width': layout.leftWidth === undefined ? undefined : `${layout.leftWidth}px`,
                '--qs-right-width': layout.rightWidth === undefined ? undefined : `${layout.rightWidth}px`,
              } as CSSProperties}>
                <button
                  type="button"
                  className={clsx(
                    styles.mobileOverlay,
                    layout.compact && (layout.leftOpen || layout.rightOpen) && styles.mobileOverlayActive,
                  )}
                  aria-label={t('nav.collapse')}
                  onClick={() => {
                    actions.setLeftOpen(false)
                    actions.setRightOpen(false)
                  }}
                />
                {renderSlot('qs.sidebar', { hidden: !layout.leftOpen, user })}
                {layout.leftOpen && !layout.compact ? <PanelResize side="left" label={t('nav.resize')} onResize={actions.setWidth} /> : null}
                {/* 主区必须经它自己的条目渲染：`qs.stage.body` / `qs.composer` 由
                    `qs.stage` 条目声明，root 没有渲染它们的权限——直接传 root 的
                    renderSlot 会抛 SlotOwnershipError。 */}
                {renderSlot('qs.stage', {})}
                {layout.rightOpen && !layout.compact ? <PanelResize side="right" label={t('inspector.resize')} onResize={actions.setWidth} /> : null}
                {renderSlot('qs.inspector', { hidden: !layout.rightOpen, requestId: layout.rightRequestId, reportOpen: actions.reportRightOpen })}
                {renderSlot('qs.status', {})}
                {renderSlot('qs.overlay', {})}
              </div>
            </div>
          )
          : <div className={styles.app}>{renderSlot('qs.gate', {})}</div>}
      </QsRootErrorBoundary>
    </div>
  )
}

/**
 * 视口跨断点时收敛面板开合。
 *
 * 原型只在初始化读 innerWidth，规范明确要求补实时 resize 行为。这里只在
 * 窄↔宽跨越时收敛，不做逐像素跟随，避免覆盖用户在当次宽度下的手动开合。
 * @param actions - 布局 store 的写入集。
 */
function useViewportSync(
  actions: { applyViewport: (viewport: { narrow: boolean; wide: boolean }) => void },
): void {
  useEffect(() => {
    // matchMedia 不是所有运行环境都有（jsdom 没有）。缺了就不能"猜"视口：
    // 直接按当前能力取一次值，绝不让缺 API 变成渲染异常——root 条目一旦抛错会被
    // 框架退位，界面会**静默**换成官方 AppFrame。
    if (typeof globalThis.matchMedia !== 'function') {
      actions.applyViewport({ narrow: false, wide: false })
      return
    }
    const narrow = globalThis.matchMedia('(max-width: 700px)')
    const wide = globalThis.matchMedia(RIGHT_OPEN_QUERY)
    const onChange = (): void => {
      actions.applyViewport({ narrow: narrow.matches, wide: matchesViewport(RIGHT_OPEN_QUERY) })
    }
    narrow.addEventListener('change', onChange)
    wide.addEventListener('change', onChange)
    return () => { narrow.removeEventListener('change', onChange); wide.removeEventListener('change', onChange) }
  }, [actions])
}
