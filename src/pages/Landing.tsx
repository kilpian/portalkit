import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePortalAuth } from '../context/AuthContext'

export default function Landing() {
  const { isLoggedIn, isLoaded } = usePortalAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoaded) return
    if (isLoggedIn) navigate('/dashboard', { replace: true })
  }, [isLoggedIn, isLoaded, navigate])

  if (!isLoaded || isLoggedIn) {
    return (
      <div style={{ background: '#FDFAF5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div style={{ background: '#FDFAF5', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.04em', marginBottom: 12 }}>
          Portal<em style={{ fontStyle: 'normal', color: '#C9A84C' }}>Kit</em>
        </div>
        <p style={{ fontSize: 18, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 36 }}>
          The client portal for wedding photographers.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/signup" className="btn btn-primary" style={{ fontSize: 15, padding: '12px 28px' }}>
            Start Free Trial →
          </Link>
          <Link to="/signin" className="btn btn-ghost" style={{ fontSize: 15, padding: '12px 28px' }}>
            Sign In
          </Link>
        </div>
        <p style={{ marginTop: 32, fontSize: 13, color: 'var(--text-dim)' }}>getportalkit.com</p>
      </div>
    </div>
  )
}
