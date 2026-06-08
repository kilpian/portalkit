import { useState, useEffect, useCallback } from 'react'
import { usePortalAuth } from '../../context/AuthContext'
import API_BASE from '../../lib/api'

const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

interface GeneratedPost {
  id: number
  content: string
  twitter_content: string | null
  angle: string | null
  day_number: number | null
  week_start: string | null
  status: 'pending' | 'posted' | 'skipped'
  scheduled_for: string | null
  postproxy_id: string | null
  created_at: string
}

interface ToolLead {
  id: number
  email: string
  tool: string | null
  source: string | null
  created_at: string
}

const ANGLE_COLORS: Record<string, string> = {
  pain_point: '#DC2626',
  tip: '#059669',
  feature: '#2563EB',
  savings: '#D97706',
  social_proof: '#7C3AED',
  question: '#0891B2',
  story: '#C2410C',
  reddit_insight: '#EF4444',
}

function angleBadge(angle: string | null) {
  const color = angle ? (ANGLE_COLORS[angle] || '#6B7280') : '#6B7280'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: color + '20', color,
      border: `1px solid ${color}40`,
    }}>
      {angle || 'unknown'}
    </span>
  )
}

export default function ContentEngine() {
  const { user } = usePortalAuth()
  const [tab, setTab] = useState<'posts' | 'leads'>('posts')
  const [posts, setPosts] = useState<GeneratedPost[]>([])
  const [leads, setLeads] = useState<ToolLead[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  console.log('Admin check:', {
    userEmail: user?.email,
    adminEmail: import.meta.env.VITE_ADMIN_EMAIL,
    match: user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase()
  })

  const isAdmin = user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase()

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>Not authorized.</p>
      </div>
    )
  }

  const adminHeaders = {
    'Content-Type': 'application/json',
    'x-admin-secret': ADMIN_SECRET,
  }

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/admin/generated-content`, { headers: adminHeaders })
      const data = await res.json()
      setPosts(Array.isArray(data) ? data : [])
    } catch { setPosts([]) }
    finally { setLoading(false) }
  }, [])

  const loadLeads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/admin/tool-leads`, { headers: adminHeaders })
      const data = await res.json()
      setLeads(Array.isArray(data) ? data : [])
    } catch { setLeads([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'posts') loadPosts()
    else loadLeads()
  }, [tab])

  async function generateContent() {
    setGenerating(true)
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/api/admin/generate-content`, {
        method: 'POST',
        headers: adminHeaders,
      })
      if (res.ok) {
        setMsg('Content generated!')
        await loadPosts()
      } else {
        setMsg('Generation failed.')
      }
    } catch { setMsg('Error calling API.') }
    finally { setGenerating(false) }
  }

  async function generateRedditContent() {
    setGenerating(true)
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/api/admin/reddit-content`, {
        method: 'POST',
        headers: adminHeaders,
      })
      if (res.ok) {
        setMsg('Reddit post generated!')
        await loadPosts()
      } else {
        setMsg('Reddit generation failed.')
      }
    } catch { setMsg('Error calling API.') }
    finally { setGenerating(false) }
  }

  async function markStatus(id: number, status: 'posted' | 'skipped') {
    try {
      await fetch(`${API_BASE}/api/admin/generated-content/${id}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ status }),
      })
      setPosts(prev => prev.map(p => p.id === id ? { ...p, status } : p))
    } catch {}
  }

  function copyText(text: string, id: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const TAB_STYLE = (active: boolean) => ({
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    background: active ? '#1B4332' : 'transparent',
    color: active ? '#FDFAF5' : '#6B7280',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B4332', margin: 0 }}>
          ⚡ Content Engine
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
          AI-generated social posts and free tool leads
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#F3F4F6', padding: 4, borderRadius: 10, marginBottom: 24, width: 'fit-content' }}>
        <button style={TAB_STYLE(tab === 'posts')} onClick={() => setTab('posts')}>Generated Posts</button>
        <button style={TAB_STYLE(tab === 'leads')} onClick={() => setTab('leads')}>Tool Leads</button>
      </div>

      {/* Posts Tab */}
      {tab === 'posts' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={generateContent}
              disabled={generating}
              style={{
                padding: '10px 20px', background: '#1B4332', color: 'white',
                border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14,
                cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1,
              }}
            >
              {generating ? 'Generating...' : '⚡ Generate This Week\'s Content'}
            </button>
            <button
              onClick={generateRedditContent}
              disabled={generating}
              style={{
                padding: '10px 20px', background: '#EF4444', color: 'white',
                border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14,
                cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1,
              }}
            >
              Reddit Post
            </button>
            <button onClick={loadPosts} style={{ padding: '10px 16px', background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Refresh
            </button>
            {msg && <span style={{ fontSize: 13, color: msg.includes('!') ? '#059669' : '#DC2626', fontWeight: 600 }}>{msg}</span>}
          </div>

          {loading ? (
            <p style={{ color: '#6B7280', fontSize: 14 }}>Loading...</p>
          ) : posts.length === 0 ? (
            <div style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', border: '1px solid #E5E7EB' }}>
              <p style={{ color: '#6B7280', fontSize: 14 }}>No posts yet. Click "Generate This Week's Content" to create some.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {posts.map(post => (
                <div key={post.id} style={{
                  background: 'white', borderRadius: 12, padding: '16px 20px',
                  border: '1px solid #E5E7EB',
                  borderLeft: `4px solid ${post.status === 'posted' ? '#059669' : post.status === 'skipped' ? '#9CA3AF' : '#C9A84C'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                    {angleBadge(post.angle)}
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 600,
                      background: post.status === 'posted' ? '#D1FAE5' : post.status === 'skipped' ? '#F3F4F6' : '#FEF3C7',
                      color: post.status === 'posted' ? '#059669' : post.status === 'skipped' ? '#9CA3AF' : '#D97706',
                    }}>
                      {post.status}
                    </span>
                    {post.scheduled_for && (
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                        {new Date(post.scheduled_for).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {post.postproxy_id && (
                      <span style={{ fontSize: 11, color: '#7C3AED' }}>Postproxy: {post.postproxy_id}</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>
                      {new Date(post.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Hook — first line */}
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', margin: '0 0 8px', lineHeight: 1.4 }}>
                    {post.content.split('\n')[0].slice(0, 120)}{post.content.split('\n')[0].length > 120 ? '…' : ''}
                  </p>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setExpandedId(expandedId === post.id ? null : post.id)}
                      style={{ fontSize: 12, color: '#1B4332', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                    >
                      {expandedId === post.id ? 'Collapse ▲' : 'Expand ▼'}
                    </button>
                    <button
                      onClick={() => copyText(post.content, post.id)}
                      style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #E5E7EB', borderRadius: 6, background: copiedId === post.id ? '#D1FAE5' : 'white', color: copiedId === post.id ? '#059669' : '#374151', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {copiedId === post.id ? '✓ Copied' : 'Copy'}
                    </button>
                    {post.twitter_content && (
                      <button
                        onClick={() => copyText(post.twitter_content!, post.id * -1)}
                        style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #E5E7EB', borderRadius: 6, background: copiedId === post.id * -1 ? '#D1FAE5' : 'white', color: copiedId === post.id * -1 ? '#059669' : '#374151', cursor: 'pointer', fontWeight: 600 }}
                      >
                        {copiedId === post.id * -1 ? '✓ Copied' : 'Copy X/Twitter'}
                      </button>
                    )}
                    {post.status !== 'posted' && (
                      <button
                        onClick={() => markStatus(post.id, 'posted')}
                        style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #A7F3D0', borderRadius: 6, background: '#F0FDF4', color: '#059669', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Mark Posted
                      </button>
                    )}
                    {post.status !== 'skipped' && post.status !== 'posted' && (
                      <button
                        onClick={() => markStatus(post.id, 'skipped')}
                        style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #E5E7EB', borderRadius: 6, background: 'white', color: '#9CA3AF', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Skip
                      </button>
                    )}
                  </div>

                  {expandedId === post.id && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instagram / Facebook</p>
                        <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#F9FAFB', padding: 12, borderRadius: 8, lineHeight: 1.6, color: '#374151', margin: 0, fontFamily: 'inherit' }}>
                          {post.content}
                        </pre>
                      </div>
                      {post.twitter_content && (
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>X / Twitter ({post.twitter_content.length} chars)</p>
                          <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#F0F9FF', padding: 12, borderRadius: 8, lineHeight: 1.6, color: '#374151', margin: 0, fontFamily: 'inherit' }}>
                            {post.twitter_content}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Leads Tab */}
      {tab === 'leads' && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <p style={{ fontSize: 14, color: '#374151', fontWeight: 600, margin: 0 }}>
              {leads.length} lead{leads.length !== 1 ? 's' : ''} captured
            </p>
            <button onClick={loadLeads} style={{ padding: '6px 14px', background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Refresh
            </button>
          </div>

          {loading ? (
            <p style={{ color: '#6B7280', fontSize: 14 }}>Loading...</p>
          ) : leads.length === 0 ? (
            <p style={{ color: '#6B7280', fontSize: 14 }}>No leads yet.</p>
          ) : (
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tool</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => (
                    <tr key={lead.id} style={{ borderBottom: i < leads.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{lead.email}</td>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: '#6B7280' }}>{lead.tool || '—'}</td>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: '#6B7280' }}>{lead.source || '—'}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: '#9CA3AF' }}>
                        {new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
