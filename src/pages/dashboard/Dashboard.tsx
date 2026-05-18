import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi, type DashboardStats, type Client } from '../../lib/api'
import { trialDaysLeft } from '../../lib/plan'
import Onboarding from './Onboarding'

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 800, color: accent ? 'var(--gold)' : 'var(--green)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>{sub}</p>}
    </div>
  )
}

function CopyToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/portal/${token}`
  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <button onClick={handleCopy} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500,
      color: copied ? 'var(--color-green)' : 'var(--green)',
      background: copied ? 'var(--color-green-bg)' : 'var(--bg-secondary)',
      border: `1px solid ${copied ? 'var(--color-green-border)' : 'var(--border)'}`,
      borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {copied
        ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Copied</>
        : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy Link</>
      }
    </button>
  )
}

export default function Dashboard() {
  const { user: clerkUser } = useUser()
  const { user } = usePortalAuth()
  const { authFetch } = useApi()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  const [searchParams, setSearchParams] = useSearchParams()
  const paymentStatus = searchParams.get('payment')
  const [upgrading, setUpgrading] = useState(false)

  const days = trialDaysLeft(user)

  const firstName = clerkUser?.firstName || clerkUser?.fullName?.split(' ')[0] || ''

  useEffect(() => {
    if (paymentStatus) {
      const t = setTimeout(() => setSearchParams({}, { replace: true }), 10000)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentStatus])

  useEffect(() => {
    Promise.all([
      authFetch('/api/dashboard/stats', { method: 'get' }),
      authFetch('/api/clients', { method: 'get' }),
    ])
      .then(([sRes, cRes]) => {
        setStats(sRes.data)
        setClients(Array.isArray(cRes.data) ? cRes.data.slice(0, 5) : [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const createCheckout = async () => {
    setUpgrading(true)
    try {
      const res = await authFetch('/api/stripe/create-checkout-with-trial', { method: 'post' })
      window.location.href = res.data.url
    } catch {
      setUpgrading(false)
    }
  }

  const [onboardingDone, setOnboardingDone] = useState(false)
  const showOnboarding = !onboardingDone && !loading && !user?.business_name && (stats?.total_clients === 0)
  if (showOnboarding) return <Onboarding onComplete={() => setOnboardingDone(true)} />

  const [greenDismissed, setGreenDismissed] = useState(() => localStorage.getItem('trial-welcome-dismissed') === 'true')
  const dismissGreenBanner = () => { localStorage.setItem('trial-welcome-dismissed', 'true'); setGreenDismissed(true) }

  const trialExpired = user?.plan === 'trial' && days === 0
  const showGreenBanner = user?.plan === 'trial' && days > 3 && !greenDismissed
  const showRedBanner = user?.plan === 'trial' && days > 0 && days <= 3

  return (
    <>
      {trialExpired && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="card" style={{ padding: '48px 40px', textAlign: 'center', maxWidth: 440 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Your trial has ended</h2>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 28 }}>Your 14-day free trial has expired. Upgrade to continue accessing your client portals, contracts, and invoices.</p>
            <button onClick={createCheckout} disabled={upgrading} className="btn btn-primary" style={{ fontSize: 15, padding: '13px 28px' }}>
              {upgrading ? 'Loading…' : 'Upgrade — $39/mo'}
            </button>
          </div>
        </div>
      )}

      {showGreenBanner && (
        <div style={{ background: '#EAF3DE', borderBottom: '1px solid #C0DD97', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, color: '#1B4332', fontWeight: 600 }}>
            🎉 Your 14-day free trial is active. Add your payment method to keep access after your trial ends.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <button onClick={createCheckout} disabled={upgrading} style={{ fontSize: 13, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #C0DD97', background: 'transparent', color: '#1B4332', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {upgrading ? 'Loading…' : 'Add Payment Method →'}
            </button>
            <button onClick={dismissGreenBanner} style={{ fontSize: 12, background: 'transparent', border: 'none', color: '#1B4332', cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
        </div>
      )}

      {showRedBanner && (
        <div style={{ background: '#FCEBEB', borderBottom: '1px solid #FCA5A5', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, color: '#A32D2D', fontWeight: 600 }}>⚠️ Your trial expires in {days} day{days === 1 ? '' : 's'}. Add payment now to avoid losing access.</p>
          <button onClick={createCheckout} disabled={upgrading} style={{ fontSize: 13, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #FCA5A5', background: 'transparent', color: '#A32D2D', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {upgrading ? 'Loading…' : 'Add Card Now →'}
          </button>
        </div>
      )}

      {paymentStatus === 'success' && (
        <div style={{ background: '#EAF3DE', borderBottom: '1px solid #C0DD97', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, color: '#1B4332', fontWeight: 600 }}>
            🎉 You're all set! Your 14-day trial has started. You won't be charged until{' '}
            {new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
          </p>
          <button onClick={() => setSearchParams({}, { replace: true })} style={{ fontSize: 12, background: 'transparent', border: 'none', color: '#1B4332', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>
      )}

      {paymentStatus === 'cancelled' && (
        <div style={{ background: '#FFF9EC', borderBottom: '1px solid #F0D090', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, color: '#7A5E00', fontWeight: 600 }}>No worries — you can add your card anytime in Settings to keep access after your trial.</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <button onClick={createCheckout} disabled={upgrading} style={{ fontSize: 13, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #F0D090', background: 'transparent', color: '#7A5E00', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {upgrading ? 'Loading…' : 'Add Payment Method →'}
            </button>
            <button onClick={() => setSearchParams({}, { replace: true })} style={{ fontSize: 12, background: 'transparent', border: 'none', color: '#7A5E00', cursor: 'pointer' }}>✕</button>
          </div>
        </div>
      )}

      <div style={{ padding: '32px 32px 64px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 4 }}>
          {greeting()}{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Here's what's happening with your portals today.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
          {[0,1,2,3].map(i => (
            <div key={i} className="card" style={{ padding: '20px 24px' }}>
              <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 28, width: '40%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
          <StatCard label="Total Clients" value={stats?.total_clients ?? 0} />
          <StatCard label="Active Portals" value={stats?.active_portals ?? 0} />
          <StatCard label="Pending Invoices" value={stats?.pending_invoices ?? 0} />
          {user?.plan !== 'active' && (
            <StatCard label="Trial Days Left" value={days} sub={days === 0 ? 'Trial expired' : `day${days === 1 ? '' : 's'} remaining`} accent />
          )}
          {user?.plan === 'active' && (
            <StatCard label="Plan" value="Active" sub="Subscription active" />
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>Recent Clients</h2>
          <Link to="/dashboard/clients" style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, textDecoration: 'none' }}>View all →</Link>
        </div>

        {loading ? (
          <div style={{ padding: '16px 20px' }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="skeleton" style={{ height: 14, flex: 2 }} />
                <div className="skeleton" style={{ height: 14, flex: 1 }} />
                <div className="skeleton" style={{ height: 14, flex: 1 }} />
              </div>
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ margin: '0 auto 16px', display: 'block' }}>
              <rect x="4" y="14" width="48" height="34" rx="5" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5"/>
              <path d="M20 14l3-6h10l3 6" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="28" cy="31" r="9" fill="none" stroke="var(--green)" strokeWidth="1.5" opacity="0.4"/>
              <circle cx="28" cy="31" r="5" fill="var(--green)" opacity="0.2"/>
              <circle cx="40" cy="20" r="2" fill="var(--green)" opacity="0.5"/>
            </svg>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
              Welcome to PortalKit
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20 }}>
              Create your first client portal in 60 seconds.
            </p>
            <Link to="/dashboard/clients" className="btn btn-primary btn-sm">Add Your First Client</Link>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Client', 'Event', 'Portal Link', 'Added'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 20px' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</p>
                    {c.email && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{c.email}</p>}
                  </td>
                  <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-muted)' }}>
                    {c.event_type || '—'}
                    {c.event_date && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{formatDate(c.event_date)}</span>}
                  </td>
                  <td style={{ padding: '12px 20px' }}><CopyToken token={c.portal_token} /></td>
                  <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-dim)' }}>{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </>
  )
}
