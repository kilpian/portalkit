import { useState, useRef } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

interface OnboardingProps {
  onComplete: () => void
}

function CardForm({ onSuccess, onError }: { onSuccess: () => void; onError: (msg: string) => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const { authFetch } = useApi()
  const [saving, setSaving] = useState(false)
  const [cardError, setCardError] = useState('')

  const handleSubmit = async () => {
    if (!stripe || !elements) return
    setSaving(true)
    setCardError('')

    try {
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) throw new Error('Card element not found')

      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      })

      if (error) throw new Error(error.message)
      if (!paymentMethod) throw new Error('Payment method creation failed')

      await authFetch('/api/stripe/confirm-setup', {
        method: 'post',
        data: { paymentMethodId: paymentMethod.id },
      })

      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setCardError(msg)
      onError(msg)
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ border: '1px solid #E8E0D0', borderRadius: 8, padding: '12px 14px', background: 'white', marginBottom: 8 }}>
        <CardElement options={{
          style: {
            base: {
              fontSize: '15px',
              color: '#374151',
              fontFamily: 'Inter, sans-serif',
              '::placeholder': { color: '#9CA3AF' },
            },
            invalid: { color: '#A32D2D' },
          },
          hidePostalCode: false,
        }} />
      </div>
      {cardError && (
        <p style={{ color: '#A32D2D', fontSize: 12, marginBottom: 8 }}>{cardError}</p>
      )}
      <button
        onClick={handleSubmit}
        disabled={saving || !stripe}
        style={{
          width: '100%',
          background: '#1B4332',
          color: 'white',
          border: 'none',
          padding: '13px 24px',
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          cursor: saving || !stripe ? 'not-allowed' : 'pointer',
          opacity: saving || !stripe ? 0.7 : 1,
        }}
      >
        {saving ? 'Setting up your account…' : 'Start Free Trial →'}
      </button>
    </div>
  )
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { setUser } = usePortalAuth()
  const { authFetch } = useApi()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [brandColor, setBrandColor] = useState('#1B4332')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const [stripeError, setStripeError] = useState('')
  const logoInputRef = useRef<HTMLInputElement>(null)

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
    setStripeError('')
    try {
      const profileRes = await authFetch('/api/users/me', {
        method: 'put',
        data: {
          business_name: businessName.trim(),
          brand_color: brandColor,
          ...(logoDataUrl ? { logo_url: logoDataUrl } : {}),
        },
      })
      setUser(profileRes.data)

      const setupRes = await authFetch('/api/stripe/create-setup-intent', { method: 'post' })
      setClientSecret(setupRes.data.clientSecret)
      setStep(2)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setStripeError(msg)
    } finally {
      setSaving(false)
    }
  }

  const handlePaymentSuccess = async () => {
    try {
      const res = await authFetch('/api/users/me', {
        method: 'put',
        data: { onboarding_completed: true },
      })
      setUser(res.data)
    } catch {
      // onboarding_completed is set best-effort; proceed regardless
    }
    onComplete()
  }

  const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

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

          {step === 1 && (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Set up your studio</h1>
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

              {stripeError && (
                <div style={{ color: '#A32D2D', fontSize: 13, padding: '8px 12px', background: '#FCEBEB', borderRadius: 6, marginBottom: 12 }}>
                  {stripeError}
                </div>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 12 }}>
                Next: add your card to activate your free trial
              </p>

              <button onClick={handleStep1} disabled={saving || !businessName.trim()} className="btn btn-primary" style={{ width: '100%' }}>
                {saving ? 'Saving…' : 'Continue →'}
              </button>
            </>
          )}

          {step === 2 && clientSecret && (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Secure your account</h1>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 4, lineHeight: 1.5 }}>
                Add your card to activate your 14-day free trial.
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
                🔒 You won't be charged until {trialEndDate}. Cancel anytime before then.
              </p>

              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme: 'stripe',
                    variables: { colorPrimary: '#1B4332', fontFamily: 'Inter, sans-serif' },
                  },
                }}
              >
                <CardForm onSuccess={handlePaymentSuccess} onError={setStripeError} />
              </Elements>

              {stripeError && (
                <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{stripeError}</p>
              )}

              <button
                onClick={() => { setStep(1); setStripeError('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', marginTop: 14, width: '100%' }}
              >
                ← Back
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
