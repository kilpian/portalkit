import { useState, useRef } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import posthog from 'posthog-js'
import { useClerk } from '@clerk/clerk-react'
import { usePortalAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/api'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
if (!STRIPE_KEY) throw new Error('Missing VITE_STRIPE_PUBLISHABLE_KEY')
// Clerk key must NEVER be used here — it lives only in main.tsx for ClerkProvider
const stripePromise = loadStripe(STRIPE_KEY)

interface OnboardingProps {
  onComplete: () => void
}

function CardForm({ onSuccess, onError, billingCycle }: { onSuccess: () => void; onError: (msg: string) => void; billingCycle: 'monthly' | 'annual' }) {
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
        data: { paymentMethodId: paymentMethod.id, billingCycle },
      })

      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setCardError(msg)
      onError(msg)
      setSaving(false)
    }
  }

  const disabled = saving || !stripe

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
        disabled={disabled}
        style={{
          width: '100%',
          background: '#1B4332',
          color: 'white',
          border: 'none',
          padding: '13px 24px',
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {saving ? 'Setting up your account…' : 'Start Free Trial →'}
      </button>
    </div>
  )
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { signOut } = useClerk()
  const { setUser } = usePortalAuth()
  const { authFetch } = useApi()
  const [step, setStep] = useState(1)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual')
  const [saving, setSaving] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [brandColor, setBrandColor] = useState('#1B4332')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const [stripeError, setStripeError] = useState('')
  const [businessNameError, setBusinessNameError] = useState('')
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleStep1 = async () => {
    if (!businessName.trim()) {
      setBusinessNameError('Please enter your business or studio name')
      return
    }
    setBusinessNameError('')
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
      posthog.capture('onboarding_step1_complete', { business_name: businessName.trim() })

      const setupRes = await authFetch('/api/stripe/create-setup-intent', { method: 'post', data: { billingCycle } })
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
    posthog.capture('onboarding_payment_complete')
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
    <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.3)', maxWidth: 480, width: '100%', padding: 32, maxHeight: '90vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => signOut(() => { window.location.href = '/' })}
          style={{ background: 'none', border: 'none', fontSize: 12, color: '#9CA3AF', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}
        >
          Sign out / use different account
        </button>
      </div>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.04em', marginBottom: 6 }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>Let's set up your account</p>
        </div>

        <div style={{ padding: '8px 0' }}>

          {step === 1 && (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Set up your studio</h1>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 28, lineHeight: 1.5 }}>This is what your clients see when they open their portal.</p>

              <div style={{ marginBottom: 18 }}>
                <label className="field-label">Business name <span style={{ color: 'var(--color-red)' }}>*</span></label>
                <input
                  className="input"
                  type="text"
                  placeholder="Your Photography Studio"
                  value={businessName}
                  onChange={e => { setBusinessName(e.target.value); if (e.target.value.trim()) setBusinessNameError('') }}
                  autoFocus
                />
                {businessNameError && (
                  <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{businessNameError}</p>
                )}
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

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 10, fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                  <input
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={e => setAgreedTerms(e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, accentColor: '#1B4332', flexShrink: 0 }}
                  />
                  I agree to PortalKit's{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: '#1B4332', fontWeight: 600 }}>Terms of Service</a>
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                  <input
                    type="checkbox"
                    checked={agreedPrivacy}
                    onChange={e => setAgreedPrivacy(e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, accentColor: '#1B4332', flexShrink: 0 }}
                  />
                  I have read and agree to the{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#1B4332', fontWeight: 600 }}>Privacy Policy</a>
                </label>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 12 }}>
                Next: add your card to activate your free trial
              </p>

              <button onClick={handleStep1} disabled={saving || !businessName.trim() || !agreedTerms || !agreedPrivacy} className="btn btn-primary" style={{ width: '100%' }}>
                {saving ? 'Saving…' : 'Continue →'}
              </button>
            </>
          )}

          {step === 2 && clientSecret && (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Secure your account</h1>
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
                Add your card to activate your 14-day free trial.
              </p>

              {/* Billing cycle toggle */}
              <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 4, marginBottom: 20, position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setBillingCycle('annual')}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', borderRadius: 6, padding: '10px 12px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    background: billingCycle === 'annual' ? 'white' : 'transparent',
                    color: billingCycle === 'annual' ? '#1B4332' : '#6B7280',
                    boxShadow: billingCycle === 'annual' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  Annual
                  <span style={{ marginLeft: 6, background: '#1B4332', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99 }}>SAVE 26%</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  style={{
                    flex: 1, border: 'none', borderRadius: 6, padding: '10px 12px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    background: billingCycle === 'monthly' ? 'white' : 'transparent',
                    color: billingCycle === 'monthly' ? '#1B4332' : '#6B7280',
                    boxShadow: billingCycle === 'monthly' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  Monthly
                </button>
              </div>

              {/* Dynamic pricing display */}
              <div style={{ textAlign: 'center', marginBottom: 16, padding: '12px 16px', background: '#EAF3DE', borderRadius: 8 }}>
                {billingCycle === 'annual' ? (
                  <>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#1B4332' }}>$29<span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>/month</span></div>
                    <div style={{ fontSize: 13, color: '#4B5563', marginTop: 2 }}>$348 billed today</div>
                    <div style={{ fontSize: 12, color: '#1B4332', fontWeight: 600, marginTop: 2 }}>You save $120/year vs monthly</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#1B4332' }}>$39<span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>/month</span></div>
                    <div style={{ fontSize: 13, color: '#4B5563', marginTop: 2 }}>billed monthly</div>
                  </>
                )}
              </div>

              {/* $0 today callout */}
              <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#166534', margin: 0 }}>💚 $0 due today</p>
                <p style={{ fontSize: 12, color: '#15803D', margin: '2px 0 0', lineHeight: 1.4 }}>
                  Your 14-day free trial starts now. First charge of {billingCycle === 'annual' ? '$348' : '$39'} on {trialEndDate} — cancel anytime before then.
                </p>
              </div>

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
                <CardForm onSuccess={handlePaymentSuccess} onError={setStripeError} billingCycle={billingCycle} />
              </Elements>

              <p style={{ marginTop: 12, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
                By starting your trial you agree to our{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Terms</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Privacy Policy</a>.
                {' '}{billingCycle === 'annual' ? '$348/yr' : '$39/mo'} billed after trial ends on {trialEndDate}.
              </p>

              {stripeError && (
                <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{stripeError}</p>
              )}

              <div style={{ marginTop: 14 }}>
                <button
                  onClick={() => { setStep(1); setStripeError('') }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer' }}
                >
                  ← Back
                </button>
              </div>
            </>
          )}

        </div>
    </div>
  )
}
