import { useEffect, useState, useRef } from 'react'
import { marked } from 'marked'
import { useApi, type Client, type Contract, type ContractTemplate } from '../../lib/api'
import { usePortalAuth } from '../../context/AuthContext'

const TEMPLATES = [
  {
    label: 'Wedding',
    type: 'wedding photography services',
    content: `WEDDING PHOTOGRAPHY SERVICES AGREEMENT

This agreement is entered into between the Photographer and the Client.

SERVICES: Photographer agrees to provide photography services for the wedding event as described below.

PAYMENT: The total fee is due as outlined in the attached invoice. A non-refundable retainer of 50% is due upon signing.

DELIVERY: Final edited images will be delivered within 8 weeks of the event via an online gallery.

RIGHTS: Photographer retains copyright to all images. Client receives a personal use license.

CANCELLATION: Cancellations within 30 days of the event forfeit the full retainer.

By signing below, both parties agree to the terms of this agreement.`,
  },
  {
    label: 'Portrait',
    type: 'portrait photography',
    content: `PORTRAIT PHOTOGRAPHY AGREEMENT

This agreement is between the Photographer and the Client for portrait photography services.

SESSION: One portrait session as scheduled. Duration approximately 1-2 hours.

PAYMENT: Full payment is due prior to the session date.

DELIVERY: 20-30 edited images delivered via online gallery within 3 weeks of the session.

USAGE: Images are for personal use only. Commercial use requires a separate license.

RESCHEDULING: One reschedule is permitted with 48 hours notice. Cancellations within 24 hours are non-refundable.

By signing below, both parties agree to the terms of this agreement.`,
  },
  {
    label: 'Commercial',
    type: 'commercial photography',
    content: `COMMERCIAL PHOTOGRAPHY AGREEMENT

This agreement is between the Photographer and the Client for commercial photography services.

SCOPE: Photographer will provide photography coverage for the event or campaign as outlined.

DELIVERABLES: Fully edited, high-resolution images delivered within 5 business days.

LICENSING: Client receives a one-year, non-exclusive license for agreed-upon uses. Additional licensing available at extra cost.

PAYMENT: 50% deposit due upon signing; remaining balance due on or before the shoot date.

CREDIT: Photographer credit preferred in any published work.

Both parties have read and agree to the terms above.`,
  },
]

function statusStyle(status: Contract['status']): React.CSSProperties {
  if (status === 'fully_signed') return { background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)' }
  if (status === 'signed') return { background: 'var(--color-green-bg)', color: 'var(--color-green)', border: '1px solid var(--color-green-border)' }
  if (status === 'sent') return { background: 'var(--gold-bg)', color: 'var(--gold-dim)', border: '1px solid var(--gold-border)' }
  return { background: 'var(--bg-secondary)', color: 'var(--text-dim)', border: '1px solid var(--border)' }
}

function statusLabel(status: Contract['status']): string {
  if (status === 'fully_signed') return '✓ Fully Executed'
  if (status === 'signed') return 'client signed'
  return status
}

export default function Contracts() {
  const { authFetch } = useApi()
  const { user } = usePortalAuth()
  const businessName = user?.business_name || ''
  const [contracts, setContracts] = useState<Contract[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [customTemplates, setCustomTemplates] = useState<ContractTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
  const [saving, setSaving] = useState(false)
  const [sendingDrawer, setSendingDrawer] = useState(false)
  const [sending, setSending] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ client_id: '', title: '', content: '' })
  const [formError, setFormError] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const [saveTemplateMode, setSaveTemplateMode] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState<number | null>(null)
  const [counterSignContract, setCounterSignContract] = useState<Contract | null>(null)
  const [counterSignName, setCounterSignName] = useState('')
  const [counterSigning, setCounterSigning] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      authFetch('/api/contracts', { method: 'get' }),
      authFetch('/api/clients', { method: 'get' }),
      authFetch('/api/contract-templates', { method: 'get' }),
    ]).then(([cRes, clRes, tRes]) => {
      setContracts(Array.isArray(cRes.data) ? cRes.data : [])
      setClients(Array.isArray(clRes.data) ? clRes.data : [])
      setCustomTemplates(Array.isArray(tRes.data) ? tRes.data : [])
    }).catch(console.error).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (drawerOpen) setTimeout(() => titleRef.current?.focus(), 80)
  }, [drawerOpen])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setPreviewMode(false)
    setSaveTemplateMode(false)
    setTemplateName('')
  }

  const openNew = () => {
    setEditingContract(null)
    setForm({ client_id: '', title: '', content: '' })
    setFormError('')
    setPreviewMode(false)
    setSaveTemplateMode(false)
    setDrawerOpen(true)
  }

  const openEdit = (c: Contract) => {
    setEditingContract(c)
    setForm({ client_id: c.client_id?.toString() ?? '', title: c.title, content: c.content ?? '' })
    setFormError('')
    setPreviewMode(false)
    setSaveTemplateMode(false)
    setDrawerOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Contract title is required.'); return }
    setFormError('')
    setSaving(true)
    try {
      if (editingContract) {
        const res = await authFetch(`/api/contracts/${editingContract.id}`, {
          method: 'put',
          data: { title: form.title.trim(), content: form.content, status: editingContract.status, client_id: form.client_id || null },
        })
        setContracts(prev => prev.map(c => c.id === editingContract.id ? res.data as Contract : c))
        closeDrawer()
        showToast('Contract saved.')
      } else {
        const res = await authFetch('/api/contracts', {
          method: 'post',
          data: { client_id: form.client_id || null, title: form.title.trim(), content: form.content },
        })
        setContracts(prev => [res.data as Contract, ...prev])
        closeDrawer()
        showToast('Contract created.')
      }
    } catch {
      setFormError(editingContract ? 'Failed to save contract.' : 'Failed to create contract.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndSend = async () => {
    if (!form.title.trim()) { setFormError('Contract title is required.'); return }
    setFormError('')
    setSendingDrawer(true)
    try {
      let contractId: number
      if (editingContract) {
        const res = await authFetch(`/api/contracts/${editingContract.id}`, {
          method: 'put',
          data: { title: form.title.trim(), content: form.content, status: editingContract.status, client_id: form.client_id || null },
        })
        contractId = (res.data as Contract).id
        setContracts(prev => prev.map(c => c.id === editingContract.id ? res.data as Contract : c))
      } else {
        const res = await authFetch('/api/contracts', {
          method: 'post',
          data: { client_id: form.client_id || null, title: form.title.trim(), content: form.content },
        })
        contractId = (res.data as Contract).id
        setContracts(prev => [res.data as Contract, ...prev])
      }
      await authFetch(`/api/contracts/${contractId}/send`, { method: 'post' })
      setContracts(prev => prev.map(c => c.id === contractId ? { ...c, status: 'sent' as const } : c))
      closeDrawer()
      showToast('Contract saved and sent to client.')
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string } }; message?: string }
      setFormError(errObj.response?.data?.error || errObj.message || 'Failed to save and send.')
    } finally {
      setSendingDrawer(false)
    }
  }

  const handleSend = async (id: number) => {
    setSending(id)
    try {
      await authFetch(`/api/contracts/${id}/send`, { method: 'post' })
      setContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'sent' as const } : c))
      showToast('Contract sent to client.')
    } catch {
      showToast('Failed to send contract.')
    } finally {
      setSending(null)
    }
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    try {
      await authFetch(`/api/contracts/${id}`, { method: 'delete' })
      setContracts(prev => prev.filter(c => c.id !== id))
      showToast('Contract deleted.')
    } catch {
      showToast('Failed to delete.')
    } finally {
      setDeleting(null)
    }
  }

  const handleCounterSign = async () => {
    if (!counterSignContract || !counterSignName.trim()) return
    setCounterSigning(true)
    try {
      const res = await authFetch(`/api/contracts/${counterSignContract.id}/photographer-sign`, {
        method: 'post',
        data: { signature_name: counterSignName.trim() },
      })
      setContracts(prev => prev.map(c => c.id === counterSignContract.id ? res.data as Contract : c))
      setCounterSignContract(null)
      setCounterSignName('')
      showToast('Contract countersigned.')
    } catch {
      showToast('Failed to countersign contract.')
    } finally {
      setCounterSigning(false)
    }
  }

  const applyTemplate = (content: string, label: string) => {
    const injected = businessName
      ? content.replace(/the Photographer/g, businessName)
      : content
    setForm(f => ({ ...f, title: f.title || label, content: injected }))
    setPreviewMode(false)
  }

  const handleAiGenerate = async () => {
    setAiLoading(true)
    try {
      const selectedTemplate = TEMPLATES.find(t => form.title.toLowerCase().includes(t.label.toLowerCase()))
      const res = await authFetch('/api/ai/generate-contract', {
        method: 'post',
        data: {
          client_id: form.client_id || null,
          template_type: selectedTemplate?.type || 'photography services',
          custom_instructions: form.content.trim() || undefined,
        },
      })
      const { content } = res.data as { content: string }
      if (content) setForm(f => ({ ...f, content }))
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string } }; message?: string }
      const msg = errObj.response?.data?.error || errObj.message || 'AI generation failed'
      showToast('AI Error: ' + msg)
    } finally {
      setAiLoading(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return
    if (!form.content.trim()) { showToast('Add content before saving as template.'); return }
    setSavingTemplate(true)
    try {
      const res = await authFetch('/api/contract-templates', {
        method: 'post',
        data: { name: templateName.trim(), content: form.content },
      })
      setCustomTemplates(prev => [res.data as ContractTemplate, ...prev])
      setSaveTemplateMode(false)
      setTemplateName('')
      showToast('Template saved.')
    } catch {
      showToast('Failed to save template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleDeleteTemplate = async (id: number) => {
    setDeletingTemplate(id)
    try {
      await authFetch(`/api/contract-templates/${id}`, { method: 'delete' })
      setCustomTemplates(prev => prev.filter(t => t.id !== id))
    } catch {
      showToast('Failed to delete template.')
    } finally {
      setDeletingTemplate(null)
    }
  }

  const renderedContent = String(marked.parse(form.content || ''))

  const downloadSignatureRecord = (c: Contract) => {
    const photographerDate = c.photographer_signed_at ? new Date(c.photographer_signed_at).toLocaleString() : ''
    const clientDate = c.signed_at ? new Date(c.signed_at).toLocaleString() : ''
    const content = `
      <html><head><title>Contract Signature Record</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #333; }
        h1 { color: #1B4332; border-bottom: 2px solid #1B4332; padding-bottom: 10px; }
        .field { margin: 12px 0; }
        .label { font-weight: bold; color: #555; font-size: 12px; text-transform: uppercase; }
        .value { font-size: 14px; margin-top: 4px; }
        .contract-text { background: #f5f5f5; padding: 20px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; margin-top: 20px; }
        .sig-grid { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .sig-block p { margin: 0 0 4px; font-size: 13px; }
        .sig-line { border-bottom: 1px solid #333; margin: 24px 0 6px; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 11px; color: #888; }
      </style></head>
      <body>
        <h1>Contract Signature Record</h1>
        <div class="field"><div class="label">Contract</div><div class="value">${c.title}</div></div>
        <div class="field"><div class="label">Reference</div><div class="value">${c.content_hash?.slice(-8).toUpperCase() ?? '—'}</div></div>
        <div class="contract-text">${c.content ?? ''}</div>
        <div class="sig-grid">
          <div class="sig-block">
            <p style="font-weight:bold;margin-bottom:16px;">PHOTOGRAPHER</p>
            <p>${c.photographer_signature ?? businessName}</p>
            <div class="sig-line"></div>
            <p style="font-size:12px;">Signature</p>
            <div class="sig-line"></div>
            <p style="font-size:12px;">Date: ${photographerDate || '_______________'}</p>
          </div>
          <div class="sig-block">
            <p style="font-weight:bold;margin-bottom:16px;">CLIENT</p>
            <p>${c.signed_by_name ?? '—'}</p>
            <div class="sig-line"></div>
            <p style="font-size:12px;">Signature: ${c.signed_by_name ? c.signed_by_name + ' (Electronic)' : '—'}</p>
            <div class="sig-line"></div>
            <p style="font-size:12px;">Date: ${clientDate || '_______________'}</p>
          </div>
        </div>
        <div class="footer">This record was generated by PortalKit. This constitutes a legally binding electronic signature under the ESIGN Act.</div>
      </body></html>
    `
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(content)
      printWindow.document.close()
      printWindow.print()
    }
  }

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Contracts</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{contracts.length} contract{contracts.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openNew} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Contract
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[0,1,2].map(i => <div key={i} className="card skeleton" style={{ height: 72 }} />)}
        </div>
      ) : contracts.length === 0 ? (
        <div className="card" style={{ padding: '56px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📝</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>No contracts yet</p>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>Create a contract and send it to a client for review.</p>
          <button onClick={openNew} className="btn btn-primary">Create First Contract</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contracts.map(c => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</p>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, flexShrink: 0, ...statusStyle(c.status) }}>{statusLabel(c.status)}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {c.client_name ?? 'No client'} · {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {c.signed_by_name && ` · Client: ${c.signed_by_name}`}
                  {c.photographer_signature && ` · Photographer: ${c.photographer_signature}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {(c.status === 'signed' || c.status === 'fully_signed') && (
                  <button
                    onClick={() => downloadSignatureRecord(c)}
                    title="Download signature record"
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    ↓ Record
                  </button>
                )}
                {c.status === 'signed' && !c.photographer_signed_at && (
                  <button
                    onClick={() => { setCounterSignContract(c); setCounterSignName('') }}
                    style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--color-green-border)', background: 'var(--color-green-bg)', color: 'var(--color-green)', cursor: 'pointer' }}
                  >
                    Counter-sign ✍
                  </button>
                )}
                {c.status === 'draft' ? (
                  <button
                    onClick={() => handleSend(c.id)}
                    disabled={sending === c.id}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer' }}
                  >
                    {sending === c.id ? 'Sending…' : 'Send to Client'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend(c.id)}
                    disabled={sending === c.id}
                    style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {sending === c.id ? 'Sending…' : 'Resend'}
                  </button>
                )}
                <button
                  onClick={() => openEdit(c)}
                  title="Edit"
                  style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.background = 'var(--green-bg)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  disabled={deleting === c.id}
                  style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer backdrop */}
      {drawerOpen && <div onClick={closeDrawer} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199, backdropFilter: 'blur(2px)' }} />}

      {/* Drawer */}
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 200, width: 'min(560px, 100vw)', background: 'var(--bg-elevated)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editingContract ? 'Edit Contract' : 'New Contract'}
          </h2>
          <button onClick={closeDrawer} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSave} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {formError && <div className="alert alert-error">{formError}</div>}

          <div>
            <label className="field-label">Client</label>
            <select className="input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">No client selected</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">Contract title <span style={{ color: 'var(--color-red)' }}>*</span></label>
            <input ref={titleRef} className="input" type="text" placeholder="e.g. Wedding Photography Agreement" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div>
            {/* Template selector row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
              <label className="field-label" style={{ margin: 0 }}>Contract content</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Built-in templates */}
                {TEMPLATES.map(t => (
                  <button key={t.label} type="button" onClick={() => applyTemplate(t.content, t.label)}
                    style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-dim)', cursor: 'pointer' }}>
                    {t.label}
                  </button>
                ))}
                {/* Custom templates */}
                {customTemplates.length > 0 && (
                  <>
                    <span style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
                    {customTemplates.map(t => (
                      <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <button type="button" onClick={() => applyTemplate(t.content, t.name)}
                          style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer' }}>
                          {t.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(t.id)}
                          disabled={deletingTemplate === t.id}
                          style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
                          title="Delete template"
                        >×</button>
                      </span>
                    ))}
                  </>
                )}
                {/* AI generate */}
                <button
                  type="button"
                  onClick={handleAiGenerate}
                  disabled={aiLoading}
                  style={{ background: 'linear-gradient(135deg, #C9A84C, #D4B35A)', color: '#1B4332', border: 'none', padding: '4px 12px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: aiLoading ? 0.7 : 1 }}
                >
                  {aiLoading
                    ? <><span className="spinner-sm" style={{ borderColor: 'rgba(27,67,50,0.3)', borderTopColor: '#1B4332', width: 10, height: 10 }} />Generating…</>
                    : <>✨ Generate with AI</>
                  }
                </button>
              </div>
            </div>

            {/* File upload */}
            <div style={{ marginBottom: 8 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.name.endsWith('.pdf') || file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
                    showToast('PDF/Word upload coming soon — paste contract text for now.')
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = ev => setForm(f => ({ ...f, content: ev.target?.result as string || '' }))
                  reader.readAsText(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ fontSize: 12, color: 'var(--text-dim)', background: 'transparent', border: '1px dashed var(--border)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', width: '100%', textAlign: 'left' }}
              >
                📎 Upload contract file (.txt) · PDF/Word coming soon
              </button>
            </div>

            {/* Edit / Preview toggle */}
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 8, width: 'fit-content' }}>
              {(['Edit', 'Preview'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode === 'Preview')}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 14px', border: 'none', cursor: 'pointer',
                    background: (mode === 'Preview') === previewMode ? 'var(--green)' : 'transparent',
                    color: (mode === 'Preview') === previewMode ? '#FDFAF5' : 'var(--text-dim)',
                  }}
                >{mode}</button>
              ))}
            </div>

            {previewMode ? (
              <div
                className="contract-content"
                dangerouslySetInnerHTML={{ __html: renderedContent }}
                style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', minHeight: 260, background: '#fff', fontSize: 14, lineHeight: 1.6, overflowY: 'auto' }}
              />
            ) : (
              <textarea
                className="input"
                placeholder="Write your contract terms here, use a template above, or click ✨ AI Generate…"
                rows={14}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13, minHeight: 260 }}
              />
            )}
          </div>

          {/* Save as Template */}
          {!saveTemplateMode ? (
            <button
              type="button"
              onClick={() => { setSaveTemplateMode(true); setTemplateName(form.title || '') }}
              style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
            >
              Save as Template…
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                type="text"
                placeholder="Template name…"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                style={{ flex: 1, minWidth: 160, fontSize: 13 }}
              />
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={savingTemplate || !templateName.trim()}
                className="btn btn-primary btn-sm"
              >
                {savingTemplate ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setSaveTemplateMode(false)} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          )}
        </form>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexShrink: 0, justifyContent: 'flex-end' }}>
          <button type="button" onClick={closeDrawer} className="btn btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving || sendingDrawer} className="btn btn-ghost" style={{ border: '1px solid var(--border)' }}>
            {saving
              ? <><span className="spinner-sm" style={{ borderColor: 'rgba(0,0,0,0.2)', borderTopColor: 'var(--text-primary)' }} />Saving…</>
              : 'Save Contract'
            }
          </button>
          <button onClick={handleSaveAndSend} disabled={saving || sendingDrawer} className="btn btn-primary">
            {sendingDrawer
              ? <><span className="spinner-sm" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />Sending…</>
              : 'Send to Client →'
            }
          </button>
        </div>
      </aside>

      {/* Counter-sign modal */}
      {counterSignContract && (
        <>
          <div onClick={() => setCounterSignContract(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 299, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, width: 'min(420px, 90vw)', background: 'var(--bg-elevated)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 28 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--green)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>Countersign Contract</h3>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 4 }}>{counterSignContract.title}</p>
            {counterSignContract.signed_by_name && (
              <p style={{ fontSize: 12, color: 'var(--color-green)', marginBottom: 16 }}>✓ Signed by client: {counterSignContract.signed_by_name}</p>
            )}
            <label className="field-label">Type your full name to countersign</label>
            <input
              className="input"
              type="text"
              placeholder="Your full name"
              value={counterSignName}
              onChange={e => setCounterSignName(e.target.value)}
              style={{ marginBottom: 12 }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCounterSign() }}
            />
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.5 }}>
              By countersigning, you confirm your agreement to this contract as the photographer.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCounterSignContract(null)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
              <button
                onClick={handleCounterSign}
                disabled={counterSigning || !counterSignName.trim()}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                {counterSigning ? 'Signing…' : 'Countersign Contract ✍'}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, background: 'var(--green)', color: '#FDFAF5', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.18)', animation: 'fadeInUp 0.2s ease' }}>
          {toast}
        </div>
      )}
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
