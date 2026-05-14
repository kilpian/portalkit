import { useRef, useState } from 'react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'

interface OnboardingProps {
  onComplete: () => void
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { setUser } = usePortalAuth()
  const { authFetch } = useApi()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)

  // Step 1
  const [businessName, setBusinessName] = useState('')
  const [brandColor, setBrandColor] = useState('#1B4332')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Step 2
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [eventDate, setEventDate] = useState('')

  // Step 3
  const [portalToken, setPortalToken] = useState('')
  const [copied, setCopied] = useState(false)

  const portalLink = portalToken ? `${window.location.origin}/portal/${portalToken}` : ''

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleStep1 = async () => {
    if (!businessName.trim()) return
    setSaving(true)
    try {
      const payload: Record<string, string> = { business_name: businessName.trim(), brand_color: brandColor }
      if (logoDataUrl) payload.logo_url = logoDataUrl
      const res = await authFetch('/api/users/me', { method: 'put', data: payload })
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
              <div style={{ marginBottom: 18 }}>
                <label className="field-label">Brand color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} style={{ width: 44, height: 44, padding: 2, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} />
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: 'monospace' }}>{brandColor}</span>
                </div>
              </div>
              <div style={{ marginBottom: 28 }}>
                <label className="field-label">Logo <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleLogoChange}
                  style={{ display: 'none' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {logoDataUrl ? (
                    <img src={logoDataUrl} alt="Logo preview" style={{ height: 48, maxWidth: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)' }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 6, border: '1px dashed var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                      </svg>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button type="button" onClick={() => logoInputRef.current?.click()} style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>
                      {logoDataUrl ? 'Change' : 'Upload logo'}
                    </button>
                    {logoDataUrl && (
                      <button type="button" onClick={() => setLogoDataUrl(null)} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>Remove</button>
                    )}
                  </div>
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
              <button onClick={onComplete} className="btn btn-primary" style={{ display: 'block', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
                Go to Dashboard →
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
