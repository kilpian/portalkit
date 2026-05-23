import { useEffect, useRef, useState } from 'react'
import { useApi, usePolling, type Client, type Message, type MessageSummary } from '../../lib/api'

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function formatTime(d: string) {
  try {
    const date = new Date(d)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function formatFull(d: string) {
  try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

function dateDividerLabel(d: string): string {
  const date = new Date(d)
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === now.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

export default function Messages() {
  const { authFetch } = useApi()
  const [clients, setClients] = useState<Client[]>([])
  const [summaries, setSummaries] = useState<MessageSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [search, setSearch] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [deletingMsg, setDeletingMsg] = useState<number | null>(null)
  const [openMsgMenu, setOpenMsgMenu] = useState<number | null>(null)
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null)
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null)
  const [editMsgContent, setEditMsgContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchClients = () =>
    authFetch('/api/clients', { method: 'get' })
      .then(res => setClients(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)

  const fetchUnreadCount = () =>
    authFetch('/api/messages/summaries', { method: 'get' })
      .then(res => setSummaries(Array.isArray(res.data) ? res.data : []))
      .catch(console.error)

  // Load clients + summaries on mount
  useEffect(() => {
    fetchClients()
    fetchUnreadCount()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll for new messages / unread counts every 30s
  usePolling(() => {
    fetchClients()
    fetchUnreadCount()
    if (selectedId !== null) {
      authFetch(`/api/messages?client_id=${selectedId}`, { method: 'get' })
        .then(res => setMessages(Array.isArray(res.data) ? res.data : []))
        .catch(() => {})
    }
  }, 30000)

  // Load messages when client selected
  useEffect(() => {
    if (selectedId === null) return
    setLoadingMsgs(true)
    authFetch(`/api/messages?client_id=${selectedId}`, { method: 'get' })
      .then(res => {
        setMessages(Array.isArray(res.data) ? res.data : [])
        // Zero out unread for this client in summaries
        setSummaries(prev => prev.map(s => s.client_id === selectedId ? { ...s, unread_count: 0 } : s))
      })
      .catch(console.error)
      .finally(() => setLoadingMsgs(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [content])

  const selectedClient = clients.find(c => c.id === selectedId) ?? null
  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  const getSummary = (clientId: number) => summaries.find(s => s.client_id === clientId)

  const sortedClients = [...filteredClients].sort((a, b) => {
    const sa = getSummary(a.id)
    const sb = getSummary(b.id)
    const ua = sa?.unread_count ?? 0
    const ub = sb?.unread_count ?? 0
    if (ua !== ub) return ub - ua
    const ta = sa?.last_message_at ? new Date(sa.last_message_at).getTime() : 0
    const tb = sb?.last_message_at ? new Date(sb.last_message_at).getTime() : 0
    if (ta !== tb) return tb - ta
    return a.name.localeCompare(b.name)
  })

  const handleSend = async () => {
    if (!selectedId || !content.trim()) return
    setSending(true)
    try {
      const res = await authFetch('/api/messages', { method: 'post', data: { client_id: selectedId, content: content.trim() } })
      setMessages(prev => [...prev, res.data as Message])
      setSummaries(prev => prev.map(s => s.client_id === selectedId ? { ...s, last_message: content.trim(), last_sender: 'photographer', last_message_at: new Date().toISOString() } : s))
      setContent('')
    } catch {
      // silent — user sees nothing sent
    } finally {
      setSending(false)
    }
  }

  const handleDeleteMsg = async (id: number) => {
    setDeletingMsg(id)
    setOpenMsgMenu(null)
    try {
      await authFetch(`/api/messages/${id}`, { method: 'delete' })
      setMessages(prev => prev.filter(m => m.id !== id))
    } catch {
      // silent
    } finally {
      setDeletingMsg(null)
    }
  }

  const handleStartEdit = (m: Message) => {
    setOpenMsgMenu(null)
    setEditingMsgId(m.id)
    setEditMsgContent(m.content)
  }

  const handleSaveEdit = async (id: number) => {
    if (!editMsgContent.trim()) return
    setSavingEdit(true)
    try {
      const res = await authFetch(`/api/messages/${id}`, { method: 'put', data: { content: editMsgContent.trim() } })
      setMessages(prev => prev.map(m => m.id === id ? { ...m, content: (res.data as Message).content } : m))
      setEditingMsgId(null)
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string } } }
      alert(errObj.response?.data?.error || 'Failed to edit message.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleAiSuggest = async () => {
    if (!selectedId) return
    setAiLoading(true)
    try {
      const res = await authFetch('/api/ai/suggest-message', { method: 'post', data: { client_id: selectedId } })
      const suggestion = (res.data as { suggestion: string }).suggestion
      if (suggestion) setContent(suggestion)
    } catch {
      // silent
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left Panel ── */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 10 }}>Messages</h1>
          <div style={{ position: 'relative' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="input"
              type="search"
              placeholder="Search clients…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, fontSize: 13 }}
            />
          </div>
        </div>

        {/* Client list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sortedClients.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{search ? 'No clients match your search.' : 'No clients yet.'}</p>
            </div>
          ) : (
            sortedClients.map(c => {
              const summary = getSummary(c.id)
              const isSelected = c.id === selectedId
              const unread = summary?.unread_count ?? 0
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: isSelected ? 'var(--green-bg)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--green)' : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: isSelected ? 'var(--green)' : 'var(--bg-tertiary)', color: isSelected ? '#FDFAF5' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {getInitials(c.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: unread > 0 ? 700 : 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                      {summary?.last_message_at && <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{formatTime(summary.last_message_at)}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread > 0 ? 600 : 400 }}>
                        {summary?.last_message
                          ? (summary.last_sender === 'photographer' ? 'You: ' : '') + summary.last_message.slice(0, 40)
                          : 'No messages yet'
                        }
                      </p>
                      {unread > 0 && (
                        <span style={{ flexShrink: 0, minWidth: 18, height: 18, borderRadius: 9, background: '#DC2626', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
        {!selectedClient ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-dim)' }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p style={{ fontSize: 14, fontWeight: 500 }}>Select a client to start messaging</p>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--green)', color: '#FDFAF5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                {getInitials(selectedClient.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedClient.name}</p>
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {[selectedClient.event_type, selectedClient.event_date ? new Date(selectedClient.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null].filter(Boolean).join(' · ') || 'No event details'}
                </p>
              </div>
              <a
                href={`/portal/${selectedClient.portal_token}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--green)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--green-border)', borderRadius: 6, background: 'var(--green-bg)', whiteSpace: 'nowrap' }}
              >
                View Portal →
              </a>
            </div>

            {/* Backdrop to close message menu */}
            {openMsgMenu !== null && (
              <div onClick={() => { setOpenMsgMenu(null); setHoveredMsgId(null) }} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
            )}

            {/* Message thread */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loadingMsgs ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-dim)' }}>
                  <p style={{ fontSize: 14 }}>No messages yet. Send the first one!</p>
                </div>
              ) : (
                (() => {
                  const items: React.ReactNode[] = []
                  let lastDay = ''
                  messages.forEach(m => {
                    const day = new Date(m.created_at).toDateString()
                    if (day !== lastDay) {
                      lastDay = day
                      items.push(
                        <div key={`div-${m.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{dateDividerLabel(m.created_at)}</span>
                          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                        </div>
                      )
                    }
                    items.push(
                      <div
                        key={m.id}
                        onMouseEnter={() => { if (m.sender === 'photographer') setHoveredMsgId(m.id) }}
                        onMouseLeave={() => { if (openMsgMenu !== m.id) setHoveredMsgId(null) }}
                        style={{ display: 'flex', justifyContent: m.sender === 'photographer' ? 'flex-end' : 'flex-start' }}
                      >
                        {m.sender === 'photographer' ? (
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <button
                                onClick={() => setOpenMsgMenu(openMsgMenu === m.id ? null : m.id)}
                                style={{
                                  visibility: (hoveredMsgId === m.id || openMsgMenu === m.id) && deletingMsg !== m.id ? 'visible' : 'hidden',
                                  background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
                                  padding: '2px 7px', cursor: 'pointer', fontSize: 16, color: 'var(--text-dim)', lineHeight: 1,
                                }}
                              >⋯</button>
                              {openMsgMenu === m.id && (
                                <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 10, minWidth: 140, overflow: 'hidden' }}>
                                  {(new Date().getTime() - new Date(m.created_at).getTime()) < 5 * 60 * 1000 && (
                                    <button
                                      onClick={() => handleStartEdit(m)}
                                      style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
                                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                      Edit
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteMsg(m.id)}
                                    style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: '#DC2626', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                                    Delete message
                                  </button>
                                </div>
                              )}
                            </div>
                            <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: '14px 4px 14px 14px', background: 'var(--green)', color: '#FDFAF5', boxShadow: 'var(--shadow-sm)', opacity: deletingMsg === m.id ? 0.5 : 1 }}>
                              {editingMsgId === m.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <textarea
                                    value={editMsgContent}
                                    onChange={e => setEditMsgContent(e.target.value)}
                                    rows={2}
                                    style={{ fontSize: 14, lineHeight: 1.5, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, color: '#FDFAF5', padding: '4px 8px', resize: 'none', width: '100%' }}
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(m.id) } if (e.key === 'Escape') setEditingMsgId(null) }}
                                  />
                                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                    <button onClick={() => setEditingMsgId(null)} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#FDFAF5', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={() => handleSaveEdit(m.id)} disabled={savingEdit} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 5, border: 'none', background: '#FDFAF5', color: 'var(--green)', fontWeight: 700, cursor: 'pointer' }}>{savingEdit ? '…' : 'Save'}</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                                  <p style={{ fontSize: 11, margin: '5px 0 0', opacity: 0.55 }}>
                                    {formatFull(m.created_at)}{m.read_at && <span> · Read</span>}
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: '4px 14px 14px 14px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
                            <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                            <p style={{ fontSize: 11, margin: '5px 0 0', opacity: 0.55 }}>{formatFull(m.created_at)}</p>
                          </div>
                        )}
                      </div>
                    )
                  })
                  return items
                })()
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <textarea
                    ref={textareaRef}
                    className="input"
                    placeholder="Write a message…"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    rows={1}
                    style={{ resize: 'none', paddingRight: 12, lineHeight: 1.5, minHeight: 40, maxHeight: 120 }}
                  />
                  <span style={{ position: 'absolute', right: 10, bottom: 8, fontSize: 11, color: content.length > 900 ? '#DC2626' : 'var(--text-faint)' }}>{content.length}/1000</span>
                </div>
                {/* AI Suggest */}
                <button
                  onClick={handleAiSuggest}
                  disabled={aiLoading}
                  title="AI message suggestion"
                  style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 8, border: '1px solid var(--gold-border)', background: 'var(--gold-bg)', color: 'var(--gold-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-bg-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--gold-bg)' }}
                >
                  {aiLoading
                    ? <span className="spinner-sm" style={{ borderColor: 'rgba(201,168,76,0.3)', borderTopColor: 'var(--gold)' }} />
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  }
                </button>
                {/* Send */}
                <button
                  onClick={handleSend}
                  disabled={sending || !content.trim()}
                  className="btn btn-primary"
                  style={{ flexShrink: 0, width: 40, height: 40, padding: 0, borderRadius: 8 }}
                >
                  {sending
                    ? <span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  }
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>Enter to send · Shift+Enter for new line · ✦ for AI suggestion</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
