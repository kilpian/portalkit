import { useEffect, useRef, useState } from 'react'
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

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return '🖼'
  if (['pdf'].includes(ext)) return '📄'
  if (['mp4', 'mov', 'avi'].includes(ext)) return '🎬'
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜'
  return '📎'
}

export default function Files() {
  const { authFetch } = useApi()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [dragOver, setDragOver] = useState(false)
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
      if (selectedClientId) fd.append('client_id', selectedClientId)
      const resp = await authFetch('/api/files/upload', {
        method: 'post',
        data: fd,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e: { loaded: number; total?: number }) => {
          if (e.total) setUploadProgress(Math.round(e.loaded / e.total * 100))
        },
      })
      setFiles(prev => [resp.data, ...prev])
      showToast('File uploaded!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      showToast(msg || 'Upload failed')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    try {
      await authFetch(`/api/files/${id}`, { method: 'delete' })
      setFiles(prev => prev.filter(f => f.id !== id))
      showToast('File deleted.')
    } catch {
      showToast('Failed to delete.')
    } finally {
      setDeleting(null)
    }
  }

  // Group by client
  const grouped = files.reduce<Record<string, UploadedFile[]>>((acc, f) => {
    const key = f.client_name ?? 'No client assigned'
    ;(acc[key] = acc[key] ?? []).push(f)
    return acc
  }, {})

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Files & Galleries</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{files.length} file{files.length !== 1 ? 's' : ''} shared with clients</p>
        </div>
      </div>

      {/* Client selector */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flexShrink: 0 }}>Assign to client:</label>
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
          style={{ flex: 1, maxWidth: 240, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          <option value="">— No client —</option>
          {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f) }}
        style={{
          background: dragOver ? '#F0FDF4' : 'var(--bg-secondary)',
          border: `2px dashed ${dragOver ? '#86EFAC' : 'var(--border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '40px 24px',
          textAlign: 'center',
          marginBottom: 24,
          cursor: uploading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
        />
        {uploading ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⏫</div>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Uploading…</p>
            <div style={{ maxWidth: 200, margin: '0 auto', height: 6, background: 'var(--border)', borderRadius: 99 }}>
              <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--green)', borderRadius: 99, transition: 'width 0.2s' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{uploadProgress}%</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📁</div>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              {dragOver ? 'Drop to upload' : 'Click or drag a file to upload'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Images, PDFs, videos, ZIP — up to 50 MB</p>
          </>
        )}
      </div>

      {/* File list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[0,1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 60 }} />)}
        </div>
      ) : files.length === 0 ? (
        <div className="card" style={{ padding: '40px 32px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>No files yet. Upload your first file above.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([clientName, clientFiles]) => (
          <div key={clientName} style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{clientName}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {clientFiles.map(f => (
                <div key={f.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{fileIcon(f.original_name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</p>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>{formatSize(f.size_bytes)} · {formatDate(f.created_at)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {f.storage_url && (
                      <a
                        href={f.storage_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', textDecoration: 'none' }}
                      >
                        Download
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(f.id)}
                      disabled={deleting === f.id}
                      style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)', animation: 'fadeInUp 0.2s ease' }}>
          {toast}
        </div>
      )}
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
