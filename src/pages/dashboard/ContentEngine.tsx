import { useState, useEffect } from 'react'
import { usePortalAuth } from '../../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

export default function ContentEngine() {
  // 1. ALL hooks declared first — no exceptions
  const { user } = usePortalAuth()
  const [posts, setPosts] = useState<any[]>([])
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState('posts')
  const [error, setError] = useState('')

  // 2. Derived values (not hooks)
  const isAdmin = user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase()

  console.log('ContentEngine admin check:', {
    userEmail: user?.email,
    adminEmail: import.meta.env.VITE_ADMIN_EMAIL,
    isAdmin
  })

  // 3. useEffect hooks — all before any return
  useEffect(() => {
    if (!isAdmin) return
    fetchPosts()
    fetchLeads()
  }, [isAdmin])

  // 4. Handler functions
  const fetchPosts = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/generated-content`, {
        headers: { 'x-admin-secret': ADMIN_SECRET }
      })
      const data = await res.json()
      setPosts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Fetch posts error:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchLeads = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/tool-leads`, {
        headers: { 'x-admin-secret': ADMIN_SECRET }
      })
      const data = await res.json()
      setLeads(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Fetch leads error:', err)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/admin/generate-content`, {
        method: 'POST',
        headers: { 'x-admin-secret': ADMIN_SECRET }
      })
      const data = await res.json()
      if (data.success) {
        await fetchPosts()
      } else {
        setError(data.error || 'Generation failed')
      }
    } catch {
      setError('Failed to connect. Is Railway running?')
    } finally {
      setGenerating(false)
    }
  }

  const handleReddit = async () => {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/admin/reddit-content`, {
        method: 'POST',
        headers: { 'x-admin-secret': ADMIN_SECRET }
      })
      const data = await res.json()
      if (data.success) {
        await fetchPosts()
      } else {
        setError(data.error || 'Reddit generation failed')
      }
    } catch {
      setError('Failed to connect.')
    } finally {
      setGenerating(false)
    }
  }

  const markStatus = async (id: number, status: 'posted' | 'skipped') => {
    try {
      await fetch(`${API_URL}/api/admin/generated-content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ status }),
      })
      setPosts(prev => prev.map(p => p.id === id ? { ...p, status } : p))
    } catch {}
  }

  // 5. Conditional returns — AFTER all hooks
  if (!user) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: 16 }}>Not authorized.</p>
        <p style={{ fontSize: 13, marginTop: 8 }}>Signed in as: {user?.email}</p>
      </div>
    )
  }

  // 6. Main render
  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          ⚡ Content Engine
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleReddit}
            disabled={generating}
            style={{
              background: '#EF4444', color: 'white', border: 'none',
              padding: '10px 16px', borderRadius: 8, fontSize: 13,
              fontWeight: 600, cursor: 'pointer', opacity: generating ? 0.7 : 1
            }}
          >
            Reddit Post
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              background: '#1B4332', color: 'white', border: 'none',
              padding: '10px 20px', borderRadius: 8, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', opacity: generating ? 0.7 : 1
            }}
          >
            {generating ? 'Generating...' : "✨ Generate This Week's Content"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FCA5A5',
          borderRadius: 8, padding: '12px 16px',
          color: '#991B1B', fontSize: 13, marginBottom: 16
        }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        borderBottom: '1px solid var(--border-subtle)', paddingBottom: 0
      }}>
        {['posts', 'leads'].map(t => (
          <button key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none',
              cursor: 'pointer', fontSize: 14, fontWeight: 600,
              color: activeTab === t ? '#1B4332' : 'var(--text-muted)',
              borderBottom: activeTab === t ? '2px solid #1B4332' : '2px solid transparent',
              textTransform: 'capitalize' as const
            }}
          >
            {t === 'posts' ? `Posts (${posts.length})` : `Leads (${leads.length})`}
          </button>
        ))}
        <button
          onClick={() => activeTab === 'posts' ? fetchPosts() : fetchLeads()}
          style={{ marginLeft: 'auto', padding: '6px 14px', background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {/* Posts tab */}
      {activeTab === 'posts' && (
        <div>
          {loading ? (
            <p style={{ color: '#6B7280', fontSize: 14 }}>Loading...</p>
          ) : posts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: 15, marginBottom: 8 }}>No posts generated yet.</p>
              <p style={{ fontSize: 13 }}>Click "Generate This Week's Content" above.</p>
            </div>
          ) : (
            posts.map((post: any) => (
              <div key={post.id} style={{
                background: 'white', borderRadius: 10, padding: 16, marginBottom: 12,
                border: '1px solid var(--border-subtle)',
                borderLeft: `4px solid ${post.status === 'posted' ? '#059669' : post.status === 'skipped' ? '#9CA3AF' : '#C9A84C'}`,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' as const }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    background: '#F0FDF4', color: '#14532D', textTransform: 'uppercase' as const
                  }}>
                    {post.angle || 'post'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {post.scheduled_for
                      ? new Date(post.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : 'Not scheduled'}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, marginLeft: 'auto',
                    color: post.status === 'posted' ? '#059669' : '#6B7280'
                  }}>
                    {post.status}
                  </span>
                </div>
                <p style={{
                  fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', margin: '0 0 10px'
                }}>
                  {post.content}
                </p>
                {post.twitter_content && (
                  <div style={{
                    background: '#F8FAFC', borderRadius: 6, padding: '8px 12px',
                    marginBottom: 10, border: '1px solid #E2E8F0'
                  }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#64748B', margin: '0 0 4px' }}>
                      TWITTER/X VERSION:
                    </p>
                    <p style={{ fontSize: 12, color: '#374151', margin: 0, lineHeight: 1.5 }}>
                      {post.twitter_content}
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                  <button
                    onClick={() => navigator.clipboard.writeText(post.content)}
                    style={{
                      fontSize: 12, padding: '5px 12px', background: 'none',
                      border: '1px solid var(--border)', borderRadius: 6,
                      cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 600
                    }}
                  >
                    Copy
                  </button>
                  {post.twitter_content && (
                    <button
                      onClick={() => navigator.clipboard.writeText(post.twitter_content)}
                      style={{
                        fontSize: 12, padding: '5px 12px', background: 'none',
                        border: '1px solid var(--border)', borderRadius: 6,
                        cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 600
                      }}
                    >
                      Copy X/Twitter
                    </button>
                  )}
                  {post.status !== 'posted' && (
                    <button
                      onClick={() => markStatus(post.id, 'posted')}
                      style={{
                        fontSize: 12, padding: '5px 12px', background: '#F0FDF4',
                        border: '1px solid #A7F3D0', borderRadius: 6,
                        cursor: 'pointer', color: '#059669', fontWeight: 600
                      }}
                    >
                      Mark Posted
                    </button>
                  )}
                  {post.status !== 'skipped' && post.status !== 'posted' && (
                    <button
                      onClick={() => markStatus(post.id, 'skipped')}
                      style={{
                        fontSize: 12, padding: '5px 12px', background: 'white',
                        border: '1px solid #E5E7EB', borderRadius: 6,
                        cursor: 'pointer', color: '#9CA3AF', fontWeight: 600
                      }}
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Leads tab */}
      {activeTab === 'leads' && (
        <div>
          {leads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              No leads captured yet.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Email', 'Tool', 'Source', 'Date'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 12px', fontSize: 12,
                      fontWeight: 700, color: 'var(--text-muted)',
                      borderBottom: '1px solid var(--border)', textTransform: 'uppercase' as const
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: any) => (
                  <tr key={lead.id}>
                    <td style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border-subtle)' }}>{lead.email}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>{lead.tool}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>{lead.source}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-dim)' }}>
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
