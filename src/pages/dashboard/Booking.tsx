import { useState, useEffect } from 'react'
import { useApi } from '../../lib/api'
import type { SessionType, AvailabilitySlot, Booking } from '../../lib/api'
import { usePortalAuth } from '../../context/AuthContext'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const COLORS = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0891B2', '#BE185D']

const defaultSlots: AvailabilitySlot[] = [1, 2, 3, 4, 5].map(d => ({
  day_of_week: d,
  start_time: '09:00',
  end_time: '17:00',
  active: true,
}))

export default function BookingPage() {
  const { authFetch } = useApi()
  const { user } = usePortalAuth()
  const [tab, setTab] = useState<'types' | 'availability' | 'bookings'>('types')

  // Session types
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([])
  const [editingType, setEditingType] = useState<Partial<SessionType> | null>(null)
  const [showTypeForm, setShowTypeForm] = useState(false)
  const [typeLoading, setTypeLoading] = useState(false)

  // Availability
  const [slots, setSlots] = useState<AvailabilitySlot[]>(defaultSlots)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsSaved, setSlotsSaved] = useState(false)
  const [slotsFromDb, setSlotsFromDb] = useState(false)

  // Bookings
  const [bookings, setBookings] = useState<Booking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(false)

  useEffect(() => {
    fetchSessionTypes()
    fetchAvailability()
    fetchBookings()
  }, [])

  const fetchSessionTypes = async () => {
    try {
      const res = await authFetch('/api/session-types')
      setSessionTypes(res.data)
    } catch {}
  }

  const fetchAvailability = async () => {
    try {
      const res = await authFetch('/api/availability')
      if (res.data.length > 0) {
        setSlots(res.data)
        setSlotsFromDb(true)
      }
    } catch {}
  }

  const fetchBookings = async () => {
    setBookingsLoading(true)
    try {
      const res = await authFetch('/api/bookings')
      setBookings(res.data)
    } catch {} finally {
      setBookingsLoading(false)
    }
  }

  const saveSessionType = async () => {
    if (!editingType?.name || !editingType.duration_minutes || editingType.price_cents === undefined) return
    setTypeLoading(true)
    try {
      if (editingType.id) {
        await authFetch(`/api/session-types/${editingType.id}`, { method: 'put', data: editingType })
      } else {
        await authFetch('/api/session-types', { method: 'post', data: editingType })
      }
      await fetchSessionTypes()
      setShowTypeForm(false)
      setEditingType(null)
    } catch {} finally {
      setTypeLoading(false)
    }
  }

  const deleteSessionType = async (id: number) => {
    if (!confirm('Deactivate this session type?')) return
    try {
      await authFetch(`/api/session-types/${id}`, { method: 'delete' })
      await fetchSessionTypes()
    } catch {}
  }

  const saveAvailability = async () => {
    setSlotsLoading(true)
    try {
      await authFetch('/api/availability', { method: 'put', data: { slots } })
      setSlotsSaved(true)
      setSlotsFromDb(true)
      setTimeout(() => setSlotsSaved(false), 2000)
    } catch {} finally {
      setSlotsLoading(false)
    }
  }

  const updateSlot = (day: number, field: keyof AvailabilitySlot, value: unknown) => {
    setSlots(prev => {
      const existing = prev.find(s => s.day_of_week === day)
      if (existing) {
        return prev.map(s => s.day_of_week === day ? { ...s, [field]: value } : s)
      }
      return [...prev, { day_of_week: day, start_time: '09:00', end_time: '17:00', active: false, [field]: value }]
    })
  }

  const getSlot = (day: number): AvailabilitySlot => {
    return slots.find(s => s.day_of_week === day) || { day_of_week: day, start_time: '09:00', end_time: '17:00', active: false }
  }

  const updateBookingStatus = async (id: number, status: string) => {
    try {
      await authFetch(`/api/bookings/${id}/status`, { method: 'patch', data: { status } })
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: status as Booking['status'] } : b))
    } catch {}
  }

  const bookingLink = user?.booking_username
    ? `getportalkit.com/book/${user.booking_username}`
    : null

  const tabStyle = (t: string) => ({
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    background: tab === t ? '#111827' : 'transparent',
    color: tab === t ? '#fff' : '#6B7280',
    fontSize: 14,
  })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 }}>Booking</h1>
        {bookingLink && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>Your booking link:</span>
            <a
              href={`https://${bookingLink}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13, color: '#2563EB', fontWeight: 500 }}
            >
              {bookingLink}
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(`https://${bookingLink}`)}
              style={{ fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
            >
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#F9FAFB', borderRadius: 10, padding: 4, marginBottom: 28, width: 'fit-content' }}>
        <button style={tabStyle('types')} onClick={() => setTab('types')}>Session Types</button>
        <button style={tabStyle('availability')} onClick={() => setTab('availability')}>Availability</button>
        <button style={tabStyle('bookings')} onClick={() => setTab('bookings')}>Bookings</button>
      </div>

      {/* Session Types */}
      {tab === 'types' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: '#111827', margin: 0 }}>Session Types</h2>
            <button
              onClick={() => { setEditingType({ name: '', duration_minutes: 60, price_cents: 0, description: '', active: true, color: COLORS[0] }); setShowTypeForm(true) }}
              style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              + Add Session Type
            </button>
          </div>

          {showTypeForm && editingType && (
            <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>{editingType.id ? 'Edit' : 'New'} Session Type</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Name *</label>
                  <input
                    value={editingType.name || ''}
                    onChange={e => setEditingType(p => ({ ...p!, name: e.target.value }))}
                    placeholder="e.g. Portrait Session"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Duration (minutes) *</label>
                  <input
                    type="number"
                    value={editingType.duration_minutes || ''}
                    onChange={e => setEditingType(p => ({ ...p!, duration_minutes: parseInt(e.target.value) }))}
                    placeholder="60"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Price ($) *</label>
                  <input
                    type="number"
                    value={editingType.price_cents !== undefined ? editingType.price_cents / 100 : ''}
                    onChange={e => setEditingType(p => ({ ...p!, price_cents: Math.round(parseFloat(e.target.value) * 100) }))}
                    placeholder="150"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Color</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditingType(p => ({ ...p!, color: c }))}
                        style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: editingType.color === c ? '3px solid #111827' : '2px solid transparent', cursor: 'pointer' }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                  <textarea
                    value={editingType.description || ''}
                    onChange={e => setEditingType(p => ({ ...p!, description: e.target.value }))}
                    placeholder="What's included in this session..."
                    rows={2}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  onClick={saveSessionType}
                  disabled={typeLoading}
                  style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  {typeLoading ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setShowTypeForm(false); setEditingType(null) }}
                  style={{ background: 'none', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sessionTypes.length === 0 ? (
            <p style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No session types yet. Add one to start accepting bookings.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sessionTypes.filter(t => t.active).map(t => (
                <div key={t.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{t.duration_minutes} min · ${(t.price_cents / 100).toFixed(0)}</div>
                    {t.description && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{t.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setEditingType(t); setShowTypeForm(true) }}
                      style={{ fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteSessionType(t.id)}
                      style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Availability */}
      {tab === 'availability' && (
        <div>
          {!slotsFromDb && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', margin: '0 0 2px' }}>Availability not saved yet</p>
                <p style={{ fontSize: 12, color: '#B45309', margin: 0 }}>Set your weekly hours below and click "Save Availability" so clients can book with you.</p>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: '#111827', margin: 0 }}>Weekly Availability</h2>
            <button
              onClick={saveAvailability}
              disabled={slotsLoading}
              style={{ background: slotsSaved ? '#059669' : '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              {slotsLoading ? 'Saving...' : slotsSaved ? 'Saved!' : 'Save Availability'}
            </button>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
            {DAYS.map((day, idx) => {
              const slot = getSlot(idx)
              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderBottom: idx < 6 ? '1px solid #F3F4F6' : 'none' }}>
                  <input
                    type="checkbox"
                    checked={slot.active}
                    onChange={e => updateSlot(idx, 'active', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ width: 100, fontSize: 14, fontWeight: 500, color: slot.active ? '#111827' : '#9CA3AF' }}>{day}</span>
                  {slot.active ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="time"
                        value={slot.start_time}
                        onChange={e => updateSlot(idx, 'start_time', e.target.value)}
                        style={{ padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                      />
                      <span style={{ color: '#9CA3AF', fontSize: 13 }}>to</span>
                      <input
                        type="time"
                        value={slot.end_time}
                        onChange={e => updateSlot(idx, 'end_time', e.target.value)}
                        style={{ padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: 13, color: '#D1D5DB' }}>Unavailable</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bookings */}
      {tab === 'bookings' && (
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>Incoming Bookings</h2>
          {bookingsLoading ? (
            <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
          ) : bookings.length === 0 ? (
            <p style={{ color: '#9CA3AF', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No bookings yet. Share your booking link to start receiving requests.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bookings.map(b => (
                <div key={b.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  {b.session_color && <div style={{ width: 10, height: 10, borderRadius: '50%', background: b.session_color, flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{b.client_name}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                      {b.session_type_name && `${b.session_type_name} · `}
                      {new Date(b.booking_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {b.start_time}–{b.end_time}
                    </div>
                    <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 1 }}>{b.client_email}{b.client_phone ? ` · ${b.client_phone}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
                      background: b.status === 'confirmed' ? '#D1FAE5' : b.status === 'cancelled' ? '#FEE2E2' : '#FEF3C7',
                      color: b.status === 'confirmed' ? '#065F46' : b.status === 'cancelled' ? '#991B1B' : '#92400E',
                    }}>
                      {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                    </span>
                    {b.status === 'pending' && (
                      <>
                        <button
                          onClick={() => updateBookingStatus(b.id, 'confirmed')}
                          style={{ fontSize: 12, color: '#059669', background: 'none', border: '1px solid #A7F3D0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => updateBookingStatus(b.id, 'cancelled')}
                          style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                        >
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
