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
  const api = useApi()
  const [searchParams] = useSearchParams()

  // Profile
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [businessName, setBusinessName] = useState(user?.business_name ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')

  // Billing
  const [billingLoading, setBillingLoading] = useState(false)

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
    }
  }, [user])

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileErr(''); setProfileMsg('')
    if (!fullName.trim()) { setProfileErr('Name is required.'); return }
    setProfileSaving(true)
    try {
      const updated = await api.updateProfile({ full_name: fullName.trim(), business_name: businessName.trim() || undefined })
      setUser(updated)
      setProfileMsg('Profile saved.')
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { error?: string } } }
      setProfileErr(ae?.response?.data?.error || 'Failed to save profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleUpgrade = async () => {
    setBillingLoading(true)
    try {
      const { url } = await api.createCheckout()
      window.location.href = url
    } catch {
      setBillingLoading(false)
    }
  }

  const handleManageBilling = async () => {
    setBillingLoading(true)
    try {
      const { url } = await api.createBillingPortal()
      window.location.href = url
    } catch {
      setBillingLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') { setDeleteErr('Type DELETE to confirm.'); return }
    setDeleteLoading(true)
    try {
      await api.deleteAccount()
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
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 99, background: 'var(--gold-bg)', color: 'var(--gold-dim)', border: '1px solid var(--gold-border)' }}>
                    Trial
                  </span>
                )}
              </div>
              {isActive ? (
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>You're on the PortalKit plan — unlimited clients and portals.</p>
              ) : (
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {days > 0 ? `${days} day${days === 1 ? '' : 's'} left on your trial.` : 'Your trial has expired.'}
                  {' '}Upgrade to keep full access.
                </p>
              )}
            </div>
            <div>
              {isActive ? (
                <button onClick={handleManageBilling} disabled={billingLoading} className="btn btn-ghost btn-sm">
                  {billingLoading ? 'Loading…' : 'Manage Billing'}
                </button>
              ) : (
                <button onClick={handleUpgrade} disabled={billingLoading} className="btn btn-primary btn-sm">
                  {billingLoading ? 'Loading…' : 'Upgrade Now →'}
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
