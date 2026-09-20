/**
 * overlay 宿主。
 *
 * 它是 toast 的唯一入口：任何包经 `ctx.get('qsToast')` 调 `show(message)`。
 * 弹窗不走这里——原生 `<dialog>.showModal()` 自己进入顶层图层，不需要 portal，
 * 所以宿主只承担 toast 栈与"应用根内的 overlay 容器"两件事。
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsOverlayInjected } from './contract.ts'
import styles from './overlay.module.css'

/** overlay 宿主的完整 props。 */
export type QsOverlayHostProps = InjectFace<QsOverlayInjected> & PropsLocale<'qs-shell'>

/**
 * 渲染 overlay 宿主。
 * @param props - toast 座席与语言座席。
 * @returns 宿主节点。
 */
export function QsOverlayHost({ useQsToasts }: QsOverlayHostProps): ReactNode {
  const toasts = useQsToasts(list => list)
  return (
    <div className={styles.host} data-qs-overlay>
      <div className={styles.stack} role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={styles.toast} data-visible="true">{toast.message}</div>
        ))}
      </div>
    </div>
  )
}
