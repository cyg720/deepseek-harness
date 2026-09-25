/** 输入区用到的图标子集（只按全局类名使用通用控件，不跨包 import 组件）。 */
import type { ReactNode, SVGProps } from 'react'

/** 输入区用到的图形名。 */
export type ComposerIconName = 'spark' | 'up' | 'stop' | 'chat' | 'shield'

const PATHS: Record<ComposerIconName, string> = {
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-5 9 3 3 7-7',
  chat: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z',
  spark: 'M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z',
  up: 'M12 19V5m-6 6 6-6 6 6',
  stop: 'M6 6h12v12H6Z',
}

/** 图标输入。 */
export interface ComposerIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** 图形名。 */
  name: ComposerIconName
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
export function QsIcon({ name, size = 'sm', className, ...rest }: ComposerIconProps): ReactNode {
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
