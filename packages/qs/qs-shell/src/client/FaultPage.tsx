/**
 * 根错误边界与自建故障页。
 *
 * 兜底分层（见 07-异常与恢复矩阵）里 T2 负责的一层：root occupant 内部渲染抛错时，
 * 显示自建故障页，**不回落官方 UI**。T1a/T1b（子槽条目崩溃）由框架 entry 级边界处理，
 * 各包自己在组件内兜底；T3（注册前抛错）由官方接管；T5/T6 没有 UI 兜底。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { QsIcon } from './Icon.tsx'
import styles from './fault.module.css'

/**
 * 把任意抛出值转成诊断文本。
 * @param error - 捕获到的抛出值。
 * @returns 稳定的诊断字符串。
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return typeof error === 'string' ? error : JSON.stringify(error)
}

/** 故障页文案来源：由调用方从注册时绑定的 `t` 座席取。 */
export interface QsFaultCopy {
  readonly title: string
  readonly lead: string
  readonly retry: string
  readonly reload: string
  readonly detail: string
}

/** 故障页输入。 */
export interface QsFaultPageProps {
  /** 本地化后的固定文案。 */
  readonly copy: QsFaultCopy
  /** 诊断信息；undefined 时不渲染明细区。 */
  readonly detail?: string
  /** 重试渲染；undefined 时不显示重试按钮。 */
  readonly onRetry?: (() => void) | undefined
}

/**
 * 渲染自建故障页。
 * @param props - 文案、诊断信息与重试回调。
 * @returns 故障页节点。
 */
export function QsFaultPage({ copy, detail, onRetry }: QsFaultPageProps): ReactNode {
  return (
    <div className={styles.page} data-qs-fault="root">
      <section className={styles.card} role="alert">
        <span className={styles.symbol}><QsIcon name="shield" /></span>
        <h1 className={styles.title} tabIndex={-1} data-qs-fault-title>{copy.title}</h1>
        <p className={styles.lead}>{copy.lead}</p>
        <div className={styles.actions}>
          {onRetry === undefined ? null : (
            <button type="button" className="qs-btn" onClick={onRetry}>{copy.retry}</button>
          )}
          <button
            type="button"
            className="qs-btn qs-btn-primary"
            onClick={() => { globalThis.location.reload() }}
          >
            {copy.reload}
          </button>
        </div>
        {detail === undefined ? null : (
          <details className={styles.detail}>
            <summary>{copy.detail}</summary>
            <pre>{detail}</pre>
          </details>
        )}
      </section>
    </div>
  )
}

interface BoundaryProps {
  readonly copy: QsFaultCopy
  readonly children: ReactNode
}

interface BoundaryState {
  readonly error: unknown
}

/**
 * 捕获工作台组件树内的渲染异常并改渲染故障页。
 *
 * 重试通过清空错误状态重新挂载子树；工作台 store 与官方对象层不随重挂销毁，
 * 因此会话、草稿与滚动位置都保留。
 */
export class QsRootErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: undefined }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('qs-shell: workbench render failed', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children
    return (
      <QsFaultPage
        copy={this.props.copy}
        detail={describeError(error)}
        onRetry={() => { this.setState({ error: undefined }) }}
      />
    )
  }
}
