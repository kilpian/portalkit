import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClerk } from '@clerk/clerk-react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'
import { trialDaysLeft } from '../../lib/plan'

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
  const [upgradeLoading, setUpgradeLoading] = useState(false)

  // Delete
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const days = trialDaysLeft(user)
  const isActive = user?.plan === 'active'

  useEffect(() => {
    if (searchParams.get('upgraded') === 'true') {
      setProfileMsg('Subscription activated! Welcome to PortalKit.')
    }
  }, [searchParams])

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

  const handleUpgrade = async () => {
    setUpgradeLoading(true)
    try {
      const res = await authFetch('/api/stripe/create-checkout-with-trial', { method: 'post' })
      window.location.href = res.data.url
    } catch {
      setUpgradeLoading(false)
    }
  }

  const handleManageBilling = async () => {
    setBillingLoading(true)
    try {
      const res = await authFetch('/api/stripe/create-portal', { method: 'post' })
      window.location.href = res.data.url
    } catch {
      setBillingLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') { setDeleteErr('Type DELETE to confirm.'); return }
    setDeleteLoading(true)
    try {
      await authFetch('/api/users/me', { method: 'delete' })
      signOut()
    } catch {
      setDeleteErr('Failed to delete account. Please try again.')
      setDeleteLoading(false)
    }
  }

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 680, margin: '0 auto' }}>
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
                  disabled={upgradeLoading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    color: '#1B4332', background: '#C9A84C',
                    border: 'none', whiteSpace: 'nowrap', cursor: upgradeLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 1px 4px rgba(201,168,76,0.35)',
                    opacity: upgradeLoading ? 0.7 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {upgradeLoading ? 'Loading…' : 'Upgrade to All-In — $39/mo'}
                </button>
              )}
            </div>
          </div>
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
            <button onClick={() => { setDeleteModal(true); setDeleteConfirmText(''); setDeleteErr('') }}
              style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', color: '#DC2626', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.12)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
            >
              Delete Account
            </button>
          </div>
        </SectionCard>

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

      {/* Delete Modal */}
      {deleteModal && (
        <>
          <div onClick={() => setDeleteModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 299, backdropFilter: 'blur(2px)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 300, width: 'min(420px, 90vw)',
            background: 'var(--bg-elevated)', borderRadius: 14,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            padding: 28,
          }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#DC2626', marginBottom: 10, fontFamily: 'var(--font-display)' }}>Delete Account?</h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
              This will permanently delete your account, all clients, portals, contracts, invoices, and files. This cannot be undone.
            </p>
            {deleteErr && <div className="alert alert-error" style={{ marginBottom: 14 }}>{deleteErr}</div>}
            <div style={{ marginBottom: 20 }}>
              <label className="field-label" style={{ color: '#DC2626' }}>Type DELETE to confirm</label>
              <input className="input" type="text" value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                style={{ borderColor: 'rgba(220,38,38,0.3)' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteModal(false)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading || deleteConfirmText !== 'DELETE'}
                style={{
                  flex: 2, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: deleteConfirmText === 'DELETE' ? 'pointer' : 'not-allowed',
                  color: '#fff', background: deleteConfirmText === 'DELETE' ? '#DC2626' : 'rgba(220,38,38,0.3)',
                  border: 'none', opacity: deleteLoading ? 0.7 : 1, transition: 'background 0.15s',
                }}
              >
                {deleteLoading ? 'Deleting…' : 'Delete My Account'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
