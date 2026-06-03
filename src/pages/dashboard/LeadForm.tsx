import { useState, useEffect } from 'react'
import { useApi } from '../../lib/api'
import type { LeadForm, LeadSubmission } from '../../lib/api'
import { usePortalAuth } from '../../context/AuthContext'

const API_BASE = import.meta.env.VITE_API_URL || 'https://portalkit-production.up.railway.app'

const defaults: LeadForm = {
  id: 0,
  user_id: 0,
  headline: 'Book a Session',
  subheadline: "Fill out the form below and I'll be in touch soon.",
  fields: ['name', 'email', 'phone', 'event_type', 'event_date', 'message'],
  brand_color: '#1B4332',
  active: true,
  created_at: '',
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Full Name', email: 'Email', phone: 'Phone', event_type: 'Event Type', event_date: 'Event Date', message: 'Message',
}

export default function LeadFormPage() {
  const { authFetch } = useApi()
  const { user } = usePortalAuth()
  const [tab, setTab] = useState<'setup' | 'leads'>('setup')
  const [form, setForm] = useState<LeadForm>(defaults)
  const [leads, setLeads] = useState<LeadSubmission[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    authFetch('/api/lead-form')
      .then(r => setForm(r.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'leads') return
    setLoadingLeads(true)
    authFetch('/api/lead-submissions')
      .then(r => setLeads(r.data))
      .catch(() => {})
      .finally(() => setLoadingLeads(false))
  }, [tab])

  const save = async () => {
    setSaving(true)
    try {
      const res = await authFetch('/api/lead-form', { method: 'put', data: form })
      setForm(res.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {} finally { setSaving(false) }
  }

  const handleDeleteLead = async (id: number) => {
    if (!confirm('Delete this lead?')) return
    try {
      await authFetch(`/api/lead-submissions/${id}`, { method: 'delete' })
      setLeads(prev => prev.filter(l => l.id !== id))
    } catch {}
  }

  const handleLeadStage = async (id: number, stage: string) => {
    try {
      await authFetch(`/api/lead-submissions/${id}/stage`, { method: 'patch', data: { stage } })
      setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l))
    } catch {}
  }

  const username = user?.booking_username || ''
  const embedCode = `<script src="${API_BASE.replace('/api', '')}/embed.js" data-username="${username}"></script>\n<div id="portalkit-form"></div>`
  const publicUrl = `${window.location.origin}/inquire/${username}`

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 }}>Lead Form</h1>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 6 }}>Capture inquiries from your website or share a public link.</p>
        </div>
        {tab === 'setup' && (
          <button
            onClick={save}
            disabled={saving}
            style={{ background: saved ? '#059669' : '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#F3F4F6', borderRadius: 8, padding: 4 }}>
        {(['setup', 'leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#111827' : '#6B7280', boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {t === 'setup' ? 'Setup & Embed' : `Leads${leads.length ? ` (${leads.length})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'setup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>Form Content</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Headline</label>
                <input type="text" value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Subheadline</label>
                <input type="text" value={form.subheadline || ''} onChange={e => setForm(f => ({ ...f, subheadline: e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 8 }}>Brand Color</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="color" value={form.brand_color} onChange={e => setForm(f => ({ ...f, brand_color: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                  <span style={{ fontSize: 13, color: '#6B7280' }}>{form.brand_color}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>Fields</h3>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 14 }}>All 6 fields are always included. Name is always required.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['name', 'email', 'phone', 'event_type', 'event_date', 'message'].map(f => (
                <span key={f} style={{ fontSize: 13, padding: '4px 12px', borderRadius: 99, background: '#EEF2FF', color: '#4F46E5', fontWeight: 500, border: '1px solid #C7D2FE' }}>
                  {FIELD_LABELS[f]}
                </span>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>Public Link</h3>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>Share this URL directly with potential clients.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={publicUrl} style={{ flex: 1, padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, color: '#6B7280', background: '#F9FAFB', boxSizing: 'border-box' }} />
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 13, color: '#374151', textDecoration: 'none', fontWeight: 500, cursor: 'pointer' }}>Open →</a>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>Embed on Your Website</h3>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>Paste this code anywhere on your website to embed the form.</p>
            <div style={{ position: 'relative' }}>
              <pre style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '14px 16px', fontSize: 12, fontFamily: 'monospace', overflowX: 'auto', margin: 0, color: '#374151', whiteSpace: 'pre-wrap' }}>{embedCode}</pre>
              <button
                onClick={copyEmbed}
                style={{ position: 'absolute', top: 10, right: 10, fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: copied ? '#059669' : '#fff', color: copied ? '#fff' : '#374151', cursor: 'pointer', fontWeight: 500 }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'leads' && (
        <div>
          {loadingLeads ? (
            <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
          ) : leads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No leads yet</p>
              <p style={{ fontSize: 14, color: '#6B7280' }}>Share your form link or embed it on your website to start collecting inquiries.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leads.map(lead => (
                <div key={lead.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: 0 }}>{lead.name}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select
                        value={lead.stage || 'inquiry'}
                        onChange={e => handleLeadStage(lead.id, e.target.value)}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#374151', cursor: 'pointer' }}
                      >
                        <option value="inquiry">Inquiry</option>
                        <option value="consultation">Consultation</option>
                        <option value="booked">Booked</option>
                        <option value="archived">Archived</option>
                      </select>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>{new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <button onClick={() => handleDeleteLead(lead.id)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, background: 'none', border: '1px solid #E5E7EB', color: '#EF4444', cursor: 'pointer' }}>✕</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#6B7280' }}>
                    {lead.email && <span>✉ {lead.email}</span>}
                    {lead.phone && <span>📞 {lead.phone}</span>}
                    {lead.event_type && <span>📸 {lead.event_type}</span>}
                    {lead.event_date && <span>📅 {new Date(lead.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                  </div>
                  {lead.message && <p style={{ fontSize: 13, color: '#374151', marginTop: 10, fontStyle: 'italic', lineHeight: 1.5 }}>"{lead.message}"</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
