import { useEffect, useState } from 'react'
import { useApi, type UploadedFile, API_BASE } from '../../lib/api'

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
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    authFetch('/api/files', { method: 'get' })
      .then(res => setFiles(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

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
    const key = f.client_name ?? 'No client'
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

      {/* Upload area — temporarily disabled */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '2px dashed var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '48px 24px',
        textAlign: 'center',
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
        <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>File uploads coming soon</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Cloud file storage is being set up. Available within 48 hours.
        </p>
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
                    <a
                      href={`${API_BASE}${f.storage_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', textDecoration: 'none' }}
                    >
                      Download
                    </a>
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
