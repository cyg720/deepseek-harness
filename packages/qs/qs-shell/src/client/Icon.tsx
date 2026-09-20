/**
 * 图标：24 viewBox、无填充、1.7 描边、圆角端点、跟随 currentColor。
 *
 * 路径取自原型的 `paths` 表（`qishu/PRD/1-AI工作台/prototype/app.js`），
 * 只保留第一优先工作台实际使用的图形。
 */
import type { ReactNode, SVGProps } from 'react'

/** 图标名。 */
export type QsIconName =
  | 'spark' | 'panel' | 'right' | 'grid' | 'plus' | 'close' | 'chevron' | 'more'
  | 'chat' | 'pin' | 'shield' | 'user' | 'check' | 'arrow' | 'up' | 'stop'
  | 'file' | 'duplicate' | 'refresh' | 'thumb'

const PATHS: Record<QsIconName, string> = {
  spark: 'M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z',
  panel: 'M9 3v18M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z',
  right: 'M15 3v18M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm8 10 4 4 4-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chat: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z',
  pin: 'm9 3 6 0-1 7 4 4H6l4-4ZM12 14v7',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-5 9 3 3 7-7',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a8 6 0 0 1 16 0v3',
  check: 'm5 12 4 4L19 6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  up: 'M12 19V5m-6 6 6-6 6 6',
  stop: 'M6 6h12v12H6Z',
  file: 'M14 2H5v20h14V7Zm0 0v6h5M8 12h8M8 16h6',
  // 键名不能叫 copy：i18n 门禁会把名为 copy 的属性当作产品文案。
  duplicate: 'M9 9h11v11H9ZM5 15H4V4h11v1',
  refresh: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  thumb: 'M7 21V10l4-8 1 1v6h6l-2 12Z',
}

/** 图标组件的输入。 */
export interface QsIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** 图形名。 */
  name: QsIconName
  /** 尺寸档：标准 19px、导航与文件 16px、小号 13px。 */
  size?: 'sm' | 'xs' | 'md'
}

/**
 * 渲染一个图标。
 * @param props - 图标名与尺寸档。
 * @returns SVG 节点。
 */
export function QsIcon({ name, size = 'md', className, ...rest }: QsIconProps): ReactNode {
  const sizeClass = size === 'md' ? 'qs-icon' : `qs-icon qs-icon-${size}`
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
