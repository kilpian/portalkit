import { Link } from 'react-router-dom'
import { SignIn } from '@clerk/clerk-react'

export default function SignInPage() {
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link to="/" className="auth-logo">
          Portal<em>Kit</em>
        </Link>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
          No account?{' '}
          <Link to="/signup" style={{ color: 'var(--green)', fontWeight: 600 }}>
            Start free →
          </Link>
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
        <SignIn
          routing="path"
          path="/signin"
          afterSignInUrl="/dashboard"
          appearance={{
            variables: {
              colorPrimary: '#1B4332',
              colorBackground: '#FDFAF5',
              fontFamily: 'Inter, sans-serif',
              borderRadius: '10px',
            },
            elements: {
              card: 'shadow-none border border-[#D4C9B4]',
              headerTitle: 'font-display',
            },
          }}
        />
      </main>

      <footer style={{ textAlign: 'center', padding: '20px 24px', borderTop: '1px solid var(--border-subtle)' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
          © {new Date().getFullYear()} Kilpian LLC dba PortalKit ·{' '}
          <Link to="/privacy" style={{ color: 'var(--text-dim)' }}>Privacy</Link> ·{' '}
          <Link to="/terms" style={{ color: 'var(--text-dim)' }}>Terms</Link>
        </p>
      </footer>
    </div>
  )
}
