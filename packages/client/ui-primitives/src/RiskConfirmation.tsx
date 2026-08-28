/**
 * Controlled risk acknowledgement dialog shared by product surfaces that
 * must gate a sensitive action behind an explicit checkbox.
 */
/*
 * 中文说明：
 * - 文件职责：提供敏感操作共用的受控风险确认对话框，要求用户先勾选确认再执行。
 * - 技术维度：使用 React 受控属性、Modal、Button、复选框和 CSS Modules。
 * - 产品维度：在删除、放宽权限等高风险场景中增加明确知情确认，降低误操作。
 * - 逻辑维度：渲染警告说明、确认复选框及取消/确认按钮，全部状态和动作由调用方拥有。
 * - 关键边界：disabled 或未 acknowledged 时主按钮不可用；关闭等同调用 onCancel。
 * - 新手阅读建议：先看 Props 的受控状态与三个回调，再看 disabled 表达式如何形成操作门槛。
 */
import { Button } from './Button.tsx'
import { IconWarningOutline16 } from './icons/index.tsx'
import { Modal } from './Modal.tsx'
import css from './RiskConfirmation.module.css'

/** 中文：风险确认对话框的受控属性与动作。 */
export interface RiskConfirmationProps {
  /** 是否显示对话框。 */
  open: boolean
  /** 对话框标题。 */
  title: string
  /** 风险说明正文。 */
  description: string
  /** 复选框旁的知情确认文案。 */
  acknowledgeLabel: string
  /** 取消按钮文案。 */
  cancelLabel: string
  closeLabel: string
  confirmLabel: string
  /** 调用方持有的复选框当前值。 */
  acknowledged: boolean
  /** 可选整体禁用标记，默认 false。 */
  disabled?: boolean
  /** 复选框变化回调，参数为新的勾选值。 */
  onAcknowledgedChange: (acknowledged: boolean) => void
  /** 取消或关闭回调，无返回值。 */
  onCancel: () => void
  /** 满足门槛后确认操作回调，无返回值。 */
  onConfirm: () => void
}

/**
 * Render one in-page confirmation whose primary action is unavailable until
 * the caller-controlled acknowledgement is checked.
 */
/* 中文：渲染风险确认对话框；所有显示状态和回调来自 props，返回 React 元素。示例：<RiskConfirmation open acknowledged={false} ... />。 */
export function RiskConfirmation({
  open,
  title,
  description,
  acknowledgeLabel,
  cancelLabel,
  closeLabel,
  confirmLabel,
  acknowledged,
  disabled = false,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
}: RiskConfirmationProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      closeLabel={closeLabel}
      className={css.confirmation ?? ''}
      contentClassName={css.confirmationContent ?? ''}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            className={css.confirmAction}
            disabled={disabled || !acknowledged}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className={css.warning}>
        <IconWarningOutline16 size={18} className={css.warningIcon} />
        <p>{description}</p>
      </div>
      <label className={css.acknowledgement}>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={disabled}
          autoFocus
          onChange={(event) => { onAcknowledgedChange(event.currentTarget.checked) }}
        />
        <span>{acknowledgeLabel}</span>
      </label>
    </Modal>
  )
}
