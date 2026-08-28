import { useState, useEffect } from 'react'
import { useApi } from '../../lib/api'
import type { Package, Proposal, Client } from '../../lib/api'

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const BLANK_PKG: Omit<Package, 'id' | 'user_id' | 'active' | 'created_at'> = { name: '', description: '', price_cents: 0, deposit_cents: 0, features: [] }

const STATUS_COLORS: Record<string, string> = { draft: '#6B7280', sent: '#2563EB', viewed: '#D97706', accepted: '#059669', expired: '#DC2626' }

export default function Proposals() {
  const { authFetch } = useApi()
  const [tab, setTab] = useState<'packages' | 'proposals'>('packages')
  const [packages, setPackages] = useState<Package[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  const [showPkgForm, setShowPkgForm] = useState(false)
  const [editingPkg, setEditingPkg] = useState<Package | null>(null)
  const [pkgForm, setPkgForm] = useState<typeof BLANK_PKG>(BLANK_PKG)
  const [pkgFeature, setPkgFeature] = useState('')
  const [savingPkg, setSavingPkg] = useState(false)

  const [showPropForm, setShowPropForm] = useState(false)
  const [editingProp, setEditingProp] = useState<Proposal | null>(null)
  const [propForm, setPropForm] = useState({ title: '', message: '', client_id: '', expires_at: '', packages: [] as Package[] })
  const [savingAction, setSavingAction] = useState<'draft' | 'send' | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [sending, setSending] = useState<number | null>(null)
  const [aiNotes, setAiNotes] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Package[]>([])
  const [deletePkgId, setDeletePkgId] = useState<number | null>(null)
  const [deleteProposalId, setDeleteProposalId] = useState<number | null>(null)
  const [duplicating, setDuplicating] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      authFetch('/api/packages').then(r => setPackages(r.data)).catch(() => {}),
      authFetch('/api/proposals').then(r => setProposals(r.data)).catch(() => {}),
      authFetch('/api/clients').then(r => setClients(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const openNewPkg = () => { setEditingPkg(null); setPkgForm(BLANK_PKG); setShowPkgForm(true) }
  const openEditPkg = (p: Package) => { setEditingPkg(p); setPkgForm({ name: p.name, description: p.description || '', price_cents: p.price_cents, deposit_cents: p.deposit_cents, features: [...p.features] }); setShowPkgForm(true) }

  const savePkg = async () => {
    if (!pkgForm.name.trim()) return
    setSavingPkg(true)
    try {
      if (editingPkg) {
        const res = await authFetch(`/api/packages/${editingPkg.id}`, { method: 'put', data: pkgForm })
        setPackages(prev => prev.map(p => p.id === editingPkg.id ? res.data : p))
      } else {
        const res = await authFetch('/api/packages', { method: 'post', data: pkgForm })
        setPackages(prev => [...prev, res.data])
      }
      setShowPkgForm(false)
    } catch {} finally { setSavingPkg(false) }
  }

  const deletePkg = async (id: number) => {
    await authFetch(`/api/packages/${id}`, { method: 'delete' })
    setPackages(prev => prev.filter(p => p.id !== id))
    setDeletePkgId(null)
  }

  const openNewProp = () => {
    setEditingProp(null)
    setPropForm({ title: '', message: '', client_id: '', expires_at: '', packages: [] })
    setAiNotes('')
    setAiSuggestions([])
    setShowPropForm(true)
  }

  const generateWithAI = async () => {
    setAiGenerating(true)
    try {
      const res = await authFetch('/api/ai/generate-proposal', { method: 'post', data: { client_id: propForm.client_id || undefined, notes: aiNotes } })
      const { packages: aiPkgs, message } = res.data
      if (aiPkgs?.length) {
        // Suggestions land in their own review list — never merged directly
        // into propForm.packages (what actually gets sent). The photographer
        // must explicitly add each one they want via addSuggestionToProposal.
        const newPkgs: Package[] = aiPkgs.map((p: Package, i: number) => ({ ...p, id: -(i + 1), user_id: 0, active: true, created_at: new Date().toISOString() }))
        setAiSuggestions(newPkgs)
        setPropForm(f => ({ ...f, message: message || f.message }))
      }
    } catch {
      // silent — user can retry
    } finally {
      setAiGenerating(false)
    }
  }

  const addSuggestionToProposal = (pkg: Package) => {
    setPropForm(f => ({ ...f, packages: [...f.packages, pkg] }))
    setAiSuggestions(prev => prev.filter(p => p.id !== pkg.id))
  }

  const discardSuggestions = () => setAiSuggestions([])

  const openEditProp = (p: Proposal) => {
    setEditingProp(p)
    setPropForm({ title: p.title, message: p.message || '', client_id: p.client_id?.toString() || '', expires_at: p.expires_at ? p.expires_at.split('T')[0] : '', packages: p.packages || [] })
    setAiNotes('')
    setAiSuggestions([])
    setShowPropForm(true)
  }

  const saveProp = async (andSend = false) => {
    if (!propForm.title.trim()) return
    setSavingAction(andSend ? 'send' : 'draft')
    try {
      const data = { ...propForm, client_id: propForm.client_id ? parseInt(propForm.client_id) : null, expires_at: propForm.expires_at || null }
      let saved: Proposal
      // Editing a proposal that's already been sent/viewed re-sends it after
      // saving (same endpoint as a fresh send — resets status to 'sent' and
      // emails the client again). Accepted proposals can't reach this path:
      // the Edit button is hidden for them and the backend rejects it too.
      const needsResend = editingProp && (editingProp.status === 'sent' || editingProp.status === 'viewed')
      if (editingProp) {
        const res = await authFetch(`/api/proposals/${editingProp.id}`, { method: 'put', data })
        saved = res.data
        setProposals(prev => prev.map(p => p.id === editingProp.id ? saved : p))
      } else {
        const res = await authFetch('/api/proposals', { method: 'post', data })
        saved = res.data
        setProposals(prev => [saved, ...prev])
      }
      if (andSend || needsResend) {
        const sendRes = await authFetch(`/api/proposals/${saved.id}/send`, { method: 'post' })
        setProposals(prev => prev.map(p => p.id === saved.id ? sendRes.data : p))
      }
      setShowPropForm(false)
    } catch {} finally { setSavingAction(null) }
  }

  const duplicateProposal = async (id: number) => {
    setDuplicating(id)
    try {
      const res = await authFetch(`/api/proposals/${id}/duplicate`, { method: 'post' })
      setProposals(prev => [res.data, ...prev])
    } catch {} finally { setDuplicating(null) }
  }

  const sendProposal = async (id: number) => {
    setSending(id)
    try {
      const res = await authFetch(`/api/proposals/${id}/send`, { method: 'post' })
      setProposals(prev => prev.map(p => p.id === id ? res.data : p))
    } catch {} finally { setSending(null) }
  }

  const deleteProposal = async (id: number) => {
    await authFetch(`/api/proposals/${id}`, { method: 'delete' })
    setProposals(prev => prev.filter(p => p.id !== id))
    setDeleteProposalId(null)
  }

  const copyLink = (id: number, token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/proposal/${token}`).then(() => {
      setCopied(id); setTimeout(() => setCopied(null), 2000)
    })
  }

  const togglePkgInProp = (pkg: Package) => {
    const already = propForm.packages.find(p => p.id === pkg.id)
    if (already) {
      setPropForm(f => ({ ...f, packages: f.packages.filter(p => p.id !== pkg.id) }))
    } else {
      setPropForm(f => ({ ...f, packages: [...f.packages, pkg] }))
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 24px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 700, color: '#111827', margin: 0 }}>Proposals</h1>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 6 }}>Build packages and send branded proposals to clients.</p>
        </div>
        <button
          onClick={tab === 'packages' ? openNewPkg : openNewProp}
          style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
        >
          + {tab === 'packages' ? 'New Package' : 'New Proposal'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#F3F4F6', borderRadius: 8, padding: 4 }}>
        {(['packages', 'proposals'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#111827' : '#6B7280', boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Package Form Modal */}
      {showPkgForm && (
        <>
          <div onClick={() => setShowPkgForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 51, width: 'min(520px, 90vw)', background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', marginBottom: 20 }}>{editingPkg ? 'Edit' : 'New'} Package</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Package Name *</label>
                <input type="text" value={pkgForm.name} onChange={e => setPkgForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Essential, Premium, All-Inclusive" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Description</label>
                <textarea value={pkgForm.description || ''} onChange={e => setPkgForm(f => ({ ...f, description: e.target.value }))} placeholder="What's included in this package?" rows={3} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Price (USD)</label>
                  <input type="number" min="0" step="1" value={pkgForm.price_cents / 100 || ''} onChange={e => setPkgForm(f => ({ ...f, price_cents: Math.round(parseFloat(e.target.value || '0') * 100) }))} placeholder="0.00" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Deposit (USD)</label>
                  <input type="number" min="0" step="1" value={pkgForm.deposit_cents / 100 || ''} onChange={e => setPkgForm(f => ({ ...f, deposit_cents: Math.round(parseFloat(e.target.value || '0') * 100) }))} placeholder="0.00" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Features / What's Included</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input type="text" value={pkgFeature} onChange={e => setPkgFeature(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (pkgFeature.trim()) { setPkgForm(f => ({ ...f, features: [...f.features, pkgFeature.trim()] })); setPkgFeature('') } } }} placeholder="Add a feature (press Enter)" style={{ flex: 1, padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14 }} />
                  <button onClick={() => { if (pkgFeature.trim()) { setPkgForm(f => ({ ...f, features: [...f.features, pkgFeature.trim()] })); setPkgFeature('') } }} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#F9FAFB', fontSize: 14, cursor: 'pointer' }}>Add</button>
                </div>
                {pkgForm.features.map((feat, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>✓ {feat}</span>
                    <button onClick={() => setPkgForm(f => ({ ...f, features: f.features.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <button onClick={() => setShowPkgForm(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 14, cursor: 'pointer', color: '#374151' }}>Cancel</button>
              <button onClick={savePkg} disabled={savingPkg || !pkgForm.name.trim()} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {savingPkg ? 'Saving...' : editingPkg ? 'Save Changes' : 'Create Package'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Proposal Form Modal */}
      {showPropForm && (
        <>
          <div onClick={() => setShowPropForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 51, width: 'min(540px, 90vw)', background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', marginBottom: 20 }}>{editingProp ? 'Edit' : 'New'} Proposal</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Title *</label>
                <input type="text" value={propForm.title} onChange={e => setPropForm(f => ({ ...f, title: e.target.value }))} placeholder="Wedding Photography Proposal" style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Client</label>
                <select value={propForm.client_id} onChange={e => setPropForm(f => ({ ...f, client_id: e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}>
                  <option value="">No specific client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Message</label>
                <textarea value={propForm.message} onChange={e => setPropForm(f => ({ ...f, message: e.target.value }))} placeholder="Hi! I'm so excited about your upcoming event..." rows={3} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Expiry Date (optional)</label>
                <input type="date" value={propForm.expires_at} onChange={e => setPropForm(f => ({ ...f, expires_at: e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              {/* AI suggestions are never merged directly into propForm.packages
                  (the list that actually gets sent) — they populate a separate
                  review list below, and the photographer must explicitly add
                  each one they want. Safe to show regardless of whether the
                  proposal already has packages, since nothing here can
                  silently overwrite what's already selected. */}
              <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 10, padding: '14px 16px' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#065F46', margin: '0 0 8px' }}>✨ Generate package suggestions with AI</p>
                <textarea value={aiNotes} onChange={e => setAiNotes(e.target.value)} placeholder="Optional: add context (e.g. outdoor wedding, 8 hours, 2 photographers, $500 deposit)" rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #A7F3D0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit', background: '#fff', marginBottom: 8 }} />
                <button onClick={generateWithAI} disabled={aiGenerating} style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: aiGenerating ? 0.7 : 1 }}>
                  {aiGenerating ? 'Generating...' : '✨ Generate Suggestions'}
                </button>
                <p style={{ fontSize: 11, color: '#065F46', margin: '8px 0 0', opacity: 0.8 }}>Suggestions are shown below for you to review — nothing is added to this proposal until you click "Add to Proposal" on each one.</p>
              </div>
              {aiSuggestions.length > 0 && (
                <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#5B21B6', margin: 0 }}>✨ AI Suggestions — Review Before Adding</p>
                    <button onClick={discardSuggestions} style={{ fontSize: 12, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>Discard all</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {aiSuggestions.map(pkg => (
                      <div key={pkg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fff', border: '1px solid #DDD6FE', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: 0 }}>{pkg.name}</p>
                          <p style={{ fontSize: 13, fontWeight: 700, color: '#5B21B6', margin: '2px 0' }}>{(pkg.price_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                          {pkg.description && <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>{pkg.description}</p>}
                          {pkg.features?.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                              {pkg.features.map((f, i) => (
                                <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}>{f}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button onClick={() => addSuggestionToProposal(pkg)} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#5B21B6', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          + Add to Proposal
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {packages.length > 0 && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 8 }}>Include Packages</label>
                  {packages.map(pkg => {
                    const selected = propForm.packages.some(p => p.id === pkg.id)
                    return (
                      <div key={pkg.id} onClick={() => togglePkgInProp(pkg)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, border: `2px solid ${selected ? '#111827' : '#E5E7EB'}`, background: selected ? '#F9FAFB' : '#fff', marginBottom: 6, cursor: 'pointer' }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${selected ? '#111827' : '#D1D5DB'}`, background: selected ? '#111827' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {selected && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: 0 }}>{pkg.name}</p>
                          <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{(pkg.price_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <button onClick={() => setShowPropForm(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 14, cursor: 'pointer', color: '#374151' }}>Cancel</button>
              {editingProp ? (
                <button onClick={() => saveProp(false)} disabled={savingAction !== null || !propForm.title.trim()} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {savingAction !== null ? 'Saving...' : (editingProp.status === 'sent' || editingProp.status === 'viewed') ? 'Save & Resend →' : 'Save Changes'}
                </button>
              ) : (
                <>
                  <button onClick={() => saveProp(false)} disabled={savingAction !== null || !propForm.title.trim()} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                    {savingAction === 'draft' ? 'Saving...' : 'Save as Draft'}
                  </button>
                  <button
                    onClick={() => saveProp(true)}
                    disabled={savingAction !== null || !propForm.title.trim() || !propForm.client_id}
                    title={!propForm.client_id ? 'Select a client before sending.' : 'Saves the proposal and immediately emails it to the selected client'}
                    style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {savingAction === 'send' ? 'Sending...' : 'Save & Send →'}
                  </button>
                </>
              )}
            </div>
            {!editingProp && !propForm.client_id && (
              <p style={{ fontSize: 12, color: '#DC2626', marginTop: 8, textAlign: 'right' }}>Select a client before sending.</p>
            )}
            {editingProp && (editingProp.status === 'sent' || editingProp.status === 'viewed') && (
              <p style={{ fontSize: 12, color: '#2563EB', marginTop: 8, textAlign: 'right' }}>Saving will resend the updated proposal to the client.</p>
            )}
          </div>
        </>
      )}

      {loading ? (
        <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
      ) : tab === 'packages' ? (
        packages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No packages yet</p>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>Create packages to include in your proposals.</p>
            <button onClick={openNewPkg} style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Create Package</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {packages.map(pkg => (
              <div key={pkg.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>{pkg.name}</p>
                    <p style={{ fontSize: 20, fontWeight: 800, color: '#059669', margin: 0 }}>{formatCents(pkg.price_cents)}</p>
                    {pkg.deposit_cents > 0 && <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>{formatCents(pkg.deposit_cents)} deposit</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {deletePkgId === pkg.id ? (
                      <>
                        <button onClick={() => deletePkg(pkg.id)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Confirm</button>
                        <button onClick={() => setDeletePkgId(null)} className="btn btn-ghost btn-sm">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => openEditPkg(pkg)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: 'transparent', color: '#374151', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => setDeletePkgId(pkg.id)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #FECACA', background: 'transparent', color: '#DC2626', cursor: 'pointer' }}>✕</button>
                      </>
                    )}
                  </div>
                </div>
                {pkg.description && <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>{pkg.description}</p>}
                {pkg.features.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {pkg.features.map((f, i) => (
                      <span key={i} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 99, background: '#EEF2FF', color: '#4F46E5', border: '1px solid #C7D2FE' }}>✓ {f}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        proposals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No proposals yet</p>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>Create and send professional proposals to potential clients.</p>
            <button onClick={openNewProp} style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Create Proposal</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {proposals.map(p => {
              const statusColor = STATUS_COLORS[p.status] || '#6B7280'
              return (
                <div key={p.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                        <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: 0 }}>{p.title}</p>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: statusColor + '18', color: statusColor, fontWeight: 700, border: `1px solid ${statusColor}40` }}>
                          {p.status.toUpperCase()}
                        </span>
                      </div>
                      {p.client_name && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>For {p.client_name}</p>}
                      <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>
                        {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {p.accepted_at && ' · Accepted'}
                        {p.expires_at && !p.accepted_at && ` · Expires ${new Date(p.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {p.status === 'draft' && (
                        <button
                          onClick={() => sendProposal(p.id)}
                          disabled={sending === p.id || !p.client_id}
                          title={!p.client_id ? 'Select a client before sending.' : undefined}
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #C7D2FE', background: '#EEF2FF', color: '#4F46E5', cursor: 'pointer', fontWeight: 500 }}
                        >
                          {sending === p.id ? 'Sending...' : 'Send'}
                        </button>
                      )}
                      {p.status !== 'draft' && (
                        <button onClick={() => copyLink(p.id, p.token)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: copied === p.id ? '#059669' : 'transparent', color: copied === p.id ? '#fff' : '#374151', cursor: 'pointer', fontWeight: 500 }}>
                          {copied === p.id ? '✓ Copied' : 'Copy Link'}
                        </button>
                      )}
                      {p.status !== 'accepted' && (
                        <button onClick={() => openEditProp(p)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: 'transparent', color: '#374151', cursor: 'pointer' }}>Edit</button>
                      )}
                      <button
                        onClick={() => duplicateProposal(p.id)}
                        disabled={duplicating === p.id}
                        title="Create a new draft copy of this proposal with no client attached"
                        style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: 'transparent', color: '#374151', cursor: 'pointer' }}
                      >
                        {duplicating === p.id ? 'Duplicating...' : 'Duplicate'}
                      </button>
                      {deleteProposalId === p.id ? (
                        <>
                          <button onClick={() => deleteProposal(p.id)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Confirm</button>
                          <button onClick={() => setDeleteProposalId(null)} className="btn btn-ghost btn-sm">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setDeleteProposalId(p.id)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #FECACA', background: 'transparent', color: '#DC2626', cursor: 'pointer' }}>✕</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
