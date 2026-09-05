import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../lib/api'

interface NotificationItem {
  id: number
  type: string
  title: string
  link: string | null
  read: boolean
  created_at: string
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotificationBell({ collapsed, onboardingDone }: { collapsed?: boolean; onboardingDone: boolean }) {
  const { authFetch } = useApi()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const fetchUnreadCount = () => {
    authFetch('/api/notifications/unread-count', { method: 'get' })
      .then(res => setUnreadCount(res.data.count ?? 0))
      .catch(() => {})
  }

  // Matches the guard already used for the messages unread-count fetch in
  // DashboardLayout: /api/notifications/* isn't onboarding-exempt server-side,
  // so calling it before onboarding is confirmed complete gets a 403
  // 'onboarding_required' — which authFetch's interceptor turns into a hard
  // window.location.href reload. Since this component also renders in the
  // background (blurred) sidebar while the onboarding modal is blocking,
  // firing unconditionally caused an infinite reload loop for new signups.
  useEffect(() => {
    if (!onboardingDone) return
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 60_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingDone])

  useEffect(() => {
    if (!open || !onboardingDone) return
    setLoading(true)
    authFetch('/api/notifications', { method: 'get' })
      .then(res => setNotifications(res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onboardingDone])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
    authFetch('/api/notifications/mark-all-read', { method: 'post' }).catch(() => {})
  }

  const handleItemClick = (n: NotificationItem) => {
    if (!n.read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
      setUnreadCount(c => Math.max(0, c - 1))
      authFetch(`/api/notifications/${n.id}/read`, { method: 'post' }).catch(() => {})
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const hasUnread = notifications.some(n => !n.read)

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start' }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Notifications"
        title="Notifications"
        style={{
          position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 6, borderRadius: 7, transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={{ position: 'absolute', top: 2, right: collapsed ? 2 : 4, minWidth: 15, height: 15, borderRadius: 8, background: '#DC2626', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
            width: 340, maxWidth: '85vw', maxHeight: 420, overflowY: 'auto',
            background: '#fff', zIndex: 500, padding: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, background: '#fff' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</span>
            {hasUnread && (
              <button onClick={markAllRead} style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-dim)' }}>Loading…</div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-dim)' }}>No notifications yet.</div>
          ) : (
            notifications.map(n => (
              <button
                key={n.id}
                onClick={() => handleItemClick(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px',
                  background: n.read ? 'transparent' : 'rgba(201,168,76,0.08)',
                  borderLeft: n.read ? '3px solid transparent' : '3px solid #C9A84C',
                  borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--text-primary)', margin: 0 }}>{n.title}</p>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '4px 0 0' }}>{timeAgo(n.created_at)}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
