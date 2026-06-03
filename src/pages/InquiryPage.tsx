import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'

interface LeadFormData {
  id: number
  headline: string
  subheadline: string | null
  fields: string[]
  brand_color: string
  business_name: string | null
  full_name: string | null
  logo_url: string | null
}

export default function InquiryPage() {
  const { username } = useParams<{ username: string }>()
  const [form, setForm] = useState<LeadFormData | null>(null)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!username) return
    axios.get<LeadFormData>(`${API_URL}/api/lead/${username}`)
      .then(r => setForm(r.data))
      .catch(() => setError('This inquiry form is not available.'))
  }, [username])

  const set = (key: string, val: string) => setValues(prev => ({ ...prev, [key]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.name?.trim()) { setFormError('Your name is required.'); return }
    setFormError('')
    setSubmitting(true)
    try {
      await axios.post(`${API_URL}/api/lead/${username}/submit`, {
        name: values.name?.trim(),
        email: values.email?.trim() || undefined,
        phone: values.phone?.trim() || undefined,
        event_type: values.event_type?.trim() || undefined,
        event_date: values.event_date || undefined,
        message: values.message?.trim() || undefined,
      })
      setSubmitted(true)
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '40px 32px', textAlign: 'center', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <p style={{ fontSize: 16, color: '#374151' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!form) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
        <p style={{ color: '#9CA3AF' }}>Loading...</p>
      </div>
    )
  }

  const brandColor = form.brand_color || '#1B4332'

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '48px 36px', textAlign: 'center', maxWidth: 440, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: brandColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 20px' }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Thank you!</h2>
          <p style={{ fontSize: 15, color: '#6B7280', lineHeight: 1.6 }}>Your inquiry has been submitted. We'll be in touch soon!</p>
        </div>
      </div>
    )
  }

  const businessName = form.business_name || form.full_name || 'Photography'

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>
      <header style={{ background: brandColor, padding: '24px 24px 28px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {form.logo_url && (
            <img src={form.logo_url} alt={businessName} style={{ height: 44, width: 44, objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 4 }} />
          )}
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.2 }}>{businessName}</h1>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, margin: '2px 0 0' }}>Wedding Photography</p>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '48px 20px 80px' }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: brandColor, marginBottom: 10 }}>{form.headline}</h2>
          {form.subheadline && <p style={{ fontSize: 15, color: '#6B7280', lineHeight: 1.6 }}>{form.subheadline}</p>}
        </div>

        <form onSubmit={handleSubmit} style={{ background: '#fff', borderRadius: 14, padding: '28px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {formError && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>{formError}</div>}

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Full Name <span style={{ color: '#DC2626' }}>*</span></label>
            <input type="text" value={values.name || ''} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" required style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Email</label>
            <input type="email" value={values.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Phone</label>
            <input type="tel" value={values.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+1 (555) 000-0000" style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Event Type</label>
            <input type="text" value={values.event_type || ''} onChange={e => set('event_type', e.target.value)} placeholder="Wedding, Portrait, Engagement…" style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Event Date</label>
            <input type="date" value={values.event_date || ''} onChange={e => set('event_date', e.target.value)} min={new Date().toISOString().split('T')[0]} style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Message</label>
            <textarea value={values.message || ''} onChange={e => set('message', e.target.value)} placeholder="Tell us about your event or what you're looking for…" rows={4} style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{ background: brandColor, color: '#fff', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}
          >
            {submitting ? 'Sending...' : 'Send Inquiry'}
          </button>
        </form>
      </div>
    </div>
  )
}
