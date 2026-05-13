import { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { usePortalAuth } from '../context/AuthContext'
import { trialDaysLeft } from '../lib/plan'

const NAV = [
  {
    to: '/dashboard', end: true,
    label: 'Dashboard',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/clients',
    label: 'Clients',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/contracts',
    label: 'Contracts',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/invoices',
    label: 'Invoices',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2"/>
        <line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/files',
    label: 'Files',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/messages',
    label: 'Messages',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
]

const SETTINGS_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

function NavItem({ to, end, label, icon, collapsed, onClick }: {
  to: string; end?: boolean; label: string; icon: React.ReactNode; collapsed?: boolean; onClick?: () => void
}) {
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
      <span style={{ flexShrink: 0, display: 'flex' }}>{icon}</span>
      {!collapsed && label}
    </NavLink>
  )
}

export default function DashboardLayout() {
  const { user, signOut } = usePortalAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('pk_sidebar_collapsed') === 'true'
  )

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem('pk_sidebar_collapsed', String(next))
      return next
    })
  }, [])

  const days = trialDaysLeft(user)
  const isPaid = user?.plan === 'active'
  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'

  const handleSignOut = () => {
    signOut()
    navigate('/signin')
  }

  const SidebarInner = ({ isMobile = false }: { isMobile?: boolean }) => {
    const isCollapsed = collapsed && !isMobile
    return (
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

        {/* Nav */}
        <nav style={{ flex: 1, padding: isCollapsed ? '12px 8px' : '12px 10px', overflowY: 'auto' }}>
          {NAV.map(item => (
            <NavItem key={item.to} {...item} collapsed={isCollapsed} onClick={() => setMobileOpen(false)} />
          ))}
        </nav>

        {/* Settings */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: isCollapsed ? '8px 8px 0' : '10px 10px 0', flexShrink: 0 }}>
          <NavItem
            to="/dashboard/settings"
            label="Settings"
            collapsed={isCollapsed}
            onClick={() => setMobileOpen(false)}
            icon={SETTINGS_ICON}
          />
        </div>

        {/* Collapse toggle — desktop only */}
        {!isMobile && (
          <div style={{ padding: '4px 8px', flexShrink: 0 }}>
            <button
              onClick={toggleCollapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '100%', padding: '6px', borderRadius: 6,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.25)',
                transition: 'color 0.12s, background 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {collapsed
                  ? <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>
                  : <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>
                }
              </svg>
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
              <div title={user?.full_name || 'User'} style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: '#C9A84C', color: '#1B4332',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, cursor: 'default',
              }}>
                {initials}
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.3)', display: 'flex', padding: 5, borderRadius: 6,
                  transition: 'color 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#FCA5A5'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
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
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: '#C9A84C', color: '#1B4332',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                }}>
                  {initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#FDFAF5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                    {user?.full_name || 'User'}
                  </p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.email}
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
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* ── Mobile overlay ───────────────────────────────────── */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 99, display: 'none' }}
          className="mobile-overlay"
        />
      )}

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: collapsed ? 56 : 240,
          flexShrink: 0,
          background: '#1B4332',
          height: '100vh',
          overflow: 'hidden',
          transition: 'width 0.2s ease',
        }}
        className="sidebar-desktop"
      >
        <SidebarInner />
      </aside>

      {/* ── Mobile sidebar (fixed drawer) ────────────────────── */}
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
        <SidebarInner isMobile />
      </aside>

      {/* ── Main area ────────────────────────────────────────── */}
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
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
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
