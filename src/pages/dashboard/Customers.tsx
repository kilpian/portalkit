import { useEffect, useState, useCallback } from 'react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'

interface Customer {
  id: number
  email: string
  full_name?: string
  business_name?: string
  plan?: string
  billing_cycle?: string
  trial_ends_at?: string
  stripe_customer_id?: string
  stripe_subscription_id?: string
  onboarding_completed?: boolean
  created_at: string
  grace_period_ends_at?: string
}

interface Data {
  counts: { trialing: number; active: number; churned: number; trial_expired: number }
  trialing: Customer[]
  active: Customer[]
  churned: Customer[]
  trial_expired: Customer[]
}

const daysBetween = (from: string | undefined, to: string | Date) => {
  if (!from) return null
  const toMs = to instanceof Date ? to.getTime() : new Date(to).getTime()
  const ms = toMs - new Date(from).getTime()
  return Math.round(ms / 86400000)
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#F0FDF4', fg: '#14532D' },
    trial: { bg: '#FFFBEB', fg: '#92400E' },
    grace: { bg: '#FEF3C7', fg: '#92400E' },
    expired: { bg: '#FEE2E2', fg: '#991B1B' },
    canceled: { bg: '#F3F4F6', fg: '#374151' },
  }
  const c = colors[status?.toLowerCase()] || { bg: '#F3F4F6', fg: '#374151' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: c.bg, color: c.fg, textTransform: 'uppercase' as const
    }}>{status || '—'}</span>
  )
}

function Section({ title, accent, customers, hint, hintLabel }: { title: string; accent: string; customers: Customer[]; hint: (c: Customer) => string; hintLabel: string }) {
  const now = new Date()
  return (
    <div style={{ background: 'white', borderRadius: 10, marginBottom: 24, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', borderLeft: `4px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>{customers.length}</span>
      </div>
      {customers.length === 0 ? (
        <p style={{ padding: '20px', margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>No customers in this group.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' as const }}>Email / Name</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' as const }}>Plan</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' as const }}>{hintLabel}</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' as const }}>Signed up</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' as const }}>Stripe</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.email}</div>
                    {(c.full_name || c.business_name) && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.full_name}{c.full_name && c.business_name ? ' · ' : ''}{c.business_name}</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <StatusBadge status={c.plan || ''} />
                    {c.billing_cycle && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>{c.billing_cycle}</span>}
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{hint(c)}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleDateString()} <span style={{ fontSize: 11 }}>({daysBetween(c.created_at, now)}d ago)</span></td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    {c.stripe_customer_id ? (
                      <a
                        href={`https://dashboard.stripe.com/customers/${c.stripe_customer_id}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#635BFF', textDecoration: 'none', fontWeight: 600 }}
                      >
                        View →
                      </a>
                    ) : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Customers() {
  const { user } = usePortalAuth()
  const { authFetch } = useApi()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isAdmin = user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/admin/customers')
      setData(res.data)
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => { if (isAdmin) fetchData() }, [isAdmin, fetchData])

  // user is null until the async /api/auth/me fetch resolves — check that
  // before isAdmin, or this briefly renders "Admin access required" for the
  // real admin on every cold load, matching ContentEngine.tsx's guard order.
  if (!user) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
  }

  if (!isAdmin) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Admin access required.</div>
  }

  const now = new Date()
  const trialingHint = (c: Customer) => {
    const d = c.trial_ends_at ? daysBetween(new Date().toISOString(), c.trial_ends_at) : null
    return d != null ? `${d} days left` : '—'
  }
  const churnedHint = (c: Customer) => {
    if (c.grace_period_ends_at) {
      const days = daysBetween(new Date().toISOString(), c.grace_period_ends_at)
      return days != null && days > 0 ? `grace, ${days}d left` : 'grace expired'
    }
    return c.plan || 'canceled'
  }
  const activeHint = (c: Customer) => c.billing_cycle || 'monthly'
  const expiredHint = (c: Customer) => {
    const d = c.trial_ends_at ? daysBetween(c.trial_ends_at, now) : null
    return d != null && d > 0 ? `${d} days since trial ended` : 'never converted'
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 28px' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary)' }}>Customers</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Real data from the users table — no fabrication.</p>
        </div>
        <button
          onClick={fetchData}
          style={{ padding: '8px 16px', background: 'white', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {data && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <Stat label="Trialing" value={data.counts.trialing} color="#C9A84C" />
          <Stat label="Active" value={data.counts.active} color="#059669" />
          <Stat label="Churned" value={data.counts.churned} color="#DC2626" />
          <Stat label="Trial expired" value={data.counts.trial_expired} color="#6B7280" />
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {error && <p style={{ color: '#DC2626' }}>{error}</p>}

      {data && (
        <>
          <Section title="Trialing" accent="#C9A84C" customers={data.trialing} hint={trialingHint} hintLabel="Trial ends" />
          <Section title="Active" accent="#059669" customers={data.active} hint={activeHint} hintLabel="Cycle" />
          <Section title="Churned" accent="#DC2626" customers={data.churned} hint={churnedHint} hintLabel="State" />
          <Section title="Trial expired" accent="#6B7280" customers={data.trial_expired} hint={expiredHint} hintLabel="Since trial end" />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 160, padding: '14px 18px', background: 'white',
      border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${color}`,
      borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 4
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</span>
    </div>
  )
}
