import { useRef, useState } from 'react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'

interface OnboardingProps {
  onComplete: () => void
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { setUser } = usePortalAuth()
  const { authFetch } = useApi()
  const [saving, setSaving] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [brandColor, setBrandColor] = useState('#1B4332')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!businessName.trim()) return
    setSaving(true)
    try {
      const payload: Record<string, string> = { business_name: businessName.trim(), brand_color: brandColor }
      if (logoDataUrl) payload.logo_url = logoDataUrl
      const res = await authFetch('/api/users/me', { method: 'put', data: payload })
      setUser(res.data)

      setRedirecting(true)
      const checkoutRes = await authFetch('/api/stripe/create-checkout-with-trial', { method: 'post' })
      window.location.href = checkoutRes.data.url
    } catch {
      setSaving(false)
      setRedirecting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.04em', marginBottom: 6 }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>Let's set up your account</p>
        </div>

        <div className="card" style={{ padding: '40px 36px' }}>
          {redirecting ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div className="spinner" style={{ margin: '0 auto 20px' }} />
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Redirecting to checkout…</p>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>You'll start your 14-day free trial. No charge today.</p>
            </div>
          ) : (
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
                <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogoChange} style={{ display: 'none' }} />
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

              <button onClick={handleSave} disabled={saving || !businessName.trim()} className="btn btn-primary" style={{ width: '100%', marginBottom: 14 }}>
                {saving ? 'Saving…' : 'Continue to Payment →'}
              </button>

              <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
                14-day free trial · No charge today · Cancel anytime
              </p>

              <button
                type="button"
                onClick={onComplete}
                style={{ display: 'block', width: '100%', marginTop: 12, fontSize: 12, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'center' }}
              >
                Skip for now →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
