interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

export default function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', onConfirm, onCancel, danger = false }: Props) {
  if (!open) return null
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onCancel}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 400, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 10px' }}>{title}</h3>
        <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: '0 0 24px' }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: danger ? '#DC2626' : '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
