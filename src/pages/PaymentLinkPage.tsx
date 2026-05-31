import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'

interface PaymentLinkData {
  id: number
  title: string
  description: string | null
  amount_cents: number | null
  allow_custom_amount: boolean
  min_amount_cents: number
  link_type: 'fixed' | 'tip' | 'custom'
  full_name: string | null
  business_name: string | null
  logo_url: string | null
  brand_color: string | null
  stripe_connect_enabled: boolean
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const TIP_PRESETS = [1000, 2500, 5000, 10000]

function PaymentForm({ link }: { link: PaymentLinkData; stripePromise: ReturnType<typeof loadStripe> }) {
  const stripe = useStripe()
  const elements = useElements()
  const [amount, setAmount] = useState<number>(link.amount_cents || link.min_amount_cents || 100)
  const [customAmount, setCustomAmount] = useState('')
  const [payerName, setPayerName] = useState('')
  const [payerEmail, setPayerEmail] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [paid, setPaid] = useState(false)
  const brandColor = link.brand_color || '#111827'

  if (paid) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Payment successful!</h2>
        <p style={{ fontSize: 15, color: '#6B7280' }}>Thank you for your payment. A receipt has been sent to {payerEmail || 'you'}.</p>
      </div>
    )
  }

  const finalAmount = (link.link_type === 'tip' || link.link_type === 'custom')
    ? (customAmount ? Math.round(parseFloat(customAmount) * 100) : amount)
    : amount

  const handlePay = async () => {
    if (!stripe || !elements) return
    setProcessing(true)
    setError('')
    try {
      const chargeRes = await axios.post(`${API_URL}/api/pay/${link.id}/charge`, {
        amount_cents: finalAmount, payer_name: payerName, payer_email: payerEmail,
      })
      const { client_secret } = chargeRes.data
      const card = elements.getElement(CardElement)
      if (!card) return
      const { error: confirmError } = await stripe.confirmCardPayment(client_secret, {
        payment_method: { card, billing_details: { name: payerName || undefined, email: payerEmail || undefined } },
      })
      if (confirmError) {
        setError(confirmError.message || 'Payment failed')
      } else {
        await axios.post(`${API_URL}/api/pay/${link.id}/confirm`, { payment_intent_id: client_secret.split('_secret_')[0] })
        setPaid(true)
      }
    } catch {
      setError('Payment failed. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {link.link_type === 'tip' && (
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Choose an amount</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {TIP_PRESETS.map(p => (
              <button key={p} onClick={() => { setAmount(p); setCustomAmount('') }} style={{ padding: '8px 16px', borderRadius: 8, border: `2px solid ${amount === p && !customAmount ? brandColor : '#E5E7EB'}`, background: amount === p && !customAmount ? brandColor : '#fff', color: amount === p && !customAmount ? '#fff' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {formatCents(p)}
              </button>
            ))}
          </div>
          <input type="number" min="1" step="1" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="Or enter custom amount" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
      )}
      {link.link_type === 'custom' && (
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Amount (USD)</label>
          <input type="number" min={(link.min_amount_cents || 100) / 100} step="1" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="Enter amount" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} required />
        </div>
      )}
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Your Name</label>
        <input type="text" value={payerName} onChange={e => setPayerName(e.target.value)} placeholder="Jane Smith" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
      </div>
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Email (for receipt)</label>
        <input type="email" value={payerEmail} onChange={e => setPayerEmail(e.target.value)} placeholder="jane@example.com" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
      </div>
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Card Details</label>
        <div style={{ border: '1px solid #D1D5DB', borderRadius: 8, padding: '12px 14px', background: '#fff' }}>
          <CardElement options={{ style: { base: { fontSize: '14px', color: '#111827', '::placeholder': { color: '#9CA3AF' } } } }} />
        </div>
      </div>
      {error && <p style={{ fontSize: 13, color: '#DC2626' }}>{error}</p>}
      <button onClick={handlePay} disabled={processing || !stripe} style={{ background: brandColor, color: '#fff', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>
        {processing ? 'Processing...' : `Pay ${formatCents(finalAmount)}`}
      </button>
    </div>
  )
}

export default function PaymentLinkPage() {
  const { linkId } = useParams<{ linkId: string }>()
  const [link, setLink] = useState<PaymentLinkData | null>(null)
  const [error, setError] = useState('')
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)

  useEffect(() => {
    if (!linkId) return
    axios.get<PaymentLinkData>(`${API_URL}/api/pay/${linkId}`)
      .then(r => {
        setLink(r.data)
        if (r.data.stripe_connect_enabled && import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) {
          setStripePromise(loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string))
        }
      })
      .catch(() => setError('Payment link not found or is no longer active.'))
  }, [linkId])

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '40px 32px', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <p style={{ fontSize: 16, color: '#374151' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!link) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
        <p style={{ color: '#9CA3AF' }}>Loading...</p>
      </div>
    )
  }

  const businessName = link.business_name || link.full_name || 'Your photographer'
  const brandColor = link.brand_color || '#111827'

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>
      <div style={{ background: brandColor, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {link.logo_url && (
          <img src={link.logo_url} alt={businessName} style={{ height: 28, width: 28, objectFit: 'contain', borderRadius: 6, background: '#fff', padding: 3 }} />
        )}
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{businessName}</span>
      </div>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 20px 80px' }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '28px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 6 }}>{link.title}</h1>
          {link.description && <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 20, lineHeight: 1.6 }}>{link.description}</p>}
          {link.link_type === 'fixed' && link.amount_cents && (
            <p style={{ fontSize: 28, fontWeight: 800, color: brandColor, marginBottom: 20 }}>{formatCents(link.amount_cents)}</p>
          )}

          {!link.stripe_connect_enabled ? (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '14px 16px' }}>
              <p style={{ fontSize: 13, color: '#92400E', margin: 0 }}>Online payments are not currently enabled for this link.</p>
            </div>
          ) : stripePromise ? (
            <Elements stripe={stripePromise}>
              <PaymentForm link={link} stripePromise={stripePromise} />
            </Elements>
          ) : (
            <p style={{ fontSize: 13, color: '#9CA3AF' }}>Loading payment form...</p>
          )}
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginTop: 20 }}>
          Powered by <a href="https://getportalkit.com" target="_blank" rel="noopener noreferrer" style={{ color: '#1B4332', fontWeight: 600, textDecoration: 'none' }}>PortalKit</a>
        </p>
      </div>
    </div>
  )
}
