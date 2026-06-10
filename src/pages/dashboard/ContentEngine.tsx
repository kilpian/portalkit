import { useState, useEffect, useCallback } from 'react'
import { usePortalAuth } from '../../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

interface ColdStats {
  queued?: number
  sent?: number
  replied?: number
  opted_out?: number
  bounced?: number
  suppressed?: number
}

export default function ContentEngine() {
  // ALL hooks first
  const { user } = usePortalAuth()
  const [posts, setPosts] = useState<any[]>([])
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState('posts')
  const [error, setError] = useState('')

  // Outreach tab state
  const [outreachInput, setOutreachInput] = useState('')
  const [outreachLoading, setOutreachLoading] = useState(false)
  const [outreachResult, setOutreachResult] = useState<{ added: number; skipped: number; skippedReasons: string[] } | null>(null)
  const [coldStats, setColdStats] = useState<ColdStats>({})
  const [testEmail, setTestEmail] = useState('')
  const [testResult, setTestResult] = useState('')
  const [suppressEmail, setSuppressEmail] = useState('')
  const [suppressResult, setSuppressResult] = useState('')

  const isAdmin = user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase()

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

  const fetchColdStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/cold-contacts/stats`, {
        headers: { 'x-admin-secret': ADMIN_SECRET }
      })
      const data = await res.json()
      setColdStats(data)
    } catch {}
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetchPosts()
    fetchLeads()
    fetchColdStats()
  }, [isAdmin, fetchPosts, fetchLeads, fetchColdStats])

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

  // Outreach handlers
  const parseContacts = (raw: string) => {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
    return lines.map(line => {
      const parts = line.split(',').map(p => p.trim())
      if (parts.length >= 3) {
        return { email: parts[0], first_name: parts[1] || undefined, business_name: parts[2] || undefined }
      }
      return { email: parts[0] }
    })
  }

  const handleImport = async () => {
    if (!outreachInput.trim()) return
    setOutreachLoading(true)
    setOutreachResult(null)
    try {
      const contacts = parseContacts(outreachInput)
      const res = await fetch(`${API_URL}/api/admin/cold-contacts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ contacts }),
      })
      const data = await res.json()
      setOutreachResult(data)
      await fetchColdStats()
    } catch {
      setOutreachResult({ added: 0, skipped: 0, skippedReasons: ['Import failed — check connection'] })
    } finally {
      setOutreachLoading(false)
    }
  }

  const handleSendTest = async () => {
    if (!testEmail) return
    setTestResult('Sending...')
    try {
      const res = await fetch(`${API_URL}/api/admin/cold-send-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ email: testEmail }),
      })
      const data = await res.json()
      setTestResult(data.success ? 'Sent! Check your inbox.' : `Error: ${data.error}`)
    } catch {
      setTestResult('Failed to connect.')
    }
  }

  const handleSuppress = async () => {
    if (!suppressEmail) return
    try {
      await fetch(`${API_URL}/api/admin/cold-suppression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ email: suppressEmail }),
      })
      setSuppressResult(`${suppressEmail} suppressed.`)
      setSuppressEmail('')
      await fetchColdStats()
    } catch {
      setSuppressResult('Failed.')
    }
  }

  // Conditional returns — after all hooks
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

  const statBox = (label: string, value: number | undefined, color: string) => (
    <div style={{
      background: 'white', border: '1px solid var(--border)', borderRadius: 8,
      padding: '12px 16px', textAlign: 'center' as const, minWidth: 80
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, fontWeight: 600 }}>{label}</div>
    </div>
  )

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          ⚡ Content Engine
        </h1>
        {activeTab !== 'outreach' && (
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
        {['posts', 'leads', 'outreach'].map(t => (
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
            {t === 'posts' ? `Posts (${posts.length})` : t === 'leads' ? `Leads (${leads.length})` : 'Outreach'}
          </button>
        ))}
        <button
          onClick={() => {
            if (activeTab === 'posts') fetchPosts()
            else if (activeTab === 'leads') fetchLeads()
            else fetchColdStats()
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
          {/* Stats row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' as const }}>
            {statBox('Queued', coldStats.queued, '#C9A84C')}
            {statBox('Sent', coldStats.sent, '#1B4332')}
            {statBox('Replied', coldStats.replied, '#059669')}
            {statBox('Opted out', coldStats.opted_out, '#6B7280')}
            {statBox('Bounced', coldStats.bounced, '#EF4444')}
            {statBox('Suppressed', coldStats.suppressed, '#9CA3AF')}
          </div>

          {/* Import section */}
          <div style={{
            background: 'white', border: '1px solid var(--border)', borderRadius: 10,
            padding: 20, marginBottom: 16
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>
              Import contacts
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              One per line. Formats: <code>email</code> or <code>email,first_name,business_name</code>
            </p>
            <textarea
              value={outreachInput}
              onChange={e => setOutreachInput(e.target.value)}
              placeholder={'jane@studiojane.com\nbob@bobphoto.com,Bob,Bob Photo Co\nalice@aliceweds.com,Alice'}
              rows={8}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #E5E7EB',
                borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
                resize: 'vertical', boxSizing: 'border-box' as const
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <button
                onClick={handleImport}
                disabled={outreachLoading || !outreachInput.trim()}
                style={{
                  background: '#1B4332', color: 'white', border: 'none',
                  padding: '10px 20px', borderRadius: 8, fontSize: 14,
                  fontWeight: 600, cursor: 'pointer',
                  opacity: outreachLoading || !outreachInput.trim() ? 0.6 : 1
                }}
              >
                {outreachLoading ? 'Importing...' : 'Import contacts'}
              </button>
              {outreachResult && (
                <span style={{ fontSize: 13, color: outreachResult.added > 0 ? '#059669' : '#6B7280' }}>
                  Added {outreachResult.added}, skipped {outreachResult.skipped}
                </span>
              )}
            </div>
            {outreachResult && outreachResult.skippedReasons.length > 0 && (
              <div style={{
                marginTop: 10, background: '#F9FAFB', border: '1px solid #E5E7EB',
                borderRadius: 6, padding: '8px 12px', maxHeight: 120, overflowY: 'auto' as const
              }}>
                {outreachResult.skippedReasons.map((r, i) => (
                  <p key={i} style={{ fontSize: 11, color: '#6B7280', margin: '2px 0', fontFamily: 'monospace' }}>{r}</p>
                ))}
              </div>
            )}
          </div>

          {/* Test send */}
          <div style={{
            background: 'white', border: '1px solid var(--border)', borderRadius: 10,
            padding: 20, marginBottom: 16
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: 'var(--text-primary)' }}>
              Send test email
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  flex: 1, padding: '9px 12px', border: '1px solid #E5E7EB',
                  borderRadius: 8, fontSize: 13
                }}
              />
              <button
                onClick={handleSendTest}
                disabled={!testEmail}
                style={{
                  background: '#1B4332', color: 'white', border: 'none',
                  padding: '9px 18px', borderRadius: 8, fontSize: 13,
                  fontWeight: 600, cursor: 'pointer', opacity: !testEmail ? 0.5 : 1,
                  whiteSpace: 'nowrap' as const
                }}
              >
                Send test
              </button>
            </div>
            {testResult && (
              <p style={{ fontSize: 13, color: testResult.startsWith('Sent') ? '#059669' : '#EF4444', margin: '8px 0 0' }}>
                {testResult}
              </p>
            )}
          </div>

          {/* Suppress */}
          <div style={{
            background: 'white', border: '1px solid var(--border)', borderRadius: 10,
            padding: 20
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>
              Add to suppression list
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Adds to suppression and marks any matching contact as opted_out.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={suppressEmail}
                onChange={e => setSuppressEmail(e.target.value)}
                placeholder="optout@example.com"
                style={{
                  flex: 1, padding: '9px 12px', border: '1px solid #E5E7EB',
                  borderRadius: 8, fontSize: 13
                }}
              />
              <button
                onClick={handleSuppress}
                disabled={!suppressEmail}
                style={{
                  background: '#6B7280', color: 'white', border: 'none',
                  padding: '9px 18px', borderRadius: 8, fontSize: 13,
                  fontWeight: 600, cursor: 'pointer', opacity: !suppressEmail ? 0.5 : 1,
                  whiteSpace: 'nowrap' as const
                }}
              >
                Suppress
              </button>
            </div>
            {suppressResult && (
              <p style={{ fontSize: 13, color: '#059669', margin: '8px 0 0' }}>{suppressResult}</p>
            )}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
            Cold sends run daily at 13:00 UTC (up to {import.meta.env.VITE_API_URL ? '25' : '25'} per day). Sender: COLD_EMAIL_FROM env var on Railway.
          </p>
        </div>
      )}
    </div>
  )
}
