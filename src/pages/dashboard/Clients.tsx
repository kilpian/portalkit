import { useEffect, useState, useRef } from 'react'
import { useApi, usePolling, type Client, type CreateClientPayload } from '../../lib/api'
import { usePortalAuth } from '../../context/AuthContext'
import { ClientPortalContent } from '../ClientPortal'

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function formatDate(d: string | null) {
  if (!d) return null
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const diff = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
  return Math.ceil(diff / 86_400_000)
}

function formatDaysLabel(n: number): string {
  if (n < 0) return 'Past'
  if (n === 0) return 'Today!'
  if (n === 1) return 'Tomorrow'
  if (n < 30) return `${n} days`
  const months = Math.round(n / 30)
  return `${months}mo`
}

const BLANK: CreateClientPayload = { name: '', email: '', phone: '', event_type: '', event_date: '', notes: '' }

const PANEL_W = 400

export default function Clients() {
  const { authFetch } = useApi()
  const { user } = usePortalAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  // Which client is selected for Info or Preview
  const [infoClient, setInfoClient] = useState<Client | null>(null)
  const [previewClient, setPreviewClient] = useState<Client | null>(null)

  // Create/Edit form
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [form, setForm] = useState<CreateClientPayload>(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const fetchClients = () =>
    authFetch('/api/clients', { method: 'get' })
      .then(res => setClients(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)
      .finally(() => setLoading(false))

  useEffect(() => {
    fetchClients()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  usePolling(fetchClients, 60000)

  // ESC to close panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewClient) { setPreviewClient(null); return }
        if (infoClient) { setInfoClient(null); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [infoClient, previewClient])

  useEffect(() => {
    if (infoClient) setTimeout(() => nameRef.current?.focus(), 80)
  }, [infoClient])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const openInfoPanel = (client: Client) => {
    console.log('Client info:', client)
    setPreviewClient(null)
    setEditingClient(client)
    setForm({ name: client.name, email: client.email ?? '', phone: client.phone ?? '', event_type: client.event_type ?? '', event_date: client.event_date ? client.event_date.slice(0, 10) : '', notes: client.notes ?? '' })
    setFormError('')
    setInfoClient(client)
  }

  const openNewClientPanel = () => {
    setPreviewClient(null)
    setEditingClient(null)
    setForm(BLANK)
    setFormError('')
    setInfoClient({} as Client) // truthy sentinel to open panel
  }

  const openPreviewPanel = (client: Client) => {
    setInfoClient(null)
    setPreviewClient(client)
  }

  const closeInfo = () => { setInfoClient(null); setEditingClient(null) }
  const closePreview = () => setPreviewClient(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Client name is required.'); return }
    setFormError('')
    setSaving(true)
    try {
      const payload: CreateClientPayload = {
        name: form.name.trim(),
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        event_type: form.event_type?.trim() || undefined,
        event_date: form.event_date || undefined,
        notes: form.notes?.trim() || undefined,
      }
      if (editingClient?.id) {
        console.log('📝 Submitting client update:', JSON.stringify(payload))
        console.log('📝 Notes in payload:', payload.notes)
        const res = await authFetch(`/api/clients/${editingClient.id}`, { method: 'put', data: payload })
        const updated: Client = res.data
        setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
        setInfoClient(updated)
        setEditingClient(updated)
        showToast(`${updated.name}'s info saved.`)
      } else {
        const res = await authFetch('/api/clients', { method: 'post', data: payload })
        const created: Client = res.data
        setClients(prev => [created, ...prev])
        closeInfo()
        showToast(`${created.name}'s portal created!`)
      }
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { error?: string } } }
      setFormError(ae?.response?.data?.error || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await authFetch(`/api/clients/${id}`, { method: 'delete' })
      setClients(prev => prev.filter(c => c.id !== id))
      if (infoClient && 'id' in infoClient && infoClient.id === id) closeInfo()
      if (previewClient?.id === id) closePreview()
      setDeleteConfirmId(null)
      showToast('Client deleted.')
    } catch {
      showToast('Failed to delete client.')
    }
  }

  const handleSendToClient = (client: Client) => {
    if (!client.email) { showToast('No email on file for this client.'); return }
    const portalUrl = `${window.location.origin}/portal/${client.portal_token}`
    const businessName = user?.business_name || user?.full_name || 'Your photographer'
    const subject = encodeURIComponent(`Your wedding portal is ready — ${client.name}`)
    const body = encodeURIComponent(
      `Hi ${client.name},\n\nYour wedding portal is ready. You can access everything here:\n\n${portalUrl}\n\nYou'll find your contract, invoice, and any files we share with you.\n\nLooking forward to your wedding!\n\n${businessName}`
    )
    window.open(`mailto:${client.email}?subject=${subject}&body=${body}`)
  }

  const copyLink = (client: Client) => {
    const url = `${window.location.origin}/portal/${client.portal_token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(client.id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const field = (key: keyof CreateClientPayload) => ({
    value: form[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value })),
  })

  const hasPanel = !!(infoClient || previewClient)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ── Main list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 32px 64px', transition: 'padding-right 0.25s' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
              Your Clients
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {clients.length} client{clients.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={openNewClientPanel} className="btn btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Client
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 14, marginBottom: 8, width: '40%' }} />
                  <div className="skeleton" style={{ height: 12, width: '25%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📸</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>No clients yet</p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>Add a client to generate their personal portal link.</p>
            <button onClick={openNewClientPanel} className="btn btn-primary">Add Your First Client</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clients.map(c => {
              const days = daysUntil(c.event_date)
              const isInfoOpen = infoClient && 'id' in infoClient && infoClient.id === c.id
              const isPreviewOpen = previewClient?.id === c.id
              const isActive = isInfoOpen || isPreviewOpen
              return (
                <div
                  key={c.id}
                  style={{
                    background: isActive ? 'var(--green-bg)' : '#fff',
                    border: `1px solid ${isActive ? 'var(--green-border)' : 'var(--border)'}`,
                    borderLeft: `3px solid ${isActive ? 'var(--green)' : 'transparent'}`,
                    borderRadius: 10,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onClick={() => openInfoPanel(c)}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = '#fff' }}
                >
                  {/* Avatar */}
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: isActive ? 'var(--green)' : 'var(--bg-tertiary)', color: isActive ? '#FDFAF5' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                    {getInitials(c.name)}
                  </div>

                  {/* Name + event */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{c.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[c.event_type, formatDate(c.event_date)].filter(Boolean).join(' · ') || c.email || 'No event details'}
                    </p>
                  </div>

                  {/* Days badge */}
                  {days !== null && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, flexShrink: 0, background: days >= 0 && days <= 30 ? 'var(--gold-bg)' : 'var(--bg-secondary)', color: days >= 0 && days <= 30 ? 'var(--gold-dim)' : 'var(--text-dim)', border: `1px solid ${days >= 0 && days <= 30 ? 'var(--gold-border)' : 'var(--border)'}` }}>
                      {formatDaysLabel(days)}
                    </span>
                  )}

                  {/* Actions — stop propagation */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {/* Preview */}
                    <button
                      onClick={() => isPreviewOpen ? closePreview() : openPreviewPanel(c)}
                      title="Preview portal"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, padding: '5px 10px', borderRadius: 6, border: `1px solid ${isPreviewOpen ? 'var(--green)' : 'var(--border)'}`, background: isPreviewOpen ? 'var(--green-bg)' : 'transparent', color: isPreviewOpen ? 'var(--green)' : 'var(--text-dim)', cursor: 'pointer' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      Portal
                    </button>
                    {/* Copy */}
                    <button
                      onClick={() => copyLink(c)}
                      title="Copy portal link"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, padding: '5px 10px', borderRadius: 6, border: `1px solid ${copied === c.id ? 'var(--color-green-border)' : 'var(--border)'}`, background: copied === c.id ? 'var(--color-green-bg)' : 'transparent', color: copied === c.id ? 'var(--color-green)' : 'var(--text-dim)', cursor: 'pointer' }}
                    >
                      {copied === c.id
                        ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                        : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                      }
                    </button>
                    {/* Delete */}
                    {deleteConfirmId === c.id ? (
                      <>
                        <button onClick={() => handleDelete(c.id)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Confirm</button>
                        <button onClick={() => setDeleteConfirmId(null)} className="btn btn-ghost btn-sm">Cancel</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(c.id)}
                        title="Delete"
                        style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Backdrop ── */}
      {hasPanel && (
        <div
          onClick={() => { closeInfo(); closePreview() }}
          style={{ position: 'fixed', inset: 0, zIndex: 198 }}
        />
      )}

      {/* ── Client Info / Edit Panel ── */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 199,
        width: PANEL_W,
        background: 'var(--bg-elevated)',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        transform: infoClient ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingClient?.id ? 'Edit Client' : 'New Client'}
          </h2>
          <button onClick={closeInfo} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {formError && <div className="alert alert-error">{formError}</div>}
          <div>
            <label className="field-label">Full name <span style={{ color: 'var(--color-red)' }}>*</span></label>
            <input ref={nameRef} className="input" type="text" placeholder="Jane Smith" {...field('name')} />
          </div>
          <div>
            <label className="field-label">Email address</label>
            <input className="input" type="email" placeholder="jane@example.com" {...field('email')} />
          </div>
          <div>
            <label className="field-label">Phone number</label>
            <input className="input" type="tel" placeholder="+1 (555) 000-0000" {...field('phone')} />
          </div>
          <div>
            <label className="field-label">Event type</label>
            <input className="input" type="text" placeholder="Wedding, Portrait, Engagement…" {...field('event_type')} />
          </div>
          <div>
            <label className="field-label">Event date</label>
            <input className="input" type="date" {...field('event_date')} />
          </div>
          <div>
            <label className="field-label">Notes</label>
            <textarea className="input" placeholder="Any details about this client or event…" rows={4}
              value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ resize: 'vertical', minHeight: 80 }}
            />
          </div>
          {editingClient?.id && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
              <label className="field-label">Portal link</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  readOnly
                  value={`${window.location.origin}/portal/${editingClient.portal_token}`}
                  style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}
                />
                <button type="button" onClick={() => copyLink(editingClient)} style={{ flexShrink: 0, fontSize: 12, padding: '0 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}>
                  {copied === editingClient.id ? '✓' : 'Copy'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => { closeInfo(); openPreviewPanel(editingClient) }}
                style={{ marginTop: 8, fontSize: 13, color: 'var(--green)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600 }}
              >
                Preview portal →
              </button>
            </div>
          )}
        </form>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={closeInfo} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>
            {saving
              ? <><span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />{editingClient?.id ? 'Saving…' : 'Creating…'}</>
              : editingClient?.id ? 'Save Changes' : 'Create Portal'
            }
          </button>
        </div>
      </aside>

      {/* ── Portal Preview Panel ── */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 199,
        width: PANEL_W,
        background: 'var(--bg-primary)',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        transform: previewClient ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        {previewClient && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, background: 'var(--bg-elevated)', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewClient.name}'s Portal</p>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{window.location.origin}/portal/{previewClient.portal_token}</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => copyLink(previewClient)} style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}>
                  {copied === previewClient.id ? '✓' : 'Copy'}
                </button>
                <button onClick={() => handleSendToClient(previewClient)} title={previewClient.email ? `Send to ${previewClient.email}` : 'No email on file'} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer' }}>
                  Send to Client ✉
                </button>
                <button onClick={closePreview} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <ClientPortalContent token={previewClient.portal_token} />
            </div>
          </>
        )}
      </aside>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)', animation: 'fadeInUp 0.2s ease' }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
