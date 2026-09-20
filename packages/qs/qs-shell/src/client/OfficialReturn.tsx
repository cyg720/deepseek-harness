/**
 * 官方界面下的开发者返回入口。
 *
 * 挂在官方公共扩展槽 `sidebar.footer.action`（ui-sidebar 声明、list 作用域 root），
 * 不修改官方 AppFrame，也不向其 DOM 强行插入节点。只有在部署显式开启
 * `showOfficialUiEntry` 时才贡献该条目。
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { QsIcon } from './Icon.tsx'

/** 返回入口经 inject face 拿到的动作。 */
export interface QsOfficialReturnInjected {
  /** 切回奇术工作台。 */
  readonly backToWorkbench: () => void
}

/** 返回入口的完整 props。 */
export type QsOfficialReturnProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<QsOfficialReturnInjected>
  & PropsLocale<'qs-shell'>

/**
 * 渲染返回入口。
 * @param props - 官方槽 owner props、注入动作与语言座席。
 * @returns 返回入口节点。
 */
export function QsOfficialReturn({ backToWorkbench, wide, t }: QsOfficialReturnProps): ReactNode {
  return (
    <button
      type="button"
      className="qs-text-button"
      aria-label={t('switch.toWorkbench')}
      data-qs-official-return
      onClick={backToWorkbench}
    >
      <QsIcon name="spark" size="xs" />
      {wide ? t('switch.toWorkbench') : null}
    </button>
  )
}
