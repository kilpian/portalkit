import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../lib/api'

interface ChecklistSteps {
  first_client: boolean
  send_contract: boolean
  booking_page: boolean
  stripe_connect: boolean
  branding: boolean
}

interface ChecklistStatusResponse {
  dismissed: boolean
  steps: ChecklistSteps
}

const STEP_DEFS: { key: keyof ChecklistSteps; label: string; to: string; actionLabel: string }[] = [
  { key: 'first_client', label: 'Create your first client', to: '/dashboard/clients', actionLabel: 'Add client' },
  { key: 'send_contract', label: 'Send a contract', to: '/dashboard/contracts', actionLabel: 'Go to Contracts' },
  { key: 'booking_page', label: 'Set up your booking page', to: '/dashboard/booking', actionLabel: 'Go to Booking' },
  { key: 'stripe_connect', label: 'Connect Stripe to get paid', to: '/dashboard/settings', actionLabel: 'Go to Settings' },
  { key: 'branding', label: 'Customize your portal branding', to: '/dashboard/settings', actionLabel: 'Go to Settings' },
]

export default function OnboardingChecklist() {
  const { authFetch } = useApi()
  const [status, setStatus] = useState<ChecklistStatusResponse | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    authFetch('/api/onboarding/checklist-status', { method: 'get' })
      .then(res => setStatus(res.data))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = () => {
    setHidden(true)
    authFetch('/api/onboarding/checklist-dismiss', { method: 'post' }).catch(() => {})
  }

  // Once every step is complete, dismiss automatically instead of leaving a
  // "5 of 5" card sitting there — the person's already done what it asked.
  useEffect(() => {
    if (!status || status.dismissed || hidden) return
    if (STEP_DEFS.every(s => status.steps[s.key])) dismiss()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  if (!status || status.dismissed || hidden) return null
  const completedCount = STEP_DEFS.filter(s => status.steps[s.key]).length
  if (completedCount === STEP_DEFS.length) return null // about to auto-dismiss — avoid a flash at "5 of 5"

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', margin: 0 }}>Get set up</h2>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '2px 0 0' }}>{completedCount} of {STEP_DEFS.length} done</p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, padding: 4 }}
        >
          ✕
        </button>
      </div>
      <div style={{ padding: '4px 20px' }}>
        {STEP_DEFS.map((step, i) => {
          const complete = status.steps[step.key]
          return (
            <div
              key={step.key}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '12px 0', borderBottom: i < STEP_DEFS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {complete ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="11" fill="var(--color-green)" />
                    <path d="M7 12.5l3 3 7-7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="11" stroke="var(--border)" strokeWidth="2" />
                  </svg>
                )}
                <span style={{ fontSize: 13, fontWeight: 600, color: complete ? 'var(--text-dim)' : 'var(--text-primary)', textDecoration: complete ? 'line-through' : 'none' }}>
                  {step.label}
                </span>
              </div>
              {!complete && (
                <Link to={step.to} style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                  {step.actionLabel} →
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
