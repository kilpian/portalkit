import { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { usePortalAuth } from '../context/AuthContext'
import { useApi } from '../lib/api'
import { trialDaysLeft } from '../lib/plan'
import Onboarding from '../pages/dashboard/Onboarding'

const ICON_DASHBOARD = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
)
const ICON_MESSAGES = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)
const ICON_CLIENTS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)
const ICON_PIPELINE = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="5" height="18" rx="1"/>
    <rect x="10" y="3" width="5" height="13" rx="1"/>
    <rect x="17" y="3" width="5" height="9" rx="1"/>
  </svg>
)
const ICON_CONTRACTS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
)
const ICON_QUESTIONNAIRES = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
)
const ICON_INVOICES = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2"/>
    <line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
)
const ICON_BOOKING = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)
const ICON_FILES = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)
const ICON_WORKFLOWS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
)
const ICON_LEADS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)
const ICON_PAYMENT_LINKS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
)
const ICON_PROPOSALS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="12" y1="17" x2="8" y2="17"/>
  </svg>
)

const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode; end?: boolean }[] = [
  { to: '/dashboard', end: true, label: 'Dashboard', icon: ICON_DASHBOARD },
  { to: '/dashboard/clients', label: 'Clients', icon: ICON_CLIENTS },
  { to: '/dashboard/messages', label: 'Messages', icon: ICON_MESSAGES },
  { to: '/dashboard/pipeline', label: 'Pipeline', icon: ICON_PIPELINE },
  { to: '/dashboard/booking', label: 'Booking', icon: ICON_BOOKING },
  { to: '/dashboard/leads', label: 'Lead Form', icon: ICON_LEADS },
  { to: '/dashboard/proposals', label: 'Proposals', icon: ICON_PROPOSALS },
  { to: '/dashboard/contracts', label: 'Contracts', icon: ICON_CONTRACTS },
  { to: '/dashboard/invoices', label: 'Invoices', icon: ICON_INVOICES },
  { to: '/dashboard/payment-links', label: 'Payment Links', icon: ICON_PAYMENT_LINKS },
  { to: '/dashboard/questionnaires', label: 'Questionnaires', icon: ICON_QUESTIONNAIRES },
  { to: '/dashboard/files', label: 'Files', icon: ICON_FILES },
  { to: '/dashboard/workflows', label: 'Workflows', icon: ICON_WORKFLOWS },
]

const SETTINGS_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

// Defined OUTSIDE DashboardLayout so its reference is stable across renders
function NavItem({ to, end, label, icon, collapsed, onClick, badge, disabled }: {
  to: string; end?: boolean; label: string; icon: React.ReactNode; collapsed?: boolean; onClick?: () => void; badge?: number; disabled?: boolean
}) {
  if (disabled) {
    return (
      <div
        title="Complete setup to access this feature"
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 10, padding: collapsed ? '10px 0' : '9px 10px',
          borderRadius: 7, fontSize: 14, fontWeight: 500,
          marginBottom: 2, opacity: 0.3, cursor: 'not-allowed',
          color: 'rgba(255,255,255,0.55)',
          borderLeft: '3px solid transparent',
          userSelect: 'none',
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex' }}>{icon}</span>
        {!collapsed && label}
      </div>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      title={collapsed ? label : undefined}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10,
        padding: collapsed ? '10px 0' : '9px 10px',
        borderRadius: 7,
        fontSize: 14,
        fontWeight: 500,
        textDecoration: 'none',
        marginBottom: 2,
        transition: 'background 0.12s ease, color 0.12s ease',
        background: isActive ? 'rgba(201,168,76,0.12)' : 'transparent',
        color: isActive ? '#C9A84C' : 'rgba(255,255,255,0.55)',
        borderLeft: isActive ? '3px solid #C9A84C' : '3px solid transparent',
      })}
      onMouseEnter={e => {
        const el = e.currentTarget
        if (!el.getAttribute('aria-current')) {
          el.style.background = 'rgba(255,255,255,0.07)'
          el.style.color = '#fff'
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        if (!el.getAttribute('aria-current')) {
          el.style.background = 'transparent'
          el.style.color = 'rgba(255,255,255,0.55)'
        }
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', position: 'relative' }}>
        {icon}
        {badge && badge > 0 ? (
          <span style={{ position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16, borderRadius: 8, background: '#DC2626', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </span>
      {!collapsed && label}
    </NavLink>
  )
}

// Defined OUTSIDE DashboardLayout — stable reference, no remount issues
function UserAvatar({ imageUrl, initials, size = 32 }: { imageUrl?: string; initials: string; size?: number }) {
  if (imageUrl) {
    return <img src={imageUrl} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#C9A84C', color: '#1B4332',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.38), fontWeight: 700,
    }}>
      {initials}
    </div>
  )
}

export default function DashboardLayout() {
  // FIX 3: use Clerk's useUser() directly for reliable, immediate user data
  const { user: clerkUser } = useUser()
  const { user: portalUser, signOut, refreshUser } = usePortalAuth()
  const { authFetch } = useApi()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  // FIX 1: collapsed state with localStorage persistence
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('pk_sidebar_collapsed') === 'true'
  )

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Fetch unread count on mount and every 60s
  useEffect(() => {
    const fetchUnread = () => {
      authFetch('/api/messages/unread-count', { method: 'get' })
        .then(res => setUnreadCount((res.data as { count: number }).count ?? 0))
        .catch(() => {})
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 60_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // FIX 1: stable toggle callback
  const toggleCollapsed = useCallback(() => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem('pk_sidebar_collapsed', String(next))
      return next
    })
  }, [])

  const days = trialDaysLeft(portalUser)
  const isPaid = portalUser?.plan === 'active'
  const onboardingComplete = !portalUser || portalUser.onboarding_completed === true

  // FIX 5: block the entire dashboard until onboarding is done — no sidebar, no
  // content, no route is reachable. This prevents bypassing onboarding by typing
  // a /dashboard/* URL directly. All hooks above run unconditionally first.
  if (portalUser && !portalUser.onboarding_completed) {
    return <Onboarding onComplete={refreshUser} />
  }

  // FIX 3: derive display info directly from Clerk
  const displayName = clerkUser?.fullName || clerkUser?.firstName || clerkUser?.emailAddresses?.[0]?.emailAddress || 'User'
  const displayEmail = clerkUser?.emailAddresses?.[0]?.emailAddress || portalUser?.email || ''
  const avatarUrl = clerkUser?.imageUrl
  const rawInitials = ((clerkUser?.firstName?.[0] ?? '') + (clerkUser?.lastName?.[0] ?? '')).toUpperCase()
  const initials = rawInitials || displayEmail[0]?.toUpperCase() || '?'

  const handleSignOut = () => {
    signOut()
    navigate('/signin')
  }

  // FIX 1: renderSidebar is a plain function returning JSX, NOT a React component.
  // This avoids the "component defined inside render" bug where React sees a new
  // component type on every re-render and unmounts/remounts the entire subtree.
  const renderSidebar = (isCollapsed: boolean, isMobile: boolean) => (
    <>
      {/* Logo */}
      <div style={{
        padding: isCollapsed ? '18px 0' : '18px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
      }}>
        {isCollapsed ? (
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 800, color: '#C9A84C', letterSpacing: '-0.02em' }}>PK</span>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 800, color: '#FDFAF5', letterSpacing: '-0.03em' }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </span>
        )}
      </div>

      {/* Gold accent line */}
      {!isCollapsed && (
        <div style={{ height: 1, background: 'linear-gradient(90deg, rgba(201,168,76,0.45) 0%, transparent 80%)', flexShrink: 0 }} />
      )}

      {/* Main nav */}
      <nav role="navigation" aria-label="Main navigation" style={{ flex: 1, padding: isCollapsed ? '12px 8px' : '12px 10px', overflowY: 'auto' }}>
        {NAV_ITEMS.map(item => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={isCollapsed}
            onClick={() => setMobileOpen(false)}
            badge={item.to === '/dashboard/messages' ? unreadCount : undefined}
            disabled={!onboardingComplete && item.to !== '/dashboard'}
          />
        ))}
      </nav>

      {/* Settings — pinned before collapse button */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: isCollapsed ? '8px 8px 0' : '10px 10px 0', flexShrink: 0 }}>
        <NavItem
          to="/dashboard/settings"
          label="Settings"
          collapsed={isCollapsed}
          onClick={() => setMobileOpen(false)}
          icon={SETTINGS_ICON}
        />
      </div>

      {/* FIX 1: collapse toggle — desktop only, clearly visible */}
      {!isMobile && (
        <div style={{ padding: '6px 10px', flexShrink: 0 }}>
          <button
            onClick={toggleCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start',
              gap: 8,
              width: '100%', padding: '8px 10px', borderRadius: 7,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 12, fontWeight: 500,
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              {isCollapsed
                ? <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>
                : <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>
              }
            </svg>
            {!isCollapsed && 'Collapse'}
          </button>
        </div>
      )}

      {/* User info */}
      <div style={{
        padding: isCollapsed ? '10px 8px 14px' : '12px 14px 16px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        {isCollapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div title={displayName}>
              <UserAvatar imageUrl={avatarUrl} initials={initials} size={32} />
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.3)', display: 'flex', padding: 5, borderRadius: 6,
                transition: 'color 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#FCA5A5' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.3)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <UserAvatar imageUrl={avatarUrl} initials={initials} size={34} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#FDFAF5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                  {displayName}
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayEmail}
                </p>
              </div>
            </div>

            {/* Plan badge */}
            <div style={{ marginBottom: 10 }}>
              {isPaid ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: 'rgba(52,211,153,0.14)', color: '#34D399', border: '1px solid rgba(52,211,153,0.28)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D399', flexShrink: 0 }} />
                  Active
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: 'rgba(201,168,76,0.14)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.28)' }}>
                  <span className="pk-pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C', flexShrink: 0 }} />
                  {days > 0 ? `${days}d trial` : 'Expired'}
                </span>
              )}
            </div>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '7px 10px', borderRadius: 7,
                fontSize: 13, fontWeight: 500,
                color: 'rgba(255,255,255,0.45)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#FCA5A5' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          </>
        )}
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 99, display: 'none' }}
          className="mobile-overlay"
        />
      )}

      {/* Desktop sidebar — FIX 1: 64px collapsed, 240px expanded, smooth transition */}
      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: collapsed ? 64 : 240,
          flexShrink: 0,
          background: '#1B4332',
          height: '100vh',
          overflow: 'hidden',
          transition: 'width 0.25s ease',
        }}
        className="sidebar-desktop"
      >
        {renderSidebar(collapsed, false)}
      </aside>

      {/* Mobile sidebar (fixed drawer, always expanded) */}
      <aside
        style={{
          display: 'none',
          flexDirection: 'column',
          width: 240,
          flexShrink: 0,
          background: '#1B4332',
          height: '100vh',
          overflow: 'hidden',
          position: 'fixed',
          top: 0, left: 0,
          zIndex: 100,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        }}
        className="sidebar-mobile"
      >
        {renderSidebar(false, true)}
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Mobile top bar */}
        <div
          style={{
            display: 'none',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: '#1B4332',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}
          className="mobile-topbar"
        >
          <button
            onClick={() => setMobileOpen(v => !v)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#FDFAF5', display: 'flex', alignItems: 'center', padding: 4 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 800, color: '#FDFAF5', letterSpacing: '-0.03em' }}>
            Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
          </span>
          <div style={{ width: 30 }} />
        </div>

        {/* Page content */}
        <main key={location.pathname} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Outlet />
        </main>
      </div>

      <style>{`
        @media (max-width: 767px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile { display: flex !important; }
          .mobile-topbar { display: flex !important; }
          .mobile-overlay { display: block !important; }
        }
        @keyframes pk-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.85); }
        }
        .pk-pulse-dot {
          animation: pk-pulse 2.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
