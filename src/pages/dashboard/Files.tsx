import { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import { useApi, type Client, type UploadedFile } from '../../lib/api'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(d: string) {
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function getCategory(mime: string | null): 'Photos' | 'Videos' | 'Documents' | 'Other' {
  if (!mime) return 'Other'
  if (mime.startsWith('image/')) return 'Photos'
  if (mime.startsWith('video/')) return 'Videos'
  if (mime === 'application/pdf' || mime.includes('document')) return 'Documents'
  return 'Other'
}

function fileIcon(mime: string | null, name: string): string {
  const cat = getCategory(mime)
  if (cat === 'Photos') return '🖼'
  if (cat === 'Videos') return '🎬'
  if (cat === 'Documents') return '📄'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜'
  return '📎'
}

type SidebarKey = 'all' | 'unassigned' | number

export default function Files() {
  const { authFetch } = useApi()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadClientId, setUploadClientId] = useState<string>('')
  const [dragOver, setDragOver] = useState(false)
  const [sidebarKey, setSidebarKey] = useState<SidebarKey>('all')
  const [category, setCategory] = useState<'All' | 'Photos' | 'Videos' | 'Documents' | 'Other'>('All')
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null)
  const [assigningId, setAssigningId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchFiles = () =>
    authFetch('/api/files', { method: 'get' })
      .then(res => setFiles(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)
      .finally(() => setLoading(false))

  useEffect(() => {
    fetchFiles()
    authFetch('/api/clients', { method: 'get' })
      .then(res => setClients(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  const uploadFile = async (file: File) => {
    if (uploading) return
    setUploading(true)
    setUploadProgress(0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (uploadClientId) fd.append('client_id', uploadClientId.toString())
      const resp = await authFetch('/api/files/upload', {
        method: 'post',
        data: fd,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e: { loaded: number; total?: number }) => {
          if (e.total) setUploadProgress(Math.round(e.loaded / e.total * 100))
        },
      })
      setFiles(prev => [resp.data, ...prev])
      posthog.capture('file_uploaded', { mime_type: file.type, has_client: !!uploadClientId })
      showToast('File uploaded!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      showToast(msg || 'Upload failed')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const confirmDelete = async (id: number) => {
    setDeleting(id)
    try {
      await authFetch(`/api/files/${id}`, { method: 'delete' })
      setFiles(prev => prev.filter(f => f.id !== id))
      if (previewFile?.id === id) setPreviewFile(null)
      setDeleteConfirmId(null)
      showToast('File deleted.')
    } catch {
      showToast('Failed to delete.')
    } finally {
      setDeleting(null)
    }
  }

  const assignFile = async (fileId: number, clientId: string) => {
    if (!clientId) return
    const cid = parseInt(clientId)
    try {
      await authFetch(`/api/files/${fileId}/assign`, { method: 'patch', data: { client_id: cid } })
      const clientName = clients.find(c => c.id === cid)?.name ?? null
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, client_id: cid, client_name: clientName } : f))
      setAssigningId(null)
      showToast('File assigned.')
    } catch {
      showToast('Failed to assign file.')
      setAssigningId(null)
    }
  }

  // Sidebar data
  const clientsWithFiles = clients.filter(c => files.some(f => f.client_id === c.id))
  const unassignedFiles = files.filter(f => !f.client_id)

  const sidebarFiles = sidebarKey === 'all'
    ? files
    : sidebarKey === 'unassigned'
      ? unassignedFiles
      : files.filter(f => f.client_id === sidebarKey)

  const visibleFiles = category === 'All'
    ? sidebarFiles
    : sidebarFiles.filter(f => getCategory(f.mime_type) === category)

  const catCounts = (['All', 'Photos', 'Videos', 'Documents', 'Other'] as const).map(cat => ({
    cat, count: cat === 'All' ? sidebarFiles.length : sidebarFiles.filter(f => getCategory(f.mime_type) === cat).length,
  }))

  const photoFiles = visibleFiles.filter(f => getCategory(f.mime_type) === 'Photos')
  const nonPhotoFiles = visibleFiles.filter(f => getCategory(f.mime_type) !== 'Photos')
  const sidebarLabel = sidebarKey === 'all' ? 'All Files' : sidebarKey === 'unassigned' ? 'Unassigned' : (clients.find(c => c.id === sidebarKey)?.name ?? 'Client')

  const InlineConfirm = ({ id, onConfirm, onCancel }: { id: number; onConfirm: () => void; onCancel: () => void }) => (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#A32D2D', whiteSpace: 'nowrap' }}>Delete?</span>
      <button onClick={onConfirm} disabled={deleting === id} style={{ fontSize: 11, color: 'white', background: '#A32D2D', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Yes</button>
      <button onClick={onCancel} style={{ fontSize: 11, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>No</button>
    </div>
  )

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header + upload */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Files & Galleries</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{files.length} file{files.length !== 1 ? 's' : ''}</p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <select
            value={uploadClientId}
            onChange={e => setUploadClientId(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--text-primary)', cursor: 'pointer', minWidth: 180 }}
          >
            <option value="">— No client —</option>
            {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f) }}
            style={{
              flex: 1, minWidth: 220,
              background: dragOver ? '#F0FDF4' : 'var(--bg-secondary)',
              border: `2px dashed ${dragOver ? '#86EFAC' : 'var(--border)'}`,
              borderRadius: 8, padding: '10px 18px', textAlign: 'center',
              cursor: uploading ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
            {uploading ? (
              <div style={{ width: '100%' }}>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 99 }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--green)', borderRadius: 99, transition: 'width 0.2s' }} />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Uploading {uploadProgress}%…</p>
              </div>
            ) : (
              <>
                <span style={{ fontSize: 16 }}>📁</span>
                <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>{dragOver ? 'Drop to upload' : 'Click or drag a file to upload'}</span>
              </>
            )}
          </div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Images, PDFs, videos, ZIP — up to 50 MB</p>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* Sidebar */}
        <div style={{ width: 200, flexShrink: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {[
            { key: 'all' as SidebarKey, label: 'All Files', count: files.length },
            ...(unassignedFiles.length > 0 ? [{ key: 'unassigned' as SidebarKey, label: 'Unassigned', count: unassignedFiles.length }] : []),
            ...clientsWithFiles.map(c => ({ key: c.id as SidebarKey, label: c.name, count: files.filter(f => f.client_id === c.id).length })),
          ].map(({ key, label, count }) => (
            <button
              key={String(key)}
              onClick={() => { setSidebarKey(key); setCategory('All') }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: sidebarKey === key ? 'var(--bg-secondary)' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                textAlign: 'left', fontWeight: sidebarKey === key ? 700 : 400,
                color: sidebarKey === key ? 'var(--green)' : 'var(--text-primary)', fontSize: 13,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 6 }}>{label}</span>
              <span style={{ fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--text-dim)', padding: '1px 7px', borderRadius: 99, flexShrink: 0 }}>{count}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{sidebarLabel}</p>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {catCounts.filter(c => c.cat === 'All' || c.count > 0).map(({ cat, count }) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 99,
                    border: `1px solid ${category === cat ? 'var(--green)' : 'var(--border)'}`,
                    background: category === cat ? 'var(--green)' : 'transparent',
                    color: category === cat ? '#fff' : 'var(--text-dim)', cursor: 'pointer',
                  }}
                >
                  {cat} {cat !== 'All' && `(${count})`}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[0,1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 60 }} />)}
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="card" style={{ padding: '40px 32px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                {files.length === 0 ? 'No files yet. Upload your first file above.' : 'No files match this filter.'}
              </p>
            </div>
          ) : (
            <>
              {/* Photo grid */}
              {photoFiles.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  {category === 'All' && <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Photos</p>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))', gap: 8 }}>
                    {photoFiles.map(f => (
                      <div
                        key={f.id}
                        style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', aspectRatio: '1' }}
                        onClick={() => deleteConfirmId !== f.id && setPreviewFile(f)}
                        className="file-thumb-card"
                      >
                        <img src={f.storage_url} alt={f.original_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                        <div className="file-thumb-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', transition: 'background 0.15s' }}>
                          <div style={{ padding: '6px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
                            <p style={{ fontSize: 11, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{f.original_name}</p>
                            {deleteConfirmId === f.id ? (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{ fontSize: 10, color: '#fca5a5' }}>Delete?</span>
                                <button onClick={e => { e.stopPropagation(); confirmDelete(f.id) }} disabled={deleting === f.id} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.85)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Yes</button>
                                <button onClick={e => { e.stopPropagation(); setDeleteConfirmId(null) }} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer' }}>No</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <a href={f.storage_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.2)', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>↓</a>
                                <button onClick={e => { e.stopPropagation(); setDeleteConfirmId(f.id) }} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.6)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>✕</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Document/video list */}
              {nonPhotoFiles.length > 0 && (
                <div>
                  {category === 'All' && photoFiles.length > 0 && <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Files</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {nonPhotoFiles.map(f => (
                      <div key={f.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20, flexShrink: 0 }}>{fileIcon(f.mime_type, f.original_name)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</p>
                          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>{formatSize(f.size_bytes)} · {formatDate(f.created_at)}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                          {/* Assign button for unassigned files */}
                          {!f.client_id && (
                            assigningId === f.id ? (
                              <select
                                autoFocus
                                onBlur={() => setAssigningId(null)}
                                onChange={e => assignFile(f.id, e.target.value)}
                                style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                              >
                                <option value="">Select client…</option>
                                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            ) : (
                              <button
                                onClick={() => setAssigningId(f.id)}
                                style={{ fontSize: 11, color: 'var(--green)', background: 'none', border: '1px solid var(--green)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >Assign →</button>
                            )
                          )}
                          {f.storage_url && (
                            <a href={f.storage_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', textDecoration: 'none' }}>Download</a>
                          )}
                          {deleteConfirmId === f.id ? (
                            <InlineConfirm id={f.id} onConfirm={() => confirmDelete(f.id)} onCancel={() => setDeleteConfirmId(null)} />
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(f.id)}
                              style={{ display: 'flex', alignItems: 'center', padding: '4px 7px', borderRadius: 6, border: '1px solid #A32D2D', background: 'transparent', cursor: 'pointer', color: '#A32D2D' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Image preview modal */}
      {previewFile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setPreviewFile(null)}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', position: 'relative' }}>
            <button onClick={() => setPreviewFile(null)} style={{ position: 'absolute', top: -40, right: 0, background: 'none', border: 'none', color: 'white', fontSize: 28, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            {previewFile.mime_type?.startsWith('image/') && (
              <img src={previewFile.storage_url} alt={previewFile.original_name} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 16 }}>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{previewFile.original_name}</p>
              <a href={previewFile.storage_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.15)', color: '#fff', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>Download</a>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)', animation: 'fadeInUp 0.2s ease' }}>
          {toast}
        </div>
      )}
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .file-thumb-card:hover .file-thumb-overlay { background: rgba(0,0,0,0.35) !important; }
      `}</style>
    </div>
  )
}
