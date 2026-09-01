import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClerk } from '@clerk/clerk-react'
import { loadConnectAndInitialize } from '@stripe/connect-js'
import type { StripeConnectInstance } from '@stripe/connect-js'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'
import { trialDaysLeft, isSubscribed } from '../../lib/plan'
import UpgradeModal from '../../components/UpgradeModal'
import ConfirmModal from '../../components/ConfirmModal'
import ImportClientsModal from '../../components/ImportClientsModal'
import ManageSubscriptionModal from '../../components/ManageSubscriptionModal'

interface ImportHistoryItem {
  id: number
  filename: string
  imported_count: number
  skipped_count: number
  created_at: string
}

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
  const [showManageSubModal, setShowManageSubModal] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [switchingAnnual, setSwitchingAnnual] = useState(false)
  const [switchMsg, setSwitchMsg] = useState('')
  const [switchingMonthly, setSwitchingMonthly] = useState(false)
  const [switchMonthlyMsg, setSwitchMonthlyMsg] = useState('')

  // Data import
  const [showImportModal, setShowImportModal] = useState(false)
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([])
  const [importHistoryErr, setImportHistoryErr] = useState('')
  const [deletingImportId, setDeletingImportId] = useState<number | null>(null)
  const [importDeleteConfirm, setImportDeleteConfirm] = useState<{ id: number; clientCount: number } | null>(null)

  // Delete / exit survey
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteComment, setDeleteComment] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Confirm modals
  const [showSwitchAnnualModal, setShowSwitchAnnualModal] = useState(false)
  const [showSwitchMonthlyModal, setShowSwitchMonthlyModal] = useState(false)
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)

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

  // Embedded Stripe Connect onboarding
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [stripeConnectInstance, setStripeConnectInstance] = useState<StripeConnectInstance | null>(null)
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [connectError, setConnectError] = useState('')
  const stripeContainerRef = useRef<HTMLDivElement>(null)

  // Referral
  const [referralData, setReferralData] = useState<{
    referral_code: string | null
    referral_url: string | null
    total_referred: number
    total_converted: number
    months_earned: number
  } | null>(null)
  const [referralCopied, setReferralCopied] = useState(false)

  const days = trialDaysLeft(user)
  // Uses the same resolved-status helper the rest of the app uses (lib/plan.ts),
  // instead of a local re-implementation of the "is this plan active" check.
  const isActive = isSubscribed(user ?? null)

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

  // Fetch referral stats
  useEffect(() => {
    authFetch('/api/referrals', { method: 'get' })
      .then(res => setReferralData(res.data))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchImportHistory = () => {
    authFetch('/api/import/history', { method: 'get' })
      .then(res => setImportHistory(res.data))
      .catch(() => {})
  }

  useEffect(() => {
    fetchImportHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDownloadImport = async (id: number) => {
    setImportHistoryErr('')
    try {
      const res = await authFetch(`/api/import/history/${id}/download`, { method: 'get' })
      window.open(res.data.url, '_blank')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setImportHistoryErr(msg || 'Failed to download file.')
    }
  }

  const handleDeleteImportClick = async (id: number) => {
    setImportHistoryErr('')
    setDeletingImportId(id)
    try {
      const res = await authFetch(`/api/import/history/${id}`, { method: 'delete' })
      if (res.data.requiresConfirmation) {
        setImportDeleteConfirm({ id, clientCount: res.data.clientCount })
      } else {
        setImportHistory(prev => prev.filter(h => h.id !== id))
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setImportHistoryErr(msg || 'Failed to delete import.')
    } finally {
      setDeletingImportId(null)
    }
  }

  const handleResolveImportDelete = async (deleteClients: boolean) => {
    if (!importDeleteConfirm) return
    const { id } = importDeleteConfirm
    setDeletingImportId(id)
    try {
      await authFetch(`/api/import/history/${id}?deleteClients=${deleteClients}`, { method: 'delete' })
      setImportHistory(prev => prev.filter(h => h.id !== id))
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setImportHistoryErr(msg || 'Failed to delete import.')
    } finally {
      setDeletingImportId(null)
      setImportDeleteConfirm(null)
    }
  }

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

  const handleSwitchToAnnual = async () => {
    setSwitchingAnnual(true)
    setSwitchMsg('')
    try {
      await authFetch('/api/stripe/switch-to-annual', { method: 'post' })
      if (user) setUser({ ...user, billing_cycle: 'annual' })
      setSwitchMsg('You\'re now on annual billing — saving $120/year. 🎉')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setSwitchMsg('Could not switch: ' + (msg || 'Please try again'))
    } finally {
      setSwitchingAnnual(false)
    }
  }

  const handleSwitchToMonthly = async () => {
    setSwitchingMonthly(true)
    setSwitchMonthlyMsg('')
    try {
      await authFetch('/api/stripe/switch-to-monthly', { method: 'post' })
      if (user) setUser({ ...user, billing_cycle: 'monthly' })
      setSwitchMonthlyMsg('You\'re switched to monthly billing — this takes effect at the end of your current annual period.')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setSwitchMonthlyMsg('Could not switch: ' + (msg || 'Please try again'))
    } finally {
      setSwitchingMonthly(false)
    }
  }

  const refreshConnectStatus = (notify = false) => {
    authFetch('/api/stripe/connect/status', { method: 'get' })
      .then(res => {
        setConnectStatus(res.data)
        if (notify) {
          setConnectMsg(res.data.enabled
            ? '✓ Stripe account connected! Clients can now pay invoices.'
            : 'Verification started — complete it to enable payments.'
          )
        }
      })
      .catch(() => {})
  }

  const handleConnectStripe = async () => {
    setOnboardingLoading(true)
    setConnectError('')
    try {
      const res = await authFetch('/api/stripe/connect/account-session', { method: 'post' })
      if (!res.data?.client_secret) throw new Error('No client secret returned')
      const clientSecret = res.data.client_secret

      const instance = loadConnectAndInitialize({
        publishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string,
        fetchClientSecret: async () => clientSecret,
        appearance: {
          overlays: 'dialog',
          variables: {
            colorPrimary: '#1B4332',
            fontFamily: 'Inter, system-ui, sans-serif',
            borderRadius: '8px',
            colorBackground: '#FDFAF5',
          },
        },
      })
      setStripeConnectInstance(instance)
      setShowOnboarding(true)
      setOnboardingLoading(false)
    } catch (err: unknown) {
      console.error('Stripe Connect init error:', err)
      setOnboardingLoading(false)
      setConnectError('Could not load Stripe setup. Please refresh and try again.')
    }
  }

  const closeOnboarding = (notifyEnabled = false) => {
    setShowOnboarding(false)
    setStripeConnectInstance(null)
    refreshConnectStatus(notifyEnabled)
  }

  // Mount the embedded onboarding component once the instance is ready
  useEffect(() => {
    if (!stripeConnectInstance || !showOnboarding) return
    if (!stripeContainerRef.current) return
    const container = stripeContainerRef.current
    container.innerHTML = ''

    try {
      const onboarding = stripeConnectInstance.create('account-onboarding')
      if (!onboarding) throw new Error('Failed to create onboarding component')

      onboarding.setOnExit(async () => {
        setShowOnboarding(false)
        setStripeConnectInstance(null)
        try {
          const statusRes = await authFetch('/api/stripe/connect/status')
          setConnectStatus(statusRes.data)
        } catch {}
      })

      container.appendChild(onboarding)
    } catch (err) {
      console.error('Stripe component mount error:', err)
      setShowOnboarding(false)
      setStripeConnectInstance(null)
      setConnectError('Could not load Stripe setup. Please try again.')
    }

    return () => { container.innerHTML = '' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeConnectInstance, showOnboarding])

  const handleDisconnect = async () => {
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
    <div style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 32px) 64px', maxWidth: 680, margin: '0 auto' }}>
      {showUpgradeModal && (
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
      )}

      <ConfirmModal
        open={showSwitchAnnualModal}
        title="Switch to annual billing?"
        message="You'll be charged the prorated annual amount today and save $120/year going forward."
        confirmLabel="Switch to Annual"
        onConfirm={() => { setShowSwitchAnnualModal(false); handleSwitchToAnnual() }}
        onCancel={() => setShowSwitchAnnualModal(false)}
      />
      <ConfirmModal
        open={showSwitchMonthlyModal}
        title="Switch to monthly billing?"
        message="You'll keep your annual pricing and full access through the end of your current paid period. After that, billing switches to monthly at the standard $39/mo rate."
        confirmLabel="Switch to Monthly"
        onConfirm={() => { setShowSwitchMonthlyModal(false); handleSwitchToMonthly() }}
        onCancel={() => setShowSwitchMonthlyModal(false)}
      />
      <ConfirmModal
        open={showDisconnectModal}
        title="Disconnect payment account?"
        message="Clients will no longer be able to pay invoices online."
        confirmLabel="Disconnect"
        danger
        onConfirm={() => { setShowDisconnectModal(false); handleDisconnect() }}
        onCancel={() => setShowDisconnectModal(false)}
      />

      <ImportClientsModal open={showImportModal} onClose={() => setShowImportModal(false)} onImported={fetchImportHistory} />
      <ManageSubscriptionModal open={showManageSubModal} onClose={() => setShowManageSubModal(false)} />

      {showOnboarding && stripeConnectInstance && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'white', borderRadius: 16,
            padding: 24, maxWidth: 560, width: '100%',
            maxHeight: '90vh', overflow: 'auto',
            boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 20,
            }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1B4332', margin: 0 }}>
                  Connect your Stripe account
                </h3>
                <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
                  Payments go directly to your bank. PortalKit never touches your money.
                </p>
              </div>
              <button
                onClick={() => closeOnboarding(false)}
                style={{
                  background: 'none', border: 'none',
                  fontSize: 22, cursor: 'pointer',
                  color: '#9CA3AF', flexShrink: 0, marginLeft: 12,
                }}
              >✕</button>
            </div>

            <div ref={stripeContainerRef} style={{ minHeight: 400 }} />

            <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 16 }}>
              🔒 Secured by Stripe · Your banking info is handled directly by Stripe
            </p>
          </div>
        </div>
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
                <>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>You're on the PortalKit All-In plan — unlimited clients and portals.</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                    Billing: <strong style={{ color: 'var(--text-primary)' }}>{user?.billing_cycle === 'annual' ? 'Annual' : 'Monthly'}</strong>
                    {' · '}{user?.billing_cycle === 'annual' ? '$348/year' : '$39/month'}
                  </p>
                  {user?.billing_cycle !== 'annual' && !!user?.stripe_subscription_id && user.stripe_subscription_id !== 'manual_activation' && (
                    <button
                      onClick={() => setShowSwitchAnnualModal(true)}
                      disabled={switchingAnnual}
                      style={{
                        marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                        color: '#1B4332', background: 'transparent', border: '1.5px solid #1B4332',
                        cursor: switchingAnnual ? 'not-allowed' : 'pointer', opacity: switchingAnnual ? 0.6 : 1,
                      }}
                    >
                      {switchingAnnual ? 'Switching…' : 'Switch to Annual — Save $120/year →'}
                    </button>
                  )}
                  {switchMsg && (
                    <p style={{ fontSize: 13, color: 'var(--color-green)', marginTop: 8 }}>{switchMsg}</p>
                  )}
                  {user?.billing_cycle === 'annual' && !!user?.stripe_subscription_id && user.stripe_subscription_id !== 'manual_activation' && (
                    <button
                      onClick={() => setShowSwitchMonthlyModal(true)}
                      disabled={switchingMonthly}
                      style={{
                        marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                        color: '#1B4332', background: 'transparent', border: '1.5px solid #1B4332',
                        cursor: switchingMonthly ? 'not-allowed' : 'pointer', opacity: switchingMonthly ? 0.6 : 1,
                      }}
                    >
                      {switchingMonthly ? 'Switching…' : 'Switch to Monthly →'}
                    </button>
                  )}
                  {switchMonthlyMsg && (
                    <p style={{ fontSize: 13, color: 'var(--color-green)', marginTop: 8 }}>{switchMonthlyMsg}</p>
                  )}
                </>
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
                <button onClick={() => setShowManageSubModal(true)} className="btn btn-ghost btn-sm">
                  Manage Subscription
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
          {connectError && <p style={{ fontSize: 13, color: '#A32D2D', marginBottom: 10 }}>{connectError}</p>}

          {connectStatus.enabled ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--color-green-bg)', borderRadius: 8, marginBottom: 12, border: '1px solid var(--color-green-border)' }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-green)', margin: 0 }}>Stripe Connected &amp; Active</p>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>Clients can pay invoices from their portal</p>
                </div>
              </div>
              <button onClick={() => setShowDisconnectModal(true)} disabled={connectLoading} style={{ fontSize: 12, color: '#A32D2D', background: 'none', border: '1px solid #A32D2D', padding: '5px 12px', borderRadius: 6, cursor: connectLoading ? 'not-allowed' : 'pointer', opacity: connectLoading ? 0.6 : 1 }}>
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
                disabled={onboardingLoading}
                style={{ fontSize: 13, color: 'white', background: '#635BFF', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: onboardingLoading ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: onboardingLoading ? 0.7 : 1 }}
              >
                {onboardingLoading ? 'Setting up…' : 'Continue Verification →'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectStripe}
              disabled={onboardingLoading}
              style={{ background: '#635BFF', color: 'white', border: 'none', padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: onboardingLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: onboardingLoading ? 0.7 : 1 }}
            >
              {onboardingLoading ? 'Setting up…' : '⚡ Connect with Stripe →'}
            </button>
          )}
        </div>

        {/* ── Referral ─────────────────────────────────────────── */}
        {referralData?.referral_url && (
          <div style={{ background: 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 100%)', borderRadius: 16, padding: 24, color: 'white' }}>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: 'white', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>
                🎁 Refer a Photographer — Earn Free Months
              </h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.6 }}>
                Share your link. When a photographer subscribes, you both get rewarded — they get PortalKit, you get a free month added to your subscription.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: referralData.total_converted > 0 ? 14 : 0 }}>
              <input
                readOnly
                value={referralData.referral_url}
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontFamily: 'monospace', background: 'rgba(255,255,255,0.15)', color: 'white', outline: 'none' }}
                onFocus={e => e.target.select()}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(referralData.referral_url!)
                  setReferralCopied(true)
                  setTimeout(() => setReferralCopied(false), 2000)
                }}
                style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#C9A84C', color: '#1B4332', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {referralCopied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>
            {referralData.total_converted > 0 && (
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
                🎉 {referralData.total_converted} photographer{referralData.total_converted === 1 ? '' : 's'} subscribed via your link — you've earned {referralData.months_earned} free month{referralData.months_earned === 1 ? '' : 's'}!
              </p>
            )}
          </div>
        )}

        {/* ── Import Data ──────────────────────────────────────── */}
        <SectionCard title="Import Your Data">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Bring your clients over from a spreadsheet or another CRM. Upload a CSV or Excel file, review the column mapping, and confirm — nothing is saved until you approve it.
              </p>
            </div>
            <button onClick={() => setShowImportModal(true)} className="btn btn-ghost btn-sm">
              Import Your Data →
            </button>
          </div>
        </SectionCard>

        {/* ── Import History ───────────────────────────────────── */}
        <SectionCard title="Import History">
          {importHistoryErr && <p style={{ fontSize: 13, color: '#DC2626', marginBottom: 12 }}>{importHistoryErr}</p>}
          {importHistory.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>No imports yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {importHistory.map((h, i) => {
                const isConfirming = importDeleteConfirm?.id === h.id
                const isDeleting = deletingImportId === h.id
                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '12px 0', borderBottom: i < importHistory.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                        {h.filename}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}{h.imported_count} imported, {h.skipped_count} skipped
                      </p>
                    </div>

                    {isConfirming ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#B45309' }}>
                          This import created {importDeleteConfirm.clientCount} client{importDeleteConfirm.clientCount === 1 ? '' : 's'}. Delete the log only, or also remove {importDeleteConfirm.clientCount === 1 ? 'that client' : 'those clients'}?
                        </span>
                        <button
                          onClick={() => handleResolveImportDelete(false)}
                          disabled={isDeleting}
                          style={{ fontSize: 12, padding: '5px 10px', background: 'white', border: '1px solid #D1D5DB', borderRadius: 6, color: '#374151', fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Log only
                        </button>
                        <button
                          onClick={() => handleResolveImportDelete(true)}
                          disabled={isDeleting}
                          style={{ fontSize: 12, padding: '5px 10px', background: '#DC2626', border: 'none', borderRadius: 6, color: 'white', fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Delete log + clients
                        </button>
                        <button
                          onClick={() => setImportDeleteConfirm(null)}
                          disabled={isDeleting}
                          style={{ fontSize: 12, padding: '5px 10px', background: 'transparent', border: 'none', color: '#6B7280', fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button onClick={() => handleDownloadImport(h.id)} className="btn btn-ghost btn-sm">
                          Download
                        </button>
                        <button
                          onClick={() => handleDeleteImportClick(h.id)}
                          disabled={isDeleting}
                          style={{ fontSize: 12, padding: '6px 12px', border: '1px solid #FCA5A5', borderRadius: 6, background: 'white', color: '#A32D2D', cursor: isDeleting ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: isDeleting ? 0.6 : 1 }}
                        >
                          {isDeleting ? '...' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

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
            <button onClick={() => { setDeleteModal(true); setDeleteReason(''); setDeleteComment(''); setDeleteErr(''); setDeleteConfirmText('') }}
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

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Type <span style={{ fontFamily: 'monospace', color: '#A32D2D' }}>DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              style={{ width: '100%', marginBottom: 14, padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setDeleteModal(false); setDeleteReason(''); setDeleteComment(''); setDeleteErr(''); setDeleteConfirmText('') }}
                style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Keep My Account
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteLoading || deleteConfirmText !== 'DELETE'}
                style={{ flex: 1, padding: '10px', background: '#A32D2D', color: 'white', border: 'none', borderRadius: 8, cursor: (deleteLoading || deleteConfirmText !== 'DELETE') ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: (deleteLoading || deleteConfirmText !== 'DELETE') ? 0.5 : 1 }}
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
