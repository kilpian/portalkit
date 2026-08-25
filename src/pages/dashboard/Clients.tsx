import { useEffect, useState, useRef } from 'react'
import { useApi, usePolling, type Client, type CreateClientPayload } from '../../lib/api'
import { usePortalAuth } from '../../context/AuthContext'
import { ClientPortalContent } from '../ClientPortal'

const STAGES = [
  { key: 'inquiry',      label: 'Inquiry',      color: '#6B7280' },
  { key: 'consultation', label: 'Consultation', color: '#D97706' },
  { key: 'booked',       label: 'Booked',       color: '#2563EB' },
  { key: 'in_progress',  label: 'In Progress',  color: '#7C3AED' },
  { key: 'delivered',    label: 'Delivered',    color: '#059669' },
  { key: 'archived',     label: 'Archived',     color: '#9CA3AF' },
]

function StageBadge({ stage }: { stage: string }) {
  const s = STAGES.find(x => x.key === stage) || STAGES[0]
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: s.color + '18', color: s.color, border: `1px solid ${s.color}40`, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

interface ClientEvent {
  id: number
  client_id: number
  event_name: string
  event_date: string | null
  event_type: string | null
  notes: string | null
  created_at: string
}

interface ShotItem {
  id: string
  category: string
  description: string
  priority: 'must_have' | 'if_possible' | 'skip'
}

interface ShotList {
  id: number
  client_id: number
  user_id: number
  shots: ShotItem[]
  client_notes: string | null
  photographer_notes: string | null
  status: 'pending' | 'submitted' | 'confirmed'
  submitted_at: string | null
  confirmed_at: string | null
}

const BLANK_EVENT = { event_name: '', event_date: '', event_type: '' }

const SHOT_CATEGORIES = [
  { key: 'ceremony',      label: 'Ceremony' },
  { key: 'reception',     label: 'Reception' },
  { key: 'portraits',     label: 'Portraits' },
  { key: 'details',       label: 'Details' },
  { key: 'family',        label: 'Family' },
  { key: 'getting_ready', label: 'Getting Ready' },
]

function PriorityBadge({ priority }: { priority: ShotItem['priority'] }) {
  const map = {
    must_have:   { label: 'Must', bg: '#FEE2E2', color: '#DC2626' },
    if_possible: { label: 'If possible', bg: '#FEF3C7', color: '#D97706' },
    skip:        { label: 'Skip', bg: '#F3F4F6', color: '#6B7280' },
  }
  const s = map[priority] ?? map.if_possible
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: s.bg, color: s.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {s.label}
    </span>
  )
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function formatEventDate(dateStr: string | null | undefined) {
  if (!dateStr) return ''
  const clean = dateStr.split('T')[0]
  const [year, month, day] = clean.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const clean = d.split('T')[0]
  const [year, month, day] = clean.split('-').map(Number)
  const diff = new Date(year, month - 1, day).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
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

const BLANK: CreateClientPayload = { name: '', email: '', phone: '', event_type: '', event_date: '', notes: '', gallery_url: '', secondary_name: '', secondary_email: '', secondary_phone: '' }

const PANEL_W = 400

export default function Clients() {
  const { authFetch } = useApi()
  const { user } = usePortalAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState<string>('all')

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
  const [sendModal, setSendModal] = useState<Client | null>(null)
  const [sendLinkCopied, setSendLinkCopied] = useState(false)
  const [sendMsgCopied, setSendMsgCopied] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const [clientEvents, setClientEvents] = useState<ClientEvent[]>([])
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [eventForm, setEventForm] = useState(BLANK_EVENT)
  const [savingEvent, setSavingEvent] = useState(false)
  const [deleteEventConfirmId, setDeleteEventConfirmId] = useState<number | null>(null)
  const [showSecondary, setShowSecondary] = useState(false)
  const [showEvents, setShowEvents] = useState(false)

  const [shotList, setShotList] = useState<ShotList | null>(null)
  const [shotListLoading, setShotListLoading] = useState(false)
  const [confirmingShots, setConfirmingShots] = useState(false)
  const [newShotDesc, setNewShotDesc] = useState('')
  const [newShotCat, setNewShotCat] = useState('ceremony')
  const [newShotPrio, setNewShotPrio] = useState<ShotItem['priority']>('must_have')
  const [savingShot, setSavingShot] = useState(false)

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

  useEffect(() => {
    setShowAddEvent(false)
    setDeleteEventConfirmId(null)
    if (!editingClient?.id) { setClientEvents([]); return }
    authFetch(`/api/clients/${editingClient.id}/events`, { method: 'get' })
      .then(res => setClientEvents(Array.isArray(res.data) ? res.data : []))
      .catch(() => setClientEvents([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingClient?.id])

  useEffect(() => {
    setShotList(null)
    setNewShotDesc('')
    if (!editingClient?.id) return
    setShotListLoading(true)
    authFetch(`/api/clients/${editingClient.id}/shot-list`, { method: 'get' })
      .then(res => setShotList(res.data))
      .catch(() => setShotList(null))
      .finally(() => setShotListLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingClient?.id])

  const handleAddEvent = async () => {
    if (!editingClient?.id || !eventForm.event_name.trim()) return
    setSavingEvent(true)
    try {
      const res = await authFetch(`/api/clients/${editingClient.id}/events`, {
        method: 'post',
        data: {
          event_name: eventForm.event_name.trim(),
          event_date: eventForm.event_date || undefined,
          event_type: eventForm.event_type.trim() || undefined,
        },
      })
      setClientEvents(prev => [...prev, res.data as ClientEvent])
      setShowAddEvent(false)
      setEventForm(BLANK_EVENT)
    } catch {
      // silent
    } finally {
      setSavingEvent(false)
    }
  }

  const handleDeleteEvent = async (id: number) => {
    if (!editingClient?.id) return
    try {
      await authFetch(`/api/clients/${editingClient.id}/events/${id}`, { method: 'delete' })
      setClientEvents(prev => prev.filter(e => e.id !== id))
      setDeleteEventConfirmId(null)
    } catch {
      // silent
    }
  }

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
    setForm({ name: client.name, email: client.email ?? '', phone: client.phone ?? '', event_type: client.event_type ?? '', event_date: client.event_date ? client.event_date.split('T')[0] : '', notes: client.notes ?? '', gallery_url: client.gallery_url ?? '', secondary_name: client.secondary_name ?? '', secondary_email: client.secondary_email ?? '', secondary_phone: client.secondary_phone ?? '' })
    setFormError('')
    setInfoClient(client)
  }

  const openNewClientPanel = () => {
    setPreviewClient(null)
    setEditingClient(null)
    setForm(BLANK)
    setFormError('')
    setShowSecondary(false)
    setShowEvents(false)
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
        gallery_url: form.gallery_url?.trim() || undefined,
        secondary_name: form.secondary_name?.trim() || undefined,
        secondary_email: form.secondary_email?.trim() || undefined,
        secondary_phone: form.secondary_phone?.trim() || undefined,
      }
      if (editingClient?.id) {
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
    setSendLinkCopied(false)
    setSendModal(client)
  }

  const updateStage = async (clientId: number, stage: string) => {
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, stage } : c))
    try {
      await authFetch(`/api/clients/${clientId}/stage`, { method: 'patch', data: { stage } })
    } catch {
      fetchClients()
    }
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
  const isBlurred = clients.some(c => c._blurred)

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="input" style={{ fontSize: 12, padding: '6px 10px', height: 'auto' }}>
              <option value="all">All Stages</option>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button onClick={openNewClientPanel} className="btn btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Client
            </button>
          </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
            {isBlurred && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: 'var(--gold-bg)', border: '1px solid var(--gold-border)', borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  You have {clients.length} client{clients.length === 1 ? '' : 's'} (upgrade to view)
                </span>
                <button onClick={() => window.dispatchEvent(new Event('pk:upgrade-required'))} className="btn btn-primary btn-sm">
                  Upgrade to view
                </button>
              </div>
            )}
            {clients.filter(c => stageFilter === 'all' || (c.stage || 'inquiry') === stageFilter).map(c => {
              const days = daysUntil(c.event_date)
              const isInfoOpen = infoClient && 'id' in infoClient && infoClient.id === c.id
              const isPreviewOpen = previewClient?.id === c.id
              const isActive = isInfoOpen || isPreviewOpen
              return (
                <div
                  key={c.id}
                  className={c._blurred ? 'blurred-row' : undefined}
                  style={{
                    background: isActive ? 'var(--green-bg)' : '#fff',
                    border: `1px solid ${isActive ? 'var(--green-border)' : 'var(--border)'}`,
                    borderLeft: `3px solid ${isActive ? 'var(--green)' : 'transparent'}`,
                    borderRadius: 10,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    cursor: c._blurred ? 'default' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onClick={() => { if (!c._blurred) openPreviewPanel(c) }}
                  onMouseEnter={e => { if (!isActive && !c._blurred) e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={e => { if (!isActive && !c._blurred) e.currentTarget.style.background = '#fff' }}
                >
                  {/* Avatar */}
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: isActive ? 'var(--green)' : 'var(--bg-tertiary)', color: isActive ? '#FDFAF5' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                    {getInitials(c.name)}
                  </div>

                  {/* Name + event */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{c.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[c.event_type, formatEventDate(c.event_date)].filter(Boolean).join(' · ') || c.email || 'No event details'}
                    </p>
                  </div>

                  <StageBadge stage={c.stage || 'inquiry'} />

                  {/* Shot list status indicator */}
                  {c.shot_list_status === 'submitted' && (
                    <span
                      title="Shot list pending review"
                      style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, cursor: 'default' }}
                    >📋</span>
                  )}
                  {c.shot_list_status === 'confirmed' && (
                    <span
                      title="Shot list confirmed"
                      style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, cursor: 'default' }}
                    >✅</span>
                  )}

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
                    {/* Edit — secondary action; the row itself now opens the
                        portal preview (with Copy Link/Send to Client
                        immediately visible), so editing is an explicit,
                        lower-emphasis action here instead of the default. */}
                    <button
                      onClick={() => openInfoPanel(c)}
                      title="Edit client"
                      aria-label="Edit client"
                      style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
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
                        title="Delete client"
                        aria-label="Delete client"
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
          {editingClient?.id ? (
            <>
              <div>
                <label className="field-label">Event type</label>
                <input className="input" type="text" placeholder="Wedding, Portrait, Engagement…" {...field('event_type')} />
              </div>
              <div>
                <label className="field-label">Event date</label>
                <input className="input" type="date" {...field('event_date')} />
              </div>
            </>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setShowEvents(!showEvents)}
                style={{ fontSize: 13, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 0' }}
              >
                {showEvents ? '− Hide event details' : '+ Add event dates'}
              </button>
              {showEvents && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  <div>
                    <label className="field-label">Event type</label>
                    <select className="input" value={form.event_type ?? ''} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                      <option value="">Select type…</option>
                      <option value="Wedding">Wedding</option>
                      <option value="Engagement">Engagement</option>
                      <option value="Portrait">Portrait</option>
                      <option value="Elopement">Elopement</option>
                      <option value="Anniversary">Anniversary</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Event date</label>
                    <input className="input" type="date" {...field('event_date')} />
                  </div>
                </div>
              )}
            </div>
          )}
          {editingClient?.id && (
            <div>
              <label className="field-label">Pipeline stage</label>
              <select
                className="input"
                value={editingClient.stage || 'inquiry'}
                onChange={e => {
                  const stage = e.target.value
                  updateStage(editingClient.id, stage)
                  setEditingClient(prev => prev ? { ...prev, stage } : prev)
                  setInfoClient(prev => (prev && 'id' in prev) ? { ...prev, stage } : prev)
                }}
              >
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="field-label">Notes</label>
            <textarea className="input" placeholder="Any details about this client or event…" rows={4}
              value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ resize: 'vertical', minHeight: 80 }}
            />
          </div>
          {editingClient?.id && (
            <div>
              <label className="field-label">Gallery URL <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 11 }}>(external link)</span></label>
              <input className="input" type="url" placeholder="https://gallery.example.com/..." value={form.gallery_url ?? ''} onChange={e => setForm(f => ({ ...f, gallery_url: e.target.value }))} />
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
            {editingClient?.id ? (
              <>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Secondary Contact</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label className="field-label">Name</label>
                    <input className="input" type="text" placeholder="Partner or secondary contact" value={form.secondary_name ?? ''} onChange={e => setForm(f => ({ ...f, secondary_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label">Email</label>
                    <input className="input" type="email" placeholder="partner@example.com" value={form.secondary_email ?? ''} onChange={e => setForm(f => ({ ...f, secondary_email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label">Phone</label>
                    <input className="input" type="tel" placeholder="+1 (555) 000-0001" value={form.secondary_phone ?? ''} onChange={e => setForm(f => ({ ...f, secondary_phone: e.target.value }))} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowSecondary(!showSecondary)}
                  style={{ fontSize: 13, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '4px 0' }}
                >
                  {showSecondary ? '− Hide' : '+ Add second contact'} <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(partner, spouse)</span>
                </button>
                {showSecondary && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    <div>
                      <label className="field-label">Name</label>
                      <input className="input" type="text" placeholder="Partner or secondary contact" value={form.secondary_name ?? ''} onChange={e => setForm(f => ({ ...f, secondary_name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Email</label>
                      <input className="input" type="email" placeholder="partner@example.com" value={form.secondary_email ?? ''} onChange={e => setForm(f => ({ ...f, secondary_email: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Phone</label>
                      <input className="input" type="tel" placeholder="+1 (555) 000-0001" value={form.secondary_phone ?? ''} onChange={e => setForm(f => ({ ...f, secondary_phone: e.target.value }))} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {editingClient?.id && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label className="field-label" style={{ margin: 0 }}>Events</label>
                <button
                  type="button"
                  onClick={() => { setShowAddEvent(true); setEventForm(BLANK_EVENT) }}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                >+ Add</button>
              </div>
              {clientEvents.length === 0 && !showAddEvent && (
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>No extra events yet.</p>
              )}
              {clientEvents.map(ev => (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{ev.event_name}</p>
                    {ev.event_date && <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>{formatEventDate(ev.event_date)}{ev.event_type ? ` · ${ev.event_type}` : ''}</p>}
                  </div>
                  {deleteEventConfirmId === ev.id ? (
                    <>
                      <button type="button" onClick={() => handleDeleteEvent(ev.id)} style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Confirm</button>
                      <button type="button" onClick={() => setDeleteEventConfirmId(null)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setDeleteEventConfirmId(ev.id)} style={{ color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  )}
                </div>
              ))}
              {showAddEvent && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <input className="input" placeholder="Event name *" value={eventForm.event_name} onChange={e => setEventForm(f => ({ ...f, event_name: e.target.value }))} style={{ fontSize: 13 }} autoFocus />
                  <input className="input" type="date" value={eventForm.event_date} onChange={e => setEventForm(f => ({ ...f, event_date: e.target.value }))} style={{ fontSize: 13 }} />
                  <input className="input" placeholder="Event type (optional)" value={eventForm.event_type} onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))} style={{ fontSize: 13 }} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => setShowAddEvent(false)} className="btn btn-ghost btn-sm" style={{ flex: 1 }}>Cancel</button>
                    <button type="button" onClick={handleAddEvent} disabled={savingEvent || !eventForm.event_name.trim()} className="btn btn-primary btn-sm" style={{ flex: 2 }}>
                      {savingEvent ? 'Saving…' : 'Add Event'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {editingClient?.id && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Shot List</p>
                {shotList?.status === 'submitted' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#FEF3C7', color: '#D97706', border: '1px solid #FCD34D60' }}>
                    ● Submitted
                  </span>
                )}
                {shotList?.status === 'confirmed' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green-border)' }}>
                    ✓ Confirmed
                  </span>
                )}
              </div>

              {shotListLoading ? (
                <div className="skeleton" style={{ height: 60, borderRadius: 8 }} />
              ) : !shotList || shotList.status === 'pending' && !shotList.shots?.length ? (
                <div style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.4 }}>
                    No shots added yet. Share the portal link so your client can request specific shots.
                  </p>
                  <button
                    type="button"
                    onClick={() => copyLink(editingClient)}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Copy portal link →
                  </button>
                </div>
              ) : shotList.status === 'submitted' ? (
                <>
                  <div style={{ padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FCD34D50', borderRadius: 8, marginBottom: 10 }}>
                    <p style={{ fontSize: 12, color: '#92400E', margin: 0, fontWeight: 600 }}>● Shot list submitted — review below</p>
                    {shotList.client_notes && (
                      <p style={{ fontSize: 12, color: '#92400E', margin: '4px 0 0', opacity: 0.8, lineHeight: 1.4 }}>"{shotList.client_notes}"</p>
                    )}
                  </div>
                  {SHOT_CATEGORIES.map(cat => {
                    const catShots = (shotList.shots || []).filter(s => s.category === cat.key)
                    if (!catShots.length) return null
                    return (
                      <div key={cat.key} style={{ marginBottom: 10 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{cat.label}</p>
                        {catShots.map(shot => (
                          <div key={shot.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>{shot.description}</span>
                            <PriorityBadge priority={shot.priority} />
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={async () => {
                      setConfirmingShots(true)
                      try {
                        const res = await authFetch(`/api/clients/${editingClient.id}/shot-list/confirm`, { method: 'post' })
                        setShotList(res.data)
                        setClients(prev => prev.map(c => c.id === editingClient.id ? { ...c, shot_list_status: 'confirmed' } : c))
                        showToast('Shot list confirmed!')
                      } catch {
                        showToast('Failed to confirm shot list.')
                      } finally {
                        setConfirmingShots(false)
                      }
                    }}
                    disabled={confirmingShots}
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    {confirmingShots ? 'Confirming…' : 'Confirm Shot List ✓'}
                  </button>
                </>
              ) : (
                <>
                  {SHOT_CATEGORIES.map(cat => {
                    const catShots = (shotList.shots || []).filter(s => s.category === cat.key)
                    if (!catShots.length) return null
                    return (
                      <div key={cat.key} style={{ marginBottom: 10 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{cat.label}</p>
                        {catShots.map(shot => (
                          <div key={shot.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>{shot.description}</span>
                            <PriorityBadge priority={shot.priority} />
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  <div style={{ marginTop: 8, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add your own shots</p>
                    <input
                      className="input"
                      placeholder="Shot description"
                      value={newShotDesc}
                      onChange={e => setNewShotDesc(e.target.value)}
                      style={{ marginBottom: 6, fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <select className="input" value={newShotCat} onChange={e => setNewShotCat(e.target.value)} style={{ fontSize: 12, flex: 1, padding: '6px 8px' }}>
                        {SHOT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                      <select className="input" value={newShotPrio} onChange={e => setNewShotPrio(e.target.value as ShotItem['priority'])} style={{ fontSize: 12, flex: 1, padding: '6px 8px' }}>
                        <option value="must_have">Must have</option>
                        <option value="if_possible">If possible</option>
                        <option value="skip">Skip</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!newShotDesc.trim()) return
                        setSavingShot(true)
                        try {
                          const newShot: ShotItem = { id: Date.now().toString(), category: newShotCat, description: newShotDesc.trim(), priority: newShotPrio }
                          const updatedShots = [...(shotList.shots || []), newShot]
                          const res = await authFetch(`/api/clients/${editingClient.id}/shot-list`, { method: 'put', data: { shots: updatedShots, photographer_notes: shotList.photographer_notes } })
                          setShotList(res.data)
                          setNewShotDesc('')
                        } catch {
                          showToast('Failed to add shot.')
                        } finally {
                          setSavingShot(false)
                        }
                      }}
                      disabled={savingShot || !newShotDesc.trim()}
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                    >
                      {savingShot ? 'Adding…' : '+ Add Shot'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

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

      {/* Send to client modal */}
      {sendModal && (() => {
        const portalUrl = `${window.location.origin}/portal/${sendModal.portal_token}`
        const businessName = user?.business_name || user?.full_name || 'Your photographer'
        const fullMessage = `Hi ${sendModal.name},\n\nYour client portal is ready. You can view your contract, invoice, and any files I've shared with you here:\n\n${portalUrl}\n\nLet me know if you have any questions!\n\n${businessName}`
        return (
          <>
            <div onClick={() => setSendModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 299, backdropFilter: 'blur(2px)' }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 300, width: 'min(480px, 90vw)',
              background: 'var(--bg-elevated)', borderRadius: 14,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              padding: 28,
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>Send to {sendModal.name}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Copy the link or the ready-to-send message below.
              </p>

              {/* Portal link row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="input"
                  readOnly
                  value={portalUrl}
                  style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)' }}
                  onFocus={e => e.target.select()}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(portalUrl)
                    setSendLinkCopied(true)
                    setTimeout(() => setSendLinkCopied(false), 2000)
                  }}
                  style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, padding: '0 14px', borderRadius: 8, border: `1px solid ${sendLinkCopied ? 'var(--color-green-border)' : 'var(--border)'}`, background: sendLinkCopied ? 'var(--color-green-bg)' : 'transparent', cursor: 'pointer', color: sendLinkCopied ? 'var(--color-green)' : 'var(--text-dim)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
                >
                  {sendLinkCopied ? '✓ Copied!' : 'Copy Link'}
                </button>
              </div>

              {/* Pre-written message */}
              <textarea
                readOnly
                value={fullMessage}
                onClick={e => (e.target as HTMLTextAreaElement).select()}
                rows={7}
                style={{ width: '100%', fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'text', marginBottom: 8 }}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(fullMessage)
                    setSendMsgCopied(true)
                    setTimeout(() => setSendMsgCopied(false), 2000)
                  }}
                  style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 8, border: `1px solid ${sendMsgCopied ? 'var(--color-green-border)' : 'var(--border)'}`, background: sendMsgCopied ? 'var(--color-green-bg)' : 'transparent', cursor: 'pointer', color: sendMsgCopied ? 'var(--color-green)' : 'var(--text-primary)', transition: 'all 0.15s' }}
                >
                  {sendMsgCopied ? '✓ Copied!' : 'Copy Message'}
                </button>
                <button onClick={() => setSendModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>Done</button>
              </div>
            </div>
          </>
        )
      })()}

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
