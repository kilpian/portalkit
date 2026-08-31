import { useRef, useState } from 'react'
import { useApi } from '../lib/api'

interface AnalyzeResponse {
  headers: string[]
  sampleRows: string[][]
  mapping: Record<string, string | null>
  unmatchedColumns: string[]
  totalRows: number
}

interface SkippedRow {
  row: number
  reason: string
}

interface ConfirmResponse {
  imported: number
  skipped: SkippedRow[]
  skippedCount: number
  total: number
}

const TARGET_FIELDS: { value: string; label: string }[] = [
  { value: '', label: "Don't import" },
  { value: 'client_name', label: 'Client Name' },
  { value: 'partner_name', label: 'Partner Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'wedding_date', label: 'Wedding Date' },
  { value: 'venue', label: 'Venue' },
  { value: 'contract_status', label: 'Contract Status' },
  { value: 'invoice_amount', label: 'Invoice Amount' },
  { value: 'notes', label: 'Notes' },
]

type Step = 'upload' | 'review' | 'summary'

export default function ImportClientsModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  const { authFetch } = useApi()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')

  const [headers, setHeaders] = useState<string[]>([])
  const [sampleRows, setSampleRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [totalRows, setTotalRows] = useState(0)

  const [confirming, setConfirming] = useState(false)
  const [summary, setSummary] = useState<ConfirmResponse | null>(null)

  const reset = () => {
    setStep('upload')
    setFile(null)
    setError('')
    setHeaders([])
    setSampleRows([])
    setMapping({})
    setTotalRows(0)
    setSummary(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleAnalyze = async () => {
    if (!file) return
    setAnalyzing(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await authFetch('/api/import/analyze', {
        method: 'post',
        data: fd,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const data: AnalyzeResponse = res.data
      setHeaders(data.headers)
      setSampleRows(data.sampleRows)
      setMapping(data.mapping)
      setTotalRows(data.totalRows)
      setStep('review')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Could not read this file. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  const setFieldForHeader = (header: string, field: string) => {
    setMapping(prev => {
      const next = { ...prev }
      if (field) {
        // A target field can only be used once — reassigning it here clears
        // it from whichever other column previously had it.
        for (const h of Object.keys(next)) {
          if (h !== header && next[h] === field) next[h] = null
        }
      }
      next[header] = field || null
      return next
    })
  }

  const handleConfirm = async () => {
    if (!file) return
    setConfirming(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mapping', JSON.stringify(mapping))
      const res = await authFetch('/api/import/confirm', {
        method: 'post',
        data: fd,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSummary(res.data)
      setStep('summary')
      onImported?.()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Import failed. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  if (!open) return null

  const clientNameMapped = Object.values(mapping).includes('client_name')
  const usedFields = new Set(Object.values(mapping).filter(Boolean) as string[])

  return (
    <>
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 301, width: 'min(680px, 92vw)', maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>Import Your Data</h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9CA3AF' }}>✕</button>
        </div>

        {step === 'upload' && (
          <div>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 16, lineHeight: 1.6 }}>
              Upload a CSV or Excel (.xlsx) file exported from your old CRM or spreadsheet. We'll suggest how each column maps to your client fields — nothing is saved until you review and confirm.
            </p>
            <div style={{ border: '2px dashed #D1D5DB', borderRadius: 10, padding: 24, textAlign: 'center' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={e => setFile(e.target.files?.[0] || null)}
                style={{ fontSize: 13 }}
              />
              {file && <p style={{ fontSize: 13, color: '#374151', marginTop: 10 }}>Selected: {file.name}</p>}
            </div>
            {error && <p style={{ fontSize: 13, color: '#DC2626', marginTop: 12 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <button onClick={handleClose} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 14, cursor: 'pointer', color: '#374151' }}>Cancel</button>
              <button
                onClick={handleAnalyze}
                disabled={!file || analyzing}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: !file || analyzing ? 'not-allowed' : 'pointer', opacity: !file || analyzing ? 0.6 : 1 }}
              >
                {analyzing ? 'Analyzing...' : 'Analyze File →'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 6, lineHeight: 1.6 }}>
              Found <strong>{totalRows}</strong> row{totalRows === 1 ? '' : 's'}. Review the suggested mapping below — change any column with the dropdown before importing.
            </p>
            {!clientNameMapped && (
              <p style={{ fontSize: 13, color: '#B45309', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                ⚠️ No column is mapped to Client Name. Every row will be skipped — a client name is required.
              </p>
            )}
            <div style={{ overflowX: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#374151' }}>Your Column</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#374151' }}>Sample Value</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#374151' }}>Maps To</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header, colIdx) => {
                    const sample = sampleRows[0]?.[colIdx] ?? ''
                    const currentField = mapping[header] || ''
                    return (
                      <tr key={header} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 500, color: '#111827' }}>{header || <em style={{ color: '#9CA3AF' }}>(blank)</em>}</td>
                        <td style={{ padding: '8px 12px', color: '#6B7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sample || <em style={{ color: '#D1D5DB' }}>—</em>}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <select
                            value={currentField}
                            onChange={e => setFieldForHeader(header, e.target.value)}
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, background: '#fff' }}
                          >
                            {TARGET_FIELDS.map(f => (
                              <option key={f.value} value={f.value} disabled={!!f.value && f.value !== currentField && usedFields.has(f.value)}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 10 }}>
              Rows with no client name will be skipped and listed after import. Venue, contract status, and invoice amount are saved into the client's notes.
            </p>
            {error && <p style={{ fontSize: 13, color: '#DC2626', marginTop: 12 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <button onClick={() => setStep('upload')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #D1D5DB', background: 'transparent', fontSize: 14, cursor: 'pointer', color: '#374151' }}>Back</button>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: confirming ? 'not-allowed' : 'pointer', opacity: confirming ? 0.6 : 1 }}
              >
                {confirming ? 'Importing...' : 'Confirm Import →'}
              </button>
            </div>
          </div>
        )}

        {step === 'summary' && summary && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: '#059669', margin: 0 }}>{summary.imported}</p>
                <p style={{ fontSize: 12, color: '#065F46', margin: '2px 0 0' }}>Imported</p>
              </div>
              <div style={{ flex: 1, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: '#DC2626', margin: 0 }}>{summary.skippedCount}</p>
                <p style={{ fontSize: 12, color: '#991B1B', margin: '2px 0 0' }}>Skipped</p>
              </div>
              <div style={{ flex: 1, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: '#111827', margin: 0 }}>{summary.total}</p>
                <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>Total Rows</p>
              </div>
            </div>
            {summary.skipped.length > 0 && (
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Skipped rows:</p>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                  {summary.skipped.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderBottom: i < summary.skipped.length - 1 ? '1px solid #F3F4F6' : 'none', fontSize: 13 }}>
                      <span style={{ color: '#6B7280', flexShrink: 0 }}>Row {s.row}</span>
                      <span style={{ color: '#991B1B', textAlign: 'right' }}>{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={handleClose} style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 22 }}>
              Done
            </button>
          </div>
        )}
      </div>
    </>
  )
}
