import { useEffect, useState, useRef } from 'react'
import { useApi, type Client, type Invoice } from '../../lib/api'

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function formatDate(d: string | null) {
  if (!d) return null
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function isOverdue(inv: Invoice): boolean {
  if (inv.status === 'paid') return false
  if (!inv.due_date) return false
  return new Date(inv.due_date) < new Date()
}

function statusStyle(status: Invoice['status'], overdue: boolean): React.CSSProperties {
  if (status === 'paid') return { background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)' }
  if (overdue || status === 'overdue') return { background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }
  if (status === 'sent') return { background: 'var(--gold-bg)', color: 'var(--gold-dim)', border: '1px solid var(--gold-border)' }
  return { background: 'var(--bg-secondary)', color: 'var(--text-dim)', border: '1px solid var(--border)' }
}

function genInvoiceNumber(existing: Invoice[]): string {
  const nums = existing.map(i => parseInt(i.invoice_number?.replace(/\D/g, '') ?? '0')).filter(Boolean)
  const next = nums.length ? Math.max(...nums) + 1 : 1001
  return `INV-${next}`
}

export default function Invoices() {
  const { authFetch } = useApi()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState<number | null>(null)
  const [markingPaid, setMarkingPaid] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ client_id: '', invoice_number: '', amount: '', due_date: '', notes: '' })
  const [formError, setFormError] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      authFetch('/api/invoices', { method: 'get' }),
      authFetch('/api/clients', { method: 'get' }),
    ]).then(([iRes, cRes]) => {
      setInvoices(Array.isArray(iRes.data) ? iRes.data : [])
      setClients(Array.isArray(cRes.data) ? cRes.data : [])
    }).catch(console.error).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (drawerOpen) setTimeout(() => amountRef.current?.focus(), 80)
  }, [drawerOpen])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const openDrawer = () => {
    setForm({ client_id: '', invoice_number: genInvoiceNumber(invoices), amount: '', due_date: '', notes: '' })
    setFormError('')
    setDrawerOpen(true)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const amountCents = Math.round(parseFloat(form.amount) * 100)
    if (!form.amount || isNaN(amountCents) || amountCents <= 0) { setFormError('A valid amount is required.'); return }
    setFormError('')
    setSaving(true)
    try {
      const res = await authFetch('/api/invoices', {
        method: 'post',
        data: {
          client_id: form.client_id || null,
          invoice_number: form.invoice_number || null,
          amount_cents: amountCents,
          due_date: form.due_date || null,
          notes: form.notes || null,
        },
      })
      setInvoices(prev => [res.data as Invoice, ...prev])
      setDrawerOpen(false)
      showToast('Invoice created.')
    } catch {
      setFormError('Failed to create invoice.')
    } finally {
      setSaving(false)
    }
  }

  const handleSend = async (id: number) => {
    setSending(id)
    try {
      await authFetch(`/api/invoices/${id}/send`, { method: 'post' })
      setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: 'sent' } : i))
      showToast('Invoice sent to client.')
    } catch {
      showToast('Failed to send invoice.')
    } finally {
      setSending(null)
    }
  }

  const handleMarkPaid = async (id: number) => {
    setMarkingPaid(id)
    try {
      const res = await authFetch(`/api/invoices/${id}`, { method: 'put', data: { status: 'paid', paid_at: new Date().toISOString() } })
      setInvoices(prev => prev.map(i => i.id === id ? (res.data as Invoice) : i))
      showToast('Invoice marked as paid.')
    } catch {
      showToast('Failed to update invoice.')
    } finally {
      setMarkingPaid(null)
    }
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    try {
      await authFetch(`/api/invoices/${id}`, { method: 'delete' })
      setInvoices(prev => prev.filter(i => i.id !== id))
      showToast('Invoice deleted.')
    } catch {
      showToast('Failed to delete.')
    } finally {
      setDeleting(null)
    }
  }

  // Stats
  const totalCents = invoices.reduce((s, i) => s + i.amount_cents, 0)
  const paidCents = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0)
  const outstandingCents = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount_cents, 0)
  const overdueCents = invoices.filter(i => isOverdue(i)).reduce((s, i) => s + i.amount_cents, 0)

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Invoices</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openDrawer} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Invoice
        </button>
      </div>

      {/* Stats row */}
      {!loading && invoices.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Invoiced', value: formatMoney(totalCents), accent: false },
            { label: 'Paid', value: formatMoney(paidCents), accent: paidCents > 0, color: 'var(--color-green)' },
            { label: 'Outstanding', value: formatMoney(outstandingCents), accent: false },
            { label: 'Overdue', value: formatMoney(overdueCents), accent: overdueCents > 0, color: '#DC2626' },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{s.label}</p>
              <p style={{ fontSize: 20, fontWeight: 800, color: s.accent ? s.color : 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[0,1,2].map(i => <div key={i} className="card skeleton" style={{ height: 72 }} />)}
        </div>
      ) : invoices.length === 0 ? (
        <div className="card" style={{ padding: '56px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>💳</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>No invoices yet</p>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>Create an invoice to send to your clients.</p>
          <button onClick={openDrawer} className="btn btn-primary">Create First Invoice</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {invoices.map(inv => {
            const overdue = isOverdue(inv)
            const effStatus: Invoice['status'] = overdue && inv.status !== 'paid' ? 'overdue' : inv.status
            return (
              <div key={inv.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(inv.amount_cents)}</p>
                    {inv.invoice_number && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{inv.invoice_number}</span>}
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, flexShrink: 0, ...statusStyle(effStatus, overdue) }}>{overdue && inv.status !== 'paid' ? 'overdue' : effStatus}</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {inv.client_name ?? 'No client'}
                    {inv.due_date && ` · Due ${formatDate(inv.due_date)}`}
                    {inv.paid_at && ` · Paid ${formatDate(inv.paid_at)}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {inv.status !== 'paid' && (
                    <>
                      {inv.status === 'draft' && (
                        <button
                          onClick={() => handleSend(inv.id)}
                          disabled={sending === inv.id}
                          style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer' }}
                        >
                          {sending === inv.id ? 'Sending…' : 'Send'}
                        </button>
                      )}
                      <button
                        onClick={() => handleMarkPaid(inv.id)}
                        disabled={markingPaid === inv.id}
                        style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--color-green-border)', background: 'var(--color-green-bg)', color: 'var(--color-green)', cursor: 'pointer' }}
                      >
                        {markingPaid === inv.id ? '…' : '✓ Paid'}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(inv.id)}
                    disabled={deleting === inv.id}
                    style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Drawer backdrop */}
      {drawerOpen && <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199, backdropFilter: 'blur(2px)' }} />}

      {/* Drawer */}
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 200, width: 'min(440px, 100vw)', background: 'var(--bg-elevated)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>New Invoice</h2>
          <button onClick={() => setDrawerOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleCreate} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {formError && <div className="alert alert-error">{formError}</div>}

          <div>
            <label className="field-label">Client</label>
            <select className="input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">No client selected</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">Invoice number</label>
            <input className="input" type="text" placeholder="INV-1001" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
          </div>

          <div>
            <label className="field-label">Amount (USD) <span style={{ color: 'var(--color-red)' }}>*</span></label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontSize: 14 }}>$</span>
              <input ref={amountRef} className="input" type="number" min="0" step="0.01" placeholder="500.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ paddingLeft: 28 }} />
            </div>
          </div>

          <div>
            <label className="field-label">Due date</label>
            <input className="input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>

          <div>
            <label className="field-label">Notes</label>
            <textarea className="input" placeholder="Any details to include on the invoice…" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical', minHeight: 80 }} />
          </div>
        </form>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={() => setDrawerOpen(false)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>
            {saving ? <><span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />Creating…</> : 'Create Invoice'}
          </button>
        </div>
      </aside>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)', animation: 'fadeInUp 0.2s ease' }}>
          {toast}
        </div>
      )}
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
