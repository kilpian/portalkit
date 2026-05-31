import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import posthog from 'posthog-js'
import { usePortalAuth } from '../context/AuthContext'
import { useApi } from '../lib/api'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
if (!STRIPE_KEY) throw new Error('Missing VITE_STRIPE_PUBLISHABLE_KEY')
// Clerk key must NEVER be used here — it lives only in main.tsx for ClerkProvider
const stripePromise = loadStripe(STRIPE_KEY)

function ActivateForm({ onSuccess, onError }: { onSuccess: () => void; onError: (msg: string) => void }) {
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

      // immediate=true → activate the subscription now (no second free trial)
      await authFetch('/api/stripe/confirm-setup', {
        method: 'post',
        data: { paymentMethodId: paymentMethod.id, immediate: true },
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
      {cardError && <p style={{ color: '#A32D2D', fontSize: 12, marginBottom: 8 }}>{cardError}</p>}
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
        {saving ? 'Activating…' : 'Activate Now →'}
      </button>
    </div>
  )
}

export default function UpgradeModal({ onClose, clientCount }: { onClose: () => void; clientCount?: number }) {
  const { authFetch } = useApi()
  const { setUser } = usePortalAuth()
  const [clientSecret, setClientSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [stripeError, setStripeError] = useState('')
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    let cancelled = false
    authFetch('/api/stripe/create-setup-intent', { method: 'post' })
      .then(res => { if (!cancelled) setClientSecret(res.data.clientSecret) })
      .catch(() => { if (!cancelled) setLoadError('Could not start checkout. Please try again.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSuccess = async () => {
    posthog.capture('upgrade_activated')
    setActivated(true)
    try {
      const res = await authFetch('/api/auth/me', { method: 'get' })
      if (res?.data?.id) setUser(res.data)
    } catch {
      // user state refresh is best-effort; webhook will also reconcile
    }
    setTimeout(() => onClose(), 1800)
  }

  const renewDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ padding: '36px 32px', maxWidth: 440, width: '100%', position: 'relative' }}>
        {!activated && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: 'var(--text-dim)', cursor: 'pointer' }}
          >
            ×
          </button>
        )}

        {activated ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Subscription activated</h2>
            <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>Your data is unlocked. Welcome back!</p>
          </div>
        ) : (
          <>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>Activate your subscription</h2>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
              $39/month — cancel anytime.
              {typeof clientCount === 'number' && clientCount > 0
                ? ` ${clientCount} client${clientCount === 1 ? '' : 's'} waiting (upgrade to view).`
                : ''}
            </p>

            <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>💳</span>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#166534', margin: 0 }}>$39 due today</p>
                <p style={{ fontSize: 12, color: '#15803D', margin: '2px 0 0', lineHeight: 1.4 }}>
                  Your trial has ended. You'll be charged $39 today to reactivate, then $39/mo on {renewDate}. Cancel anytime.
                </p>
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-dim)', fontSize: 14 }}>Loading secure checkout…</div>
            ) : loadError ? (
              <p style={{ color: '#A32D2D', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>{loadError}</p>
            ) : clientSecret ? (
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
                <ActivateForm onSuccess={handleSuccess} onError={setStripeError} />
              </Elements>
            ) : null}

            {stripeError && (
              <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{stripeError}</p>
            )}

            <p style={{ marginTop: 12, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
              By activating you agree to our{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Terms</a>
              {' '}and{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)' }}>Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
