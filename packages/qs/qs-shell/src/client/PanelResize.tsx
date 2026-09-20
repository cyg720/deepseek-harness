/** Pointer and keyboard resizing for desktop workbench panels. */
import { useRef, type ReactNode } from 'react'
import styles from './shell.module.css'

/**
 * Accessible separator with a drag origin taken from the rendered panel.
 * @param props - Panel side, localized name and width update callback.
 * @returns Pointer- and keyboard-operable separator.
 */
export function PanelResize({ side, label, onResize }: {
  side: 'left' | 'right'
  label: string
  onResize: (side: 'left' | 'right', width: number) => void
}): ReactNode {
  const drag = useRef<{ x: number; width: number } | undefined>(undefined)
  const widthOf = (element: HTMLElement): number => {
    const panel = side === 'left' ? element.previousElementSibling : element.nextElementSibling
    return (panel?.matches('aside') ? panel : panel?.querySelector('aside'))?.getBoundingClientRect().width ?? 0
  }
  return <div role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0}
    className={styles.resizeHandle} data-qs-resize={side}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      drag.current = { x: event.clientX, width: widthOf(event.currentTarget) }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    }}
    onPointerMove={(event) => {
      if (drag.current === undefined) return
      onResize(side, drag.current.width + (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1))
    }}
    onPointerUp={(event) => {
      drag.current = undefined
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onLostPointerCapture={() => { drag.current = undefined }}
    onPointerCancel={() => { drag.current = undefined }}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      onResize(side, widthOf(event.currentTarget) + (event.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1))
    }} />
}
