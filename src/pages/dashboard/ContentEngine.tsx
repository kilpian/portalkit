import { useState, useEffect, useCallback, useRef } from 'react'
import { usePortalAuth } from '../../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

type ToastType = 'success' | 'error'
interface Toast { id: number; msg: string; type: ToastType }

export default function ContentEngine() {
  // ALL hooks first — no exceptions
  const { user } = usePortalAuth()
  const [posts, setPosts] = useState<any[]>([])
  const [leads, setLeads] = useState<any[]>([])
  const [videos, setVideos] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState('posts')
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  // Outreach state
  const [outreachStats, setOutreachStats] = useState<any>(null)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [testingEmail, setTestingEmail] = useState('')
  const [testSending, setTestSending] = useState(false)

  // City search state
  const [searchCity, setSearchCity] = useState('')
  const [searchState, setSearchState] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<any>(null)

  // Video state
  const [videoScript, setVideoScript] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [videoGenerating, setVideoGenerating] = useState(false)
  const videoPolling = useRef<ReturnType<typeof setInterval> | null>(null)

  const isAdmin = user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase()

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const fetchPosts = useCallback(async () => {
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
  }, [])

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/tool-leads`, {
        headers: { 'x-admin-secret': ADMIN_SECRET }
      })
      const data = await res.json()
      setLeads(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Fetch leads error:', err)
    }
  }, [])

  const fetchOutreachStats = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/admin/cold-contacts/stats`,
        { headers: { 'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET } }
      )
      const data = await res.json()
      setOutreachStats(data)
    } catch {}
  }, [])

  const fetchVideos = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/generated-videos`, {
        headers: { 'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET }
      })
      const data = await res.json()
      setVideos(Array.isArray(data) ? data : [])
    } catch {}
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetchPosts()
    fetchLeads()
    fetchOutreachStats()
    fetchVideos()
  }, [isAdmin, fetchPosts, fetchLeads, fetchOutreachStats, fetchVideos])

  // Poll videos while any are rendering
  useEffect(() => {
    const hasRendering = videos.some(v => v.status === 'rendering' || v.status === 'queued')
    if (hasRendering && !videoPolling.current) {
      videoPolling.current = setInterval(fetchVideos, 8000)
    } else if (!hasRendering && videoPolling.current) {
      clearInterval(videoPolling.current)
      videoPolling.current = null
    }
    return () => {
      if (videoPolling.current) clearInterval(videoPolling.current)
    }
  }, [videos, fetchVideos])

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

  const handleImport = async () => {
    if (!importText.trim()) return
    setImporting(true)
    setImportResult(null)

    const lines = importText.trim().split('\n')
      .map((l: string) => l.trim()).filter(Boolean)

    const contacts = lines.map((line: string) => {
      const parts = line.split(',').map((p: string) => p.trim())
      return {
        email: parts[0],
        first_name: parts[1] || null,
        business_name: parts[2] || null
      }
    })

    try {
      const res = await fetch(
        `${API_URL}/api/admin/cold-contacts/import`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET
          },
          body: JSON.stringify({ contacts })
        }
      )
      const data = await res.json()
      setImportResult(data)
      setImportText('')
      fetchOutreachStats()
    } catch {
      setImportResult({ error: 'Import failed' })
    } finally {
      setImporting(false)
    }
  }

  const handleFindEmails = async () => {
    if (!searchCity.trim()) return
    setSearching(true)
    setSearchResult(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/find-emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET
        },
        body: JSON.stringify({ city: searchCity, state: searchState || 'USA' })
      })
      const data = await res.json()
      if (data.error) {
        showToast(data.error, 'error')
      } else {
        setSearchResult(data)
        fetchOutreachStats()
      }
    } catch {
      showToast('Failed to connect', 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleTestEmail = async () => {
    if (!testingEmail) return
    setTestSending(true)
    try {
      const res = await fetch(
        `${API_URL}/api/admin/cold-send-test`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET
          },
          body: JSON.stringify({ email: testingEmail })
        }
      )
      const data = await res.json()
      if (data.success) {
        showToast('Test email sent! Check your inbox.')
      } else {
        showToast(data.error || 'Failed to send test', 'error')
      }
    } catch {
      showToast('Failed to connect', 'error')
    } finally {
      setTestSending(false)
    }
  }

  const handleGenerateVideo = async () => {
    if (!videoScript.trim()) return
    setVideoGenerating(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/generate-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': import.meta.env.VITE_ADMIN_SECRET
        },
        body: JSON.stringify({ script: videoScript, title: videoTitle || undefined })
      })
      const data = await res.json()
      if (data.queued) {
        showToast('Video queued! Rendering in background.')
        setVideoScript('')
        setVideoTitle('')
        setTimeout(fetchVideos, 2000)
      } else {
        showToast(data.error || 'Failed to queue video', 'error')
      }
    } catch {
      showToast('Failed to connect', 'error')
    } finally {
      setVideoGenerating(false)
    }
  }

  // Conditional returns — AFTER all hooks
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

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {/* Toast notifications */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '12px 18px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            color: 'white',
            background: t.type === 'error' ? '#DC2626' : '#059669',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            animation: 'slideUp 0.25s ease',
            maxWidth: 320
          }}>
            {t.msg}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          ⚡ Content Engine
        </h1>
        {activeTab !== 'outreach' && activeTab !== 'videos' && (
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
        )}
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
          onClick={() => setActiveTab('outreach')}
          style={{
            padding: '8px 16px', border: 'none', background: 'none',
            cursor: 'pointer', fontSize: 14, fontWeight: 600,
            color: activeTab === 'outreach' ? '#1B4332' : 'var(--text-muted)',
            borderBottom: activeTab === 'outreach' ? '2px solid #1B4332' : '2px solid transparent'
          }}
        >
          Outreach
        </button>
        <button
          onClick={() => setActiveTab('videos')}
          style={{
            padding: '8px 16px', border: 'none', background: 'none',
            cursor: 'pointer', fontSize: 14, fontWeight: 600,
            color: activeTab === 'videos' ? '#1B4332' : 'var(--text-muted)',
            borderBottom: activeTab === 'videos' ? '2px solid #1B4332' : '2px solid transparent'
          }}
        >
          Videos ({videos.length})
        </button>
        <button
          onClick={() => {
            if (activeTab === 'posts') fetchPosts()
            else if (activeTab === 'leads') fetchLeads()
            else if (activeTab === 'videos') fetchVideos()
            else fetchOutreachStats()
          }}
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

      {/* Outreach tab */}
      {activeTab === 'outreach' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12, marginBottom: 24
          }}>
            {['queued', 'sent', 'opted_out', 'bounced'].map(s => (
              <div key={s} style={{
                background: 'white', borderRadius: 10,
                padding: 16, border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase' as const,
                  marginBottom: 6
                }}>
                  {s.replace('_', ' ')}
                </div>
                <div style={{
                  fontSize: 26, fontWeight: 800,
                  color: '#1B4332'
                }}>
                  {outreachStats?.byStatus?.find(
                    (b: any) => b.status === s
                  )?.count || 0}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: 'white', borderRadius: 12,
            padding: 20, marginBottom: 20,
            border: '1px solid var(--border-subtle)'
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#1B4332' }}>
              Find Photographers by City
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Enter any US city to find wedding photographers from The Knot directory. Runs automatically every Sunday.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                value={searchCity}
                onChange={e => setSearchCity(e.target.value)}
                placeholder="City (e.g. Austin)"
                style={{
                  flex: 2, padding: '9px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13
                }}
              />
              <input
                type="text"
                value={searchState}
                onChange={e => setSearchState(e.target.value)}
                placeholder="State (e.g. TX)"
                style={{
                  flex: 1, padding: '9px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13
                }}
              />
              <button
                onClick={handleFindEmails}
                disabled={searching || !searchCity.trim()}
                style={{
                  background: '#1B4332', color: 'white', border: 'none',
                  padding: '9px 16px', borderRadius: 8, fontSize: 14,
                  fontWeight: 600, cursor: 'pointer',
                  opacity: searching ? 0.7 : 1, whiteSpace: 'nowrap' as const
                }}
              >
                {searching ? 'Searching...' : 'Find & Import'}
              </button>
            </div>
            {searchResult && (
              <div style={{
                padding: '10px 14px', background: '#F0FDF4',
                border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 13
              }}>
                Found {searchResult.found} emails. Added {searchResult.added} new contacts, skipped {searchResult.skipped} duplicates.
              </div>
            )}
          </div>

          <div style={{
            background: 'white', borderRadius: 12,
            padding: 20, marginBottom: 20,
            border: '1px solid var(--border-subtle)'
          }}>
            <h3 style={{
              fontSize: 14, fontWeight: 700,
              marginBottom: 6, color: '#1B4332'
            }}>
              Import Contacts
            </h3>
            <p style={{
              fontSize: 12, color: 'var(--text-muted)',
              marginBottom: 12
            }}>
              One per line. Format: email OR email,FirstName,BusinessName
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'sarah@sarahphoto.com,Sarah,Sarah Photo Co\nmike@mikeweddings.com'}
              style={{
                width: '100%', height: 140,
                padding: '10px 14px',
                border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 13,
                fontFamily: 'monospace', resize: 'vertical' as const,
                boxSizing: 'border-box' as const
              }}
            />
            <button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              style={{
                marginTop: 10, background: '#1B4332',
                color: 'white', border: 'none',
                padding: '10px 20px', borderRadius: 8,
                fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
                opacity: importing ? 0.7 : 1
              }}
            >
              {importing ? 'Importing...' : 'Import Contacts'}
            </button>

            {importResult && (
              <div style={{
                marginTop: 12, padding: '10px 14px',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: 8, fontSize: 13
              }}>
                {importResult.error
                  ? importResult.error
                  : `Added ${importResult.added} contacts. Skipped ${importResult.skipped}.`
                }
              </div>
            )}
          </div>

          <div style={{
            background: 'white', borderRadius: 12,
            padding: 20, border: '1px solid var(--border-subtle)'
          }}>
            <h3 style={{
              fontSize: 14, fontWeight: 700,
              marginBottom: 12, color: '#1B4332'
            }}>
              Send Test Email
            </h3>
            <p style={{
              fontSize: 12, color: 'var(--text-muted)',
              marginBottom: 10
            }}>
              Sends a test cold email to any address so you can see exactly what photographers receive.
              Requires COLD_EMAIL_FROM to be set in Railway.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={testingEmail}
                onChange={e => setTestingEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  flex: 1, padding: '9px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13
                }}
              />
              <button
                onClick={handleTestEmail}
                disabled={testSending || !testingEmail}
                style={{
                  background: '#1B4332',
                  color: 'white', border: 'none',
                  padding: '9px 16px', borderRadius: 8,
                  fontSize: 14, fontWeight: 600,
                  cursor: 'pointer',
                  opacity: testSending ? 0.7 : 1
                }}
              >
                {testSending ? 'Sending...' : 'Send Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Videos tab */}
      {activeTab === 'videos' && (
        <div>
          <div style={{
            background: 'white', borderRadius: 12,
            padding: 20, marginBottom: 20,
            border: '1px solid var(--border-subtle)'
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#1B4332' }}>
              Generate Video
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Renders a 1080x1920 MP4 with voice narration. Requires ElevenLabs + R2 configured in Railway.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Title (optional)
            </label>
            <input
              type="text"
              value={videoTitle}
              onChange={e => setVideoTitle(e.target.value)}
              placeholder="e.g. Why photographers need a client portal"
              style={{
                width: '100%', padding: '9px 14px', marginBottom: 10,
                border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
                boxSizing: 'border-box' as const
              }}
            />
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Script
            </label>
            <textarea
              value={videoScript}
              onChange={e => setVideoScript(e.target.value)}
              placeholder="The hook, the story, the CTA. Keep it under 60 seconds (~150 words)."
              rows={5}
              style={{
                width: '100%', padding: '10px 14px',
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 13, resize: 'vertical' as const,
                boxSizing: 'border-box' as const
              }}
            />
            <button
              onClick={handleGenerateVideo}
              disabled={videoGenerating || !videoScript.trim()}
              style={{
                marginTop: 10, background: '#1B4332',
                color: 'white', border: 'none',
                padding: '10px 20px', borderRadius: 8,
                fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
                opacity: videoGenerating ? 0.7 : 1
              }}
            >
              {videoGenerating ? 'Queuing...' : '🎬 Generate Video'}
            </button>
          </div>

          {videos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: 15 }}>No videos generated yet.</p>
            </div>
          ) : (
            videos.map((v: any) => (
              <div key={v.id} style={{
                background: 'white', borderRadius: 10, padding: 16, marginBottom: 12,
                border: '1px solid var(--border-subtle)',
                borderLeft: `4px solid ${v.status === 'done' ? '#059669' : v.status === 'error' ? '#DC2626' : '#C9A84C'}`,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    background: v.status === 'done' ? '#F0FDF4' : v.status === 'error' ? '#FEE2E2' : '#FFFBEB',
                    color: v.status === 'done' ? '#14532D' : v.status === 'error' ? '#991B1B' : '#92400E',
                    textTransform: 'uppercase' as const
                  }}>
                    {v.status}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {v.title || 'Untitled video'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                    {new Date(v.created_at).toLocaleDateString()}
                  </span>
                </div>
                {v.script && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>
                    {v.script.length > 200 ? v.script.slice(0, 200) + '...' : v.script}
                  </p>
                )}
                {v.error && (
                  <p style={{ fontSize: 12, color: '#DC2626', margin: '0 0 8px' }}>Error: {v.error}</p>
                )}
                {v.status === 'done' && v.r2_url && (
                  <a
                    href={v.r2_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block', fontSize: 12, padding: '5px 12px',
                      background: '#F0FDF4', border: '1px solid #A7F3D0',
                      borderRadius: 6, color: '#059669', fontWeight: 600,
                      textDecoration: 'none'
                    }}
                  >
                    Download MP4
                  </a>
                )}
                {(v.status === 'rendering' || v.status === 'queued') && (
                  <span style={{ fontSize: 12, color: '#92400E' }}>Rendering... (auto-refreshes)</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
