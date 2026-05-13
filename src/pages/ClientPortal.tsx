import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

interface Contract {
  id: number
  title: string
  status: string
  signed_at: string | null
}

interface Invoice {
  id: number
  invoice_number: string | null
  amount_cents: number
  status: string
  due_date: string | null
}

interface PortalFile {
  id: number
  original_name: string
  size_bytes: number | null
  storage_url: string | null
  created_at: string
}

interface PortalData {
  id: number
  name: string
  event_date: string | null
  event_type: string | null
  photographer_name: string
  photographer_business: string | null
  photographer_logo: string | null
  photographer_brand_color: string | null
  contracts: Contract[]
  invoices: Invoice[]
  files: PortalFile[]
}

interface PortalMessage {
  id: number
  sender: 'photographer' | 'client'
  content: string
  read_at: string | null
  created_at: string
}

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function formatTime(d: string) {
  try { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="skeleton" style={{ height: 18, width: '40%', marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
      <div className="skeleton" style={{ height: 14, width: '55%' }} />
    </div>
  )
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <span style={{ color: 'var(--gold)' }}>{icon}</span>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{title}</h2>
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

function EmptySection({ message }: { message: string }) {
  return <p style={{ fontSize: 14, color: 'var(--text-dim)', textAlign: 'center', padding: '12px 0' }}>{message}</p>
}

// ── Messages Section ──────────────────────────────────────────
function PortalMessages({ token }: { token: string }) {
  const [messages, setMessages] = useState<PortalMessage[]>([])
  const [content, setContent] = useState('')
  const [senderName, setSenderName] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    axios.get<PortalMessage[]>(`http://localhost:3001/api/portals/${token}/messages`)
      .then(r => setMessages(r.data))
      .catch(() => {})
  }, [token])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!content.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await axios.post<PortalMessage>(`http://localhost:3001/api/portals/${token}/messages`, {
        content: content.trim(),
        sender_name: senderName.trim() || undefined,
      })
      setMessages(prev => [...prev, res.data])
      setContent('')
    } catch {
      setError('Failed to send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Thread */}
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16, padding: '4px 0' }}>
        {messages.length === 0 && (
          <p style={{ fontSize: 14, color: 'var(--text-dim)', textAlign: 'center', padding: '16px 0' }}>
            No messages yet. Send your photographer a message below.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.sender === 'photographer' ? 'flex-start' : 'flex-end' }}>
            <div style={{
              maxWidth: '78%',
              padding: '10px 14px',
              borderRadius: m.sender === 'photographer' ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
              background: m.sender === 'photographer' ? 'var(--bg-secondary)' : 'var(--green)',
              color: m.sender === 'photographer' ? 'var(--text-primary)' : '#FDFAF5',
              fontSize: 14,
              lineHeight: 1.5,
              border: m.sender === 'photographer' ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <p style={{ margin: 0 }}>{m.content}</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.6 }}>{formatTime(m.created_at)}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--color-red)', marginBottom: 10 }}>{error}</p>}

      {/* Composer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="input"
          type="text"
          placeholder="Your name (optional)"
          value={senderName}
          onChange={e => setSenderName(e.target.value)}
          style={{ fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            className="input"
            placeholder="Type a message..."
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            rows={2}
            style={{ resize: 'none', flex: 1 }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !content.trim()}
            className="btn btn-primary"
            style={{ alignSelf: 'flex-end', flexShrink: 0 }}
          >
            {sending ? '…' : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  )
}

// ── ClientPortalContent (exported for preview modal) ──────────
export function ClientPortalContent({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setError('Invalid portal link.'); setLoading(false); return }
    axios.get<PortalData>(`http://localhost:3001/api/portals/${token}`)
      .then(r => { setData(r.data); setLoading(false) })
      .catch(err => {
        setError(err?.response?.data?.error || 'This portal link is invalid or has expired.')
        setLoading(false)
      })
  }, [token])

  if (loading) {
    return (
      <div style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
          <div className="skeleton" style={{ height: 28, width: 220, marginBottom: 32 }} />
          <div className="skeleton" style={{ height: 80, marginBottom: 24 }} />
          <div style={{ display: 'grid', gap: 16 }}>
            {[0,1,2,3].map(i => <SkeletonCard key={i} />)}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ padding: '40px 32px', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>Portal not found</h1>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const businessName = data.photographer_business || data.photographer_name

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
      <header style={{ background: data.photographer_brand_color || '#1B4332', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {data.photographer_logo && (
            <img src={data.photographer_logo} alt={businessName} style={{ height: 32, maxWidth: 120, objectFit: 'contain' }} />
          )}
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#FDFAF5' }}>{businessName}</span>
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          Powered by Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
        </span>
      </header>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '36px 20px 60px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 6 }}>
            Welcome, {data.name}!
          </h1>
          {(data.event_type || data.event_date) && (
            <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>
              {data.event_type && <span>{data.event_type}</span>}
              {data.event_type && data.event_date && <span> · </span>}
              {data.event_date && <span>{formatDate(data.event_date)}</span>}
            </p>
          )}
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {/* Contracts */}
          <SectionCard title="Contracts" icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          }>
            {data.contracts.length === 0
              ? <EmptySection message="No contracts yet — your photographer will share them here." />
              : data.contracts.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</p>
                    {c.signed_at && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Signed {formatDate(c.signed_at)}</p>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99, background: c.status === 'signed' ? 'var(--color-green-bg)' : 'var(--gold-bg)', color: c.status === 'signed' ? 'var(--color-green)' : 'var(--gold-dim)', border: `1px solid ${c.status === 'signed' ? 'var(--color-green-border)' : 'var(--gold-border)'}` }}>
                    {c.status === 'signed' ? 'Signed' : 'Awaiting signature'}
                  </span>
                </div>
              ))
            }
          </SectionCard>

          {/* Invoices */}
          <SectionCard title="Invoices" icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          }>
            {data.invoices.length === 0
              ? <EmptySection message="No invoices yet — your photographer will share them here." />
              : data.invoices.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{inv.invoice_number ? `Invoice #${inv.invoice_number}` : 'Invoice'}</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>{formatCents(inv.amount_cents)}</p>
                    {inv.due_date && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Due {formatDate(inv.due_date)}</p>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99, background: inv.status === 'paid' ? 'var(--color-green-bg)' : 'var(--color-yellow-bg)', color: inv.status === 'paid' ? 'var(--color-green)' : 'var(--color-yellow)', border: `1px solid ${inv.status === 'paid' ? 'var(--color-green-border)' : 'var(--color-yellow-border)'}` }}>
                      {inv.status === 'paid' ? 'Paid' : 'Unpaid'}
                    </span>
                    {inv.status !== 'paid' && <button className="btn btn-primary btn-sm">Pay Now</button>}
                  </div>
                </div>
              ))
            }
          </SectionCard>

          {/* Files */}
          <SectionCard title="Files & Galleries" icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          }>
            {data.files.length === 0
              ? <EmptySection message="No files shared yet — your photographer will upload them here." />
              : data.files.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</p>
                    {f.size_bytes && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{formatBytes(f.size_bytes)}</p>}
                  </div>
                  {f.storage_url && (
                    <a href={f.storage_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>Download</a>
                  )}
                </div>
              ))
            }
          </SectionCard>

          {/* Messages */}
          <SectionCard title="Messages" icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          }>
            <PortalMessages token={token} />
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

// ── Default export wraps with useParams ───────────────────────
export default function ClientPortal() {
  const { token } = useParams<{ token: string }>()
  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <p style={{ color: 'var(--text-dim)' }}>Invalid portal link.</p>
    </div>
  )
  return <ClientPortalContent token={token} />
}
