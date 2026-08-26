import { useEffect, useState } from 'react'
import { useApi } from '../../lib/api'
import type { QuestionnaireTemplate, QuestionnaireResponse, QuestionDef, Client } from '../../lib/api'
import ConfirmModal from '../../components/ConfirmModal'

const QUESTION_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Multiple choice' },
  { value: 'date', label: 'Date' },
]

function makeQId() { return 'q' + Math.random().toString(36).slice(2, 9) }

const BLANK_Q: QuestionDef = { id: '', type: 'text', label: '', required: false }

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

export default function Questionnaires() {
  const { authFetch } = useApi()
  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([])
  const [sent, setSent] = useState<QuestionnaireResponse[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<QuestionnaireTemplate | null>(null)
  const [editName, setEditName] = useState('')
  const [editQuestions, setEditQuestions] = useState<QuestionDef[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [sendModal, setSendModal] = useState(false)
  const [sendClientId, setSendClientId] = useState('')
  const [sendTitle, setSendTitle] = useState('')
  const [sending, setSending] = useState(false)
  const [viewResponses, setViewResponses] = useState<QuestionnaireResponse | null>(null)
  const [deleteTemplateId, setDeleteTemplateId] = useState<number | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchAll = () => {
    authFetch('/api/questionnaire-templates', { method: 'get' }).then(r => setTemplates(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    authFetch('/api/questionnaires', { method: 'get' }).then(r => setSent(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    authFetch('/api/clients', { method: 'get' }).then(r => setClients(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }

  useEffect(() => { fetchAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const newTemplate = () => {
    setSelectedTemplate({ id: 0, user_id: 0, name: 'New Questionnaire', questions: [], created_at: '' })
    setEditName('New Questionnaire')
    setEditQuestions([])
  }

  const openTemplate = (t: QuestionnaireTemplate) => {
    setSelectedTemplate(t)
    setEditName(t.name)
    setEditQuestions(JSON.parse(JSON.stringify(t.questions)))
  }

  const saveTemplate = async () => {
    if (!editName.trim()) return
    setSaving(true)
    try {
      if (selectedTemplate?.id) {
        const r = await authFetch(`/api/questionnaire-templates/${selectedTemplate.id}`, { method: 'put', data: { name: editName, questions: editQuestions } })
        setTemplates(prev => prev.map(t => t.id === r.data.id ? r.data : t))
        setSelectedTemplate(r.data)
        showToast('Template saved.')
      } else {
        const r = await authFetch('/api/questionnaire-templates', { method: 'post', data: { name: editName, questions: editQuestions } })
        setTemplates(prev => [r.data, ...prev])
        setSelectedTemplate(r.data)
        showToast('Template created.')
      }
    } catch { showToast('Failed to save template.') }
    finally { setSaving(false) }
  }

  const deleteTemplate = async (id: number) => {
    try {
      await authFetch(`/api/questionnaire-templates/${id}`, { method: 'delete' })
      setTemplates(prev => prev.filter(t => t.id !== id))
      if (selectedTemplate?.id === id) setSelectedTemplate(null)
      setDeleteTemplateId(null)
      showToast('Template deleted.')
    } catch { showToast('Failed to delete.') }
  }

  const addQuestion = () => {
    setEditQuestions(prev => [...prev, { ...BLANK_Q, id: makeQId() }])
  }

  const updateQuestion = (idx: number, patch: Partial<QuestionDef>) => {
    setEditQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q))
  }

  const removeQuestion = (idx: number) => {
    setEditQuestions(prev => prev.filter((_, i) => i !== idx))
  }

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const newArr = [...editQuestions]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= newArr.length) return
    ;[newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]]
    setEditQuestions(newArr)
  }

  const sendQuestionnaire = async () => {
    if (!selectedTemplate?.id || !sendClientId || !sendTitle.trim()) return
    setSending(true)
    try {
      const r = await authFetch('/api/questionnaires', { method: 'post', data: { template_id: selectedTemplate.id, client_id: parseInt(sendClientId), title: sendTitle } })
      setSent(prev => [r.data, ...prev])
      setSendModal(false)
      setSendClientId('')
      setSendTitle('')
      showToast('Questionnaire sent!')
    } catch { showToast('Failed to send.') }
    finally { setSending(false) }
  }

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 32px) 64px', maxWidth: 1100, margin: '0 auto' }}>
      <ConfirmModal
        open={deleteTemplateId !== null}
        title="Delete this template?"
        message="This questionnaire template will be permanently deleted. Responses already collected from clients will not be affected."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTemplateId !== null && deleteTemplate(deleteTemplateId)}
        onCancel={() => setDeleteTemplateId(null)}
      />
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>Questionnaires</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Create questionnaire templates and send them to clients.</p>
      </div>

      <div className="quest-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
        {/* Left: template library */}
        <div>
          <button onClick={newTemplate} className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }}>
            + New Template
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {templates.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>No templates yet.</p>
            )}
            {templates.map(t => (
              <div
                key={t.id}
                onClick={() => openTemplate(t)}
                style={{ background: selectedTemplate?.id === t.id ? 'var(--green-bg)' : '#fff', border: `1px solid ${selectedTemplate?.id === t.id ? 'var(--green-border)' : 'var(--border)'}`, borderLeft: `3px solid ${selectedTemplate?.id === t.id ? 'var(--green)' : 'transparent'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'all 0.12s' }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{t.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Array.isArray(t.questions) ? t.questions.length : 0} questions</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: template editor */}
        {selectedTemplate !== null ? (
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12 }}>
              <input
                className="input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Questionnaire name"
                style={{ fontSize: 16, fontWeight: 700, flex: 1 }}
              />
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {selectedTemplate.id > 0 && (
                  <button
                    onClick={() => { setSendTitle(editName); setSendModal(true) }}
                    className="btn btn-primary btn-sm"
                  >Send to Client</button>
                )}
                {selectedTemplate.id > 0 && (
                  <button onClick={() => setDeleteTemplateId(selectedTemplate.id)} style={{ fontSize: 12, color: '#DC2626', background: 'none', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Delete</button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {editQuestions.map((q, idx) => (
                <div key={q.id} className="card" style={{ padding: '14px 16px', background: 'var(--bg-secondary)' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <input
                        className="input"
                        value={q.label}
                        onChange={e => updateQuestion(idx, { label: e.target.value })}
                        placeholder="Question label"
                        style={{ marginBottom: 6 }}
                      />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px', height: 'auto' }} value={q.type} onChange={e => updateQuestion(idx, { type: e.target.value as QuestionDef['type'], options: undefined })}>
                          {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={q.required} onChange={e => updateQuestion(idx, { required: e.target.checked })} />
                          Required
                        </label>
                      </div>
                      {(q.type === 'select' || q.type === 'radio') && (
                        <div style={{ marginTop: 8 }}>
                          <label className="field-label" style={{ fontSize: 11 }}>Options (one per line)</label>
                          <textarea
                            className="input"
                            rows={3}
                            value={(q.options || []).join('\n')}
                            onChange={e => updateQuestion(idx, { options: e.target.value.split('\n') })}
                            placeholder="Option 1&#10;Option 2&#10;Option 3"
                          />
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0} style={{ fontSize: 10, padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>↑</button>
                      <button onClick={() => moveQuestion(idx, 1)} disabled={idx === editQuestions.length - 1} style={{ fontSize: 10, padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>↓</button>
                      <button onClick={() => removeQuestion(idx)} style={{ fontSize: 10, padding: '3px 7px', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 4, background: 'none', cursor: 'pointer', color: '#DC2626' }}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addQuestion} style={{ fontSize: 13, color: 'var(--green)', background: 'none', border: '1px dashed var(--green)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', width: '100%', marginBottom: 16 }}>+ Add Question</button>

            <button onClick={saveTemplate} disabled={saving} className="btn btn-primary" style={{ width: '100%' }}>
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>Select a template to edit, or create a new one.</p>
          </div>
        )}
      </div>

      {/* Sent questionnaires */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', marginBottom: 14 }}>Sent Questionnaires</h2>
        {sent.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>No questionnaires sent yet.</p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                  {['Client', 'Title', 'Sent', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                  <th style={{ padding: '10px 16px' }} />
                </tr>
              </thead>
              <tbody>
                {sent.map(q => (
                  <tr key={q.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{q.client_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{q.title}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)' }}>{formatDate(q.sent_at)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: q.status === 'completed' ? 'var(--color-green-bg)' : 'var(--bg-secondary)', color: q.status === 'completed' ? 'var(--color-green)' : 'var(--text-dim)', border: `1px solid ${q.status === 'completed' ? 'var(--color-green-border)' : 'var(--border)'}` }}>
                        {q.status === 'completed' ? '✓ Completed' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {q.status === 'completed' && (
                        <button onClick={() => setViewResponses(q)} style={{ fontSize: 12, color: 'var(--green)', background: 'none', border: '1px solid var(--green-border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>View Responses</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* Send modal */}
      {sendModal && (
        <>
          <div onClick={() => setSendModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 299, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, width: 'min(440px, 90vw)', background: 'var(--bg-elevated)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 28 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>Send Questionnaire</h3>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Client</label>
              <select className="input" value={sendClientId} onChange={e => setSendClientId(e.target.value)}>
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="field-label">Title (shown to client)</label>
              <input className="input" value={sendTitle} onChange={e => setSendTitle(e.target.value)} placeholder="e.g. Wedding Day Details" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={sendQuestionnaire} disabled={sending || !sendClientId || !sendTitle.trim()} className="btn btn-primary" style={{ flex: 1 }}>
                {sending ? 'Sending…' : 'Send →'}
              </button>
              <button onClick={() => setSendModal(false)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* View responses modal */}
      {viewResponses && (
        <>
          <div onClick={() => setViewResponses(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 299, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, width: 'min(560px, 90vw)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--bg-elevated)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 28 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{viewResponses.title}</h3>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20 }}>{viewResponses.client_name} · Submitted {formatDate(viewResponses.completed_at)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(viewResponses.questions || []).map(q => (
                <div key={q.id}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4 }}>{q.label}{q.required && ' *'}</p>
                  <p style={{ fontSize: 14, color: 'var(--text-primary)', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    {viewResponses.responses[q.id] || <em style={{ color: 'var(--text-dim)' }}>No answer</em>}
                  </p>
                </div>
              ))}
            </div>
            <button onClick={() => setViewResponses(null)} className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }}>Close</button>
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--green)', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}

      <style>{`
        @media (max-width: 767px) {
          .quest-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
