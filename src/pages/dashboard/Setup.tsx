import { useState } from 'react'
import { useApi } from '../../lib/api'

export default function Setup() {
  const { authFetch } = useApi()
  const [loading, setLoading] = useState(false)

  const handleRetry = async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/stripe/create-checkout-with-trial', { method: 'post' })
      window.location.href = res.data.url
    } catch {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📸</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--green)', marginBottom: 12 }}>
          One last step
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 8, lineHeight: 1.6 }}>
          Add your payment method to activate your account.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
          You won't be charged for 14 days. We just need your card on file to keep your account active after your trial.
        </p>
        <button
          onClick={handleRetry}
          disabled={loading}
          className="btn btn-primary"
          style={{ width: '100%', fontSize: 16, padding: '14px 28px', marginBottom: 16 }}
        >
          {loading ? 'Loading…' : 'Complete Setup →'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🔒 Secured by Stripe · Cancel anytime · No charge today
        </p>
      </div>
    </div>
  )
}
