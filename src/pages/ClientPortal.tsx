import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import posthog from 'posthog-js'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string)
  : null

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
  secondary_name: string | null
  event_date: string | null
  event_type: string | null
  portal_token: string
  gallery_url: string | null
  photographer_name: string
  photographer_business: string | null
  photographer_logo: string | null
  photographer_brand_color: string | null
  payments_enabled?: boolean
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
      })
      setMessages(prev => [...prev, res.data])
      posthog.capture('client_sent_message')
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

// ── Invoice Payment ───────────────────────────────────────────
function PaymentForm({ invoiceId, token, amount, onPaid, onCancel }: {
  invoiceId: number; token: string; amount: number; onPaid: () => void; onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const handlePay = async () => {
    if (!stripe || !elements) return
    const card = elements.getElement(CardElement)
    if (!card) return
    setProcessing(true)
    setError('')
    try {
      const res = await axios.post(`${API_URL}/api/portals/${token}/invoices/${invoiceId}/pay`)
      const { error: confirmError } = await stripe.confirmCardPayment(res.data.clientSecret, {
        payment_method: { card },
      })
      if (confirmError) {
        setError(confirmError.message || 'Payment failed')
      } else {
        onPaid()
      }
    } catch {
      setError('Payment failed. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginTop: 10, background: 'var(--bg-secondary)' }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Enter card details</p>
      <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', background: '#fff', marginBottom: 10 }}>
        <CardElement options={{ style: { base: { fontSize: '14px', color: '#2D2416', '::placeholder': { color: '#9CA3AF' } } } }} />
      </div>
      {error && <p style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, fontSize: 13, fontWeight: 500, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}>Cancel</button>
        <button
          onClick={handlePay}
          disabled={processing || !stripe}
          className="btn btn-primary btn-sm"
          style={{ flex: 2 }}
        >
          {processing ? 'Processing…' : `Pay ${formatCents(amount)}`}
        </button>
      </div>
    </div>
  )
}

function InvoicePayment({ invoiceId, token, amount, onPaid }: {
  invoiceId: number; token: string; amount: number; onPaid: () => void
}) {
  const [open, setOpen] = useState(false)
  if (!stripePromise) return null
  if (!open) {
    return (
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Pay Now</button>
    )
  }
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm
        invoiceId={invoiceId}
        token={token}
        amount={amount}
        onPaid={() => { setOpen(false); onPaid() }}
        onCancel={() => setOpen(false)}
      />
    </Elements>
  )
}

// ── Questionnaires ────────────────────────────────────────────
interface PortalQuestionnaire {
  id: number
  title: string
  questions: { id: string; type: string; label: string; required: boolean; options?: string[] }[]
  responses: Record<string, string>
  status: 'pending' | 'completed'
  completed_at: string | null
}

function PortalQuestionnaires({ token }: { token: string }) {
  const [questionnaires, setQuestionnaires] = useState<PortalQuestionnaire[]>([])
  const [answers, setAnswers] = useState<Record<number, Record<string, string>>>({})
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({})

  useEffect(() => {
    axios.get(`${API_URL}/api/portals/${token}/questionnaires`)
      .then(r => setQuestionnaires(r.data))
      .catch(() => {})
  }, [token])

  if (questionnaires.length === 0) return null

  const handleSubmit = async (q: PortalQuestionnaire) => {
    const qAnswers = answers[q.id] || {}
    const missing = q.questions.filter(qu => qu.required && !qAnswers[qu.id])
    if (missing.length > 0) { alert(`Please answer: ${missing.map(m => m.label).join(', ')}`) ; return }
    setSubmitting(q.id)
    try {
      await axios.post(`${API_URL}/api/portals/${token}/questionnaires/${q.id}/respond`, { responses: qAnswers })
      setSubmitted(prev => ({ ...prev, [q.id]: true }))
      setQuestionnaires(prev => prev.map(item => item.id === q.id ? { ...item, status: 'completed', responses: qAnswers } : item))
      posthog.capture('client_completed_questionnaire')
    } catch {} finally {
      setSubmitting(null)
    }
  }

  return (
    <SectionCard title="Questionnaires" icon={
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {questionnaires.map(q => {
          const isComplete = q.status === 'completed' || submitted[q.id]
          const qAnswers = answers[q.id] || {}
          return (
            <div key={q.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{q.title}</p>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99,
                  background: isComplete ? 'var(--color-green-bg)' : 'var(--color-yellow-bg)',
                  color: isComplete ? 'var(--color-green)' : 'var(--color-yellow)',
                  border: `1px solid ${isComplete ? 'var(--color-green-border)' : 'var(--color-yellow-border)'}`,
                }}>
                  {isComplete ? '✓ Completed' : 'Pending'}
                </span>
              </div>

              {isComplete ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {q.questions.map(qu => (
                    <div key={qu.id}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', margin: '0 0 2px' }}>{qu.label}</p>
                      <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>{q.responses[qu.id] || '—'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {q.questions.map(qu => (
                    <div key={qu.id}>
                      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>
                        {qu.label}{qu.required && <span style={{ color: 'var(--color-red)', marginLeft: 2 }}>*</span>}
                      </label>
                      {qu.type === 'textarea' ? (
                        <textarea
                          className="input"
                          rows={3}
                          style={{ resize: 'vertical', fontSize: 14 }}
                          value={qAnswers[qu.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], [qu.id]: e.target.value } }))}
                        />
                      ) : qu.type === 'select' ? (
                        <select
                          className="input"
                          value={qAnswers[qu.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], [qu.id]: e.target.value } }))}
                          style={{ fontSize: 14 }}
                        >
                          <option value="">Select...</option>
                          {(qu.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : qu.type === 'radio' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(qu.options || []).map(opt => (
                            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                              <input
                                type="radio"
                                name={`q${q.id}_${qu.id}`}
                                value={opt}
                                checked={qAnswers[qu.id] === opt}
                                onChange={() => setAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], [qu.id]: opt } }))}
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      ) : qu.type === 'date' ? (
                        <input
                          type="date"
                          className="input"
                          value={qAnswers[qu.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], [qu.id]: e.target.value } }))}
                          style={{ fontSize: 14 }}
                        />
                      ) : (
                        <input
                          type="text"
                          className="input"
                          value={qAnswers[qu.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [q.id]: { ...prev[q.id], [qu.id]: e.target.value } }))}
                          style={{ fontSize: 14 }}
                        />
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => handleSubmit(q)}
                    disabled={submitting === q.id}
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {submitting === q.id ? 'Submitting…' : 'Submit Questionnaire'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ── Shot List ─────────────────────────────────────────────────
interface ShotItemPortal { id: string; category: string; description: string; priority: string; confirmed: boolean }
interface ShotListPortal { id: number; shots: ShotItemPortal[]; client_notes: string | null; photographer_notes: string | null; status: string }

function PortalShotList({ token }: { token: string }) {
  const [shotList, setShotList] = useState<ShotListPortal | null>(null)
  const [clientNotes, setClientNotes] = useState('')
  const [customShots, setCustomShots] = useState<ShotItemPortal[]>([])
  const [newShot, setNewShot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    axios.get<ShotListPortal>(`${API_URL}/api/portals/${token}/shot-list`)
      .then(r => { if (r.data) setShotList(r.data) })
      .catch(() => {})
  }, [token])

  if (!shotList) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const allShots = [...(shotList.shots || []), ...customShots]
      await axios.post(`${API_URL}/api/portals/${token}/shot-list`, { shots: allShots, client_notes: clientNotes })
      setSubmitted(true)
    } catch {} finally { setSubmitting(false) }
  }

  const addCustomShot = () => {
    if (!newShot.trim()) return
    setCustomShots(prev => [...prev, { id: crypto.randomUUID(), category: 'Custom', description: newShot.trim(), priority: 'must_have', confirmed: false }])
    setNewShot('')
  }

  if (shotList.status === 'confirmed') {
    return (
      <SectionCard title="Shot List" icon={<span>📷</span>}>
        <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1B4332', margin: 0 }}>✓ Shot list confirmed by your photographer!</p>
        </div>
        {shotList.shots.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(shotList.shots.reduce<Record<string, ShotItemPortal[]>>((acc, s) => { (acc[s.category] = acc[s.category] || []).push(s); return acc }, {})).map(([cat, shots]) => (
              <div key={cat}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{cat}</p>
                {shots.map(s => <p key={s.id} style={{ fontSize: 13, color: 'var(--text-primary)', padding: '4px 0' }}>• {s.description}</p>)}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    )
  }

  if (submitted || shotList.status === 'submitted') {
    return (
      <SectionCard title="Shot List" icon={<span>📷</span>}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Your shot list has been submitted and is awaiting confirmation from your photographer.</p>
      </SectionCard>
    )
  }

  const grouped = (shotList.shots || []).reduce<Record<string, ShotItemPortal[]>>((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s); return acc
  }, {})

  return (
    <SectionCard title="Shot List" icon={<span>📷</span>}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Review and customize your shot list, then add any special requests.</p>
      {Object.entries(grouped).map(([cat, shots]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>{cat}</p>
          {shots.map(s => (
            <div key={s.id} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13, color: 'var(--text-primary)', alignItems: 'flex-start' }}>
              <span>{s.priority === 'must_have' ? '★' : '☆'}</span>
              <span>{s.description}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Add a special shot request</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="Describe your shot..." value={newShot} onChange={e => setNewShot(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustomShot()} style={{ flex: 1 }} />
          <button onClick={addCustomShot} className="btn btn-ghost btn-sm">Add</button>
        </div>
        {customShots.map(s => <p key={s.id} style={{ fontSize: 13, color: 'var(--text-primary)', padding: '3px 0' }}>+ {s.description}</p>)}
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Any notes for your photographer?</label>
          <textarea className="input" rows={3} value={clientNotes} onChange={e => setClientNotes(e.target.value)} placeholder="Special requests, family groupings, important moments..." style={{ resize: 'vertical' }} />
        </div>
        <button onClick={handleSubmit} disabled={submitting} className="btn btn-primary" style={{ marginTop: 12, width: '100%' }}>
          {submitting ? 'Submitting…' : 'Submit Shot List'}
        </button>
      </div>
    </SectionCard>
  )
}

// ── Vendors ───────────────────────────────────────────────────
interface VendorPortal { id: number; category: string; name: string; contact_name: string | null; phone: string | null; email: string | null; website: string | null; notes: string | null }

const VENDOR_ICONS: Record<string, string> = { venue: '🏛️', florist: '💐', caterer: '🍽️', dj: '🎧', band: '🎸', officiant: '💍', videographer: '🎬', hair: '💇', makeup: '💄', planner: '📋', transportation: '🚗', cake: '🎂', photo: '📸' }

function PortalVendors({ token }: { token: string }) {
  const [vendors, setVendors] = useState<VendorPortal[]>([])

  useEffect(() => {
    axios.get<VendorPortal[]>(`${API_URL}/api/portals/${token}/vendors`)
      .then(r => setVendors(r.data))
      .catch(() => {})
  }, [token])

  if (!vendors.length) return null

  const grouped = vendors.reduce<Record<string, VendorPortal[]>>((acc, v) => {
    (acc[v.category] = acc[v.category] || []).push(v); return acc
  }, {})

  return (
    <SectionCard title="Vendor Contact Sheet" icon={<span>📇</span>}>
      {Object.entries(grouped).map(([cat, vends]) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            {VENDOR_ICONS[cat.toLowerCase()] || '📌'} {cat}
          </p>
          {vends.map(v => (
            <div key={v.id} style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 8 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>{v.name}</p>
              {v.contact_name && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0' }}>Contact: {v.contact_name}</p>}
              {v.phone && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0' }}><a href={`tel:${v.phone}`} style={{ color: 'var(--green)' }}>{v.phone}</a></p>}
              {v.email && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0' }}><a href={`mailto:${v.email}`} style={{ color: 'var(--green)' }}>{v.email}</a></p>}
              {v.website && <p style={{ fontSize: 13, margin: '2px 0' }}><a href={v.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Website →</a></p>}
            </div>
          ))}
        </div>
      ))}
    </SectionCard>
  )
}

// ── Timeline ──────────────────────────────────────────────────
interface TimelineItemPortal { id: string; time: string; duration_minutes: number; title: string; location: string | null; notes: string | null; category: string }
interface TimelinePortal { id: number; title: string; items: TimelineItemPortal[]; status: string; client_approved_at: string | null }

function PortalTimeline({ token }: { token: string }) {
  const [timeline, setTimeline] = useState<TimelinePortal | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  useEffect(() => {
    axios.get<TimelinePortal>(`${API_URL}/api/portals/${token}/timeline`)
      .then(r => { if (r.data) setTimeline(r.data) })
      .catch(() => {})
  }, [token])

  if (!timeline) return null

  const handleApprove = async () => {
    setApproving(true)
    try {
      await axios.post(`${API_URL}/api/portals/${token}/timeline/approve`)
      setApproved(true)
      setTimeline(prev => prev ? { ...prev, status: 'approved' } : prev)
    } catch {} finally { setApproving(false) }
  }

  const isApproved = approved || timeline.status === 'approved'

  return (
    <SectionCard title={timeline.title || 'Day-of Timeline'} icon={<span>🗓️</span>}>
      {isApproved && (
        <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1B4332', margin: 0 }}>✓ You approved this timeline</p>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {timeline.items.map(item => (
          <div key={item.id} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ minWidth: 70, textAlign: 'right' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', margin: 0 }}>{item.time}</p>
              {item.duration_minutes > 0 && <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>{item.duration_minutes}m</p>}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px' }}>{item.title}</p>
              {item.location && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0' }}>📍 {item.location}</p>}
              {item.notes && <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0' }}>{item.notes}</p>}
            </div>
          </div>
        ))}
      </div>
      {!isApproved && (
        <button onClick={handleApprove} disabled={approving} className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}>
          {approving ? 'Approving…' : 'Approve Timeline'}
        </button>
      )}
    </SectionCard>
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
  const [lightboxFile, setLightboxFile] = useState<PortalFile | null>(null)
  const [paidInvoices, setPaidInvoices] = useState<Record<number, boolean>>({})

  const handleSign = async (contract: Contract) => {
    const name = signerNames[contract.id]?.trim()
    if (!name) return
    setSigning(contract.id)
    try {
      const res = await axios.post(`${API_URL}/api/portals/${token}/contracts/${contract.id}/sign`, { signer_name: name })
      const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      setSignedContracts(prev => ({ ...prev, [contract.id]: { name, date, hash: res.data.content_hash ?? null, content: contract.content } }))
      posthog.capture('client_signed_contract')
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
      .then(r => {
        setData(r.data)
        setLoading(false)
        posthog.capture('client_portal_viewed', {
          has_contract: r.data.contracts.length > 0,
          has_invoice: r.data.invoices.length > 0,
        })
      })
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
            Welcome, {data.name}{data.secondary_name ? ` & ${data.secondary_name}` : ''}!
          </h1>
          {(data.event_type || data.event_date) && (
            <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>
              {data.event_type && <span>{data.event_type}</span>}
              {data.event_type && data.event_date && <span> · </span>}
              {data.event_date && <span>{formatDate(data.event_date)}</span>}
            </p>
          )}
          {data.gallery_url && (
            <a
              href={data.gallery_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14,
                padding: '12px 22px', borderRadius: 10,
                background: data.photographer_brand_color || '#1B4332',
                color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 15,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
            >
              📸 View Your Photo Gallery →
            </a>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99, background: (inv.status === 'paid' || paidInvoices[inv.id]) ? 'var(--color-green-bg)' : 'var(--color-yellow-bg)', color: (inv.status === 'paid' || paidInvoices[inv.id]) ? 'var(--color-green)' : 'var(--color-yellow)', border: `1px solid ${(inv.status === 'paid' || paidInvoices[inv.id]) ? 'var(--color-green-border)' : 'var(--color-yellow-border)'}` }}>
                      {(inv.status === 'paid' || paidInvoices[inv.id]) ? 'Paid' : 'Unpaid'}
                    </span>
                    {inv.status !== 'paid' && !paidInvoices[inv.id] && data?.payments_enabled && (
                      <InvoicePayment
                        invoiceId={inv.id}
                        token={token}
                        amount={inv.amount_cents}
                        onPaid={() => setPaidInvoices(prev => ({ ...prev, [inv.id]: true }))}
                      />
                    )}
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
                            <div key={f.id} onClick={() => setLightboxFile(f)} style={{ display: 'block', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                              <img src={f.storage_url ?? ''} alt={f.original_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                            </div>
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

          {/* Questionnaires */}
          <PortalQuestionnaires token={token} />

          {/* Shot List */}
          <PortalShotList token={token} />

          {/* Vendors */}
          <PortalVendors token={token} />

          {/* Timeline */}
          <PortalTimeline token={token} />

          {/* Messages */}
          <SectionCard title="Messages" icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          }>
            <PortalMessages token={token} />
          </SectionCard>
        </div>

        {/* Lightbox */}
        {lightboxFile && (
          <div
            onClick={() => setLightboxFile(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '92vh', position: 'relative' }}>
              <button
                onClick={() => setLightboxFile(null)}
                style={{ position: 'absolute', top: -40, right: 0, background: 'none', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}
              >✕</button>
              <img
                src={lightboxFile.storage_url ?? ''}
                alt={lightboxFile.original_name}
                style={{ maxWidth: '92vw', maxHeight: '82vh', borderRadius: 8, display: 'block', objectFit: 'contain' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 16 }}>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, margin: 0 }}>{lightboxFile.original_name}</p>
                <a
                  href={lightboxFile.storage_url ?? ''}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, background: 'rgba(255,255,255,0.15)', color: '#fff', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}
                >
                  Download
                </a>
              </div>
            </div>
          </div>
        )}

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
