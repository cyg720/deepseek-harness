/** 原图通过 body portal 覆盖视口，按官方行为管理关闭按钮和返回焦点。 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GalleryProps } from './contract.ts'
import css from './gallery.module.css'
/**
 * 挂载期间接管 Escape，卸载释放监听并恢复打开前的焦点。
 * @param props - 原图地址、名称、本地化字典及关闭/解码错误动作。
 * @returns 不受消息容器 transform 或滚动裁剪影响的原图弹层。
 */
export function OriginalImage({ url, name, t, onClose, onError }: Pick<GalleryProps, 't'> & {
  url: string
  name: string
  onClose: () => void
  onError: () => void
}): ReactNode {
  const [opener] = useState(() => document.activeElement)
  const focusClose = useCallback((node: HTMLButtonElement | null) => { node?.focus() }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [onClose, opener])
  return createPortal(<div className={css.backdrop} role="dialog" aria-modal="true" aria-label={name}>
    <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
    <img className={css.original} src={url} alt={name} onError={onError} />
    <button ref={focusClose} type="button" className={css.close} onClick={onClose} aria-label={t('close')}>{t('close')}</button>
  </div>, document.body)
}
