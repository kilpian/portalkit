import { useState } from 'react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'

export default function Onboarding() {
  const { setUser } = usePortalAuth()
  const { authFetch } = useApi()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)

  // Step 1
  const [businessName, setBusinessName] = useState('')
  const [brandColor, setBrandColor] = useState('#1B4332')

  // Step 2
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [eventDate, setEventDate] = useState('')

  // Step 3
  const [portalToken, setPortalToken] = useState('')
  const [copied, setCopied] = useState(false)

  const portalLink = portalToken ? `${window.location.origin}/portal/${portalToken}` : ''

  const handleStep1 = async () => {
    if (!businessName.trim()) return
    setSaving(true)
    try {
      const res = await authFetch('/api/users/me', { method: 'put', data: { business_name: businessName.trim(), brand_color: brandColor } })
      setUser(res.data)
      setStep(2)
    } catch { /* stay on step */ } finally { setSaving(false) }
  }

  const handleStep2 = async () => {
    if (!clientName.trim()) return
    setSaving(true)
    try {
      const res = await authFetch('/api/clients', {
        method: 'post',
        data: { name: clientName.trim(), email: clientEmail.trim() || undefined, event_date: eventDate || undefined },
      })
      setPortalToken(res.data.portal_token)
      setStep(3)
    } catch { /* stay on step */ } finally { setSaving(false) }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(portalLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 36 }}>
          {([1, 2, 3] as const).map(n => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: n <= step ? 'var(--green)' : 'var(--bg-secondary)', color: n <= step ? '#FDFAF5' : 'var(--text-dim)', border: `1px solid ${n <= step ? 'var(--green)' : 'var(--border)'}`, transition: 'all 0.2s' }}>
                {n < step ? '✓' : n}
              </div>
              {n < 3 && <div style={{ width: 32, height: 2, background: n < step ? 'var(--green)' : 'var(--border)', transition: 'background 0.2s' }} />}
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: '40px 36px' }}>

          {step === 1 && (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Set up your profile</h1>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 28, lineHeight: 1.5 }}>This is what your clients see when they open their portal.</p>
              <div style={{ marginBottom: 18 }}>
                <label className="field-label">Business name <span style={{ color: 'var(--color-red)' }}>*</span></label>
                <input className="input" type="text" placeholder="Your Photography Studio" value={businessName} onChange={e => setBusinessName(e.target.value)} autoFocus />
              </div>
              <div style={{ marginBottom: 28 }}>
                <label className="field-label">Brand color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} style={{ width: 44, height: 44, padding: 2, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} />
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: 'monospace' }}>{brandColor}</span>
                </div>
              </div>
              <button onClick={handleStep1} disabled={saving || !businessName.trim()} className="btn btn-primary" style={{ width: '100%' }}>
                {saving ? 'Saving…' : 'Next →'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Create your first client</h1>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 28, lineHeight: 1.5 }}>A private portal link will be generated for them instantly.</p>
              <div style={{ marginBottom: 16 }}>
                <label className="field-label">Client name <span style={{ color: 'var(--color-red)' }}>*</span></label>
                <input className="input" type="text" placeholder="Jane & Mark Smith" value={clientName} onChange={e => setClientName(e.target.value)} autoFocus />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="field-label">Email address</label>
                <input className="input" type="email" placeholder="jane@example.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
              </div>
              <div style={{ marginBottom: 28 }}>
                <label className="field-label">Event date</label>
                <input className="input" type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
              </div>
              <button onClick={handleStep2} disabled={saving || !clientName.trim()} className="btn btn-primary" style={{ width: '100%' }}>
                {saving ? 'Creating…' : 'Create Portal →'}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16, textAlign: 'center' }}>🎉</div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6, textAlign: 'center' }}>You're ready!</h1>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, textAlign: 'center', lineHeight: 1.5 }}>Share this link with your client. They can view their portal, sign contracts, and see invoices.</p>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <p style={{ flex: 1, fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{portalLink}</p>
                <button onClick={copyLink} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: `1px solid ${copied ? 'var(--color-green-border)' : 'var(--border)'}`, background: copied ? 'var(--color-green-bg)' : 'transparent', color: copied ? 'var(--color-green)' : 'var(--text-dim)', cursor: 'pointer' }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <a href="/dashboard" className="btn btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', width: '100%', boxSizing: 'border-box' }}>
                Go to Dashboard →
              </a>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
