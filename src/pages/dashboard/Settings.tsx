import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClerk } from '@clerk/clerk-react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'
import { trialDaysLeft } from '../../lib/plan'
import UpgradeModal from '../../components/UpgradeModal'

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{title}</h2>
      </div>
      <div style={{ padding: '24px' }}>{children}</div>
    </div>
  )
}

export default function Settings() {
  const { user, setUser, signOut } = usePortalAuth()
  const { openUserProfile } = useClerk()
  const { authFetch } = useApi()
  const [searchParams] = useSearchParams()

  // Profile
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [businessName, setBusinessName] = useState(user?.business_name ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')

  // Branding
  const [brandColor, setBrandColor] = useState(user?.brand_color ?? '#1B4332')
  const [logoUrl, setLogoUrl] = useState(user?.logo_url ?? '')
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [brandingMsg, setBrandingMsg] = useState('')
  const [brandingErr, setBrandingErr] = useState('')

  // Billing
  const [billingLoading, setBillingLoading] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  // Delete / exit survey
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteComment, setDeleteComment] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  // Stripe Connect
  const [connectStatus, setConnectStatus] = useState<{
    connected: boolean
    enabled: boolean
    charges_enabled?: boolean
    payouts_enabled?: boolean
    account_id?: string
  }>({ connected: false, enabled: false })
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectMsg, setConnectMsg] = useState('')

  const days = trialDaysLeft(user)
  const isActive = user?.plan === 'active'

  useEffect(() => {
    if (searchParams.get('upgraded') === 'true') {
      setProfileMsg('Subscription activated! Welcome to PortalKit.')
    }
  }, [searchParams])

  // Fetch Connect status on mount and handle return from Stripe onboarding
  useEffect(() => {
    authFetch('/api/stripe/connect/status', { method: 'get' })
      .then(res => setConnectStatus(res.data))
      .catch(() => {})

    const stripeConnect = new URLSearchParams(window.location.search).get('stripe_connect')
    if (stripeConnect === 'complete' || stripeConnect === 'refresh') {
      window.history.replaceState({}, '', '/dashboard/settings')
      if (stripeConnect === 'complete') {
        setTimeout(() => {
          authFetch('/api/stripe/connect/status', { method: 'get' }).then(res => {
            setConnectStatus(res.data)
            setConnectMsg(res.data.enabled
              ? '✓ Stripe connected! Clients can now pay invoices from their portal.'
              : 'Stripe onboarding started — complete verification to enable payments.'
            )
          }).catch(() => {})
        }, 2000)
      } else {
        // refresh = link expired, restart onboarding automatically
        handleConnectStripe()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep form in sync with user data once it loads
  useEffect(() => {
    if (user) {
      setFullName(user.full_name)
      setBusinessName(user.business_name ?? '')
      setBrandColor(user.brand_color ?? '#1B4332')
      setLogoUrl(user.logo_url ?? '')
    }
  }, [user])

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileErr(''); setProfileMsg('')
    if (!fullName.trim()) { setProfileErr('Name is required.'); return }
    setProfileSaving(true)
    try {
      const res = await authFetch('/api/users/me', { method: 'put', data: { full_name: fullName.trim(), business_name: businessName.trim() || undefined } })
      setUser(res.data)
      setProfileMsg('Profile saved.')
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { error?: string } } }
      setProfileErr(ae?.response?.data?.error || 'Failed to save profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) { setBrandingErr('Logo must be under 500 KB.'); return }
    setBrandingErr('')
    const reader = new FileReader()
    reader.onload = () => setLogoUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleBrandingSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setBrandingErr(''); setBrandingMsg('')
    setBrandingSaving(true)
    try {
      const res = await authFetch('/api/users/me', { method: 'put', data: { brand_color: brandColor, logo_url: logoUrl || null } })
      setUser(res.data)
      setBrandingMsg('Branding saved.')
    } catch {
      setBrandingErr('Failed to save branding.')
    } finally {
      setBrandingSaving(false)
    }
  }

  const handleUpgrade = () => setShowUpgradeModal(true)

  const handleManageBilling = async () => {
    setBillingLoading(true)
    try {
      const res = await authFetch('/api/stripe/create-portal', { method: 'post' })
      window.location.href = res.data.url
    } catch {
      setBillingLoading(false)
    }
  }

  const handleConnectStripe = async () => {
    setConnectLoading(true)
    try {
      const res = await authFetch('/api/stripe/connect/onboard', { method: 'post' })
      window.location.href = res.data.url
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert('Failed to start Stripe Connect: ' + (msg || 'Please try again'))
      setConnectLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your payment account? Clients will no longer be able to pay invoices online.')) return
    setConnectLoading(true)
    try {
      await authFetch('/api/stripe/connect/disconnect', { method: 'post' })
      setConnectStatus({ connected: false, enabled: false })
      setConnectMsg('Stripe account disconnected.')
    } catch {
      // silent
    } finally {
      setConnectLoading(false)
    }
  }

  const handleConfirmDelete = async () => {
    setDeleteLoading(true)
    setDeleteErr('')
    try {
      await authFetch('/api/users/me', {
        method: 'delete',
        data: { reason: deleteReason, comment: deleteComment },
      })
      signOut()
    } catch {
      setDeleteErr('Failed to delete account. Please try again.')
      setDeleteLoading(false)
    }
  }

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 680, margin: '0 auto' }}>
      {showUpgradeModal && (
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
      )}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
          Settings
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Manage your account and subscription.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── Profile ─────────────────────────────────────────── */}
        <SectionCard title="Profile">
          <form onSubmit={handleProfileSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {profileErr && <div className="alert alert-error">{profileErr}</div>}
            {profileMsg && <div className="alert alert-success">{profileMsg}</div>}
            <div>
              <label className="field-label">Full name</label>
              <input className="input" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="field-label">Business / studio name <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
              <input className="input" type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Jane Smith Photography" />
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 5 }}>Shown to clients on their portal page.</p>
            </div>
            <div>
              <label className="field-label">Email address</label>
              <input className="input" type="email" value={user?.email ?? ''} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Update the email address on your account. The new address will need to be verified before it activates. Your subscription and data are not affected by email changes.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={profileSaving} className="btn btn-primary btn-sm">
                {profileSaving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* ── Branding ─────────────────────────────────────────── */}
        <SectionCard title="Branding">
          <form onSubmit={handleBrandingSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {brandingErr && <div className="alert alert-error">{brandingErr}</div>}
            {brandingMsg && <div className="alert alert-success">{brandingMsg}</div>}
            <div>
              <label className="field-label">Brand color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="color"
                  value={brandColor}
                  onChange={e => setBrandColor(e.target.value)}
                  style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: 2 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{brandColor}</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 5 }}>Used as the header color on your client portal.</p>
            </div>
            <div>
              <label className="field-label">Logo <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {logoUrl && (
                  <img src={logoUrl} alt="Logo preview" style={{ height: 40, maxWidth: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)' }} />
                )}
                <label style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  {logoUrl ? 'Change logo' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={handleLogoUpload} />
                </label>
                {logoUrl && (
                  <button type="button" onClick={() => setLogoUrl('')} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Remove</button>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 5 }}>PNG, JPG, SVG or WebP · Max 500 KB · Shown in portal header.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={brandingSaving} className="btn btn-primary btn-sm">
                {brandingSaving ? 'Saving…' : 'Save Branding'}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* ── Subscription ─────────────────────────────────────── */}
        <SectionCard title="Subscription">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {isActive ? (
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 99, background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)' }}>
                    Active
                  </span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 99, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
                    Trial
                  </span>
                )}
              </div>
              {isActive ? (
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>You're on the PortalKit All-In plan — unlimited clients and portals.</p>
              ) : (
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {days > 0
                    ? <><strong style={{ color: 'var(--text-primary)' }}>{days} day{days === 1 ? '' : 's'}</strong> left on your trial.</>
                    : 'Your trial has expired.'
                  }
                  {' '}Upgrade to keep full access.
                </p>
              )}
            </div>
            <div style={{ flexShrink: 0 }}>
              {isActive ? (
                <button onClick={handleManageBilling} disabled={billingLoading} className="btn btn-ghost btn-sm">
                  {billingLoading ? 'Loading…' : 'Manage Subscription'}
                </button>
              ) : (
                <button
                  onClick={handleUpgrade}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    color: '#1B4332', background: '#C9A84C',
                    border: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(201,168,76,0.35)',
                    transition: 'opacity 0.15s',
                  }}
                >
                  Upgrade to All-In — $39/mo
                </button>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── Payments ─────────────────────────────────────────── */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', margin: 0, fontFamily: 'var(--font-display)' }}>
              💳 Accept Client Payments
            </h3>
            {connectStatus.enabled && (
              <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--color-green-bg)', color: 'var(--color-green)', padding: '2px 8px', borderRadius: 99, border: '1px solid var(--color-green-border)' }}>
                Active
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Connect your Stripe account so clients can pay invoices directly from their portal.
            Payments go straight to your bank — PortalKit never touches your money.
          </p>

          {connectMsg && <div className="alert alert-success" style={{ marginBottom: 14 }}>{connectMsg}</div>}

          {connectStatus.enabled ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--color-green-bg)', borderRadius: 8, marginBottom: 12, border: '1px solid var(--color-green-border)' }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-green)', margin: 0 }}>Stripe Connected &amp; Active</p>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>Clients can pay invoices from their portal</p>
                </div>
              </div>
              <button onClick={handleDisconnect} disabled={connectLoading} style={{ fontSize: 12, color: '#A32D2D', background: 'none', border: '1px solid #A32D2D', padding: '5px 12px', borderRadius: 6, cursor: connectLoading ? 'not-allowed' : 'pointer', opacity: connectLoading ? 0.6 : 1 }}>
                {connectLoading ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : connectStatus.connected ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#FAEEDA', borderRadius: 8, marginBottom: 12, border: '1px solid #F5D998' }}>
                <span style={{ fontSize: 18 }}>⏳</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#854F0B', margin: 0 }}>Verification Pending</p>
                  <p style={{ fontSize: 11, color: '#854F0B', margin: 0 }}>Complete your Stripe verification to activate payments</p>
                </div>
              </div>
              <button
                onClick={handleConnectStripe}
                disabled={connectLoading}
                style={{ fontSize: 13, color: 'white', background: '#635BFF', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: connectLoading ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: connectLoading ? 0.7 : 1 }}
              >
                {connectLoading ? 'Loading…' : 'Continue Verification →'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectStripe}
              disabled={connectLoading}
              style={{ background: '#635BFF', color: 'white', border: 'none', padding: '11px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: connectLoading ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: connectLoading ? 0.7 : 1 }}
            >
              {connectLoading ? 'Loading…' : '⚡ Connect with Stripe →'}
            </button>
          )}
        </div>

        {/* ── Security ─────────────────────────────────────────── */}
        <SectionCard title="Security">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Password and two-factor authentication are managed through your Clerk account settings.
              </p>
            </div>
            <button
              onClick={() => openUserProfile()}
              className="btn btn-ghost btn-sm"
            >
              Manage Security →
            </button>
          </div>
        </SectionCard>

        {/* ── Danger Zone ──────────────────────────────────────── */}
        <SectionCard title="Danger Zone">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#DC2626', marginBottom: 4 }}>Delete Account</p>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Permanently delete your account and all data. This cannot be undone.</p>
            </div>
            <button onClick={() => { setDeleteModal(true); setDeleteReason(''); setDeleteComment(''); setDeleteErr('') }}
              style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', color: '#DC2626', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.12)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
            >
              Delete Account
            </button>
          </div>
        </SectionCard>

        {/* ── Dev Tools ────────────────────────────────────────── */}
        {import.meta.env.DEV && (
          <SectionCard title="Dev Tools">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Reset Onboarding</p>
                <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Force the onboarding flow to show on next dashboard load.</p>
              </div>
              <button
                onClick={() => { localStorage.removeItem('pk_onboarding_done'); window.location.reload() }}
                style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', color: 'var(--green)', background: 'var(--color-green-bg)', border: '1px solid var(--color-green-border)', flexShrink: 0 }}
              >
                Reset Onboarding
              </button>
            </div>
          </SectionCard>
        )}

        {/* ── Footer ───────────────────────────────────────────── */}
        <div style={{ marginTop: 16, paddingTop: 24, borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            © {new Date().getFullYear()} Kilpian LLC dba PortalKit
            {' · '}
            <a href="/privacy" style={{ color: 'var(--text-dim)', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')} onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>Privacy Policy</a>
            {' · '}
            <a href="/terms" style={{ color: 'var(--text-dim)', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')} onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>Terms of Service</a>
          </p>
        </div>
      </div>

      {/* Exit Survey + Delete Modal */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 28, maxWidth: 440, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1B4332', marginBottom: 8 }}>Before you go…</h3>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20, lineHeight: 1.5 }}>
              Help us improve PortalKit for other photographers. Why are you leaving?
            </p>

            {(['Too expensive', 'Missing features I need', 'Switching to a different tool', 'Just testing / not ready yet', 'Too complicated to set up', 'My business needs changed', 'Other'] as const).map(reason => (
              <label key={reason} style={{
                display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, cursor: 'pointer',
                fontSize: 13, color: deleteReason === reason ? '#1B4332' : '#374151',
                fontWeight: deleteReason === reason ? 600 : 400,
              }}>
                <input
                  type="radio"
                  name="deleteReason"
                  value={reason}
                  checked={deleteReason === reason}
                  onChange={() => setDeleteReason(reason)}
                  style={{ accentColor: '#1B4332' }}
                />
                {reason}
              </label>
            ))}

            <textarea
              placeholder="Any additional feedback? (optional)"
              value={deleteComment}
              onChange={e => setDeleteComment(e.target.value)}
              rows={3}
              style={{ width: '100%', marginTop: 12, marginBottom: 8, padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />

            {deleteErr && <p style={{ color: '#A32D2D', fontSize: 12, marginBottom: 8 }}>{deleteErr}</p>}

            <p style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14, lineHeight: 1.5 }}>
              This will permanently delete your account, all clients, portals, contracts, and invoices. This cannot be undone.
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setDeleteModal(false); setDeleteReason(''); setDeleteComment(''); setDeleteErr('') }}
                style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Keep My Account
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                style={{ flex: 1, padding: '10px', background: '#A32D2D', color: 'white', border: 'none', borderRadius: 8, cursor: deleteLoading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: deleteLoading ? 0.7 : 1 }}
              >
                {deleteLoading ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
