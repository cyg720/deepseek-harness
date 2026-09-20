/** 登录页需要的图标子集（本包不 import qs-shell 的值，只按全局类名使用通用控件）。 */
import type { ReactNode, SVGProps } from 'react'

/** 登录页用到的图形名。 */
export type LoginIconName = 'spark' | 'user' | 'shield' | 'arrow' | 'check' | 'close'

const PATHS: Record<LoginIconName, string> = {
  spark: 'M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a8 6 0 0 1 16 0v3',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-5 9 3 3 7-7',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
}

/** 图标输入。 */
export interface LoginIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** 图形名。 */
  name: LoginIconName
  /** 尺寸档。 */
  size?: 'sm' | 'xs'
}

/**
 * 渲染一个图标。
 * @param props - 图形名与尺寸档。
 * @returns SVG 节点。
 */
// Independent client bundles retain this small SVG wrapper; importing another plugin would cross its runtime ownership.
/* jscpd:ignore-start */
export function QsIcon({ name, size = 'sm', className, ...rest }: LoginIconProps): ReactNode {
  const sizeClass = size === 'xs' ? 'qs-icon qs-icon-xs' : 'qs-icon qs-icon-sm'
  return (
    <svg
      className={className === undefined ? sizeClass : `${sizeClass} ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
/* jscpd:ignore-end */
