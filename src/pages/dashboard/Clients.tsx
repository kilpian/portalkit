import { useEffect, useState, useRef } from 'react'
import { useApi, type Client, type CreateClientPayload } from '../../lib/api'
import { ClientPortalContent } from '../ClientPortal'

// ── Helpers ───────────────────────────────────────────────────
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
  if (n < 30) return `${n} days away`
  const months = Math.round(n / 30)
  return `${months} month${months === 1 ? '' : 's'} away`
}

const BLANK: CreateClientPayload = { name: '', email: '', phone: '', event_type: '', event_date: '', notes: '' }

// ── Preview Modal ─────────────────────────────────────────────
function PreviewModal({ token, onClose }: { token: string; onClose: () => void }) {
  const url = `${window.location.origin}/portal/${token}`
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyUrl = () => {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', flexDirection: 'column', backdropFilter: 'blur(4px)', animation: 'modalIn 0.22s ease' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Chrome bar */}
      <div style={{ background: '#1A1208', flexShrink: 0, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F56', display: 'block', cursor: 'pointer' }} onClick={onClose} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FFBD2E', display: 'block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#27C93F', display: 'block' }} />
        </div>
        <div style={{ flex: 1, background: '#2D2416', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {url}
        </div>
        <button onClick={copyUrl} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: copied ? '#34D399' : 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {copied ? '✓ Copied' : 'Copy Link'}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '5px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Open ↗
        </a>
        <button onClick={onClose} style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', display: 'flex', padding: 4, borderRadius: 4 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {/* Portal content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-primary)' }}>
        <ClientPortalContent token={token} />
      </div>
      <style>{`@keyframes modalIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

// ── Client Card ───────────────────────────────────────────────
function ClientCard({
  client,
  onEdit,
  onDelete,
  onPreview,
}: {
  client: Client
  onEdit: () => void
  onDelete: () => void
  onPreview: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const url = `${window.location.origin}/portal/${client.portal_token}`

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const days = daysUntil(client.event_date)
  const eventLabel = [client.event_type, formatDate(client.event_date)].filter(Boolean).join(' · ')

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-card)', borderTop: '3px solid var(--green)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'box-shadow 0.18s ease, border-color 0.18s ease' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow-card)')}
    >
      {/* Card body */}
      <div style={{ padding: '20px 20px 16px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
          {/* Avatar */}
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--green)', color: '#FDFAF5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-display)' }}>
            {getInitials(client.name)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.name}</p>
            {eventLabel && <p style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eventLabel}</p>}
          </div>
        </div>

        {/* Badges row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)' }}>
            Active Portal
          </span>
          {days !== null && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: days >= 0 && days <= 30 ? 'var(--gold-bg)' : 'var(--bg-secondary)', color: days >= 0 && days <= 30 ? 'var(--gold-dim)' : 'var(--text-dim)', border: `1px solid ${days >= 0 && days <= 30 ? 'var(--gold-border)' : 'var(--border)'}` }}>
              {formatDaysLabel(days)}
            </span>
          )}
        </div>

        {/* Email */}
        {client.email && (
          <a href={`mailto:${client.email}`} style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--green)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            {client.email}
          </a>
        )}

        {/* Notes preview */}
        {client.notes && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 4 }}>
            {client.notes.length > 60 ? client.notes.slice(0, 60) + '…' : client.notes}
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 6, background: 'var(--bg-secondary)' }}>
        {deleteConfirm ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center', flex: 1 }}>Delete this client?</span>
            <button onClick={onDelete} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Yes, delete</button>
            <button onClick={() => setDeleteConfirm(false)} className="btn btn-ghost btn-sm">Cancel</button>
          </>
        ) : (
          <>
            {/* Preview */}
            <button onClick={onPreview} title="Preview portal" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', flex: 1, justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Preview
            </button>
            {/* Copy */}
            <button onClick={copyLink} title="Copy portal link" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: copied ? 'var(--color-green)' : 'var(--text-muted)', background: copied ? 'var(--color-green-bg)' : 'transparent', border: `1px solid ${copied ? 'var(--color-green-border)' : 'var(--border)'}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
              {copied
                ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
              }
            </button>
            {/* Edit */}
            <button onClick={onEdit} title="Edit client" style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.background = 'var(--green-bg)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            {/* Delete */}
            <button onClick={() => setDeleteConfirm(true)} title="Delete client" style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function Clients() {
  const { authFetch } = useApi()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [form, setForm] = useState<CreateClientPayload>(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  const [previewToken, setPreviewToken] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    authFetch('/api/clients', { method: 'get' })
      .then(res => setClients(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (drawerOpen) setTimeout(() => nameRef.current?.focus(), 80)
  }, [drawerOpen])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const openDrawer = () => { setEditingClient(null); setForm(BLANK); setFormError(''); setDrawerOpen(true) }
  const openEditDrawer = (client: Client) => {
    setEditingClient(client)
    setForm({ name: client.name, email: client.email ?? '', phone: client.phone ?? '', event_type: client.event_type ?? '', event_date: client.event_date ?? '', notes: client.notes ?? '' })
    setFormError('')
    setDrawerOpen(true)
  }
  const closeDrawer = () => { setDrawerOpen(false); setEditingClient(null) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) { setFormError('Client name is required.'); return }
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
      if (editingClient) {
        const res = await authFetch(`/api/clients/${editingClient.id}`, { method: 'put', data: payload })
        const updated: Client = res.data
        setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
        closeDrawer()
        showToast(`${updated.name}'s info saved.`)
      } else {
        const res = await authFetch('/api/clients', { method: 'post', data: payload })
        const created: Client = res.data
        setClients(prev => [created, ...prev])
        closeDrawer()
        showToast(`${created.name}'s portal created!`)
      }
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { error?: string } } }
      setFormError(ae?.response?.data?.error || (editingClient ? 'Failed to save changes.' : 'Failed to create client.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await authFetch(`/api/clients/${id}`, { method: 'delete' })
      setClients(prev => prev.filter(c => c.id !== id))
      showToast('Client deleted.')
    } catch {
      showToast('Failed to delete client.')
    }
  }

  const field = (key: keyof CreateClientPayload) => ({
    value: form[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  })

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
            Your Clients
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{clients.length} client{clients.length !== 1 ? 's' : ''} · Share portal links to keep everyone in the loop.</p>
        </div>
        <button onClick={openDrawer} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Client
        </button>
      </div>

      {/* Cards grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} className="card" style={{ padding: 20, borderTop: '3px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 16, marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '70%' }} />
                </div>
              </div>
              <div className="skeleton" style={{ height: 12, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: '60%' }} />
            </div>
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div style={{ padding: '64px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📸</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>No clients yet</p>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>Add a client to generate their personal portal link.</p>
          <button onClick={openDrawer} className="btn btn-primary">Add Your First Client</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {clients.map(c => (
            <ClientCard
              key={c.id}
              client={c}
              onEdit={() => openEditDrawer(c)}
              onDelete={() => handleDelete(c.id)}
              onPreview={() => setPreviewToken(c.portal_token)}
            />
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewToken && <PreviewModal token={previewToken} onClose={() => setPreviewToken(null)} />}

      {/* Drawer overlay */}
      {drawerOpen && (
        <div onClick={closeDrawer} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199, backdropFilter: 'blur(2px)' }} />
      )}

      {/* Slide-in drawer */}
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 200, width: 'min(440px, 100vw)', background: 'var(--bg-elevated)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingClient ? 'Edit Client' : 'New Client'}
          </h2>
          <button onClick={closeDrawer} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
            <input className="input" type="text" placeholder="e.g. Wedding, Portrait, Engagement" {...field('event_type')} />
          </div>
          <div>
            <label className="field-label">Event date</label>
            <input className="input" type="date" {...field('event_date')} />
          </div>
          <div>
            <label className="field-label">Notes <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
            <textarea className="input" placeholder="Any details about this client or event…" rows={3}
              value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ resize: 'vertical', minHeight: 80 }}
            />
          </div>
        </form>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={closeDrawer} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>
            {saving
              ? <><span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />{editingClient ? 'Saving…' : 'Creating…'}</>
              : editingClient ? 'Save Changes' : 'Create Portal'
            }
          </button>
        </div>
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
