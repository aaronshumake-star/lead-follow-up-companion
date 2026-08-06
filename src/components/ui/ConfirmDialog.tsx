import { Button } from './Button.tsx'
import { Modal } from './Modal.tsx'

/**
 * Confirmation for destructive actions only.
 *
 * Marking a lead lost, archiving, or deleting all pass through here. Routine
 * actions — logging a call, scheduling a follow-up — confirm with a toast
 * instead, because a dialog on every call would make the app slower to use than
 * the CRM it exists to compensate for.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">{message}</p>
    </Modal>
  )
}
