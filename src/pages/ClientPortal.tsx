import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'

interface Contract {
  id: number
  title: string
  status: string
  content: string | null
  signed_at: string | null
  signed_by_name: string | null
  content_hash: string | null
  photographer_signed_at: string | null
  photographer_signature: string | null
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
  mime_type: string | null
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
    axios.get<PortalMessage[]>(`${API_URL}/api/portals/${token}/messages`)
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
      const res = await axios.post<PortalMessage>(`${API_URL}/api/portals/${token}/messages`, {
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
  const [signAgreed, setSignAgreed] = useState<Record<number, boolean>>({})
  const [signerNames, setSignerNames] = useState<Record<number, string>>({})
  const [signing, setSigning] = useState<number | null>(null)
  const [signedContracts, setSignedContracts] = useState<Record<number, { name: string; date: string; hash: string | null; content: string | null }>>({})

  const handleSign = async (contract: Contract) => {
    const name = signerNames[contract.id]?.trim()
    if (!name) return
    setSigning(contract.id)
    try {
      const res = await axios.post(`${API_URL}/api/portals/${token}/contracts/${contract.id}/sign`, { signer_name: name })
      const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      setSignedContracts(prev => ({ ...prev, [contract.id]: { name, date, hash: res.data.content_hash ?? null, content: contract.content } }))
    } catch {
      // silently fail — user can retry
    } finally {
      setSigning(null)
    }
  }

  const downloadContract = (c: Contract, opts: { signerName: string; signedDate: string; content: string | null; hash: string | null }) => {
    const eventDate = data?.event_date
      ? new Date(data.event_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : ''
    const photographerName = data?.photographer_business || data?.photographer_name || 'PortalKit'

    const html = `<html><head><title>${c.title}</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #333; line-height: 1.6; }
      h1 { color: #1B4332; border-bottom: 2px solid #1B4332; padding-bottom: 10px; font-size: 22px; }
      .meta { background: #f5f5f5; padding: 16px; border-radius: 6px; margin-bottom: 24px; font-size: 13px; }
      .contract-body { font-size: 14px; white-space: pre-wrap; }
      .signatures { margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
      .sig-block p { margin: 4px 0; font-size: 13px; }
      .sig-line { border-bottom: 1px solid #333; margin: 24px 0 6px; }
      .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center; }
      .badge { background: #EAF3DE; color: #1B4332; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-bottom: 16px; }
    </style></head>
    <body>
      <h1>${c.title}</h1>
      <span class="badge">✓ Electronically Signed</span>
      <div class="meta">
        <strong>Client:</strong> ${data?.name ?? ''}<br>
        <strong>Event:</strong> ${data?.event_type || 'Photography Session'} · ${eventDate}<br>
        <strong>Photographer:</strong> ${photographerName}
      </div>
      <div class="contract-body">${opts.content ?? ''}</div>
      <div class="signatures">
        <div class="sig-block">
          <p><strong>PHOTOGRAPHER</strong></p>
          <p>${photographerName}</p>
          <div class="sig-line"></div>
          <p>Signature</p>
          <div class="sig-line"></div>
          <p>Date: ${c.photographer_signed_at ? new Date(c.photographer_signed_at).toLocaleDateString() : '________________'}</p>
        </div>
        <div class="sig-block">
          <p><strong>CLIENT</strong></p>
          <p>${opts.signerName}</p>
          <div class="sig-line"></div>
          <p>Signature: ${opts.signerName} (Electronic)</p>
          <div class="sig-line"></div>
          <p>Date: ${opts.signedDate}</p>
        </div>
      </div>
      <div class="footer">
        ${opts.hash ? `Reference: ${opts.hash.slice(-8).toUpperCase()} · ` : ''}Signed via PortalKit (ESIGN Act compliant) · ${photographerName}
      </div>
    </body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  useEffect(() => {
    if (!token) { setError('Invalid portal link.'); setLoading(false); return }
    axios.get<PortalData>(`${API_URL}/api/portals/${token}`)
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
              : data.contracts.map(c => {
                const justSigned = signedContracts[c.id]
                const isSigned = c.status === 'signed' || c.status === 'fully_signed' || !!justSigned
                const signerName = justSigned?.name || c.signed_by_name
                const signedDate = justSigned?.date || (c.signed_at ? formatDate(c.signed_at) : null)
                const isFullyExecuted = c.status === 'fully_signed' || (!!justSigned && !!c.photographer_signed_at)

                const contractContent = justSigned?.content ?? c.content
                const contractHash = justSigned?.hash ?? c.content_hash

                if (isSigned) {
                  return (
                    <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</p>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99, background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)', flexShrink: 0, marginLeft: 8 }}>
                          {isFullyExecuted ? '✓ Fully Executed' : '✓ You Signed'}
                        </span>
                      </div>
                      {(signerName || signedDate) && (
                        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
                          {signerName && `Signed by ${signerName}`}{signerName && signedDate && ' · '}{signedDate}
                        </p>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                        <p style={{ fontSize: 12, color: 'var(--color-green)', fontWeight: 500 }}>✓ You have signed this contract</p>
                        {isFullyExecuted
                          ? <p style={{ fontSize: 12, color: 'var(--color-green)', fontWeight: 500 }}>✓ Contract fully executed by both parties</p>
                          : <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>⏳ Awaiting photographer countersignature</p>
                        }
                      </div>
                      {contractContent && (
                        <div style={{ maxHeight: 240, overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px', fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: 10, fontFamily: 'monospace' }}>
                          {contractContent}
                        </div>
                      )}
                      <button
                        onClick={() => downloadContract(c, { signerName: signerName ?? '', signedDate: signedDate ?? '', content: contractContent, hash: contractHash })}
                        style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, background: 'none', border: '1px solid var(--green)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer' }}
                      >
                        Download PDF
                      </button>
                    </div>
                  )
                }

                return (
                  <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>{c.title}</p>
                    {c.content && (
                      <div style={{ maxHeight: 300, overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '14px 16px', fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: 14, fontFamily: 'monospace' }}>
                        {c.content}
                      </div>
                    )}
                    <div style={{ background: '#EAF3DE', padding: '12px 16px', borderRadius: 8, marginBottom: 16 }}>
                      <p style={{ fontSize: 14, color: '#1B4332', fontWeight: 600, margin: '0 0 4px' }}>✍️ Client Signature Required</p>
                      <p style={{ fontSize: 13, color: '#374151', margin: 0, lineHeight: 1.5 }}>
                        Please read the contract above and sign below to confirm your agreement.
                        This is your legal signature as the client.
                      </p>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                      <input
                        type="checkbox"
                        checked={!!signAgreed[c.id]}
                        onChange={e => setSignAgreed(prev => ({ ...prev, [c.id]: e.target.checked }))}
                        style={{ marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
                      />
                      I have read and agree to this contract
                    </label>
                    <input
                      className="input"
                      type="text"
                      placeholder="Type your full name to sign"
                      value={signerNames[c.id] ?? ''}
                      onChange={e => setSignerNames(prev => ({ ...prev, [c.id]: e.target.value }))}
                      style={{ marginBottom: 10, fontSize: 14 }}
                    />
                    <button
                      onClick={() => handleSign(c)}
                      disabled={!signAgreed[c.id] || !signerNames[c.id]?.trim() || signing === c.id}
                      className="btn btn-primary"
                      style={{ width: '100%', marginBottom: 8 }}
                    >
                      {signing === c.id ? 'Signing…' : 'Sign Contract'}
                    </button>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
                      By clicking Sign Contract, you agree this constitutes your legal signature under the ESIGN Act.
                    </p>
                  </div>
                )
              })
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
              : (() => {
                  const imageFiles = data.files.filter(f => f.mime_type?.startsWith('image/'))
                  const otherFiles = data.files.filter(f => !f.mime_type?.startsWith('image/'))
                  return (
                    <>
                      {imageFiles.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: otherFiles.length > 0 ? 16 : 0 }}>
                          {imageFiles.map(f => (
                            <a key={f.id} href={f.storage_url ?? '#'} target="_blank" rel="noopener noreferrer" style={{ display: 'block', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-secondary)', textDecoration: 'none' }}>
                              <img src={f.storage_url ?? ''} alt={f.original_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                      {otherFiles.map(f => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>
                              {f.mime_type === 'application/pdf' ? '📄' : f.mime_type?.startsWith('video/') ? '🎬' : '📎'}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</p>
                              {f.size_bytes && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{formatBytes(f.size_bytes)}</p>}
                            </div>
                          </div>
                          {f.storage_url && (
                            <a href={f.storage_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>Download</a>
                          )}
                        </div>
                      ))}
                    </>
                  )
                })()
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

        <div style={{ textAlign: 'center', marginTop: 32, paddingTop: 24, borderTop: '1px solid #E8E0D0' }}>
          <div style={{ marginBottom: 12 }}>
            <a href="https://getportalkit.com/privacy" target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 12, color: '#6B7280', marginRight: 16, textDecoration: 'none' }}>Privacy Policy</a>
            <a href="https://getportalkit.com/terms" target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 12, color: '#6B7280', textDecoration: 'none' }}>Terms of Service</a>
          </div>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
            This portal is private and secure. Powered by{' '}
            <a href="https://getportalkit.com" target="_blank" rel="noopener noreferrer"
               style={{ color: '#1B4332', fontWeight: 600, textDecoration: 'none' }}>PortalKit</a>
          </p>
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
