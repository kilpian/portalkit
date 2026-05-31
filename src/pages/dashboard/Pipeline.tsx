import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, usePolling, type Client } from '../../lib/api'

const STAGES = [
  { key: 'inquiry',      label: 'Inquiry',      color: '#6B7280' },
  { key: 'consultation', label: 'Consultation', color: '#D97706' },
  { key: 'booked',       label: 'Booked',       color: '#2563EB' },
  { key: 'in_progress',  label: 'In Progress',  color: '#7C3AED' },
  { key: 'delivered',    label: 'Delivered',    color: '#059669' },
  { key: 'archived',     label: 'Archived',     color: '#9CA3AF' },
]

interface StageStat {
  stage: string
  client_count: number
  total_cents: number
}

function formatEventDate(dateStr: string | null | undefined) {
  if (!dateStr) return ''
  const clean = dateStr.split('T')[0]
  const [year, month, day] = clean.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysInStage(client: Client): number | null {
  if (!client.stage_changed_at) return null
  const days = Math.floor((Date.now() - new Date(client.stage_changed_at).getTime()) / 86_400_000)
  return days < 0 ? 0 : days
}

function stageAgeColor(days: number): string {
  if (days < 7) return '#059669'
  if (days <= 14) return '#D97706'
  return '#DC2626'
}

function formatMoney(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US')
}

export default function Pipeline() {
  const { authFetch } = useApi()
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [stats, setStats] = useState<Record<string, StageStat>>({})
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const dragging = useRef<number | null>(null)

  const fetchStats = () =>
    authFetch('/api/pipeline/stats', { method: 'get' })
      .then(res => {
        const map: Record<string, StageStat> = {}
        if (Array.isArray(res.data)) {
          for (const row of res.data as StageStat[]) {
            map[row.stage || 'inquiry'] = {
              stage: row.stage || 'inquiry',
              client_count: Number(row.client_count) || 0,
              total_cents: Number(row.total_cents) || 0,
            }
          }
        }
        setStats(map)
      })
      .catch(() => {})

  const fetchAll = () =>
    Promise.all([
      authFetch('/api/clients', { method: 'get' }).then(res => setClients(Array.isArray(res.data) ? res.data : [])),
      fetchStats(),
    ]).catch(console.error).finally(() => setLoading(false))

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  usePolling(fetchAll, 60000)

  const updateStage = async (clientId: number, stage: string) => {
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, stage, stage_changed_at: new Date().toISOString() } : c))
    try {
      await authFetch(`/api/clients/${clientId}/stage`, { method: 'patch', data: { stage } })
      fetchStats()
    } catch {
      fetchAll()
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px 32px 64px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em', marginBottom: 2 }}>
          Pipeline
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Drag clients between stages. Totals show unpaid invoice value per stage.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
          {STAGES.map(s => <div key={s.key} className="skeleton" style={{ minWidth: 220, height: 320, borderRadius: 10 }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
          {STAGES.map(stage => {
            const stageClients = clients.filter(c => (c.stage || 'inquiry') === stage.key)
            const stat = stats[stage.key]
            const totalCents = stat?.total_cents ?? 0
            return (
              <div
                key={stage.key}
                onDragOver={e => { e.preventDefault(); setDragOver(stage.key) }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(null)
                  if (dragging.current !== null) updateStage(dragging.current, stage.key)
                  dragging.current = null
                }}
                style={{
                  minWidth: 220, flex: '0 0 220px',
                  background: dragOver === stage.key ? '#f0f9ff' : 'var(--bg-secondary)',
                  borderRadius: 10,
                  border: `1px solid ${dragOver === stage.key ? stage.color : 'var(--border)'}`,
                  borderTop: `3px solid ${stage.color}`,
                  display: 'flex', flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: stage.color }}>{stage.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 20, height: 20, borderRadius: 10, background: stage.color + '20', color: stage.color, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{stageClients.length}</span>
                </div>

                <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60 }}>
                  {stageClients.length === 0 && (
                    <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '12px 8px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
                      No clients
                    </div>
                  )}
                  {stageClients.map(c => {
                    const days = daysInStage(c)
                    return (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={() => { dragging.current = c.id }}
                        onDragEnd={() => { dragging.current = null }}
                        onClick={() => navigate('/dashboard/clients')}
                        style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', cursor: 'grab', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', userSelect: 'none' }}
                        onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'}
                      >
                        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{c.name}</p>
                        {c.event_type && <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>{c.event_type}</p>}
                        {c.event_date && <p style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>{formatEventDate(c.event_date)}</p>}
                        {days !== null && (
                          <p style={{ fontSize: 10, fontWeight: 600, color: stageAgeColor(days) }}>
                            {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} in this stage`}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: totalCents > 0 ? stage.color : 'var(--text-dim)' }}>
                    Total: {formatMoney(totalCents)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
