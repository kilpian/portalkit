import { useEffect, useState } from 'react'
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
  contracts: Contract[]
  invoices: Invoice[]
  files: PortalFile[]
}

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }
  catch { return d }
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

// ── Skeleton ──────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="skeleton" style={{ height: 18, width: '40%', marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
      <div className="skeleton" style={{ height: 14, width: '55%' }} />
    </div>
  )
}

// ── Section cards ─────────────────────────────────────────────
function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
      }}>
        <span style={{ color: 'var(--gold)' }}>{icon}</span>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          {title}
        </h2>
      </div>
      <div style={{ padding: '16px 20px' }}>
        {children}
      </div>
    </div>
  )
}

function EmptySection({ message }: { message: string }) {
  return <p style={{ fontSize: 14, color: 'var(--text-dim)', textAlign: 'center', padding: '12px 0' }}>{message}</p>
}

// ── Main ──────────────────────────────────────────────────────
export default function ClientPortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setError('Invalid portal link.'); setLoading(false); return }
    axios.get<PortalData>(`/api/portals/${token}`)
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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            Portal not found
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const businessName = data.photographer_business || data.photographer_name

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
      {/* Top bar */}
      <header style={{
        background: '#1B4332',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#FDFAF5' }}>
          {businessName}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          Powered by Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
        </span>
      </header>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '36px 20px 60px' }}>
        {/* Hero */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(26px, 5vw, 34px)',
            fontWeight: 800,
            color: 'var(--green)',
            letterSpacing: '-0.03em',
            marginBottom: 6,
          }}>
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
          <SectionCard
            title="Contracts"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            }
          >
            {data.contracts.length === 0
              ? <EmptySection message="No contracts yet — your photographer will share them here." />
              : data.contracts.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</p>
                    {c.signed_at && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Signed {formatDate(c.signed_at)}</p>}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99,
                    background: c.status === 'signed' ? 'var(--color-green-bg)' : 'var(--gold-bg)',
                    color: c.status === 'signed' ? 'var(--color-green)' : 'var(--gold-dim)',
                    border: `1px solid ${c.status === 'signed' ? 'var(--color-green-border)' : 'var(--gold-border)'}`,
                  }}>
                    {c.status === 'signed' ? 'Signed' : 'Awaiting signature'}
                  </span>
                </div>
              ))
            }
          </SectionCard>

          {/* Invoices */}
          <SectionCard
            title="Invoice"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2"/>
                <line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
            }
          >
            {data.invoices.length === 0
              ? <EmptySection message="No invoices yet — your photographer will share them here." />
              : data.invoices.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {inv.invoice_number ? `Invoice #${inv.invoice_number}` : 'Invoice'}
                    </p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>{formatCents(inv.amount_cents)}</p>
                    {inv.due_date && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Due {formatDate(inv.due_date)}</p>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99,
                      background: inv.status === 'paid' ? 'var(--color-green-bg)' : 'var(--color-yellow-bg)',
                      color: inv.status === 'paid' ? 'var(--color-green)' : 'var(--color-yellow)',
                      border: `1px solid ${inv.status === 'paid' ? 'var(--color-green-border)' : 'var(--color-yellow-border)'}`,
                    }}>
                      {inv.status === 'paid' ? 'Paid' : 'Unpaid'}
                    </span>
                    {inv.status !== 'paid' && (
                      <button className="btn btn-primary btn-sm">Pay Now</button>
                    )}
                  </div>
                </div>
              ))
            }
          </SectionCard>

          {/* Files */}
          <SectionCard
            title="Files & Galleries"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            }
          >
            {data.files.length === 0
              ? <EmptySection message="No files shared yet — your photographer will upload them here." />
              : data.files.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.original_name}
                    </p>
                    {f.size_bytes && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{formatBytes(f.size_bytes)}</p>}
                  </div>
                  {f.storage_url && (
                    <a
                      href={f.storage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      style={{ flexShrink: 0 }}
                    >
                      Download
                    </a>
                  )}
                </div>
              ))
            }
          </SectionCard>

          {/* Messages — placeholder */}
          <SectionCard
            title="Messages"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            }
          >
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 4 }}>Messaging coming soon</p>
              <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>Contact your photographer directly in the meantime.</p>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
