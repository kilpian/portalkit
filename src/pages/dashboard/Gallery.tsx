import { useEffect, useRef, useState } from 'react'
import { useApi, type Client, type Gallery as GalleryType, type GalleryFile } from '../../lib/api'

type View = 'list' | 'gallery'

type GalleryDetail = GalleryType & { files: GalleryFile[] }

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string; label: string }> = {
  hidden:    { bg: 'var(--bg-secondary)', color: 'var(--text-dim)', border: 'var(--border)', label: 'Hidden' },
  preview:   { bg: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: 'rgba(201,168,76,0.3)', label: 'Preview' },
  delivered: { bg: 'var(--color-green-bg)', color: 'var(--color-green)', border: 'var(--color-green-border)', label: 'Delivered ✓' },
}

function Badge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? STATUS_COLORS.hidden
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

export default function GalleryPage() {
  const { authFetch } = useApi()
  const [view, setView] = useState<View>('list')
  const [galleries, setGalleries] = useState<GalleryType[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGallery, setActiveGallery] = useState<GalleryDetail | null>(null)
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [clients, setClients] = useState<Client[]>([])

  // New gallery form
  const [newForm, setNewForm] = useState({ client_id: '', name: '', description: '', allow_downloads: true, allow_favorites: true, password_protected: false, password: '' })
  const [creating, setCreating] = useState(false)

  // Gallery settings form
  const [settingsForm, setSettingsForm] = useState({ name: '', description: '', status: 'hidden', allow_downloads: true, allow_favorites: true, password_protected: false, password: '' })
  const [settingsSaving, setSettingsSaving] = useState(false)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadDone, setUploadDone] = useState(0)
  const [uploadQueue, setUploadQueue] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const [listMode, setListMode] = useState<'grid' | 'list'>('grid')

  // Delete confirm
  const [deleteGalleryId, setDeleteGalleryId] = useState<number | null>(null)
  const [deleteFileId, setDeleteFileId] = useState<number | null>(null)
  const [delivering, setDelivering] = useState(false)
  const [deliverModal, setDeliverModal] = useState(false)
  const [pwCopied, setPwCopied] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  useEffect(() => {
    authFetch('/api/galleries', { method: 'get' })
      .then(r => setGalleries(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
    authFetch('/api/clients', { method: 'get' })
      .then(r => setClients(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Includes videos too — this used to filter to images only, which made
  // uploaded videos vanish from the admin gallery view entirely even though
  // they were correctly stored and tagged with this gallery's id.
  const imageFiles = activeGallery?.files ?? []
  const isVideoFile = (mime: string | null | undefined) => !!mime?.startsWith('video/')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lightboxIndex === null) return
      if (e.key === 'ArrowRight' && lightboxIndex < imageFiles.length - 1) setLightboxIndex(lightboxIndex + 1)
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1)
      if (e.key === 'Escape') setLightboxIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, imageFiles.length])

  const openGallery = async (g: GalleryType) => {
    setGalleryLoading(true)
    try {
      const r = await authFetch(`/api/galleries/${g.id}`, { method: 'get' })
      setActiveGallery(r.data)
      setSettingsForm({
        name: r.data.name,
        description: r.data.description ?? '',
        status: r.data.status,
        allow_downloads: r.data.allow_downloads,
        allow_favorites: r.data.allow_favorites,
        password_protected: r.data.password_protected,
        password: r.data.password ?? '',
      })
      setView('gallery')
    } catch { showToast('Failed to load gallery.') }
    finally { setGalleryLoading(false) }
  }

  const createGallery = async () => {
    if (!newForm.client_id) { showToast('Please select a client.'); return }
    setCreating(true)
    try {
      const client = clients.find(c => c.id === parseInt(newForm.client_id))
      const r = await authFetch('/api/galleries', {
        method: 'post',
        data: {
          client_id: parseInt(newForm.client_id),
          name: newForm.name || `${client?.name ?? 'Client'} Gallery`,
          description: newForm.description || undefined,
          allow_downloads: newForm.allow_downloads,
          allow_favorites: newForm.allow_favorites,
          password_protected: newForm.password_protected,
          password: newForm.password_protected ? newForm.password : undefined,
        },
      })
      setGalleries(prev => [{ ...r.data, file_count: 0, client_name: client?.name ?? '', portal_token: client?.portal_token ?? '' } as GalleryType, ...prev])
      setShowNew(false)
      setNewForm({ client_id: '', name: '', description: '', allow_downloads: true, allow_favorites: true, password_protected: false, password: '' })
      showToast('Gallery created!')
      await openGallery(r.data)
    } catch { showToast('Failed to create gallery.') }
    finally { setCreating(false) }
  }

  const saveSettings = async () => {
    if (!activeGallery) return
    setSettingsSaving(true)
    try {
      const r = await authFetch(`/api/galleries/${activeGallery.id}`, {
        method: 'put',
        data: {
          name: settingsForm.name,
          description: settingsForm.description || null,
          status: settingsForm.status,
          allow_downloads: settingsForm.allow_downloads,
          allow_favorites: settingsForm.allow_favorites,
          password_protected: settingsForm.password_protected,
          password: settingsForm.password_protected && settingsForm.password ? settingsForm.password : undefined,
        },
      })
      setActiveGallery(prev => prev ? { ...prev, ...r.data } : prev)
      setGalleries(prev => prev.map(g => g.id === activeGallery.id ? { ...g, ...r.data } : g))
      setShowSettings(false)
      showToast('Settings saved.')
    } catch { showToast('Failed to save settings.') }
    finally { setSettingsSaving(false) }
  }

  const handleDeliver = async (forceEmail = false) => {
    if (!activeGallery) return
    setDelivering(true)
    try {
      const r = await authFetch(`/api/galleries/${activeGallery.id}`, {
        method: 'put',
        data: { status: 'delivered', ...(forceEmail ? { force_email: true } : {}) },
      })
      setActiveGallery(prev => prev ? { ...prev, ...r.data } : prev)
      setGalleries(prev => prev.map(g => g.id === activeGallery.id ? { ...g, ...r.data } : g))
      showToast(forceEmail ? 'Delivery email resent!' : 'Gallery delivered! Email sent to client.')
    } catch { showToast('Failed to deliver gallery.') }
    finally { setDelivering(false) }
  }

  const uploadFiles = async (fileList: FileList | File[]) => {
    if (!activeGallery || uploading) return
    const files = Array.from(fileList)
    if (files.length === 0) return
    setUploading(true)
    setUploadQueue(files.length)
    setUploadDone(0)
    let succeeded = 0
    for (let i = 0; i < files.length; i++) {
      setUploadProgress(0)
      try {
        const fd = new FormData()
        fd.append('file', files[i])
        fd.append('gallery_id', String(activeGallery.id))
        const r = await authFetch('/api/files/upload', {
          method: 'post',
          data: fd,
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e: { loaded: number; total?: number }) => {
            if (e.total) setUploadProgress(Math.round(e.loaded / e.total * 100))
          },
        })
        const newFile: GalleryFile = {
          id: r.data.id,
          original_name: r.data.original_name,
          mime_type: r.data.mime_type,
          storage_url: r.data.storage_url,
          size_bytes: r.data.size_bytes,
          gallery_id: activeGallery.id,
          caption: null,
          display_order: 0,
          is_favorite: false,
          created_at: r.data.created_at,
        }
        setActiveGallery(prev => prev ? { ...prev, files: [...prev.files, newFile], file_count: prev.file_count + 1 } : prev)
        setGalleries(prev => prev.map(g => g.id === activeGallery.id ? { ...g, file_count: g.file_count + 1 } : g))
        succeeded++
      } catch {
        showToast(`Failed to upload ${files[i].name}`)
      }
      setUploadDone(i + 1)
    }
    setUploading(false)
    setUploadProgress(0)
    if (succeeded > 0) showToast(succeeded === 1 ? '1 photo uploaded!' : `${succeeded} photos uploaded!`)
  }

  const deleteFile = async (fileId: number) => {
    try {
      await authFetch(`/api/files/${fileId}`, { method: 'delete' })
      setActiveGallery(prev => prev ? { ...prev, files: prev.files.filter(f => f.id !== fileId), file_count: prev.file_count - 1 } : prev)
      setGalleries(prev => prev.map(g => g.id === activeGallery?.id ? { ...g, file_count: Math.max(0, g.file_count - 1) } : g))
      setDeleteFileId(null)
      if (lightboxIndex !== null) setLightboxIndex(null)
      showToast('Photo deleted.')
    } catch { showToast('Failed to delete.') }
  }

  const handleSetCover = async (fileId: number) => {
    if (!activeGallery) return
    try {
      await authFetch(`/api/galleries/${activeGallery.id}`, { method: 'put', data: { cover_file_id: fileId } })
      setActiveGallery(prev => prev ? { ...prev, cover_file_id: fileId } : prev)
      setGalleries(prev => prev.map(g => g.id === activeGallery.id ? { ...g, cover_file_id: fileId } : g))
      showToast('Cover photo updated.')
    } catch { showToast('Failed to update cover.') }
  }

  const deleteGallery = async (id: number) => {
    try {
      await authFetch(`/api/galleries/${id}`, { method: 'delete' })
      setGalleries(prev => prev.filter(g => g.id !== id))
      setDeleteGalleryId(null)
      if (activeGallery?.id === id) { setActiveGallery(null); setView('list') }
      showToast('Gallery deleted.')
    } catch { showToast('Failed to delete gallery.') }
  }

  // ── LIST VIEW ─────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 32px) 64px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px,3vw,26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Gallery</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Deliver photos to clients without leaving PortalKit.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
              <button onClick={() => setListMode('grid')} style={{ padding: '6px 11px', border: 'none', cursor: 'pointer', background: listMode === 'grid' ? 'var(--green)' : 'transparent', color: listMode === 'grid' ? '#fff' : 'var(--text-dim)', fontSize: 14, lineHeight: 1 }} title="Grid view">⊞</button>
              <button onClick={() => setListMode('list')} style={{ padding: '6px 11px', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', background: listMode === 'list' ? 'var(--green)' : 'transparent', color: listMode === 'list' ? '#fff' : 'var(--text-dim)', fontSize: 14, lineHeight: 1 }} title="List view">☰</button>
            </div>
            <button onClick={() => setShowNew(true)} className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>+ New Gallery</button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
            {[0,1,2].map(i => <div key={i} className="skeleton" style={{ height: 220, borderRadius: 12 }} />)}
          </div>
        ) : galleries.length === 0 ? (
          <div className="card" style={{ padding: '60px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No galleries yet</p>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20 }}>Create your first gallery to start delivering photos to clients.</p>
            <button onClick={() => setShowNew(true)} className="btn btn-primary">Create Gallery →</button>
          </div>
        ) : listMode === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
            {galleries.map(g => (
              <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onClick={() => deleteGalleryId !== g.id && openGallery(g)}>
                <div style={{ height: 150, background: 'var(--bg-secondary)', position: 'relative', overflow: 'hidden' }}>
                  {(g.cover_url || g.preview_url)
                    ? <img src={g.cover_url || g.preview_url!} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🖼️</div>
                  }
                  <div style={{ position: 'absolute', top: 10, right: 10 }}><Badge status={g.status} /></div>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{g.client_name}{g.event_date ? ` · ${formatDate(g.event_date)}` : ''}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{g.file_count} photo{g.file_count !== 1 ? 's' : ''}</span>
                    {deleteGalleryId === g.id ? (
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        <span style={{ fontSize: 11, color: '#A32D2D' }}>Delete?</span>
                        <button onClick={() => deleteGallery(g.id)} style={{ fontSize: 11, background: '#A32D2D', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Yes</button>
                        <button onClick={() => setDeleteGalleryId(null)} style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', color: 'var(--text-dim)' }}>No</button>
                      </div>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); setDeleteGalleryId(g.id) }} style={{ fontSize: 11, color: '#A32D2D', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {galleries.map((g, i) => (
              <div key={g.id} onClick={() => deleteGalleryId !== g.id && openGallery(g)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer', borderBottom: i < galleries.length - 1 ? '1px solid var(--border-subtle)' : 'none', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ width: 52, height: 52, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-secondary)', flexShrink: 0 }}>
                  {(g.cover_url || g.preview_url)
                    ? <img src={g.cover_url || g.preview_url!} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🖼️</div>
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{g.name}</p>
                    <Badge status={g.status} />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{g.client_name}{g.event_date ? ` · ${formatDate(g.event_date)}` : ''} · {g.file_count} photo{g.file_count !== 1 ? 's' : ''}</p>
                </div>
                {deleteGalleryId === g.id ? (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: '#A32D2D' }}>Delete?</span>
                    <button onClick={() => deleteGallery(g.id)} style={{ fontSize: 11, background: '#A32D2D', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Yes</button>
                    <button onClick={() => setDeleteGalleryId(null)} style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', color: 'var(--text-dim)' }}>No</button>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setDeleteGalleryId(g.id) }} style={{ fontSize: 11, color: '#A32D2D', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', flexShrink: 0 }}>Delete</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* New Gallery Drawer */}
        {showNew && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex' }} onClick={() => setShowNew(false)}>
            <div style={{ flex: 1 }} />
            <div onClick={e => e.stopPropagation()} style={{ width: 'min(380px, 100vw)', background: 'white', height: '100vh', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--green)', margin: 0 }}>New Gallery</h2>
                <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-dim)' }}>✕</button>
              </div>
              <div>
                <label className="field-label">Client <span style={{ color: 'var(--color-red)' }}>*</span></label>
                <select className="input" value={newForm.client_id} onChange={e => {
                  const c = clients.find(cl => cl.id === parseInt(e.target.value))
                  setNewForm(f => ({ ...f, client_id: e.target.value, name: c ? `${c.name} Gallery` : f.name }))
                }}>
                  <option value="">Select client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Gallery name</label>
                <input className="input" type="text" placeholder="Wedding Gallery" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="field-label">Description <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
                <textarea className="input" rows={3} style={{ resize: 'vertical' }} value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { key: 'allow_downloads', label: 'Allow downloads' },
                  { key: 'allow_favorites', label: 'Allow favorites' },
                  { key: 'password_protected', label: 'Password protect' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={newForm[key as keyof typeof newForm] as boolean}
                      onChange={e => setNewForm(f => ({ ...f, [key]: e.target.checked }))}
                      style={{ accentColor: 'var(--green)' }}
                    />
                    {label}
                  </label>
                ))}
                {newForm.password_protected && (
                  <input className="input" type="password" placeholder="Gallery password" value={newForm.password} onChange={e => setNewForm(f => ({ ...f, password: e.target.value }))} />
                )}
              </div>
              <button onClick={createGallery} disabled={creating} className="btn btn-primary" style={{ marginTop: 8 }}>
                {creating ? 'Creating…' : 'Create Gallery →'}
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 10000, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>{toast}</div>
        )}
      </div>
    )
  }

  // ── GALLERY VIEW ──────────────────────────────────────────────
  if (!activeGallery) return null
  const photos = activeGallery.files

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 28px) clamp(16px, 4vw, 32px) 64px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <button onClick={() => { setView('list'); setLightboxIndex(null) }} style={{ fontSize: 13, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
            ← Galleries
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', margin: 0 }}>{activeGallery.name}</h1>
            <Badge status={activeGallery.status} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{activeGallery.client_name} · {activeGallery.file_count} photo{activeGallery.file_count !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeGallery.status !== 'delivered' ? (
            <button onClick={() => setDeliverModal(true)} disabled={delivering} className="btn btn-primary" style={{ background: '#1B4332' }}>
              {delivering ? 'Delivering…' : '📤 Deliver Gallery'}
            </button>
          ) : (
            <button
              onClick={() => setDeliverModal(true)}
              style={{ fontSize: 13, color: '#1B4332', background: 'none', border: '1px solid #1B4332', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Resend Email
            </button>
          )}
          <button onClick={() => setShowSettings(true)} className="btn btn-ghost btn-sm">Settings</button>
        </div>
      </div>

      {/* Upload zone */}
      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
        style={{ background: dragOver ? '#F0FDF4' : 'var(--bg-secondary)', border: `2px dashed ${dragOver ? '#86EFAC' : 'var(--border)'}`, borderRadius: 10, padding: '20px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer', marginBottom: 20, transition: 'all 0.15s' }}
      >
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,application/pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }} />
        {uploading ? (
          <div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, maxWidth: 300, margin: '0 auto 8px' }}>
              <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--green)', borderRadius: 99, transition: 'width 0.2s' }} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Uploading {uploadDone + 1} of {uploadQueue}…</p>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>📁 {galleryLoading ? 'Loading…' : 'Click or drag photos here to upload'}</p>
        )}
      </div>

      {/* Photo grid — CSS masonry via columns */}
      {photos.length === 0 ? (
        <div className="card" style={{ padding: '40px 32px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>No photos yet. Drag and drop or click above to upload.</p>
        </div>
      ) : (
        <div className="gallery-cols" style={{ columnCount: 4, columnGap: 8, marginBottom: 24 }}>
          {photos.map((f, idx) => (
            <div
              key={f.id}
              style={{ breakInside: 'avoid', marginBottom: 8, position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}
              className="gallery-thumb"
              onClick={() => deleteFileId !== f.id && setLightboxIndex(idx)}
            >
              {isVideoFile(f.mime_type) ? (
                <div style={{ width: '100%', background: '#000', borderRadius: 8, position: 'relative', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <video src={f.storage_url} style={{ width: '100%', borderRadius: 8, objectFit: 'cover', maxHeight: 200 }} preload="metadata" muted />
                  <div style={{ position: 'absolute', background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, pointerEvents: 'none' }}>▶</div>
                </div>
              ) : (
                <img src={f.storage_url} alt={f.original_name} style={{ width: '100%', display: 'block', borderRadius: 8 }} loading="lazy" />
              )}
              <div className="gallery-thumb-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', transition: 'background 0.15s', borderRadius: 8 }}>
                {activeGallery && f.id === activeGallery.cover_file_id && (
                  <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(201,168,76,0.9)', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#fff', fontWeight: 700, pointerEvents: 'none', zIndex: 1 }}>★ Cover</div>
                )}
                <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                  {deleteFileId === f.id ? (
                    <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 6, padding: '3px 6px' }} onClick={e => e.stopPropagation()}>
                      <span style={{ fontSize: 10, color: '#fca5a5' }}>Delete?</span>
                      <button onClick={() => deleteFile(f.id)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.9)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Yes</button>
                      <button onClick={() => setDeleteFileId(null)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer' }}>No</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={e => { e.stopPropagation(); handleSetCover(f.id) }} title="Set as cover" className="gallery-action-btn" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: activeGallery && f.id === activeGallery.cover_file_id ? 'rgba(201,168,76,0.9)' : 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>★</button>
                      <button onClick={e => { e.stopPropagation(); setDeleteFileId(f.id) }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'rgba(220,38,38,0.8)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }} className="gallery-action-btn">✕</button>
                    </>
                  )}
                </div>
                {f.caption && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
                    <p style={{ fontSize: 11, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.caption}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setLightboxIndex(null)}>
          {lightboxIndex > 0 && (
            <button onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1) }} style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 24, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          )}
          {lightboxIndex < photos.length - 1 && (
            <button onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1) }} style={{ position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 24, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          )}
          <button onClick={() => setLightboxIndex(null)} style={{ position: 'fixed', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 20, width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          {isVideoFile(photos[lightboxIndex].mime_type) ? (
            <video onClick={e => e.stopPropagation()} src={photos[lightboxIndex].storage_url} controls autoPlay style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 8, display: 'block' }} />
          ) : (
            <img onClick={e => e.stopPropagation()} src={photos[lightboxIndex].storage_url} alt={photos[lightboxIndex].original_name} style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 8, objectFit: 'contain', display: 'block' }} />
          )}
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
            <span>{photos[lightboxIndex].original_name}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{lightboxIndex + 1} / {photos.length}</span>
            <a href={photos[lightboxIndex].storage_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.15)', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Download</a>
          </div>
        </div>
      )}

      {/* Settings Drawer */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex' }} onClick={() => setShowSettings(false)}>
          <div style={{ flex: 1 }} />
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(380px, 100vw)', background: 'white', height: '100vh', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--green)', margin: 0 }}>Gallery Settings</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-dim)' }}>✕</button>
            </div>
            <div>
              <label className="field-label">Gallery name</label>
              <input className="input" value={settingsForm.name} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Description</label>
              <textarea className="input" rows={3} style={{ resize: 'vertical' }} value={settingsForm.description} onChange={e => setSettingsForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Status</label>
              <select className="input" value={settingsForm.status} onChange={e => setSettingsForm(f => ({ ...f, status: e.target.value }))}>
                <option value="hidden">Hidden — not visible to client</option>
                <option value="preview">Preview — client can view but not download</option>
                <option value="delivered">Delivered — fully accessible</option>
              </select>
            </div>
            {[
              { key: 'allow_downloads', label: 'Allow downloads' },
              { key: 'allow_favorites', label: 'Allow favorites' },
              { key: 'password_protected', label: 'Password protect' },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={settingsForm[key as keyof typeof settingsForm] as boolean}
                  onChange={e => setSettingsForm(f => ({ ...f, [key]: e.target.checked }))}
                  style={{ accentColor: 'var(--green)' }}
                />
                {label}
              </label>
            ))}
            {settingsForm.password_protected && (
              <div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder={activeGallery?.password_protected ? 'Leave blank to keep current password' : 'Gallery password'}
                    value={settingsForm.password}
                    onChange={e => setSettingsForm(f => ({ ...f, password: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!settingsForm.password) return
                      navigator.clipboard.writeText(settingsForm.password)
                      setPwCopied(true)
                      setTimeout(() => setPwCopied(false), 2000)
                    }}
                    disabled={!settingsForm.password}
                    style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, padding: '0 12px', borderRadius: 6, border: `1px solid ${pwCopied ? 'var(--color-green-border)' : 'var(--border)'}`, background: pwCopied ? 'var(--color-green-bg)' : 'transparent', color: pwCopied ? 'var(--color-green)' : 'var(--text-dim)', cursor: 'pointer' }}
                  >
                    {pwCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                  {activeGallery?.password_protected
                    ? "For security, we don't display the current password here — enter a new one only if you want to change it. Copy it before saving to share with your client."
                    : 'Share this password with your client via message.'}
                </p>
              </div>
            )}
            <button onClick={saveSettings} disabled={settingsSaving} className="btn btn-primary" style={{ marginTop: 8 }}>
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginTop: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', marginBottom: 10 }}>Danger Zone</p>
              {deleteGalleryId === activeGallery.id ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => deleteGallery(activeGallery.id)} style={{ flex: 1, fontSize: 13, background: '#A32D2D', color: '#fff', border: 'none', padding: '9px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Yes, delete</button>
                  <button onClick={() => setDeleteGalleryId(null)} style={{ flex: 1, fontSize: 13, background: 'none', border: '1px solid var(--border)', padding: '9px', borderRadius: 8, cursor: 'pointer', color: 'var(--text-dim)' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setDeleteGalleryId(activeGallery.id)} style={{ fontSize: 13, color: '#DC2626', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, width: '100%' }}>
                  Delete Gallery &amp; All Photos
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 10000, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>{toast}</div>
      )}

      {/* Deliver / Resend modal */}
      {deliverModal && activeGallery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 28, maxWidth: 400, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📸</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1B4332', marginBottom: 8 }}>
              {activeGallery.status === 'delivered' ? 'Resend Delivery Email' : 'Deliver Gallery'}
            </h3>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 8, lineHeight: 1.6 }}>
              {activeGallery.status === 'delivered' ? 'Resend the delivery email to:' : 'This will send a delivery email to:'}
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              {activeGallery.client_name}{activeGallery.client_email ? ` (${activeGallery.client_email})` : ''}
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
              {activeGallery.file_count} photo{activeGallery.file_count !== 1 ? 's' : ''} will be available for download.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setDeliverModal(false)}
                style={{ flex: 1, padding: '11px', background: 'none', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#374151' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeliverModal(false)
                  await handleDeliver(activeGallery.status === 'delivered')
                }}
                disabled={delivering}
                style={{ flex: 1, padding: '11px', background: '#1B4332', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                {activeGallery.status === 'delivered' ? 'Resend Email →' : 'Send Delivery Email →'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .gallery-thumb:hover .gallery-thumb-overlay { background: rgba(0,0,0,0.3) !important; }
        .gallery-action-btn { opacity: 0; }
        .gallery-thumb:hover .gallery-action-btn { opacity: 1; }
        @media (max-width: 900px) { .gallery-cols { column-count: 3 !important; } }
        @media (max-width: 600px) { .gallery-cols { column-count: 2 !important; } }
      `}</style>
    </div>
  )
}
