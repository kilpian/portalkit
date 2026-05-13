import { useEffect, useState, useRef } from 'react'
import { useApi, type Client, type CreateClientPayload } from '../../lib/api'

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/portal/${token}`
  const handle = () => {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <button onClick={handle} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500,
      color: copied ? 'var(--color-green)' : 'var(--green)',
      background: copied ? 'var(--color-green-bg)' : 'var(--bg-secondary)',
      border: `1px solid ${copied ? 'var(--color-green-border)' : 'var(--border)'}`,
      borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {copied
        ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Copied</>
        : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy Link</>
      }
    </button>
  )
}

const BLANK: CreateClientPayload = { name: '', email: '', phone: '', event_type: '', event_date: '', notes: '' }

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
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
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
    setForm({
      name: client.name,
      email: client.email ?? '',
      phone: client.phone ?? '',
      event_type: client.event_type ?? '',
      event_date: client.event_date ?? '',
      notes: client.notes ?? '',
    })
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
      setDeleteConfirm(null)
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
    <div style={{ padding: '32px 32px 64px', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
            Your Clients
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Manage clients and share their portal links.</p>
        </div>
        <button onClick={openDrawer} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Client
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="skeleton" style={{ height: 14, flex: 2 }} />
                <div className="skeleton" style={{ height: 14, flex: 1 }} />
                <div className="skeleton" style={{ height: 14, flex: 1 }} />
                <div className="skeleton" style={{ height: 14, width: 80 }} />
              </div>
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📸</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No clients yet</p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20 }}>
              Add a client to generate their personal portal link.
            </p>
            <button onClick={openDrawer} className="btn btn-primary">Add Your First Client</button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                  {['Client', 'Event', 'Portal Link', 'Added', ''].map((h, i) => (
                    <th key={i} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 20px' }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</p>
                      {c.email && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{c.email}</p>}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-muted)' }}>
                      {c.event_type || '—'}
                      {c.event_date && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{formatDate(c.event_date)}</span>}
                    </td>
                    <td style={{ padding: '12px 20px' }}>
                      <CopyLink token={c.portal_token} />
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {formatDate(c.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {deleteConfirm === c.id ? (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => handleDelete(c.id)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                            Delete
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="btn btn-ghost btn-sm">Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => openEditDrawer(c)} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.background = 'var(--bg-secondary)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                          >
                            Edit
                          </button>
                          <button onClick={() => setDeleteConfirm(c.id)} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer overlay */}
      {drawerOpen && (
        <div
          onClick={closeDrawer}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199, backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Slide-in drawer */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 200,
        width: 'min(440px, 100vw)',
        background: 'var(--bg-elevated)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        {/* Drawer header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingClient ? 'Edit Client' : 'New Client'}
          </h2>
          <button onClick={closeDrawer} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Drawer form */}
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

        {/* Drawer footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={closeDrawer} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={saving}
            className="btn btn-primary"
            style={{ flex: 2 }}
          >
            {saving
              ? <><span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />{editingClient ? 'Saving…' : 'Creating…'}</>
              : editingClient ? 'Save Changes' : 'Create Portal'
            }
          </button>
        </div>
      </aside>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 300,
          background: 'var(--green)', color: '#FDFAF5',
          padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
          animation: 'fadeInUp 0.2s ease',
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
