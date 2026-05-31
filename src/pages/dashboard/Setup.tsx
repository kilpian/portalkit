import { useState } from 'react'
import UpgradeModal from '../../components/UpgradeModal'

export default function Setup() {
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} />}
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📸</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--green)', marginBottom: 12 }}>
          One last step
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 8, lineHeight: 1.6 }}>
          Add your payment method to activate your account.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
          Activate your subscription to unlock full access. $39/month — cancel anytime.
        </p>
        <button
          onClick={() => setShowUpgradeModal(true)}
          className="btn btn-primary"
          style={{ width: '100%', fontSize: 16, padding: '14px 28px', marginBottom: 16 }}
        >
          Complete Setup →
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🔒 Secured by Stripe · Cancel anytime
        </p>
      </div>
    </div>
  )
}
