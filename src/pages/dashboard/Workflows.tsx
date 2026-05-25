import { useState, useEffect } from 'react'
import { useApi } from '../../lib/api'
import type { WorkflowSettings } from '../../lib/api'

interface Toggle {
  key: keyof WorkflowSettings
  label: string
  description: string
  icon: string
}

const TOGGLES: Toggle[] = [
  {
    key: 'send_welcome_on_client_create',
    label: 'Welcome email on new client',
    description: 'Automatically send a welcome message when you add a new client.',
    icon: '👋',
  },
  {
    key: 'send_contract_reminder_3_days',
    label: 'Contract reminder (3 days)',
    description: 'Send a reminder if a contract hasn\'t been signed 3 days after it was sent.',
    icon: '📝',
  },
  {
    key: 'send_balance_reminder_7_days',
    label: 'Balance due reminder (7 days)',
    description: 'Send a payment reminder 7 days before the event date for unpaid invoices.',
    icon: '💳',
  },
  {
    key: 'send_questionnaire_on_booking',
    label: 'Questionnaire on booking confirmation',
    description: 'Automatically send the first questionnaire template when a booking is confirmed.',
    icon: '📋',
  },
  {
    key: 'send_thank_you_on_delivery',
    label: 'Thank-you on gallery delivery',
    description: 'Send a thank-you message when you move a client to "Delivered" stage.',
    icon: '🎉',
  },
]

const defaults: WorkflowSettings = {
  id: 0,
  user_id: 0,
  send_welcome_on_client_create: false,
  send_contract_reminder_3_days: false,
  send_balance_reminder_7_days: false,
  send_questionnaire_on_booking: false,
  send_thank_you_on_delivery: false,
  welcome_message: null,
  thank_you_message: null,
}

export default function Workflows() {
  const { authFetch } = useApi()
  const [settings, setSettings] = useState<WorkflowSettings>(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandedMessage, setExpandedMessage] = useState<'welcome' | 'thankyou' | null>(null)

  useEffect(() => {
    authFetch('/api/workflow-settings')
      .then(r => setSettings(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggle = (key: keyof WorkflowSettings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await authFetch('/api/workflow-settings', { method: 'put', data: settings })
      setSettings(res.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {} finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px' }}>
        <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 }}>Workflows</h1>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 6 }}>Automate emails and actions based on client activity.</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: saved ? '#059669' : '#111827', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
          }}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {TOGGLES.map(({ key, label, description, icon }) => {
          const enabled = !!settings[key]
          const isWelcome = key === 'send_welcome_on_client_create'
          const isThankYou = key === 'send_thank_you_on_delivery'
          const hasMessage = isWelcome || isThankYou

          return (
            <div
              key={key}
              style={{
                background: '#fff', border: `1px solid ${enabled ? '#E0E7FF' : '#E5E7EB'}`,
                borderRadius: 12, padding: '18px 20px',
                boxShadow: enabled ? '0 0 0 2px rgba(99,102,241,0.08)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 24, flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{label}</div>
                    <button
                      onClick={() => toggle(key)}
                      style={{
                        width: 44, height: 24, borderRadius: 12, border: 'none',
                        background: enabled ? '#6366F1' : '#D1D5DB',
                        cursor: 'pointer', position: 'relative', flexShrink: 0,
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', background: '#fff',
                        position: 'absolute', top: 3,
                        left: enabled ? 23 : 3,
                        transition: 'left 0.15s',
                      }} />
                    </button>
                  </div>
                  <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{description}</div>

                  {hasMessage && enabled && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        onClick={() => setExpandedMessage(
                          expandedMessage === (isWelcome ? 'welcome' : 'thankyou') ? null :
                          isWelcome ? 'welcome' : 'thankyou'
                        )}
                        style={{ fontSize: 12, color: '#6366F1', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
                      >
                        {expandedMessage === (isWelcome ? 'welcome' : 'thankyou') ? '▲ Hide' : '▼ Customize message'}
                      </button>

                      {expandedMessage === (isWelcome ? 'welcome' : 'thankyou') && (
                        <div style={{ marginTop: 8 }}>
                          <textarea
                            value={isWelcome ? (settings.welcome_message || '') : (settings.thank_you_message || '')}
                            onChange={e => setSettings(prev => ({
                              ...prev,
                              [isWelcome ? 'welcome_message' : 'thank_you_message']: e.target.value || null
                            }))}
                            placeholder={isWelcome
                              ? "Hi {client_name}, welcome! I'm so excited to work with you..."
                              : "Thank you so much for choosing me for your special day! Your gallery is ready..."}
                            rows={4}
                            style={{
                              width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB',
                              borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
                              fontFamily: 'inherit',
                            }}
                          />
                          <p style={{ fontSize: 11, color: '#9CA3AF', margin: '4px 0 0' }}>
                            Use <code>{'{client_name}'}</code> to personalize with the client's name.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 24, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, color: '#0369A1', fontWeight: 500, marginBottom: 4 }}>How workflows work</div>
        <div style={{ fontSize: 13, color: '#0C4A6E', lineHeight: 1.6 }}>
          Workflows run automatically when specific events happen — no manual action needed. Email reminders are sent once per client to avoid duplicates. You can turn any workflow on or off at any time.
        </div>
      </div>
    </div>
  )
}
