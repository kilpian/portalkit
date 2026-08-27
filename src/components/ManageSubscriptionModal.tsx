import { useState, useEffect, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useApi } from '../lib/api'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
if (!STRIPE_KEY) throw new Error('Missing VITE_STRIPE_PUBLISHABLE_KEY')
const stripePromise = loadStripe(STRIPE_KEY)

interface SubscriptionData {
  status: string
  cancel_at_period_end: boolean
  current_period_end: number
  amount: number | null
  currency: string
  interval: string | null
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null
}

function formatMoney(cents: number, currency: string) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() })
}

function UpdateCardForm({ onSuccess, onError }: { onSuccess: () => void; onError: (msg: string) => void }) {
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
      const { error: submitError } = await elements.submit()
      if (submitError) throw new Error(submitError.message)

      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      })
      if (error) throw new Error(error.message)
      if (!setupIntent?.payment_method) throw new Error('Could not confirm payment method')

      await authFetch('/api/stripe/confirm-setup', {
        method: 'post',
        data: { paymentMethodId: setupIntent.payment_method, immediate: true },
      })
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update payment method'
      setCardError(msg)
      onError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PaymentElement options={{ layout: 'tabs' }} />
      {cardError && <p style={{ color: '#DC2626', fontSize: 12, marginTop: 8 }}>{cardError}</p>}
      <button
        onClick={handleSubmit}
        disabled={saving || !stripe}
        style={{ width: '100%', marginTop: 12, background: '#1B4332', color: '#fff', border: 'none', padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Saving…' : 'Save Payment Method'}
      </button>
    </div>
  )
}

export default function ManageSubscriptionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { authFetch } = useApi()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sub, setSub] = useState<SubscriptionData | null>(null)

  const [showUpdateCard, setShowUpdateCard] = useState(false)
  const [clientSecret, setClientSecret] = useState('')
  const [cardMsg, setCardMsg] = useState('')

  const [cancelConfirming, setCancelConfirming] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const [portalLoading, setPortalLoading] = useState(false)

  const fetchSubscription = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await authFetch('/api/stripe/subscription', { method: 'get' })
      setSub(res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setLoadError(msg || 'Could not load your subscription details.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    fetchSubscription()
    setShowUpdateCard(false)
    setClientSecret('')
    setCardMsg('')
    setCancelConfirming(false)
    setCancelError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const startUpdateCard = async () => {
    setShowUpdateCard(true)
    setCardMsg('')
    try {
      const res = await authFetch('/api/stripe/create-setup-intent', { method: 'post' })
      setClientSecret(res.data.clientSecret)
    } catch {
      setCardMsg('Could not start card update. Please try again.')
    }
  }

  const handleCardSuccess = () => {
    setCardMsg('Payment method updated.')
    setShowUpdateCard(false)
    fetchSubscription()
  }

  const handleCancel = async () => {
    setCanceling(true)
    setCancelError('')
    try {
      await authFetch('/api/stripe/cancel-subscription', { method: 'post' })
      setCancelConfirming(false)
      fetchSubscription()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setCancelError(msg || 'Could not cancel subscription.')
    } finally {
      setCanceling(false)
    }
  }

  const openBillingHistory = async () => {
    setPortalLoading(true)
    // Fallback only. Stripe's hosted Billing Portal can't be embedded, so
    // this opens in a genuine new tab — not the small popup-window approach
    // (had a confirmed focus/relocate bug) and not a redirect of this tab.
    const tab = window.open('', '_blank')
    try {
      const res = await authFetch('/api/stripe/create-portal', { method: 'post' })
      if (tab) {
        tab.opener = null
        tab.location.href = res.data.url
      } else {
        window.open(res.data.url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      tab?.close()
    } finally {
      setPortalLoading(false)
    }
  }

  if (!open) return null

  const periodEndLabel = sub
    ? new Date(sub.current_period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 14, padding: 28, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1B4332', margin: 0 }}>Manage Subscription</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9CA3AF' }}>✕</button>
        </div>

        {loading ? (
          <p style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', padding: '20px 0' }}>Loading your subscription…</p>
        ) : loadError ? (
          <p style={{ fontSize: 13, color: '#DC2626', textAlign: 'center', padding: '12px 0' }}>{loadError}</p>
        ) : sub ? (
          <>
            {/* Current plan */}
            <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', margin: '0 0 4px' }}>
                PortalKit All-In — {sub.interval === 'year' ? 'Annual' : 'Monthly'}
              </p>
              <p style={{ fontSize: 20, fontWeight: 800, color: '#1B4332', margin: 0 }}>
                {sub.amount !== null ? formatMoney(sub.amount, sub.currency) : '—'}
                <span style={{ fontSize: 13, fontWeight: 500, color: '#6B7280' }}> / {sub.interval === 'year' ? 'year' : 'month'}</span>
              </p>
              {sub.cancel_at_period_end ? (
                <p style={{ fontSize: 13, color: '#B45309', marginTop: 8 }}>
                  Your subscription is set to cancel on <strong>{periodEndLabel}</strong>. You'll keep full access until then.
                </p>
              ) : (
                <p style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>
                  Next billing date: <strong style={{ color: '#374151' }}>{periodEndLabel}</strong>
                </p>
              )}
              {sub.card && (
                <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6, textTransform: 'capitalize' }}>
                  {sub.card.brand} ending in {sub.card.last4} · expires {String(sub.card.exp_month).padStart(2, '0')}/{sub.card.exp_year}
                </p>
              )}
            </div>

            {/* Update payment method */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showUpdateCard ? 12 : 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: 0 }}>Payment Method</p>
                {!showUpdateCard && (
                  <button onClick={startUpdateCard} className="btn btn-ghost btn-sm">Update</button>
                )}
              </div>
              {cardMsg && (
                <p style={{ fontSize: 13, color: cardMsg.includes('updated') ? '#059669' : '#DC2626', marginTop: 8 }}>{cardMsg}</p>
              )}
              {showUpdateCard && (
                <>
                  {clientSecret ? (
                    <Elements
                      stripe={stripePromise}
                      options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#1B4332', fontFamily: 'Inter, sans-serif' } } }}
                    >
                      <UpdateCardForm onSuccess={handleCardSuccess} onError={setCardMsg} />
                    </Elements>
                  ) : (
                    <p style={{ fontSize: 13, color: '#6B7280' }}>Loading secure form…</p>
                  )}
                  <button
                    onClick={() => { setShowUpdateCard(false); setCardMsg('') }}
                    style={{ marginTop: 8, fontSize: 12, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {/* Cancel subscription — same inline confirm/cancel swap pattern
                used throughout the rest of the app; no popup. */}
            {!sub.cancel_at_period_end && (
              <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 16 }}>
                {cancelError && <p style={{ fontSize: 13, color: '#DC2626', marginBottom: 8 }}>{cancelError}</p>}
                {cancelConfirming ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: '#991B1B' }}>Cancel at the end of your billing period?</span>
                    <button
                      onClick={handleCancel}
                      disabled={canceling}
                      style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
                    >
                      {canceling ? 'Cancelling…' : 'Confirm'}
                    </button>
                    <button onClick={() => setCancelConfirming(false)} className="btn btn-ghost btn-sm">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setCancelConfirming(true)}
                    style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Cancel Subscription
                  </button>
                )}
              </div>
            )}

            {/* Secondary fallback only */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button
                onClick={openBillingHistory}
                disabled={portalLoading}
                style={{ fontSize: 12, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {portalLoading ? 'Opening…' : 'View full billing history →'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
