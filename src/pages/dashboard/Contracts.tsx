import { useEffect, useState, useRef } from 'react'
import { useApi, type Client, type Contract } from '../../lib/api'

const TEMPLATES = [
  {
    label: 'Wedding Contract',
    content: `PHOTOGRAPHY SERVICES AGREEMENT

This agreement is entered into between the Photographer and the Client.

SERVICES: Photographer agrees to provide photography services for the wedding event as described below.

PAYMENT: The total fee is due as outlined in the attached invoice. A non-refundable retainer of 50% is due upon signing.

DELIVERY: Final edited images will be delivered within 8 weeks of the event via an online gallery.

RIGHTS: Photographer retains copyright to all images. Client receives a personal use license.

CANCELLATION: Cancellations within 30 days of the event forfeit the full retainer.

By signing below, both parties agree to the terms of this agreement.`,
  },
  {
    label: 'Portrait Session',
    content: `PORTRAIT PHOTOGRAPHY AGREEMENT

This agreement is between the Photographer and the Client for portrait photography services.

SESSION: One portrait session as scheduled. Duration approximately 1-2 hours.

PAYMENT: Full payment is due prior to the session date.

DELIVERY: 20-30 edited images delivered via online gallery within 3 weeks of the session.

USAGE: Images are for personal use only. Commercial use requires a separate license.

RESCHEDULING: One reschedule is permitted with 48 hours notice. Cancellations within 24 hours are non-refundable.

By signing below, both parties agree to the terms of this agreement.`,
  },
  {
    label: 'Commercial / Event',
    content: `COMMERCIAL PHOTOGRAPHY AGREEMENT

This agreement is between the Photographer and the Client for commercial photography services.

SCOPE: Photographer will provide photography coverage for the event or campaign as outlined.

DELIVERABLES: Fully edited, high-resolution images delivered within 5 business days.

LICENSING: Client receives a one-year, non-exclusive license for agreed-upon uses. Additional licensing available at extra cost.

PAYMENT: 50% deposit due upon signing; remaining balance due on or before the shoot date.

CREDIT: Photographer credit preferred in any published work.

Both parties have read and agree to the terms above.`,
  },
]

function statusStyle(status: Contract['status']): React.CSSProperties {
  if (status === 'signed') return { background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)' }
  if (status === 'sent') return { background: 'var(--gold-bg)', color: 'var(--gold-dim)', border: '1px solid var(--gold-border)' }
  return { background: 'var(--bg-secondary)', color: 'var(--text-dim)', border: '1px solid var(--border)' }
}

export default function Contracts() {
  const { authFetch } = useApi()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ client_id: '', title: '', content: '' })
  const [formError, setFormError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      authFetch('/api/contracts', { method: 'get' }),
      authFetch('/api/clients', { method: 'get' }),
    ]).then(([cRes, clRes]) => {
      setContracts(Array.isArray(cRes.data) ? cRes.data : [])
      setClients(Array.isArray(clRes.data) ? clRes.data : [])
    }).catch(console.error).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (drawerOpen) setTimeout(() => titleRef.current?.focus(), 80)
  }, [drawerOpen])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const openDrawer = () => {
    setForm({ client_id: '', title: '', content: '' })
    setFormError('')
    setDrawerOpen(true)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Contract title is required.'); return }
    setFormError('')
    setSaving(true)
    try {
      const res = await authFetch('/api/contracts', {
        method: 'post',
        data: { client_id: form.client_id || null, title: form.title.trim(), content: form.content },
      })
      setContracts(prev => [res.data as Contract, ...prev])
      setDrawerOpen(false)
      showToast('Contract created.')
    } catch {
      setFormError('Failed to create contract.')
    } finally {
      setSaving(false)
    }
  }

  const handleSend = async (id: number) => {
    setSending(id)
    try {
      await authFetch(`/api/contracts/${id}/send`, { method: 'post' })
      setContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'sent' } : c))
      showToast('Contract sent to client.')
    } catch {
      showToast('Failed to send contract.')
    } finally {
      setSending(null)
    }
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    try {
      await authFetch(`/api/contracts/${id}`, { method: 'delete' })
      setContracts(prev => prev.filter(c => c.id !== id))
      showToast('Contract deleted.')
    } catch {
      showToast('Failed to delete.')
    } finally {
      setDeleting(null)
    }
  }

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setForm(f => ({ ...f, title: f.title || t.label, content: t.content }))
  }

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Contracts</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{contracts.length} contract{contracts.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openDrawer} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Contract
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[0,1,2].map(i => <div key={i} className="card skeleton" style={{ height: 72 }} />)}
        </div>
      ) : contracts.length === 0 ? (
        <div className="card" style={{ padding: '56px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📝</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>No contracts yet</p>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>Create a contract and send it to a client for review.</p>
          <button onClick={openDrawer} className="btn btn-primary">Create First Contract</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contracts.map(c => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</p>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, flexShrink: 0, ...statusStyle(c.status) }}>{c.status}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {c.client_name ?? 'No client'} · {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {c.signed_at && ` · Signed ${new Date(c.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {c.status === 'draft' && (
                  <button
                    onClick={() => handleSend(c.id)}
                    disabled={sending === c.id}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer' }}
                  >
                    {sending === c.id ? 'Sending…' : 'Send'}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(c.id)}
                  disabled={deleting === c.id}
                  style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer backdrop */}
      {drawerOpen && <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199, backdropFilter: 'blur(2px)' }} />}

      {/* Drawer */}
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 200, width: 'min(520px, 100vw)', background: 'var(--bg-elevated)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>New Contract</h2>
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
            <label className="field-label">Contract title <span style={{ color: 'var(--color-red)' }}>*</span></label>
            <input ref={titleRef} className="input" type="text" placeholder="e.g. Wedding Photography Agreement" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label className="field-label" style={{ margin: 0 }}>Contract content</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {TEMPLATES.map(t => (
                  <button key={t.label} type="button" onClick={() => applyTemplate(t)}
                    style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-dim)', cursor: 'pointer' }}>
                    {t.label.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="input"
              placeholder="Write your contract terms here, or use a template above…"
              rows={14}
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13, minHeight: 260 }}
            />
          </div>
        </form>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={() => setDrawerOpen(false)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>
            {saving ? <><span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />Creating…</> : 'Create Contract'}
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
