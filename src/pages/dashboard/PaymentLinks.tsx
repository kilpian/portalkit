import { useState, useEffect } from 'react'
import { useApi } from '../../lib/api'
import type { PaymentLink } from '../../lib/api'

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const BLANK: Partial<PaymentLink> = { title: '', description: '', amount_cents: undefined, allow_custom_amount: false, min_amount_cents: 100, link_type: 'fixed' }

export default function PaymentLinks() {
  const { authFetch } = useApi()
  const [links, setLinks] = useState<PaymentLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Partial<PaymentLink>>(BLANK)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  const fetchLinks = () =>
    authFetch('/api/payment-links')
      .then(r => setLinks(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))

  useEffect(() => { fetchLinks() }, [])

  const openNew = () => { setEditingId(null); setForm(BLANK); setShowForm(true) }
  const openEdit = (l: PaymentLink) => { setEditingId(l.id); setForm({ ...l }); setShowForm(true) }

  const save = async () => {
    if (!form.title?.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const res = await authFetch(`/api/payment-links/${editingId}`, { method: 'put', data: form })
        setLinks(prev => prev.map(l => l.id === editingId ? res.data : l))
      } else {
        const res = await authFetch('/api/payment-links', { method: 'post', data: form })
        setLinks(prev => [res.data, ...prev])
      }
      setShowForm(false)
    } catch {} finally { setSaving(false) }
  }

  const remove = async (id: number) => {
    await authFetch(`/api/payment-links/${id}`, { method: 'delete' })
    setLinks(prev => prev.filter(l => l.id !== id))
  }

  const copyLink = (l: PaymentLink) => {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${l.id}`).then(() => {
      setCopied(l.id); setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 }}>Payment Links</h1>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 6 }}>Create shareable links for tips, deposits, or custom payments.</p>
        </div>
        <button onClick={openNew} style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          + New Link
        </button>
      </div>

      {showForm && (
        <>
          <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 51, width: 'min(500px, 90vw)', background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', marginBottom: 20 }}>{editingId ? 'Edit' : 'New'} Payment Link</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Title *</label>
                <input type="text" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tip jar, Deposit, Travel fee..." style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Description</label>
                <input type="text" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description shown to the payer" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Type</label>
                <select value={form.link_type || 'fixed'} onChange={e => setForm(f => ({ ...f, link_type: e.target.value as 'fixed' | 'tip' | 'custom' }))} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}>
                  <option value="fixed">Fixed Amount</option>
                  <option value="tip">Tip Jar (client chooses amount)</option>
                  <option value="custom">Custom (client enters amount)</option>
                </select>
              </div>
              {form.link_type === 'fixed' && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Amount (USD)</label>
                  <input type="number" min="1" step="1" value={form.amount_cents ? form.amount_cents / 100 : ''} onChange={e => setForm(f => ({ ...f, amount_cents: Math.round(parseFloat(e.target.value) * 100) || undefined }))} placeholder="0.00" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              )}
              {(form.link_type === 'tip' || form.link_type === 'custom') && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Minimum Amount (USD)</label>
                  <input type="number" min="1" step="1" value={form.min_amount_cents ? form.min_amount_cents / 100 : ''} onChange={e => setForm(f => ({ ...f, min_amount_cents: Math.round(parseFloat(e.target.value) * 100) || 100 }))} placeholder="1.00" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 14, cursor: 'pointer', color: '#374151' }}>Cancel</button>
              <button onClick={save} disabled={saving || !form.title?.trim()} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Link'}
              </button>
            </div>
          </div>
        </>
      )}

      {loading ? (
        <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
      ) : links.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No payment links yet</p>
          <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>Create a shareable link for tips, deposits, or any one-time payment.</p>
          <button onClick={openNew} style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Create Payment Link</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {links.map(l => (
            <div key={l.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: 0 }}>{l.title}</p>
                    {!l.active && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#F3F4F6', color: '#9CA3AF', fontWeight: 700 }}>INACTIVE</span>}
                  </div>
                  {l.description && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>{l.description}</p>}
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 13, color: '#6B7280' }}>
                    <span>{l.link_type === 'fixed' && l.amount_cents ? formatCents(l.amount_cents) : l.link_type === 'tip' ? 'Tip jar' : 'Custom amount'}</span>
                    <span>·</span>
                    <span>{l.transaction_count} payment{l.transaction_count !== 1 ? 's' : ''}</span>
                    {l.total_collected_cents > 0 && <><span>·</span><span style={{ color: '#059669', fontWeight: 600 }}>{formatCents(l.total_collected_cents)} collected</span></>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => copyLink(l)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: copied === l.id ? '#059669' : 'transparent', color: copied === l.id ? '#fff' : '#374151', cursor: 'pointer', fontWeight: 500 }}>
                    {copied === l.id ? '✓ Copied' : 'Copy Link'}
                  </button>
                  <button onClick={() => openEdit(l)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: 'transparent', color: '#374151', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => remove(l.id)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #FECACA', background: 'transparent', color: '#DC2626', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
