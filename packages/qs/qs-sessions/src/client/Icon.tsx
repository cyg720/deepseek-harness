/** 会话列表用到的图标子集（只按全局类名使用通用控件，不跨包 import 组件）。 */
import type { ReactNode, SVGProps } from 'react'

/** 导航用到的图形名。 */
export type NavIconName = 'spark' | 'chat' | 'pin' | 'more' | 'plus'

const PATHS: Record<NavIconName, string> = {
  spark: 'M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z',
  chat: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z',
  pin: 'm9 3 6 0-1 7 4 4H6l4-4ZM12 14v7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
}

/** 图标输入。 */
export interface NavIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** 图形名。 */
  name: NavIconName
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
export function QsIcon({ name, size = 'xs', className, ...rest }: NavIconProps): ReactNode {
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
