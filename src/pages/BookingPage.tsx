import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { API_BASE } from '../lib/api'
import type { SessionType } from '../lib/api'

type Step = 'type' | 'date' | 'time' | 'form' | 'confirm'

interface Photographer {
  full_name: string
  business_name?: string
  logo_url?: string | null
  brand_color?: string | null
}

export default function BookingPage() {
  const { username } = useParams<{ username: string }>()
  const [photographer, setPhotographer] = useState<Photographer | null>(null)
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([])
  const [notFound, setNotFound] = useState(false)
  const [step, setStep] = useState<Step>('type')

  const [selectedType, setSelectedType] = useState<SessionType | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [booked, setBooked] = useState(false)

  useEffect(() => {
    axios.get(`${API_BASE}/api/book/${username}`)
      .then(r => {
        setPhotographer(r.data.photographer)
        setSessionTypes(r.data.session_types)
      })
      .catch(() => setNotFound(true))
  }, [username])

  const fetchSlots = async (date: string) => {
    if (!selectedType) return
    setSlotsLoading(true)
    try {
      const r = await axios.get(`${API_BASE}/api/book/${username}/availability`, {
        params: { date, session_type_id: selectedType.id }
      })
      setAvailableSlots(r.data.slots)
    } catch {
      setAvailableSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }

  const handleDateChange = (date: string) => {
    setSelectedDate(date)
    setSelectedTime('')
    if (date) fetchSlots(date)
  }

  const handleBook = async () => {
    if (!form.name || !form.email) return
    setSubmitting(true)
    try {
      await axios.post(`${API_BASE}/api/book/${username}/book`, {
        session_type_id: selectedType!.id,
        booking_date: selectedDate,
        start_time: selectedTime,
        client_name: form.name,
        client_email: form.email,
        client_phone: form.phone || null,
        notes: form.notes || null,
      })
      setBooked(true)
    } catch {} finally {
      setSubmitting(false)
    }
  }

  const accentColor = photographer?.brand_color || '#111827'

  const minDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })()

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 20, color: '#111827' }}>Booking page not found</h2>
          <p style={{ color: '#6B7280', fontSize: 14 }}>This link may be invalid or the photographer is no longer accepting bookings.</p>
        </div>
      </div>
    )
  }

  if (!photographer) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
        <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
      </div>
    )
  }

  if (booked) {
    return (
      <div style={{ minHeight: '100vh', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>You're booked!</h2>
          <p style={{ color: '#6B7280', fontSize: 14, lineHeight: 1.6 }}>
            Your session with <strong>{photographer.business_name || photographer.full_name}</strong> has been requested.<br />
            You'll receive a confirmation email at {form.email} once it's confirmed.
          </p>
          <div style={{ marginTop: 20, background: '#F9FAFB', borderRadius: 10, padding: 16, textAlign: 'left' }}>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}><strong>{selectedType?.name}</strong></div>
            <div style={{ fontSize: 13, color: '#6B7280' }}>
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {selectedTime}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const stepDot = (s: Step, label: string, num: number) => {
    const active = step === s
    const done = ['type', 'date', 'time', 'form', 'confirm'].indexOf(step) > ['type', 'date', 'time', 'form', 'confirm'].indexOf(s)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done ? accentColor : active ? accentColor : '#E5E7EB',
          color: done || active ? '#fff' : '#9CA3AF',
          fontSize: 12, fontWeight: 700,
        }}>{done ? '✓' : num}</div>
        <span style={{ fontSize: 12, fontWeight: 500, color: active ? '#111827' : done ? '#374151' : '#9CA3AF' }}>{label}</span>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
        {photographer.logo_url && (
          <img src={photographer.logo_url} alt="logo" style={{ height: 36, width: 36, objectFit: 'contain', borderRadius: 6 }} />
        )}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{photographer.business_name || photographer.full_name}</div>
          <div style={{ fontSize: 12, color: '#9CA3AF' }}>Book a session</div>
        </div>
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '32px 20px' }}>
        {/* Progress */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
          {stepDot('type', 'Session', 1)}
          <div style={{ width: 20, height: 1, background: '#E5E7EB', alignSelf: 'center' }} />
          {stepDot('date', 'Date', 2)}
          <div style={{ width: 20, height: 1, background: '#E5E7EB', alignSelf: 'center' }} />
          {stepDot('time', 'Time', 3)}
          <div style={{ width: 20, height: 1, background: '#E5E7EB', alignSelf: 'center' }} />
          {stepDot('form', 'Your Info', 4)}
        </div>

        <div style={{ background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {/* Step 1: Select session type */}
          {step === 'type' && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>Choose a session type</h2>
              {sessionTypes.length === 0 ? (
                <p style={{ color: '#9CA3AF', fontSize: 14 }}>No session types available.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sessionTypes.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setSelectedType(t); setStep('date') }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                        border: `2px solid ${selectedType?.id === t.id ? accentColor : '#E5E7EB'}`,
                        borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                          {t.duration_minutes} min · ${(t.price_cents / 100).toFixed(0)}
                        </div>
                        {t.description && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{t.description}</div>}
                      </div>
                      <div style={{ fontSize: 18, color: '#D1D5DB' }}>›</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Select date */}
          {step === 'date' && (
            <div>
              <button onClick={() => setStep('type')} style={{ fontSize: 13, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Back</button>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>Choose a date</h2>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px' }}>{selectedType?.name} · {selectedType?.duration_minutes} min</p>
              <input
                type="date"
                min={minDate}
                value={selectedDate}
                onChange={e => handleDateChange(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              />
              {selectedDate && (
                <button
                  onClick={() => setStep('time')}
                  style={{ marginTop: 16, width: '100%', padding: '10px', background: accentColor, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  Next: Pick a time
                </button>
              )}
            </div>
          )}

          {/* Step 3: Select time */}
          {step === 'time' && (
            <div>
              <button onClick={() => setStep('date')} style={{ fontSize: 13, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Back</button>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>Pick a time</h2>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px' }}>
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              {slotsLoading ? (
                <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading available times...</p>
              ) : availableSlots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>No times available on this date</p>
                  <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 16px' }}>Try a different date — or reach out directly to {photographer?.business_name || photographer?.full_name}.</p>
                  <button onClick={() => setStep('date')} style={{ padding: '8px 20px', background: accentColor, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Try another date</button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {availableSlots.map(slot => (
                    <button
                      key={slot}
                      onClick={() => { setSelectedTime(slot); setStep('form') }}
                      style={{
                        padding: '10px 6px', border: `2px solid ${selectedTime === slot ? accentColor : '#E5E7EB'}`,
                        borderRadius: 8, background: selectedTime === slot ? accentColor : '#fff',
                        color: selectedTime === slot ? '#fff' : '#374151',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Contact form */}
          {step === 'form' && (
            <div>
              <button onClick={() => setStep('time')} style={{ fontSize: 13, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Back</button>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>Your information</h2>
              <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#374151' }}>
                <strong>{selectedType?.name}</strong> · {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {selectedTime}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Full Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Jane Smith"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="jane@example.com"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="(555) 000-0000"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Anything you'd like the photographer to know..."
                    rows={3}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  onClick={handleBook}
                  disabled={submitting || !form.name || !form.email}
                  style={{
                    padding: '12px', background: accentColor, color: '#fff', border: 'none',
                    borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: submitting ? 'default' : 'pointer',
                    opacity: (!form.name || !form.email) ? 0.5 : 1,
                  }}
                >
                  {submitting ? 'Requesting...' : 'Request Booking'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#D1D5DB', marginTop: 24 }}>
          Powered by PortalKit
        </p>
      </div>
    </div>
  )
}
